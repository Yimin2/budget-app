'use client';

import { useState, type ReactNode } from 'react';
import {
  ALLOWANCE_REVIEW_PROMPT, canAutoFill, conflictingRemainderRule, formatMan, isAutoRule, isFixedRule, isRemainderRule, isValidMonth, monthOf,
  needBreakdownText, ruleChangeText, ruleNext, RULE_KIND_LABEL,
} from '@/domain';
import type { Account, AllocationRule, IncomePlan, RuleKind, Won } from '@/domain/types';
import { Badge, Button, Field, Icon, MoneyInput, SegmentedControl, Select, cx, focusFirstInvalid } from '@/ui';
import { DAY_OPTIONS, isEmail } from '@/app/start/new/wizard';
import { AccountPicker } from '../_components/AccountPicker';
import { PersonPicker, peopleOptions } from '../_components/PersonPicker';
import type { ReadyLedger } from '../_components/RequireLedger';
import { accountName, periodLabel, startMonthForNew, startMonthHint } from '../settings/helpers';
import { useRunner } from '../settings/useRunner';
import type { IncomingLine } from './flow';
import styles from './budget.module.css';

/**
 * 통장 카드의 '들어오는 돈' 줄 (작업정리 8-3): 매달 배분(받는 통장 = 이 통장) · 월급통장은 수입 계획.
 * 줄을 누르면 그 자리에서 고치는 칸이 펼쳐져요(창 없음). 카드마다 [+ 들어오는 돈] · 월급통장은 [+ 수입].
 * 지난 달처럼 보기만 하는 달은 줄을 누를 수 없어요
 */

const AUTO_ONLY_MESSAGE = '알아서 맞추기는 생활비 통장으로 보낼 때만 고를 수 있어요';

const KIND_OPTIONS: { value: RuleKind; label: string }[] = [
  { value: 'fixed', label: RULE_KIND_LABEL.fixed },
  { value: 'auto', label: RULE_KIND_LABEL.auto },
  { value: 'remainder', label: RULE_KIND_LABEL.remainder },
];

const kindOf = (r: Pick<AllocationRule, 'kind'>): RuleKind => (isRemainderRule(r) ? 'remainder' : isAutoRule(r) ? 'auto' : 'fixed');
const isIncomeAccount = (a: Account) => a.role === 'income';

interface RuleRow {
  rule: AllocationRule;
  day: number;
  fromAccountId: string;
  /** 이번 달 배분 금액 (다음 달부터 시작하는 줄은 다음 배분 금액, 모르면 null) */
  amount: Won | null;
}

/** 이 통장으로 들어오는 배분 줄: 그달 배분(월급날 미리보기 금액) + 다음 달부터 시작하는 배분 */
export function incomingRuleRows(ledger: ReadyLedger, accountId: string, incoming: IncomingLine[]): RuleRow[] {
  const month = monthOf(ledger.today);
  const seen = new Set(incoming.map((l) => l.rule.id));
  const rows: RuleRow[] = incoming.map((l) => ({ rule: l.rule, day: l.day, fromAccountId: l.fromAccountId, amount: l.amount }));
  const later = ledger.data.rules
    .filter((r) => !r.deleted && r.toAccountId === accountId && !seen.has(r.id) && isValidMonth(r.startMonth) && r.startMonth > month)
    .sort((a, b) => (a.startMonth < b.startMonth ? -1 : a.startMonth > b.startMonth ? 1 : a.dayOfMonth - b.dayOfMonth));
  for (const r of later) {
    const next = ruleNext(ledger.data, r, ledger.today);
    rows.push({ rule: r, day: r.dayOfMonth, fromAccountId: r.fromAccountId, amount: next?.amount ?? (isFixedRule(r) ? r.amount : null) });
  }
  return rows;
}

/** 월급통장으로 들어오는 수입 계획 (끝나지 않은 것, 받는 날 순) */
export function incomePlanRows(ledger: ReadyLedger, accountId: string): IncomePlan[] {
  const month = monthOf(ledger.today);
  return (ledger.data.incomePlans ?? [])
    .filter((p) => !p.deleted && p.accountId === accountId && (p.endMonth === null || p.endMonth === '' || p.endMonth >= month))
    .sort((a, b) => a.dayOfMonth - b.dayOfMonth || a.personName.localeCompare(b.personName, 'ko'));
}

