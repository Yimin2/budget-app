'use client';

import { useState } from 'react';
import { formatMonthKo, formatWon, monthOf } from '@/domain';
import type { AllocationRule } from '@/domain/types';
import { Badge, Banner, Button, Card, ConfirmDialog, Dialog, EmptyState, Field, ListRow, Money, MoneyInput, Select, focusFirstInvalid } from '@/ui';
import type { ReadyLedger } from '../../_components/RequireLedger';
import { DAY_OPTIONS } from '@/app/start/new/wizard';
import { accountName, incomeSummaries, periodLabel, startMonthForNew, startMonthHint, visibleRules } from '../helpers';
import { useRunner } from '../useRunner';

interface Draft {
  id: string | null;
  fromAccountId: string;
  toAccountId: string;
  amount: number | null;
  day: number;
}

type Errors = Partial<Record<'to' | 'amount', string>>;

/** 매달 배분: 보내는 통장 → 받는 통장 · 금액 · 이체일. 수입통장(사람)마다 합계가 그 수입보다 크면 경고 */
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
    setDraft({ id: null, fromAccountId: from?.id ?? '', toAccountId: to?.id ?? '', amount: null, day: 1 });
  }
  function openEdit(r: AllocationRule) {
    setErrors({});
    setDraft({ id: r.id, fromAccountId: r.fromAccountId, toAccountId: r.toAccountId, amount: r.amount, day: r.dayOfMonth });
  }

  async function save() {
    if (!draft) return;
    const next: Errors = {};
    if (!draft.toAccountId || draft.toAccountId === draft.fromAccountId) next.to = '보내는 통장과 다른 통장을 골라 주세요';
    if (draft.amount === null || draft.amount <= 0) next.amount = '금액을 입력해 주세요';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusFirstInvalid();
      return;
    }
    const amount = draft.amount!;
    const ok = await run(
      'save',
      async () => {
        if (!draft.id) {
          await ledger.addRule({
            fromAccountId: draft.fromAccountId,
            toAccountId: draft.toAccountId,
            amount,
            dayOfMonth: draft.day,
            startMonth: startMonthForNew(ledger.today, draft.day),
            endMonth: null,
          });
          return;
        }
        const prev = ledger.data.rules.find((r) => r.id === draft.id);
        if (!prev) throw new Error('매달 배분 규칙을 찾을 수 없어요');
        if (prev.fromAccountId !== draft.fromAccountId || prev.toAccountId !== draft.toAccountId || prev.dayOfMonth !== draft.day) {
          await ledger.saveRule({ ...prev, fromAccountId: draft.fromAccountId, toAccountId: draft.toAccountId, dayOfMonth: draft.day });
        }
        // 금액은 지난 기록을 지키려고 규칙을 나눠요 (state.changeRuleAmount)
        if (prev.amount !== amount) await ledger.changeRuleAmount(prev.id, amount);
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
                  <span>이번 달 배분 합계</span>
                  <strong>{formatWon(x.total)}</strong>
                </div>
                <div className="line">
                  <span>{x.income ? `${formatMonthKo(x.income.month)} 수입` : '수입'}</span>
                  <strong>{x.income ? formatWon(x.income.amount) : '기록 없음'}</strong>
                </div>
              </div>
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
                  trailing={<Money amount={r.amount} />}
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
            <Field
              label="금액"
              error={errors.amount}
              hint={
                editing && editing.amount !== draft.amount
                  ? '지난 기록은 그대로 두고 이번 달부터(이번 달 이체가 이미 생겼으면 다음 달부터) 새 금액을 적용해요.'
                  : undefined
              }
            >
              <MoneyInput value={draft.amount} onChange={(v) => setDraft({ ...draft, amount: v })} data-autofocus="" />
            </Field>
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
