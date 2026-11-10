'use client';

import { useState } from 'react';
import { formatWon, monthOf, plannedIncome } from '@/domain';
import type { IncomePlan } from '@/domain/types';
import { Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, Field, ListRow, Money, MoneyInput, Select, TextInput, focusFirstInvalid } from '@/ui';
import type { ReadyLedger } from '../../_components/RequireLedger';
import { DAY_OPTIONS, isEmail } from '@/app/start/new/wizard';
import { accountName, periodLabel, startMonthForNew, startMonthHint } from '../helpers';
import { useRunner } from '../useRunner';

interface Draft {
  id: string | null;
  personName: string;
  personEmail: string;
  amount: number | null;
  day: number;
  accountId: string;
}

type Errors = Partial<Record<'name' | 'email' | 'amount' | 'account', string>>;

/**
 * 수입 계획 (PLAN 4-13): 누가 · 얼마를 · 매달 며칠에 · 어느 통장으로 받는지.
 * 함께 쓰는 월급통장 하나에 두 사람 월급이 들어오면 사람마다 한 줄씩. 받는 날이 되면 수입이 자동으로 기록돼요
 */
export function IncomePlansCard({ ledger }: { ledger: ReadyLedger }) {
  const { busy, run } = useRunner();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmDelete, setConfirmDelete] = useState<IncomePlan | null>(null);

  const month = monthOf(ledger.today);
  const accounts = ledger.activeAccounts;
  const plans = (ledger.data.incomePlans ?? [])
    .filter((p) => !p.deleted && (p.endMonth === null || p.endMonth >= month))
    .sort((a, b) => a.dayOfMonth - b.dayOfMonth || a.personName.localeCompare(b.personName, 'ko'));
  const total = plannedIncome(ledger.data, month);
  const editing = draft?.id ? ledger.data.incomePlans.find((p) => p.id === draft.id) : undefined;
  // 받는 통장은 수입통장 먼저
  const accountOptions = [...accounts]
    .sort((a, b) => (a.role === 'income' ? 0 : 1) - (b.role === 'income' ? 0 : 1) || a.order - b.order)
    .map((a) => ({ value: a.id, label: a.name }));
  const people = ledger.spenders.filter((s) => s.email);

  function openNew() {
    setErrors({});
    const used = new Set(plans.map((p) => p.personName));
    const next = people.find((p) => !used.has(p.name));
    setDraft({
      id: null,
      personName: next?.name ?? '',
      personEmail: next?.email ?? '',
      amount: null,
      day: 25,
      accountId: (ledger.incomeAccounts[0] ?? accounts[0])?.id ?? '',
    });
  }

  function openEdit(p: IncomePlan) {
    setErrors({});
    setDraft({ id: p.id, personName: p.personName, personEmail: p.personEmail ?? '', amount: p.amount, day: p.dayOfMonth, accountId: p.accountId });
  }

  async function save() {
    if (!draft) return;
    const next: Errors = {};
    if (!draft.personName.trim()) next.name = '누구 수입인지 이름을 입력해 주세요';
    if (draft.personEmail.trim() && !isEmail(draft.personEmail)) next.email = '이메일 주소를 확인해 주세요';
    if (draft.amount === null || draft.amount <= 0) next.amount = '금액을 입력해 주세요';
    if (!draft.accountId) next.account = '받는 통장을 골라 주세요';
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
      accountId: draft.accountId,
    };
    const ok = await run(
      'save',
      async () => {
        if (!draft.id) {
          await ledger.addIncomePlan({ ...fields, startMonth: startMonthForNew(ledger.today, draft.day), endMonth: null, memo: '' });
          return;
        }
        const prev = ledger.data.incomePlans.find((p) => p.id === draft.id);
        if (!prev) throw new Error('수입 계획을 찾을 수 없어요');
        await ledger.saveIncomePlan({ ...prev, ...fields });
      },
      draft.id ? '수입 계획을 저장했어요' : '수입 계획을 추가했어요',
    );
    if (ok) setDraft(null);
  }

  async function remove(p: IncomePlan) {
    const ok = await run('delete', () => ledger.saveIncomePlan({ ...p, deleted: true }), '수입 계획을 지웠어요');
    if (ok) setConfirmDelete(null);
  }

  return (
    <Card id="st-income" title="수입 계획" aside={total > 0 ? <span className="muted">한 달 {formatWon(total)}</span> : undefined}>
      <p className="st-desc">
        누가 매달 며칠에 얼마를 받는지 적어 두면 그날 수입이 자동으로 기록돼요. 두 사람 월급이 한 통장으로 들어오면 사람마다 한 줄씩 넣어 주세요.
      </p>
      {plans.length === 0 ? (
        <EmptyState
          icon="coins"
          headingLevel={3}
          title="수입 계획이 없어요"
          description="수입을 손으로 기록해도 돼요. 계획을 넣으면 매달 배분과 남는 돈을 미리 계산해 드려요."
        />
      ) : (
        <ul className="list">
          {plans.map((p) => {
            const label = periodLabel(p.startMonth, p.endMonth, month);
            return (
              <li key={p.id}>
                <ListRow
                  icon="coins"
                  title={p.personName}
                  subtitle={
                    <span className="st-sub">
                      <span>
                        매달 {p.dayOfMonth}일 · {accountName(accounts, p.accountId)}
                      </span>
                      {label ? (
                        <Badge size="sm" tone="info">
                          {label}
                        </Badge>
                      ) : null}
                    </span>
                  }
                  trailing={<Money amount={p.amount} />}
                  onClick={() => openEdit(p)}
                />
              </li>
            );
          })}
        </ul>
      )}
      <div className="st-foot">
        <Button variant="outline" icon="plus" onClick={openNew} disabled={accounts.length === 0}>
          수입 계획 추가
        </Button>
      </div>

      <Dialog
        open={draft !== null}
        onClose={() => (busy ? undefined : setDraft(null))}
        title={draft?.id ? '수입 계획 고치기' : '수입 계획 추가'}
        actions={
          <>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={busy !== null}>
              취소
            </Button>
            <Button type="submit" form="st-income-form" loading={busy === 'save'}>
              저장
            </Button>
          </>
        }
      >
        {draft ? (
          <form
            id="st-income-form"
            className="stack"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field label="누구 수입인가요?" error={errors.name} required>
              <TextInput
                value={draft.personName}
                onChange={(e) => setDraft({ ...draft, personName: e.target.value })}
                maxLength={20}
                autoComplete="off"
                list={people.length > 0 ? 'st-income-people' : undefined}
              />
            </Field>
            {people.length > 0 ? (
              <datalist id="st-income-people">
                {people.map((p) => (
                  <option key={p.key} value={p.name} />
                ))}
              </datalist>
            ) : null}
            <Field label="이메일" optional error={errors.email} hint="가계부를 함께 쓰는 사람이면 적어 두세요.">
              <TextInput
                type="email"
                inputMode="email"
                autoComplete="off"
                value={draft.personEmail}
                onChange={(e) => setDraft({ ...draft, personEmail: e.target.value })}
              />
            </Field>
            <Field label="한 달 금액" error={errors.amount} required hint={editing ? '이미 기록된 수입은 그대로 두고 다음 회차부터 바뀌어요.' : undefined}>
              <MoneyInput value={draft.amount} onChange={(v) => setDraft({ ...draft, amount: v })} data-autofocus="" />
            </Field>
            <Field label="받는 날" hint={editing ? undefined : startMonthHint(ledger.today, draft.day)}>
              <Select value={String(draft.day)} onChange={(v) => setDraft({ ...draft, day: Number(v) })} options={DAY_OPTIONS} />
            </Field>
            <Field label="받는 통장" error={errors.account} required>
              <Select value={draft.accountId} onChange={(v) => setDraft({ ...draft, accountId: v })} options={accountOptions} placeholder="통장 고르기" />
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
                  이 계획 지우기
                </Button>
              </div>
            ) : null}
          </form>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={confirmDelete !== null}
        tone="danger"
        title="이 수입 계획을 지울까요?"
        description="앞으로 이 수입이 자동으로 기록되지 않아요. 이미 기록된 수입은 그대로 남아요."
        confirmLabel="지우기"
        loading={busy === 'delete'}
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </Card>
  );
}
