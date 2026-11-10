'use client';

import { useState } from 'react';
import {
  addMonths, compareMonth, dateInMonth, formatDateKo, formatMonthKo, formatWon, installmentAmounts, MAX_INSTALLMENT_MONTHS, monthOf,
  prepaidAmounts, remainingAmountsFrom, revisedAmounts, validateInstallment,
} from '@/domain';
import type { InstallmentPlan, YearMonth } from '@/domain/types';
import {
  Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, Field, ListRow, Money, MoneyInput, ProgressBar,
  SegmentedControl, Select, TextInput, focusFirstInvalid,
} from '@/ui';
import type { ReadyLedger } from '../../_components/RequireLedger';
import { DAY_OPTIONS } from '@/app/start/new/wizard';
import { accountName, startMonthForNew, accountOptions as accountOptionsOf, categorySelectOptions } from '../helpers';
import { useRunner } from '../useRunner';
import { OwnerTabs, ownerKeyOf, useOwnerFilter } from './OwnerTabs';

/** 끝난 할부를 몇 달 동안 목록에 남길지 */
const ENDED_VISIBLE_MONTHS = 2;
/** 첫 달로 고를 수 있는 범위 (이번 달 기준 앞 · 뒤) */
const FIRST_MONTH_BACK = 59;
const FIRST_MONTH_AHEAD = 12;

interface NewDraft {
  name: string;
  amountKind: 'total' | 'monthly';
  amount: number | null;
  months: number | null;
  firstMonth: YearMonth;
  day: number;
  accountId: string;
  categoryId: string;
}

interface EditDraft {
  planId: string;
  mode: 'edit' | 'prepay';
  name: string;
  monthly: number | null;
  remaining: number | null;
  fromMonth: YearMonth;
  day: number;
  accountId: string;
  categoryId: string;
  prepay: number | null;
  keep: 'monthly' | 'months';
}

type Errors = Partial<Record<'name' | 'amount' | 'months' | 'account' | 'monthly' | 'remaining' | 'prepay', string>>;

function monthText(m: YearMonth, base: number): string {
  return formatMonthKo(m, base);
}

/** 첫 달로 고를 수 있는 달 (늦은 달 먼저) */
function firstMonthChoices(month: YearMonth): { value: string; label: string }[] {
  const year = Number(month.slice(0, 4));
  const out: { value: string; label: string }[] = [];
  for (let i = FIRST_MONTH_AHEAD; i >= -FIRST_MONTH_BACK; i--) {
    const m = addMonths(month, i);
    out.push({ value: m, label: i === 0 ? `이번 달 (${monthText(m, year)})` : monthText(m, year) });
  }
  return out;
}

/** 'TV 할부 · 16/24회차 · 남은 8회 · 남은 금액 800,000원' 의 회차 부분 */
export function installmentProgressText(p: InstallmentPlan): string {
  if (p.ended) return p.count > 0 ? `${p.count}회 다 냈어요` : '회차 없이 그만뒀어요';
  const parts = [`${p.paidCount}/${p.count}회차`, `남은 ${p.remainingCount}회`, `남은 금액 ${formatWon(p.remainingAmount)}`];
  return parts.join(' · ');
}

/**
 * 할부: 이름 · 총액(또는 매달 금액) · 개월 · 첫 달 · 결제일 · 통장 · 카테고리. 고치면 다음 회차부터 (PLAN 4-10).
 * accountId 를 주면 그 통장의 할부만 카드 틀 없이 보여 줘요 (예산 화면 통장 카드 안, 새 할부도 그 통장)
 */
