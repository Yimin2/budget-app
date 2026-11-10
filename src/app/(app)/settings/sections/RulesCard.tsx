'use client';

import { useState } from 'react';
import {
  ALLOWANCE_REVIEW_PROMPT, canAutoFill, conflictingRemainderRule, formatMan, formatMonthKo, formatWon, isAutoRule, isRemainderRule, monthOf, needBreakdownText, paydayPlans,
  remainderViews, ruleChangeText, ruleKindLabel, ruleNext, RULE_KIND_LABEL,
} from '@/domain';
import type { AllocationRule, RuleKind } from '@/domain/types';
import {
  Badge, Banner, Button, Card, ConfirmDialog, Dialog, EmptyState, Field, ListRow, MoneyInput, SegmentedControl, Select,
  focusFirstInvalid,
} from '@/ui';
import type { ReadyLedger } from '../../_components/RequireLedger';
import { DAY_OPTIONS } from '@/app/start/new/wizard';
import { incomeSummaries, paydayPreviewLines, periodLabel, startMonthForNew, startMonthHint, visibleRules, accountOptions as accountOptionsOf, accountNameWithOwner } from '../helpers';
import { useRunner } from '../useRunner';

interface Draft {
  id: string | null;
  fromAccountId: string;
  toAccountId: string;
  kind: RuleKind;
  amount: number | null;
  day: number;
}

type Errors = Partial<Record<'to' | 'amount' | 'kind', string>>;

const KIND_OPTIONS: { value: RuleKind; label: string }[] = [
  { value: 'fixed', label: RULE_KIND_LABEL.fixed },
  { value: 'auto', label: RULE_KIND_LABEL.auto },
  { value: 'remainder', label: RULE_KIND_LABEL.remainder },
];

/** 받는 통장이 생활비면 '알아서 맞추기'가 기본, 아니면(용돈 · 이벤트 · 저축 …) '매달 같은 금액' */
const AUTO_ONLY_MESSAGE = '알아서 맞추기는 생활비 통장으로 보낼 때만 고를 수 있어요';

const kindOf = (r: AllocationRule): RuleKind => (isRemainderRule(r) ? 'remainder' : isAutoRule(r) ? 'auto' : 'fixed');

/**
 * 매달 배분: 보내는 통장 → 받는 통장 · 매달 같은 금액 / 알아서 맞추기 / 남는 돈 전부 · 이체일.
 * 줄마다 다음 배분 금액을 바로 보여 주고(알아서 맞추기는 지난달과 달라졌으면 까닭도), 누르지 않아도 다음 배분에 저절로 반영돼요.
 * 수입통장마다 합계가 수입보다 크면 경고하고, 월급날마다 어디로 얼마가 가는지 미리 보여 줘요 (PLAN 4-13 · 4-15)
 */
