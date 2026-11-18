import { useCallback } from 'react';
import {
  isValidDate, claimTransferId, claimLoanTransferId,
  claimLoanMovedFrom, isLoanRepayId, isLoanTransferId, expenseLoanTransferId, 
} from '@/domain';
import type { Expense, Id, Transfer } from '@/domain/types';
import type { LedgerApi, RowSnapshot } from '../types';
import type { ClaimActionsCtx } from './claims';

/** 정산 화면: 지급한 기록 · 저수지 기록 고치기 */
export function useSettleRecordActions(ctx: ClaimActionsCtx) {
  const {
    nowIso, requireData, mutate, writeExpenseWith, upsertTransfers, writeExpensesAndTransfers,
  } = ctx;
  /* ---------- 지급한 기록 · 저수지 기록 고치기 (정산 화면) ---------- */

  /**
   * 지급 취소: 돌려준 이체 claim:<id> 와 (빌려 지급했으면) 빌린 이체 loan:claim:<id> 를 지우고, 빌려 지급할 때 저수지 지출을
   * 이벤트통장으로 옮겼으면 지출을 그 저수지로 되돌려요 → 다시 '줄 돈'. 이미 취소했으면 아무것도 하지 않아요. 바꾸기 전 행을 돌려줘요
   */
  const undoClaimPayments = useCallback<LedgerApi['undoClaimPayments']>(
    async (expenseIds) => {
      const { data: d } = requireData();
      const updatedAt = nowIso();
      const before: RowSnapshot = { expenses: [], transfers: [] };
      const expenses: Expense[] = [];
      const transfers: Transfer[] = [];
      for (const id of new Set(expenseIds)) {
        const settle = d.transfers.find((t) => t.id === claimTransferId(id) && !t.deleted);
        const loan = d.transfers.find((t) => t.id === claimLoanTransferId(id) && !t.deleted);
        if (!settle) continue;
        const movedFrom = claimLoanMovedFrom(d, id);
        const e = d.expenses.find((x) => x.id === id);
        if (movedFrom && e) {
          before.expenses.push(e);
          expenses.push({ ...e, accountId: movedFrom, updatedAt });
        }
        for (const t of loan ? [loan, settle] : [settle]) {
          before.transfers.push(t);
          transfers.push({ ...t, deleted: true, updatedAt });
        }
      }
      if (transfers.length === 0) return before;
      // 지출을 먼저 저수지로 되돌리고 이체를 지워요 (끊겨도 다시 누르면 남은 것만)
      await writeExpensesAndTransfers(expenses, transfers, '지급을 취소하지 못했어요', true);
      return before;
    },
    [requireData, nowIso, writeExpensesAndTransfers],
  );

  /**
   * 빌린 기록만 취소 (지급은 그대로): 빌린 이체 loan:claim:<id> 를 지워요. 저수지 지출을 옮겨 빌려 지급한 것이면
   * 지출과 돌려준 이체를 저수지로 되돌려 '저수지에서 지급'한 청구로 남겨요 (잔액이 어긋나지 않게)
   */
  const cancelClaimLoans = useCallback<LedgerApi['cancelClaimLoans']>(
    async (expenseIds) => {
      const { data: d } = requireData();
      const updatedAt = nowIso();
      const before: RowSnapshot = { expenses: [], transfers: [] };
      const expenses: Expense[] = [];
      const transfers: Transfer[] = [];
      for (const id of new Set(expenseIds)) {
        const loan = d.transfers.find((t) => t.id === claimLoanTransferId(id) && !t.deleted);
        if (!loan) continue;
        const movedFrom = claimLoanMovedFrom(d, id);
        before.transfers.push(loan);
        transfers.push({ ...loan, deleted: true, updatedAt });
        if (movedFrom) {
          const settle = d.transfers.find((t) => t.id === claimTransferId(id) && !t.deleted);
          if (settle && settle.fromAccountId !== movedFrom) {
            before.transfers.push(settle);
            transfers.push({ ...settle, fromAccountId: movedFrom, updatedAt });
          }
          const e = d.expenses.find((x) => x.id === id);
          if (e) {
            before.expenses.push(e);
            expenses.push({ ...e, accountId: movedFrom, updatedAt });
          }
        }
      }
      if (transfers.length === 0) return before;
      await writeExpensesAndTransfers(expenses, transfers, '빌린 기록을 취소하지 못했어요', true);
      return before;
    },
    [requireData, nowIso, writeExpensesAndTransfers],
  );

  /**
   * 빌린 · 갚은 이체 하나 취소: loanpay:<월> 은 갚은 기록을 지우고, loan:<지출id> 는 바꾸기를 되돌려요(지출 → 저수지).
   * loan:claim:<id> 는 cancelClaimLoans · undoClaimPayments 로 해요
   */
  const cancelLoanTransfer = useCallback<LedgerApi['cancelLoanTransfer']>(
    async (transferId) => {
      const { data: d } = requireData();
      const row = d.transfers.find((t) => t.id === transferId && !t.deleted);
      const before: RowSnapshot = { expenses: [], transfers: [] };
      if (!row) return before;
      const updatedAt = nowIso();
      if (isLoanRepayId(transferId)) {
        before.transfers.push(row);
        await upsertTransfers([{ ...row, deleted: true, updatedAt }], '갚은 기록을 취소하지 못했어요');
        return before;
      }
      if (transferId.startsWith('loan:claim:')) throw new Error('청구를 빌려 지급한 기록은 지급과 함께 정해 취소해 주세요');
      if (!isLoanTransferId(transferId)) throw new Error('저수지 기록이 아니에요');
      const e = d.expenses.find((x) => x.id === transferId.slice('loan:'.length));
      before.transfers.push(row);
      const expenses: Expense[] = [];
      if (e && row.fromAccountId && e.accountId !== row.fromAccountId) {
        before.expenses.push(e);
        expenses.push({ ...e, accountId: row.fromAccountId, updatedAt });
      }
      await writeExpensesAndTransfers(expenses, [{ ...row, deleted: true, updatedAt }], '되돌리지 못했어요', true);
      return before;
    },
    [requireData, nowIso, upsertTransfers, writeExpensesAndTransfers],
  );

  /** 빌린 · 갚은 이체(loan: · loanpay:)의 금액만 고쳐요 ('저수지에 갚을 돈' 셈). 청구 지급 · 지출은 그대로 */
  const updateLoanAmount = useCallback<LedgerApi['updateLoanAmount']>(
    async (transferId, amount) => {
      const { data: d } = requireData();
      if (!isLoanTransferId(transferId) && !isLoanRepayId(transferId)) throw new Error('저수지 기록이 아니에요');
      const value = Math.round(amount);
      if (!(value > 0)) throw new Error('금액을 확인해 주세요');
      const row = d.transfers.find((t) => t.id === transferId && !t.deleted);
      const before: RowSnapshot = { expenses: [], transfers: [] };
      if (!row) throw new Error('기록을 찾지 못했어요');
      if (row.amount === value) return before;
      before.transfers.push(row);
      await upsertTransfers([{ ...row, amount: value, updatedAt: nowIso() }], '금액을 고치지 못했어요');
      return before;
    },
    [requireData, nowIso, upsertTransfers],
  );

  /** 위 고치기 · 취소의 되돌리기: 바꾸기 전 행을 그대로 다시 써요 (이체 먼저) */
  const restoreRows = useCallback<LedgerApi['restoreRows']>(
    async (snapshot) => {
      if (snapshot.expenses.length === 0 && snapshot.transfers.length === 0) return;
      const updatedAt = nowIso();
      await writeExpensesAndTransfers(
        snapshot.expenses.map((e) => ({ ...e, updatedAt })),
        snapshot.transfers.map((t) => ({ ...t, updatedAt })),
        '되돌리지 못했어요',
        false,
      );
    },
    [nowIso, writeExpensesAndTransfers],
  );

  const saveSettleDay = useCallback<LedgerApi['saveSettleDay']>(
    async (day) => {
      const value = day !== null && Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
      await mutate(
        (d) => ({ ...d, settings: { ...d.settings, settleDay: value } }),
        (r) => r.updateSettings({ settleDay: value }),
        '정산일을 저장하지 못했어요',
      );
    },
    [mutate],
  );

  const saveDaysOff = useCallback<LedgerApi['saveDaysOff']>(
    async (days) => {
      const value = [...new Set(days.filter((d) => isValidDate(d)))].sort();
      await mutate(
        (d) => ({ ...d, settings: { ...d.settings, daysOff: value } }),
        (r) => r.updateSettings({ daysOff: value }),
        '쉬는 날을 저장하지 못했어요',
      );
    },
    [mutate],
  );

  const saveDismissedRecurring = useCallback<LedgerApi['saveDismissedRecurring']>(
    async (keys) => {
      const value = [...new Set(keys.map((k) => k.trim()).filter((k) => k && !k.includes(',')))].sort();
      await mutate(
        (d) => ({ ...d, settings: { ...d.settings, dismissedRecurring: value } }),
        (r) => r.updateSettings({ dismissedRecurring: value }),
        '숨긴 제안을 저장하지 못했어요',
      );
    },
    [mutate],
  );

  const deleteExpense = useCallback(
    async (id: Id) => {
      const d = requireData().data;
      const row = d.expenses.find((e) => e.id === id);
      if (!row) throw new Error('지출 기록을 찾을 수 없어요');
      const updatedAt = nowIso();
      const deleted: Expense = { ...row, deleted: true, updatedAt };
      // 지출을 지우면 딸린 이체(돌려준 이체 · 빌린 이체)도 같은 시각으로 지운다 (되살리면 함께 되살아난다)
      const ids = new Set([claimTransferId(row.id), claimLoanTransferId(row.id), expenseLoanTransferId(row.id)]);
      const linked = d.transfers.filter((t) => ids.has(t.id) && !t.deleted).map((t) => ({ ...t, deleted: true, updatedAt }));
      await writeExpenseWith(deleted, linked, '지출을 지우지 못했어요');
    },
    [requireData, nowIso, writeExpenseWith],
  );

  return {
    undoClaimPayments, cancelClaimLoans, cancelLoanTransfer, updateLoanAmount, restoreRows, saveSettleDay, saveDaysOff,
    saveDismissedRecurring, deleteExpense,
  };
}

export type SettleRecordActionsCtx = ClaimActionsCtx & ReturnType<typeof useSettleRecordActions>;