export function InstallmentCard({ ledger, accountId }: { ledger: ReadyLedger; accountId?: string }) {
  const { busy, run } = useRunner();
  const [draft, setDraft] = useState<NewDraft | null>(null);
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [confirm, setConfirm] = useState<{ action: 'end' | 'delete'; plan: InstallmentPlan } | null>(null);
  /** 끝난 할부 (보기 · 지우기만) */
  const [viewId, setViewId] = useState<string | null>(null);

  const today = ledger.today;
  const month = monthOf(today);
  const year = Number(month.slice(0, 4));
  const accounts = ledger.activeAccounts;
  const accountOptions = accountOptionsOf(accounts);
  const categoryOptions = categorySelectOptions(ledger.activeCategories, [draft?.categoryId, edit?.categoryId]);
  const plans = ledger.installments.filter(
    (p) => !p.ended || compareMonth(p.endMonth, addMonths(month, -ENDED_VISIBLE_MONTHS)) >= 0,
  );
  const keyOf = (p: InstallmentPlan) => ownerKeyOf(accounts.find((a) => a.id === p.accountId));
  const myKey = ledger.myLivingAccountId ? ownerKeyOf(ledger.activeAccounts.find((a) => a.id === ledger.myLivingAccountId)) : null;
  const owners = useOwnerFilter(plans.map(keyOf), ledger.data, undefined, myKey);
  const shown = accountId ? plans.filter((p) => p.accountId === accountId) : plans.filter((p) => owners.matches(keyOf(p)));
  const plan = edit ? (ledger.installments.find((p) => p.id === edit.planId) ?? null) : null;
  const viewing = viewId ? (ledger.installments.find((p) => p.id === viewId) ?? null) : null;

  const firstMonthOptions = draft ? firstMonthChoices(month) : [];

  function defaultAccountId(): string {
    if (accountId) return accountId;
    return (ledger.accountByRole('fixed') ?? ledger.accountByRole('allowance') ?? accounts[0])?.id ?? '';
  }

  function openNew() {
    setErrors({});
    setDraft({
      name: '',
      amountKind: 'total',
      amount: null,
      months: 12,
      firstMonth: startMonthForNew(today, 1),
      day: 1,
      accountId: defaultAccountId(),
      categoryId: '',
    });
  }

  function openEdit(p: InstallmentPlan) {
    setErrors({});
    setEdit({
      planId: p.id,
      mode: 'edit',
      name: p.name,
      monthly: p.monthly,
      remaining: p.remainingCount,
      fromMonth: p.next?.month ?? month,
      day: p.dayOfMonth,
      accountId: p.accountId,
      categoryId: p.categoryId ?? '',
      prepay: null,
      keep: 'monthly',
    });
  }

  /* ---------- 새 할부 ---------- */

  const newInput = draft
    ? {
        name: draft.name,
        amount: draft.amount ?? 0,
        amountKind: draft.amountKind,
        months: draft.months ?? 0,
        firstMonth: draft.firstMonth,
        dayOfMonth: draft.day,
        accountId: draft.accountId,
        categoryId: draft.categoryId || null,
      }
    : null;

  function newPreview(): string | null {
    if (!draft || !newInput || !(newInput.amount > 0) || !(newInput.months >= 2)) return null;
    const amounts = installmentAmounts(newInput);
    if (amounts.length === 0) return null;
    const last = addMonths(draft.firstMonth, amounts.length - 1);
    const monthly = amounts[amounts.length - 1]!;
    const total = amounts.reduce((s, a) => s + a, 0);
    const parts = [`매달 ${formatWon(monthly)}`, `총 ${formatWon(total)}`, `마지막 회차 ${monthText(last, year)}`];
    if (amounts[0] !== monthly) parts.push(`1회차 ${formatWon(amounts[0]!)}`);
    // 결제일이 오늘보다 앞선 회차는 낸 것으로 보고 기록하지 않아요 (buildInstallmentRows 와 같은 기준)
    let skipped = 0;
    while (skipped < amounts.length && dateInMonth(addMonths(draft.firstMonth, skipped), draft.day) < today) skipped++;
    const tail = skipped > 0 ? ` 지난 ${skipped}회는 낸 것으로 보고 기록하지 않아요.` : '';
    return `${parts.join(' · ')}.${tail}`;
  }

  async function saveNew() {
    if (!draft || !newInput) return;
    const next: Errors = {};
    if (!draft.name.trim()) next.name = '이름을 입력해 주세요';
    if (draft.amount === null || draft.amount <= 0) next.amount = '금액을 입력해 주세요';
    if (draft.months === null || draft.months < 2 || draft.months > MAX_INSTALLMENT_MONTHS)
      next.months = `2~${MAX_INSTALLMENT_MONTHS}개월로 입력해 주세요`;
    if (!draft.accountId) next.account = '통장을 골라 주세요';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusFirstInvalid();
      return;
    }
    const problem = validateInstallment(newInput, today);
    if (problem) {
      setErrors({ months: problem });
      focusFirstInvalid();
      return;
    }
    const ok = await run('add', () => ledger.addInstallment(newInput), '할부를 추가했어요');
    if (ok) setDraft(null);
  }

  /* ---------- 고치기 · 미리 갚기 ---------- */

  const fromOptions = plan
    ? plan.payments
        .filter((p) => !p.paid)
        .map((p) => ({ value: p.month, label: `${monthText(p.month, year)} (${p.number}회차)부터` }))
    : [];

  function editPreview(): { text: string; error: string | null } | null {
    if (!edit || !plan || plan.ended) return null;
    try {
      if (edit.mode === 'prepay') {
        if (edit.prepay === null || edit.prepay <= 0) return null;
        const from = plan.next!.month;
        const amounts = prepaidAmounts(plan, from, edit.prepay, edit.keep);
        if (amounts.length === 0) return { text: '남은 금액을 다 갚아요. 다음 회차부터 기록하지 않아요', error: null };
        const last = addMonths(from, amounts.length - 1);
        return {
          text: `갚고 나면 남은 ${amounts.length}회 · 매달 ${formatWon(amounts[amounts.length > 1 ? 1 : 0]!)} · 마지막 회차 ${monthText(last, year)}`,
          error: null,
        };
      }
      const remaining = edit.remaining ?? 0;
      if (remaining < 1) return null;
      const amounts = revisedAmounts(plan, edit.fromMonth, { monthly: edit.monthly ?? undefined, remaining });
      const before = plan.payments.filter((p) => compareMonth(p.month, edit.fromMonth) < 0);
      const after = remainingAmountsFrom(plan, edit.fromMonth).length;
      const paidLeft = before.filter((p) => !p.paid).reduce((s, p) => s + p.amount, 0);
      const total = paidLeft + amounts.reduce((s, a) => s + a, 0);
      const last = addMonths(edit.fromMonth, amounts.length - 1);
      const count = plan.count - after + amounts.length;
      return { text: `남은 금액 ${formatWon(total)} · 마지막 회차 ${monthText(last, year)} · 전체 ${count}회`, error: null };
    } catch (e) {
      return { text: '', error: e instanceof Error ? e.message : '금액을 확인해 주세요' };
    }
  }

  async function saveEdit() {
    if (!edit || !plan) return;
    const next: Errors = {};
    if (edit.mode === 'edit') {
      if (!edit.name.trim()) next.name = '이름을 입력해 주세요';
      if (edit.monthly === null || edit.monthly <= 0) next.monthly = '매달 금액을 입력해 주세요';
      if (edit.remaining === null || edit.remaining < 1 || edit.remaining > MAX_INSTALLMENT_MONTHS)
        next.remaining = `1~${MAX_INSTALLMENT_MONTHS}회로 입력해 주세요. 그만 낼 거라면 아래 그만 내기를 골라 주세요`;
      if (!edit.accountId) next.account = '통장을 골라 주세요';
    } else if (edit.prepay === null || edit.prepay <= 0) {
      next.prepay = '미리 갚을 금액을 입력해 주세요';
    } else if (edit.prepay > plan.remainingAmount) {
      next.prepay = `남은 금액 ${formatWon(plan.remainingAmount)}보다 많아요`;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusFirstInvalid();
      return;
    }
    let ok: boolean;
    if (edit.mode === 'prepay') {
      ok = await run(
        'save',
        () => ledger.prepayInstallment(plan.id, { amount: edit.prepay!, keep: edit.keep }),
        '미리 갚은 돈을 기록했어요',
      );
    } else {
      const current = remainingAmountsFrom(plan, edit.fromMonth);
      const sameMonthly = current.length > 0 && current.every((a) => a === edit.monthly);
      // 남은 회차는 고쳤을 때만 보낸다 (언제부터만 바꿨는데 회차가 늘어나지 않게)
      const sameRemaining = edit.remaining === current.length;
      ok = await run(
        'save',
        () =>
          ledger.reviseInstallment(plan.id, {
            fromMonth: edit.fromMonth,
            ...(sameRemaining ? {} : { remaining: edit.remaining! }),
            ...(sameMonthly ? {} : { monthly: edit.monthly! }),
            ...(edit.name.trim() !== plan.name ? { name: edit.name.trim() } : {}),
            ...(edit.accountId !== plan.accountId ? { accountId: edit.accountId } : {}),
            ...((edit.categoryId || null) !== plan.categoryId ? { categoryId: edit.categoryId || null } : {}),
            ...(edit.day !== plan.dayOfMonth ? { dayOfMonth: edit.day } : {}),
          }),
        `${monthText(edit.fromMonth, year)} 회차부터 바꿨어요`,
      );
    }
    if (ok) setEdit(null);
  }

  async function applyConfirm() {
    if (!confirm) return;
    const { action, plan: p } = confirm;
    const ok =
      action === 'end'
        ? await run('end', () => ledger.endInstallment(p.id), '다음 회차부터 기록하지 않을게요')
        : await run('delete', () => ledger.deleteInstallment(p.id), '할부를 지웠어요');
    if (ok) setConfirm(null);
  }

  function subtitle(p: InstallmentPlan) {
    const where = [`매달 ${p.dayOfMonth}일`, accountName(accounts, p.accountId)].join(' · ');
    return (
      <span className="st-sub st-inst">
        <span>{installmentProgressText(p)}</span>
        <ProgressBar
          value={p.paidCount}
          max={p.count}
          track="subtle"
          tone={p.ended ? 'success' : 'primary'}
          label={`${p.name} 낸 회차`}
          valueText={`${p.count}회 중 ${p.paidCount}회`}
          className="st-inst-bar"
        />
        <span>
          {p.ended ? (
            <Badge size="sm" tone="success">
              다 냈어요
            </Badge>
          ) : (
            where
          )}
        </span>
      </span>
    );
  }

  const newHint = draft ? newPreview() : null;
  const preview = edit ? editPreview() : null;

  const body = (
    <>
      {shown.length === 0 ? (
        accountId ? (
          <p className="st-desc">이 통장에서 나가는 할부가 없어요.</p>
        ) : (
          <EmptyState icon="calendar" headingLevel={3} title="할부가 없어요" description="TV · 노트북처럼 나눠 내는 돈을 등록해 주세요." />
        )
      ) : (
        <ul className="list">
          {shown.map((p) => (
            <li key={p.id}>
              <ListRow
                icon="calendar"
                title={p.name}
                subtitle={subtitle(p)}
                trailing={<Money amount={p.monthly} />}
                onClick={() => (p.ended ? setViewId(p.id) : openEdit(p))}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="st-foot">
        <Button variant="outline" icon="plus" onClick={openNew} disabled={accounts.length === 0}>
          할부 추가
        </Button>
      </div>

      <Dialog
        open={draft !== null}
        onClose={() => (busy ? undefined : setDraft(null))}
        title="할부 추가"
        actions={
          <>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={busy !== null}>
              취소
            </Button>
            <Button type="submit" form="st-inst-new" loading={busy === 'add'}>
              추가
            </Button>
          </>
        }
      >
        {draft ? (
          <form
            id="st-inst-new"
            className="stack"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void saveNew();
            }}
          >
            <Field label="이름" error={errors.name} required>
              <TextInput
                value={draft.name}
                maxLength={30}
                placeholder="예: TV 할부"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                data-autofocus=""
              />
            </Field>
            <SegmentedControl<'total' | 'monthly'>
              ariaLabel="금액 넣는 방식"
              block
              value={draft.amountKind}
              onChange={(amountKind) => setDraft({ ...draft, amountKind })}
              options={[
                { value: 'total', label: '총액' },
                { value: 'monthly', label: '매달 금액' },
              ]}
            />
            <div className="st-inline">
              <Field label={draft.amountKind === 'total' ? '총액' : '매달 금액'} error={errors.amount} required>
                <MoneyInput value={draft.amount} onChange={(v) => setDraft({ ...draft, amount: v })} />
              </Field>
              <Field label="개월" error={errors.months} required>
                <MoneyInput
                  unit="개월"
                  max={MAX_INSTALLMENT_MONTHS}
                  value={draft.months}
                  onChange={(v) => setDraft({ ...draft, months: v })}
                />
              </Field>
            </div>
            <div className="st-inline">
              <Field label="첫 달" hint="이미 시작한 할부면 1회차의 달을 골라요">
                <Select value={draft.firstMonth} onChange={(v) => setDraft({ ...draft, firstMonth: v })} options={firstMonthOptions} />
              </Field>
              <Field label="결제일">
                <Select value={String(draft.day)} onChange={(v) => setDraft({ ...draft, day: Number(v) })} options={DAY_OPTIONS} />
              </Field>
            </div>
            <Field label="나가는 통장" error={errors.account}>
              <Select
                value={draft.accountId}
                onChange={(v) => setDraft({ ...draft, accountId: v })}
                options={accountOptions}
                placeholder="통장 고르기"
              />
            </Field>
            <Field label="카테고리" optional>
              <Select value={draft.categoryId} onChange={(v) => setDraft({ ...draft, categoryId: v })} options={categoryOptions} />
            </Field>
            {newHint ? <p className="st-desc" aria-live="polite">{newHint}</p> : null}
          </form>
        ) : null}
      </Dialog>

      <Dialog
        open={edit !== null && plan !== null}
        onClose={() => (busy ? undefined : setEdit(null))}
        title={plan ? plan.name : '할부'}
        actions={
          <>
            <Button variant="outline" onClick={() => setEdit(null)} disabled={busy !== null}>
              취소
            </Button>
            <Button type="submit" form="st-inst-edit" loading={busy === 'save'}>
              {edit?.mode === 'prepay' ? '미리 갚기' : '저장'}
            </Button>
          </>
        }
      >
        {edit && plan ? (
          <form
            id="st-inst-edit"
            className="stack"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void saveEdit();
            }}
          >
            <p className="st-desc">
              {installmentProgressText(plan)}
              {plan.next ? ` · 다음 회차 ${formatDateKo(plan.next.date, false)} ${formatWon(plan.next.amount)}` : ''}
            </p>
            <SegmentedControl<'edit' | 'prepay'>
              ariaLabel="할 일"
              block
              value={edit.mode}
              onChange={(mode) => {
                setErrors({});
                setEdit({ ...edit, mode });
              }}
              options={[
                { value: 'edit', label: '고치기' },
                { value: 'prepay', label: '미리 갚기' },
              ]}
            />
            {edit.mode === 'edit' ? (
              <>
                <Field label="언제부터" hint="지난 회차와 이미 기록된 지출은 그대로예요">
                  <Select
                    value={edit.fromMonth}
                    onChange={(v) =>
                      // 남은 회차는 고른 달부터 다시 센다 (계약 회차가 몰래 늘거나 줄지 않게)
                      setEdit({ ...edit, fromMonth: v, remaining: remainingAmountsFrom(plan, v).length })
                    }
                    options={fromOptions}
                  />
                </Field>
                <div className="st-inline">
                  <Field label="매달 금액" error={errors.monthly} required>
                    <MoneyInput value={edit.monthly} onChange={(v) => setEdit({ ...edit, monthly: v })} />
                  </Field>
                  <Field label="남은 회차" error={errors.remaining} required>
                    <MoneyInput
                      unit="회"
                      max={MAX_INSTALLMENT_MONTHS}
                      value={edit.remaining}
                      onChange={(v) => setEdit({ ...edit, remaining: v })}
                    />
                  </Field>
                </div>
                <Field label="이름" error={errors.name} required>
                  <TextInput value={edit.name} maxLength={30} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                </Field>
                <div className="st-inline">
                  <Field label="결제일">
                    <Select value={String(edit.day)} onChange={(v) => setEdit({ ...edit, day: Number(v) })} options={DAY_OPTIONS} />
                  </Field>
                  <Field label="나가는 통장" error={errors.account}>
                    <Select value={edit.accountId} onChange={(v) => setEdit({ ...edit, accountId: v })} options={accountOptions} />
                  </Field>
                </div>
                <Field label="카테고리" optional>
                  <Select value={edit.categoryId} onChange={(v) => setEdit({ ...edit, categoryId: v })} options={categoryOptions} />
                </Field>
              </>
            ) : (
              <>
                <Field label="미리 갚을 금액" error={errors.prepay} required hint={`남은 금액 ${formatWon(plan.remainingAmount)}`}>
                  <MoneyInput value={edit.prepay} onChange={(v) => setEdit({ ...edit, prepay: v })} data-autofocus="" />
                </Field>
                <SegmentedControl<'monthly' | 'months'>
                  ariaLabel="갚은 뒤"
                  block
                  value={edit.keep}
                  onChange={(keep) => setEdit({ ...edit, keep })}
                  options={[
                    { value: 'monthly', label: '회차 줄이기' },
                    { value: 'months', label: '매달 금액 줄이기' },
                  ]}
                />
                <p className="st-desc">미리 갚은 돈은 오늘 날짜로 {accountName(accounts, plan.accountId)} 지출에 남아요.</p>
              </>
            )}
            {preview ? (
              <p className="st-desc" aria-live="polite" role={preview.error ? 'alert' : undefined}>
                {preview.error ?? preview.text}
              </p>
            ) : null}
            <div className="st-danger">
              <Button
                variant="ghost"
                icon="x-circle"
                disabled={busy !== null}
                onClick={() => {
                  setEdit(null);
                  setConfirm({ action: 'end', plan });
                }}
              >
                그만 내기
              </Button>
              <Button
                variant="ghost"
                icon="trash"
                disabled={busy !== null}
                onClick={() => {
                  setEdit(null);
                  setConfirm({ action: 'delete', plan });
                }}
              >
                지우기
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

      <Dialog
        open={viewing !== null && confirm === null}
        onClose={() => setViewId(null)}
        title={viewing ? viewing.name : '할부'}
        actions={
          <Button variant="outline" onClick={() => setViewId(null)}>
            닫기
          </Button>
        }
      >
        {viewing ? (
          <div className="stack">
            <p className="st-desc">
              {installmentProgressText(viewing)}
              {viewing.last ? ` · 마지막 회차 ${formatDateKo(viewing.last.date, false)}` : ''}
            </p>
            <p className="st-desc">끝난 할부라 고칠 수 없어요. 잘못 넣었다면 지워 주세요.</p>
            <div className="st-danger">
              <Button
                variant="ghost"
                icon="trash"
                disabled={busy !== null}
                onClick={() => {
                  setViewId(null);
                  setConfirm({ action: 'delete', plan: viewing });
                }}
              >
                지우기
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={confirm !== null}
        tone="danger"
        title={confirm?.action === 'end' ? '할부를 그만 낼까요?' : '이 할부를 지울까요?'}
        description={
          confirm?.action === 'end'
            ? '다음 회차부터 기록하지 않아요. 지난 회차 기록은 그대로 둬요.'
            : '앞으로의 회차가 모두 빠져요. 이미 자동 기록된 지출은 남아요.'
        }
        confirmLabel={confirm?.action === 'end' ? '그만 내기' : '지우기'}
        loading={busy === 'end' || busy === 'delete'}
        onConfirm={() => void applyConfirm()}
        onCancel={() => setConfirm(null)}
      />
    </>
  );

  if (accountId) return <div className="bd-embed">{body}</div>;
  return (
    <Card id="st-installment" title="할부">
      <p className="st-desc">
        정한 회차만큼 결제일에 지출로 자동 기록되고, 마지막 회차 뒤에 저절로 끝나요. 도중에 고치면 다음 회차부터 바뀌고 지난 회차는 그대로예요.
      </p>
      <OwnerTabs filter={owners} label="누구 할부" />
      {body}
    </Card>
  );
}