/* ---------- 줄 하나 (누르면 펼치는 단추) ---------- */

function InRowButton({
  readOnly,
  open,
  controls,
  onToggle,
  title,
  sub,
  amount,
  testId,
}: {
  readOnly: boolean;
  open: boolean;
  controls: string;
  onToggle: () => void;
  title: string;
  sub: ReactNode;
  amount: string;
  testId: string;
}) {
  const content = (
    <>
      <span className="main">
        <span className={cx('t', styles.inTitle)}>{title}</span>
        <span className="s">
          <span className="st-sub">{sub}</span>
        </span>
      </span>
      <span className="trail">
        <strong>{amount}</strong>
      </span>
    </>
  );
  if (readOnly) {
    return (
      <div className={cx('lrow', styles.inRow)} data-testid={testId}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={cx('lrow', styles.inRow)}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      data-testid={testId}
    >
      {content}
      <Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} className="chev" />
    </button>
  );
}

/** 지우기 전에 그 자리에서 한 번 더 묻기 */
function DeleteConfirm({ label, question, busy, onConfirm }: { label: string; question: string; busy: boolean; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <div className="st-danger">
        <Button variant="ghost" icon="trash" onClick={() => setAsking(true)}>
          {label}
        </Button>
      </div>
    );
  }
  return (
    <div className={styles.monthConfirm} role="group" aria-label={question}>
      <p className={styles.monthConfirmText}>{question}</p>
      <div className={styles.monthActions}>
        <Button variant="danger" loading={busy} onClick={onConfirm}>
          지우기
        </Button>
        <Button variant="ghost" onClick={() => setAsking(false)} disabled={busy}>
          그대로 둘게요
        </Button>
      </div>
    </div>
  );
}

/* ---------- 매달 배분 줄 ---------- */

/**
 * 이 통장으로 들어오는 매달 배분 줄 + [+ 들어오는 돈].
 * 줄마다 보내는 날 · 보내는 통장 · 이번 배분 금액 · 방식, 알아서 맞추기는 금액 내역, 용돈 금액 확인이 필요하면 그 줄 아래 금액 칸
 */