export function RulesCard({ ledger }: { ledger: ReadyLedger }) {
  const { busy, run } = useRunner();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmDelete, setConfirmDelete] = useState<AllocationRule | null>(null);
  // 금액 확인이 필요한 용돈 배분 줄의 그 자리 금액 (규칙 id → 금액)
  const [review, setReview] = useState<Record<string, number | null>>({});

  const month = monthOf(ledger.today);
  const accounts = ledger.activeAccounts;
  const order = (id: string) => accounts.find((a) => a.id === id)?.order ?? Number.MAX_SAFE_INTEGER;
  // 보내는 통장(사람별 수입통장) 순서로 묶어 보여요
  const rules = visibleRules(ledger.data.rules, month).sort((a, b) => order(a.fromAccountId) - order(b.fromAccountId));
  const allSummaries = incomeSummaries(ledger.data, month);
  // 수입통장이 여럿이면 배분이나 수입 기록이 있는 통장만 보여요
  const summaries = allSummaries.length > 1 ? allSummaries.filter((x) => x.total > 0 || x.income !== null) : allSummaries;
  const multi = summaries.length > 1;
  const accountOptions = accountOptionsOf(accounts);
  const editing = draft?.id ? ledger.data.rules.find((r) => r.id === draft.id) : undefined;
  const remainders = new Map(remainderViews(ledger.data, ledger.today).map((v) => [v.rule.id, v]));
  const autoTarget = draft ? canAutoFill(accounts.find((a) => a.id === draft.toAccountId)) : false;

  function openNew() {
    const from = ledger.incomeAccounts[0] ?? accounts[0];
    const to = accounts.find((a) => a.id !== from?.id);
    setErrors({});
    setDraft({ id: null, fromAccountId: from?.id ?? '', toAccountId: to?.id ?? '', kind: canAutoFill(to) ? 'auto' : 'fixed', amount: null, day: 1 });
  }
  function openEdit(r: AllocationRule) {
    setErrors({});
    const kind = kindOf(r);
    setDraft({ id: r.id, fromAccountId: r.fromAccountId, toAccountId: r.toAccountId, kind, amount: kind === 'fixed' ? r.amount : null, day: r.dayOfMonth });
  }

  async function save() {
    if (!draft) return;
    const next: Errors = {};
    if (!draft.toAccountId || draft.toAccountId === draft.fromAccountId) next.to = '보내는 통장과 다른 통장을 골라 주세요';
    if (draft.kind === 'fixed' && (draft.amount === null || draft.amount <= 0)) next.amount = '금액을 입력해 주세요';
    if (draft.kind === 'auto' && !canAutoFill(accounts.find((a) => a.id === draft.toAccountId))) {
      next.kind = AUTO_ONLY_MESSAGE;
    }
    if (
      draft.kind === 'remainder' &&
      conflictingRemainderRule(ledger.data, {
        id: draft.id,
        fromAccountId: draft.fromAccountId,
        dayOfMonth: draft.day,
        startMonth: editing?.startMonth ?? startMonthForNew(ledger.today, draft.day),
        endMonth: editing?.endMonth ?? null,
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
    // 받는 통장이 생활비가 아니면 '알아서 맞추기'는 고를 수 없어요 (용돈 · 이벤트통장 등은 매달 같은 금액)
    const ok = await run(
      'save',
      async () => {
        if (!draft.id) {
          await ledger.addRule({
            fromAccountId: draft.fromAccountId,
            toAccountId: draft.toAccountId,
            amount,
            kind: draft.kind,
            dayOfMonth: draft.day,
            startMonth: startMonthForNew(ledger.today, draft.day),
            endMonth: null,
          });
          return;
        }
        const prev = ledger.data.rules.find((r) => r.id === draft.id);
        if (!prev) throw new Error('매달 배분 규칙을 찾을 수 없어요');
        const prevKind = kindOf(prev);
        if (prevKind !== draft.kind) {
          // 방식을 바꾸면 그 자리에서 고쳐요 (이미 생긴 이체 기록은 그대로)
          await ledger.saveRule({
            ...prev,
            fromAccountId: draft.fromAccountId,
            toAccountId: draft.toAccountId,
            dayOfMonth: draft.day,
            kind: draft.kind,
            amount,
          });
          return;
        }
        if (prev.fromAccountId !== draft.fromAccountId || prev.toAccountId !== draft.toAccountId || prev.dayOfMonth !== draft.day) {
          await ledger.saveRule({ ...prev, fromAccountId: draft.fromAccountId, toAccountId: draft.toAccountId, dayOfMonth: draft.day });
        }
        // 금액은 지난 기록을 지키려고 규칙을 나눠요 (state.changeRuleAmount)
        if (draft.kind === 'fixed' && prev.amount !== amount) await ledger.changeRuleAmount(prev.id, amount);
      },
      draft.id ? '매달 배분을 저장했어요' : '매달 배분을 추가했어요',
    );
    if (ok) setDraft(null);
  }

  /** 금액 확인: 그 자리에서 금액을 고치고 확인 필요 표시를 지워요 (지난 기록은 그대로) */
  async function confirmAmount(r: AllocationRule) {
    const amount = review[r.id] ?? r.amount;
    if (!(amount > 0)) return;
    const ok = await run(`review:${r.id}`, () => ledger.saveRule({ ...r, amount: Math.round(amount), needsReview: false }), '용돈 금액을 저장했어요');
    if (ok) setReview((x) => {
      const next = { ...x };
      delete next[r.id];
      return next;
    });
  }

  async function remove(r: AllocationRule) {
    const ok = await run('delete', () => ledger.saveRule({ ...r, deleted: true }), '매달 배분을 지웠어요');
    if (ok) setConfirmDelete(null);
  }

  return (
    <Card id="st-rules" title="매달 배분">
      <p className="st-desc">정한 날마다 보내는 통장에서 받는 통장으로 이체 기록이 자동으로 생겨요.</p>

      {rules.length > 0
        ? summaries.map((x) => (
            <div key={x.account.id} className="stack gap-2">
              <div className="st-summary" role="group" aria-label={`${x.account.name} 배분`}>
                {multi ? (
                  <div className="line">
                    <strong>{x.account.name}</strong>
                  </div>
                ) : null}
                <div className="line">
                  <span>{x.remainder ? '이번 달 배분 합계 (남는 돈 전부 빼고)' : '이번 달 배분 합계'}</span>
                  <strong>{formatWon(x.total)}</strong>
                </div>
                <div className="line">
                  <span>{x.income ? (x.income.planned ? '이번 달 수입 계획' : `${formatMonthKo(x.income.month)} 수입`) : '수입'}</span>
                  <strong>{x.income ? formatWon(x.income.amount) : '기록 없음'}</strong>
                </div>
                {x.remainder && x.left !== null ? (
                  <div className="line">
                    <span>남는 돈 전부 → {accountNameWithOwner(accounts, x.remainder.toAccountId)}</span>
                    <strong>{formatWon(x.left)}</strong>
                  </div>
                ) : null}
              </div>
              <PaydayPreview ledger={ledger} sourceAccountId={x.account.id} />
              {x.over > 0 ? (
                <Banner
                  tone="warning"
                  title={
                    multi
                      ? `${x.account.name}에서 보내는 돈이 수입보다 ${formatWon(x.over)} 많아요`
                      : `배분 합계가 수입보다 ${formatWon(x.over)} 많아요`
                  }
                >
                  {x.account.name} 잔액이 모자랄 수 있어요. 금액을 줄이거나 수입 기록을 확인해 주세요.
                </Banner>
              ) : null}
            </div>
          ))
        : null}
      {rules.length > 0 && summaries.some((x) => !x.income) ? (
        <p className="st-desc">
          {multi
            ? `${summaries.filter((x) => !x.income).map((x) => x.account.name).join(', ')}에 이번 달과 지난달 수입 기록이 없어서 수입과 비교하지 못했어요.`
            : '이번 달과 지난달 수입 기록이 없어서 합계를 수입과 비교하지 못했어요.'}
        </p>
      ) : null}

      {rules.length === 0 ? (
        <EmptyState
          icon="arrow-left-right"
          headingLevel={3}
          title="매달 배분이 없어요"
          description="월급이 들어오면 각 통장으로 얼마씩 보낼지 정해 주세요."
        />
      ) : (
        <ul className="list">
          {rules.map((r) => {
            const label = periodLabel(r.startMonth, r.endMonth, month);
            const rest = remainders.get(r.id);
            const next = ruleNext(ledger.data, r, ledger.today);
            const change = next ? ruleChangeText(next) : null;
            const amountText = next ? `${formatMan(next.amount)}${next.auto ? ' (자동)' : ''}` : null;
            const route = `${r.dayOfMonth}일 · ${accountNameWithOwner(accounts, r.fromAccountId)} → ${accountNameWithOwner(accounts, r.toAccountId)}`;
            return (
              <li key={r.id}>
                <ListRow
                  icon="arrow-left-right"
                  title={amountText ? `${route} · ${amountText}` : route}
                  subtitle={
                    <span className="st-sub">
                      <span>{ruleKindLabel(r)}</span>
                      {change ? <span className="st-change">{change}</span> : null}
                      {rest?.nextText ? <span className={rest.empty ? 'st-warn-text' : undefined}>{rest.nextText}</span> : null}
                      {rest?.monthlyText ? <span>{rest.monthlyText}</span> : null}
                      {label ? (
                        <Badge size="sm" tone="info">
                          {label}
                        </Badge>
                      ) : null}
                    </span>
                  }
                  onClick={() => openEdit(r)}
                />
                {r.needsReview && !isAutoRule(r) && !isRemainderRule(r) ? (
                  <form
                    className="st-review stack gap-2"
                    role="group"
                    aria-label={ALLOWANCE_REVIEW_PROMPT}
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      void confirmAmount(r);
                    }}
                  >
                    <Field
                      label={ALLOWANCE_REVIEW_PROMPT}
                      hint="예전 금액을 찾지 못해 이 통장의 고정비 합을 넣어 두었어요. 실제 용돈 금액으로 고쳐 주세요."
                    >
                      <MoneyInput
                        value={review[r.id] === undefined ? r.amount : review[r.id]!}
                        onChange={(v) => setReview((x) => ({ ...x, [r.id]: v }))}
                      />
                    </Field>
                    <div>
                      <Button
                        type="submit"
                        loading={busy === `review:${r.id}`}
                        disabled={!((review[r.id] === undefined ? r.amount : review[r.id]!) ?? 0)}
                      >
                        확인
                      </Button>
                    </div>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <div className="st-foot">
        <Button variant="outline" icon="plus" onClick={openNew} disabled={accounts.length < 2}>
          배분 추가
        </Button>
      </div>
      {accounts.length < 2 ? <p className="st-desc">통장이 두 개 이상 있어야 배분을 정할 수 있어요.</p> : null}

      <Dialog
        open={draft !== null}
        onClose={() => (busy ? undefined : setDraft(null))}
        title={draft?.id ? '매달 배분 고치기' : '매달 배분 추가'}
        actions={
          <>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={busy !== null}>
              취소
            </Button>
            <Button type="submit" form="st-rule-form" loading={busy === 'save'}>
              저장
            </Button>
          </>
        }
      >
        {draft ? (
          <form
            id="st-rule-form"
            className="stack"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field label="보내는 통장">
              <Select value={draft.fromAccountId} onChange={(v) => setDraft({ ...draft, fromAccountId: v })} options={accountOptions} />
            </Field>
            <Field label="받는 통장" error={errors.to}>
              <Select
                value={draft.toAccountId}
                onChange={(v) => {
                  // 새 배분은 받는 통장에 따라 기본 방식을 바꿔요 (생활비 → 알아서 맞추기, 용돈 등은 매달 같은 금액)
                  const auto = canAutoFill(accounts.find((a) => a.id === v));
                  const kind = draft.id ? draft.kind : auto && draft.kind === 'fixed' && draft.amount === null ? 'auto' : !auto && draft.kind === 'auto' ? 'fixed' : draft.kind;
                  setDraft({ ...draft, toAccountId: v, kind });
                }}
                options={accountOptions}
                placeholder="통장 고르기"
              />
            </Field>
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
                  editing && !isRemainderRule(editing) && editing.amount !== draft.amount
                    ? '지난 기록은 그대로 두고 이번 달부터(이번 달 이체가 이미 생겼으면 다음 달부터) 새 금액을 적용해요.'
                    : undefined
                }
              >
                <MoneyInput value={draft.amount} onChange={(v) => setDraft({ ...draft, amount: v })} data-autofocus="" />
              </Field>
            ) : draft.kind === 'auto' ? (
              <p className="st-desc">
                {autoTarget
                  ? '그 배분이 채우는 한 달(이번 배분일 ~ 다음 배분일 전날)에 이 통장에서 나갈 고정비 · 세부 항목 · 할부와 생활비 항목 예산을 더해 보내요. 금액은 그날 기록될 때 정해져요.'
                  : `${AUTO_ONLY_MESSAGE}.`}
              </p>
            ) : (
              <p className="st-desc">
                그날 다른 배분을 모두 보낸 뒤 보내는 통장에 남은 돈을 전부 보내요. 남은 돈이 없으면 보내지 않아요. 금액은 그날 기록될 때
                정해지고, 그 뒤에 들어온 돈은 다음 나머지 보내기 때 함께 보내요.
              </p>
            )}
            <Field label="이체일" hint={editing ? undefined : startMonthHint(ledger.today, draft.day)}>
              <Select value={String(draft.day)} onChange={(v) => setDraft({ ...draft, day: Number(v) })} options={DAY_OPTIONS} />
            </Field>
            {editing ? (
              <div className="st-danger">
                <Button
                  variant="ghost"
                  icon="trash"
                  disabled={busy !== null}
                  onClick={() => {
                    setDraft(null);
                    setConfirmDelete(editing);
                  }}
                >
                  이 배분 지우기
                </Button>
              </div>
            ) : null}
          </form>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={confirmDelete !== null}
        tone="danger"
        title="이 배분을 지울까요?"
        description="앞으로 자동 이체 기록이 생기지 않아요. 이미 생긴 이체 기록은 그대로 남아요."
        confirmLabel="지우기"
        loading={busy === 'delete'}
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </Card>
  );
}

/** 월급날마다 어디로 얼마가 가는지 한 줄씩 ('21일: 297만 → 생활비(가람) 82.8만 · 남는 돈 전부 36.94만 → 저수지') */
function PaydayPreview({ ledger, sourceAccountId }: { ledger: ReadyLedger; sourceAccountId: string }) {
  const month = monthOf(ledger.today);
  const lines = paydayPreviewLines(ledger.data, month, sourceAccountId);
  // 수입 계획도 나머지 규칙도 없으면 예전처럼 합계만 보여요
  const useful = lines.length > 0 && (ledger.data.incomePlans ?? []).some((p) => !p.deleted && p.accountId === sourceAccountId);
  if (!useful) return null;
  const plans = paydayPlans(ledger.data, month, sourceAccountId);
  const views = new Map(remainderViews(ledger.data, ledger.today).map((v) => [v.rule.id, v]));
  const nameOf = (id: string) => ledger.data.accounts.find((a) => a.id === id)?.name ?? '지운 통장';
  return (
    <ul className="st-payday" aria-label="월급날마다 보내는 돈">
      {lines.map((l) => {
        const p = plans.find((x) => x.day === l.day);
        const rest = p?.remainder ? views.get(p.remainder.rule.id) : undefined;
        return (
          <li key={l.day}>
            <span>{l.text}</span>
            {p?.auto.map((a) => (
              <span key={a.rule.id} className="st-hint-line">
                {nameOf(a.rule.toAccountId)} 알아서 맞추기 {formatWon(a.amount)} = {a.need ? needBreakdownText(a.need) : ''}
              </span>
            ))}
            {rest?.nextText ? <span className={rest.empty ? 'st-payday-warn' : 'st-hint-line'}>{rest.text}</span> : null}
            {rest?.monthlyText ? <span className="st-hint-line">{rest.monthlyText}</span> : null}
            {l.short > 0 ? <span className="st-payday-warn">매달 같은 금액과 알아서 맞추기가 그날 들어온 돈보다 {formatWon(l.short)} 많아요</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
