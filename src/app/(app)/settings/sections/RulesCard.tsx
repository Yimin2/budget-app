'use client';

import { useState } from 'react';
import { conflictingRemainderRule, formatMonthKo, formatWon, isRemainderRule, monthOf } from '@/domain';
import type { AllocationRule, RuleKind } from '@/domain/types';
import {
  Badge, Banner, Button, Card, ConfirmDialog, Dialog, EmptyState, Field, ListRow, Money, MoneyInput, SegmentedControl, Select,
  focusFirstInvalid,
} from '@/ui';
import type { ReadyLedger } from '../../_components/RequireLedger';
import { DAY_OPTIONS } from '@/app/start/new/wizard';
import { accountName, incomeSummaries, paydayPreviewLines, periodLabel, startMonthForNew, startMonthHint, visibleRules } from '../helpers';
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
  { value: 'fixed', label: '정한 금액' },
  { value: 'remainder', label: '나머지 전부' },
];

/**
 * 매달 배분: 보내는 통장 → 받는 통장 · 정한 금액 또는 나머지 전부 · 이체일.
 * 수입통장마다 합계가 수입보다 크면 경고하고, 월급날마다 어디로 얼마가 가는지 미리 보여 줘요 (PLAN 4-13)
 */
export function RulesCard({ ledger }: { ledger: ReadyLedger }) {
  const { busy, run } = useRunner();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmDelete, setConfirmDelete] = useState<AllocationRule | null>(null);

  const month = monthOf(ledger.today);
  const accounts = ledger.activeAccounts;
  const order = (id: string) => accounts.find((a) => a.id === id)?.order ?? Number.MAX_SAFE_INTEGER;
  // 보내는 통장(사람별 수입통장) 순서로 묶어 보여요
  const rules = visibleRules(ledger.data.rules, month).sort((a, b) => order(a.fromAccountId) - order(b.fromAccountId));
  const allSummaries = incomeSummaries(ledger.data, month);
  // 수입통장이 여럿이면 배분이나 수입 기록이 있는 통장만 보여요
  const summaries = allSummaries.length > 1 ? allSummaries.filter((x) => x.total > 0 || x.income !== null) : allSummaries;
  const multi = summaries.length > 1;
  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }));
  const editing = draft?.id ? ledger.data.rules.find((r) => r.id === draft.id) : undefined;

  function openNew() {
    const from = ledger.incomeAccounts[0] ?? accounts[0];
    const to = accounts.find((a) => a.id !== from?.id);
    setErrors({});
    setDraft({ id: null, fromAccountId: from?.id ?? '', toAccountId: to?.id ?? '', kind: 'fixed', amount: null, day: 1 });
  }
  function openEdit(r: AllocationRule) {
    setErrors({});
    const kind: RuleKind = isRemainderRule(r) ? 'remainder' : 'fixed';
    setDraft({ id: r.id, fromAccountId: r.fromAccountId, toAccountId: r.toAccountId, kind, amount: kind === 'fixed' ? r.amount : null, day: r.dayOfMonth });
  }

  async function save() {
    if (!draft) return;
    const next: Errors = {};
    if (!draft.toAccountId || draft.toAccountId === draft.fromAccountId) next.to = '보내는 통장과 다른 통장을 골라 주세요';
    if (draft.kind === 'fixed' && (draft.amount === null || draft.amount <= 0)) next.amount = '금액을 입력해 주세요';
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
        const prevKind: RuleKind = isRemainderRule(prev) ? 'remainder' : 'fixed';
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
                  <span>{x.remainder ? '이번 달 정한 금액 합계' : '이번 달 배분 합계'}</span>
                  <strong>{formatWon(x.total)}</strong>
                </div>
                <div className="line">
                  <span>{x.income ? (x.income.planned ? '이번 달 수입 계획' : `${formatMonthKo(x.income.month)} 수입`) : '수입'}</span>
                  <strong>{x.income ? formatWon(x.income.amount) : '기록 없음'}</strong>
                </div>
                {x.remainder && x.left !== null ? (
                  <div className="line">
                    <span>나머지 → {accountName(accounts, x.remainder.toAccountId)}</span>
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
            return (
              <li key={r.id}>
                <ListRow
                  icon="arrow-left-right"
                  title={`${accountName(accounts, r.fromAccountId)} → ${accountName(accounts, r.toAccountId)}`}
                  subtitle={
                    <span className="st-sub">
                      <span>매달 {r.dayOfMonth}일</span>
                      {label ? (
                        <Badge size="sm" tone="info">
                          {label}
                        </Badge>
                      ) : null}
                    </span>
                  }
                  trailing={isRemainderRule(r) ? <span className="muted">나머지 전부</span> : <Money amount={r.amount} />}
                  onClick={() => openEdit(r)}
                />
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
                onChange={(v) => setDraft({ ...draft, toAccountId: v })}
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
                options={KIND_OPTIONS}
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

/** 월급날마다 어디로 얼마가 가는지 한 줄씩 ('21일: 297만 → 생활비(가람) 82.8만 · 나머지 36.94만 → 저수지') */
function PaydayPreview({ ledger, sourceAccountId }: { ledger: ReadyLedger; sourceAccountId: string }) {
  const month = monthOf(ledger.today);
  const lines = paydayPreviewLines(ledger.data, month, sourceAccountId);
  // 수입 계획도 나머지 규칙도 없으면 예전처럼 합계만 보여요
  const useful = lines.length > 0 && (ledger.data.incomePlans ?? []).some((p) => !p.deleted && p.accountId === sourceAccountId);
  if (!useful) return null;
  return (
    <ul className="st-payday" aria-label="월급날마다 보내는 돈">
      {lines.map((l) => (
        <li key={l.day}>
          <span>{l.text}</span>
          {l.short > 0 ? <span className="st-payday-warn">그날 들어온 돈보다 {formatWon(l.short)} 많아요</span> : null}
        </li>
      ))}
    </ul>
  );
}