export function IncomingRules({
  ledger,
  account,
  incoming,
  readOnly,
  addable = true,
}: {
  ledger: ReadyLedger;
  account: Account;
  incoming: IncomingLine[];
  readOnly: boolean;
  /** [+ 들어오는 돈] 단추 (월급통장은 [+ 수입]만) */
  addable?: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const month = monthOf(ledger.today);
  const rows = incomingRuleRows(ledger, account.id, incoming);
  const baseId = `bd-in-${account.id}`;
  const canAdd = addable && !readOnly && ledger.activeAccounts.some((a) => a.id !== account.id);
  if (rows.length === 0 && !canAdd) return null;
  const toggle = (id: string) => setEditing((e) => (e === id ? null : id));

  return (
    <div className="stack gap-2">
      {rows.length > 0 ? (
        <ul className={cx('list', styles.inRows)} aria-label={`${account.name} 매달 배분`}>
          {rows.map(({ rule: r, day, fromAccountId, amount }) => {
            const kind = kindOf(r);
            const next = kind === 'remainder' ? null : ruleNext(ledger.data, r, ledger.today);
            const change = next ? ruleChangeText(next) : null;
            const label = periodLabel(r.startMonth, r.endMonth, month);
            const open = editing === r.id;
            const editorId = `${baseId}-${r.id}`;
            const review = !!r.needsReview && isFixedRule(r);
            return (
              <li key={r.id}>
                <InRowButton
                  readOnly={readOnly}
                  open={open}
                  controls={editorId}
                  onToggle={() => toggle(r.id)}
                  title={`${day}일 · ${accountName(ledger.data.accounts, fromAccountId)}에서`}
                  amount={amount === null ? '그날 정해져요' : formatMan(amount)}
                  testId="incoming-row"
                  sub={
                    <>
                      <span>{RULE_KIND_LABEL[kind]}</span>
                      {label ? (
                        <Badge size="sm" tone="info">
                          {label}
                        </Badge>
                      ) : null}
                      {kind === 'auto' && next?.need ? <span className="st-hint-line">{needBreakdownText(next.need)}</span> : null}
                      {change ? <span className="st-change">{change}</span> : null}
                      {review ? <span className="st-warn-text">{ALLOWANCE_REVIEW_PROMPT}</span> : null}
                    </>
                  }
                />
                {open ? (
                  <RuleEditor id={editorId} ledger={ledger} to={account} rule={r} onDone={() => setEditing(null)} />
                ) : review && !readOnly ? (
                  <AllowanceReview ledger={ledger} rule={r} />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {canAdd ? (
        editing === 'new' ? (
          <RuleEditor id={`${baseId}-new`} ledger={ledger} to={account} rule={null} onDone={() => setEditing(null)} />
        ) : (
          <div>
            <Button variant="outline" icon="plus" onClick={() => setEditing('new')} aria-label={`${account.name} 들어오는 돈 추가`}>
              들어오는 돈
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}

interface RuleDraft {
  fromAccountId: string;
  kind: RuleKind;
  amount: number | null;
  day: number;
}

type RuleErrors = Partial<Record<'from' | 'amount' | 'kind', string>>;

/** 매달 배분 그 자리 고치기 · 추가: 금액 · 방식 · 보내는 통장 · 이체일 · 지우기 (받는 통장 = 이 카드의 통장) */
function RuleEditor({
  id,
  ledger,
  to,
  rule,
  onDone,
}: {
  id: string;
  ledger: ReadyLedger;
  to: Account;
  rule: AllocationRule | null;
  onDone: () => void;
}) {
  const { busy, run } = useRunner();
  const accounts = ledger.activeAccounts;
  const sources = accounts.filter((a) => a.id !== to.id);
  const autoTarget = canAutoFill(to);
  const [draft, setDraft] = useState<RuleDraft>(() => {
    if (rule) {
      const kind = kindOf(rule);
      return { fromAccountId: rule.fromAccountId, kind, amount: kind === 'fixed' ? rule.amount : null, day: rule.dayOfMonth };
    }
    const from = ledger.incomeAccounts.find((a) => a.id !== to.id) ?? sources[0];
    const payday = (ledger.data.incomePlans ?? []).filter((p) => !p.deleted && p.accountId === from?.id).sort((a, b) => a.dayOfMonth - b.dayOfMonth)[0];
    // 생활비 통장은 '알아서 맞추기'가 기본, 용돈 · 이벤트통장 등은 '매달 같은 금액'
    return { fromAccountId: from?.id ?? '', kind: autoTarget ? 'auto' : 'fixed', amount: null, day: payday?.dayOfMonth ?? 1 };
  });
  const [errors, setErrors] = useState<RuleErrors>({});
  const title = rule ? `${to.name} 배분 고치기` : `${to.name} 들어오는 돈 추가`;

  async function save() {
    const next: RuleErrors = {};
    if (!draft.fromAccountId || draft.fromAccountId === to.id) next.from = '받는 통장과 다른 통장을 골라 주세요';
    if (draft.kind === 'fixed' && (draft.amount === null || draft.amount <= 0)) next.amount = '금액을 입력해 주세요';
    if (draft.kind === 'auto' && !autoTarget) next.kind = AUTO_ONLY_MESSAGE;
    if (
      draft.kind === 'remainder' &&
      conflictingRemainderRule(ledger.data, {
        id: rule?.id ?? null,
        fromAccountId: draft.fromAccountId,
        dayOfMonth: draft.day,
        startMonth: rule?.startMonth ?? startMonthForNew(ledger.today, draft.day),
        endMonth: rule?.endMonth ?? null,
      })
    ) {
      next.kind = '이 통장에서 같은 날 나머지를 보내는 배분이 이미 있어요';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusFirstInvalid();
      return;
    }
    const amount = draft.kind === 'fixed' ? draft.amount! : 0;
    const ok = await run(
      'save',
      async () => {
        if (!rule) {
          await ledger.addRule({
            fromAccountId: draft.fromAccountId,
            toAccountId: to.id,
            amount,
            kind: draft.kind,
            dayOfMonth: draft.day,
            startMonth: startMonthForNew(ledger.today, draft.day),
            endMonth: null,
          });
          return;
        }
        const prev = ledger.data.rules.find((r) => r.id === rule.id);
        if (!prev) throw new Error('매달 배분 규칙을 찾을 수 없어요');
        if (kindOf(prev) !== draft.kind) {
          // 방식을 바꾸면 그 자리에서 고쳐요 (이미 생긴 이체 기록은 그대로)
          await ledger.saveRule({ ...prev, fromAccountId: draft.fromAccountId, dayOfMonth: draft.day, kind: draft.kind, amount });
          return;
        }
        if (prev.fromAccountId !== draft.fromAccountId || prev.dayOfMonth !== draft.day) {
          await ledger.saveRule({ ...prev, fromAccountId: draft.fromAccountId, dayOfMonth: draft.day });
        }
        // 금액은 지난 기록을 지키려고 규칙을 나눠요 (state.changeRuleAmount)
        if (draft.kind === 'fixed' && prev.amount !== amount) await ledger.changeRuleAmount(prev.id, amount);
      },
      rule ? '매달 배분을 저장했어요' : '매달 배분을 추가했어요',
    );
    if (ok) onDone();
  }

  async function remove() {
    if (!rule) return;
    const ok = await run('delete', () => ledger.saveRule({ ...rule, deleted: true }), '매달 배분을 지웠어요');
    if (ok) onDone();
  }

  return (
    <form
      id={id}
      className={styles.editor}
      aria-label={title}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="stack gap-2">
        <span className="st-label">보내는 방식</span>
        <SegmentedControl<RuleKind>
          ariaLabel="보내는 방식"
          block
          value={draft.kind}
          onChange={(kind) => {
            setDraft({ ...draft, kind });
            setErrors((x) => ({ ...x, kind: undefined, amount: undefined }));
          }}
          // 생활비 통장이 아니면(용돈 등) 알아서 맞추기를 보이지 않아요
          options={KIND_OPTIONS.filter((o) => o.value !== 'auto' || autoTarget || draft.kind === 'auto')}
        />
        {errors.kind ? (
          <span className="hint err" role="alert">
            {errors.kind}
          </span>
        ) : null}
      </div>
      {draft.kind === 'fixed' ? (
        <Field
          label="금액"
          error={errors.amount}
          hint={
            rule && !isRemainderRule(rule) && rule.amount !== draft.amount
              ? '지난 기록은 그대로 두고 이번 달부터(이번 달 이체가 이미 생겼으면 다음 달부터) 새 금액을 적용해요.'
              : to.role === 'allowance'
                ? '용돈은 매달 같은 금액으로 보내요.'
                : undefined
          }
        >
          <MoneyInput value={draft.amount} onChange={(v) => setDraft({ ...draft, amount: v })} />
        </Field>
      ) : draft.kind === 'auto' ? (
        <p className="st-desc">
          {autoTarget
            ? '그 배분이 채우는 한 달(이번 배분일 ~ 다음 배분일 전날)에 이 통장에서 나갈 고정비 · 할부와 생활비 항목 예산을 더해 보내요. 금액은 그날 기록될 때 정해져요.'
            : `${AUTO_ONLY_MESSAGE}.`}
        </p>
      ) : (
        <p className="st-desc">그날 다른 배분을 모두 보낸 뒤 보내는 통장에 남은 돈을 전부 보내요. 남은 돈이 없으면 보내지 않아요.</p>
      )}
      <Field label="보내는 통장" error={errors.from}>
        <AccountPicker value={draft.fromAccountId} onChange={(v) => setDraft({ ...draft, fromAccountId: v })} accounts={sources} prefer={isIncomeAccount} />
      </Field>
      <Field label="이체일" hint={rule ? undefined : startMonthHint(ledger.today, draft.day)}>
        <Select value={String(draft.day)} onChange={(v) => setDraft({ ...draft, day: Number(v) })} options={DAY_OPTIONS} />
      </Field>
      <div className={styles.monthActions}>
        <Button type="submit" loading={busy === 'save'} disabled={busy === 'delete'}>
          저장
        </Button>
        <Button variant="outline" onClick={onDone} disabled={busy !== null}>
          취소
        </Button>
      </div>
      {rule ? (
        <DeleteConfirm
          label="이 배분 지우기"
          question="이 배분을 지울까요? 이미 생긴 이체 기록은 그대로 남아요."
          busy={busy === 'delete'}
          onConfirm={() => void remove()}
        />
      ) : null}
    </form>
  );
}

/** 금액을 찾지 못해 되돌린 용돈 배분: 그 자리에서 금액을 고치고 확인 필요 표시를 지워요 (지난 기록은 그대로) */
function AllowanceReview({ ledger, rule }: { ledger: ReadyLedger; rule: AllocationRule }) {
  const { busy, run } = useRunner();
  const [amount, setAmount] = useState<number | null>(rule.amount);
  async function confirm() {
    if (!(amount && amount > 0)) return;
    await run('review', () => ledger.saveRule({ ...rule, amount: Math.round(amount), needsReview: false }), '용돈 금액을 저장했어요');
  }
  return (
    <form
      className="st-review stack gap-2"
      role="group"
      aria-label={ALLOWANCE_REVIEW_PROMPT}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void confirm();
      }}
    >
      <Field label={ALLOWANCE_REVIEW_PROMPT} hint="예전 금액을 찾지 못해 이 통장의 고정비 합을 넣어 두었어요. 실제 용돈 금액으로 고쳐 주세요.">
        <MoneyInput value={amount} onChange={setAmount} />
      </Field>
      <div>
        <Button type="submit" loading={busy === 'review'} disabled={!(amount && amount > 0)}>
          확인
        </Button>
      </div>
    </form>
  );
}

/* ---------- 월급통장: 수입 계획 줄 ---------- */

/** 월급통장의 들어오는 돈 = 수입 계획(누가 · 매달 며칠 · 얼마). 줄을 눌러 고치고 [+ 수입]으로 추가해요 */
export function IncomePlanRows({ ledger, account, readOnly }: { ledger: ReadyLedger; account: Account; readOnly: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const month = monthOf(ledger.today);
  const plans = incomePlanRows(ledger, account.id);
  const baseId = `bd-income-${account.id}`;
  const toggle = (id: string) => setEditing((e) => (e === id ? null : id));

  return (
    <div className="stack gap-2">
      {plans.length > 0 ? (
        <ul className={cx('list', styles.inRows)} aria-label={`${account.name} 수입 계획`}>
          {plans.map((p) => {
            const label = periodLabel(p.startMonth, p.endMonth, month);
            const open = editing === p.id;
            const editorId = `${baseId}-${p.id}`;
            return (
              <li key={p.id}>
                <InRowButton
                  readOnly={readOnly}
                  open={open}
                  controls={editorId}
                  onToggle={() => toggle(p.id)}
                  title={`${p.dayOfMonth}일 · ${p.personName}`}
                  amount={formatMan(p.amount)}
                  testId="income-row"
                  sub={
                    <>
                      <span>수입 계획</span>
                      {label ? (
                        <Badge size="sm" tone="info">
                          {label}
                        </Badge>
                      ) : null}
                    </>
                  }
                />
                {open ? <IncomePlanEditor id={editorId} ledger={ledger} account={account} plan={p} onDone={() => setEditing(null)} /> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="st-desc">수입 계획을 넣으면 받는 날 수입이 자동으로 기록되고, 매달 배분과 남는 돈을 미리 계산해요.</p>
      )}
      {readOnly ? null : editing === 'new' ? (
        <IncomePlanEditor id={`${baseId}-new`} ledger={ledger} account={account} plan={null} onDone={() => setEditing(null)} />
      ) : (
        <div>
          <Button variant="outline" icon="plus" onClick={() => setEditing('new')} aria-label={`${account.name} 수입 추가`}>
            수입
          </Button>
        </div>
      )}
    </div>
  );
}

interface PlanDraft {
  personName: string;
  personEmail: string;
  amount: number | null;
  day: number;
}

type PlanErrors = Partial<Record<'name' | 'email' | 'amount', string>>;

/** 수입 계획 그 자리 고치기 · 추가: 누구 · 한 달 금액 · 받는 날 · 지우기 (받는 통장 = 이 카드의 통장) */
function IncomePlanEditor({
  id,
  ledger,
  account,
  plan,
  onDone,
}: {
  id: string;
  ledger: ReadyLedger;
  account: Account;
  plan: IncomePlan | null;
  onDone: () => void;
}) {
  const { busy, run } = useRunner();
  const people = peopleOptions(ledger.data);
  const [draft, setDraft] = useState<PlanDraft>(() => {
    if (plan) return { personName: plan.personName, personEmail: plan.personEmail ?? '', amount: plan.amount, day: plan.dayOfMonth };
    const used = new Set(incomePlanRows(ledger, account.id).map((p) => p.personName));
    const next = people.find((p) => !used.has(p.name));
    return { personName: next?.name ?? '', personEmail: next?.email ?? '', amount: null, day: 25 };
  });
  const [errors, setErrors] = useState<PlanErrors>({});
  const title = plan ? `${plan.personName} 수입 고치기` : `${account.name} 수입 추가`;

  async function save() {
    const next: PlanErrors = {};
    if (!draft.personName.trim()) next.name = '누구 수입인지 이름을 입력해 주세요';
    if (draft.personEmail.trim() && !isEmail(draft.personEmail)) next.email = '이메일 주소를 확인해 주세요';
    if (draft.amount === null || draft.amount <= 0) next.amount = '금액을 입력해 주세요';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusFirstInvalid();
      return;
    }
    const fields = {
      personName: draft.personName.trim(),
      personEmail: draft.personEmail.trim() || null,
      amount: draft.amount!,
      dayOfMonth: draft.day,
      accountId: account.id,
    };
    const ok = await run(
      'save',
      async () => {
        if (!plan) {
          await ledger.addIncomePlan({ ...fields, startMonth: startMonthForNew(ledger.today, draft.day), endMonth: null, memo: '' });
          return;
        }
        const prev = ledger.data.incomePlans.find((p) => p.id === plan.id);
        if (!prev) throw new Error('수입 계획을 찾을 수 없어요');
        await ledger.saveIncomePlan({ ...prev, ...fields });
      },
      plan ? '수입 계획을 저장했어요' : '수입 계획을 추가했어요',
    );
    if (ok) onDone();
  }

  async function remove() {
    if (!plan) return;
    const ok = await run('delete', () => ledger.saveIncomePlan({ ...plan, deleted: true }), '수입 계획을 지웠어요');
    if (ok) onDone();
  }

  return (
    <form
      id={id}
      className={styles.editor}
      aria-label={title}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <PersonPicker
        label="누구 수입인가요?"
        required
        people={people}
        value={{ name: draft.personName, email: draft.personEmail }}
        onChange={(v) => setDraft({ ...draft, personName: v.name, personEmail: v.email })}
        error={errors.name}
        nameError={errors.name}
        emailError={errors.email}
        emailHint="가계부를 함께 쓰는 사람이면 적어 두세요."
      />
      <Field label="한 달 금액" error={errors.amount} required hint={plan ? '이미 기록된 수입은 그대로 두고 다음 회차부터 바뀌어요.' : undefined}>
        <MoneyInput value={draft.amount} onChange={(v) => setDraft({ ...draft, amount: v })} />
      </Field>
      <Field label="받는 날" hint={plan ? undefined : startMonthHint(ledger.today, draft.day)}>
        <Select value={String(draft.day)} onChange={(v) => setDraft({ ...draft, day: Number(v) })} options={DAY_OPTIONS} />
      </Field>
      <div className={styles.monthActions}>
        <Button type="submit" loading={busy === 'save'} disabled={busy === 'delete'}>
          저장
        </Button>
        <Button variant="outline" onClick={onDone} disabled={busy !== null}>
          취소
        </Button>
      </div>
      {plan ? (
        <DeleteConfirm
          label="이 수입 지우기"
          question="이 수입 계획을 지울까요? 이미 기록된 수입은 그대로 남아요."
          busy={busy === 'delete'}
          onConfirm={() => void remove()}
        />
      ) : null}
    </form>
  );
}
