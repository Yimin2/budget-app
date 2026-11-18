import { useCallback } from 'react';
import {
  claimTransferId, claimLoanTransferId, claimLoanMemo,
  isReservoirEventExpense, computeSettlement, settleRefusal, expenseLoanTransferId, loanCandidates as loanCandidatesDomain, loanRepayId,
  monthOf, pendingClaims, 
} from '@/domain';
import type { Expense, Id, Transfer } from '@/domain/types';
import type { LedgerApi } from '../types';
import { upsertIn, claimWhat } from './helpers';
import type { ExpenseActionsCtx } from './expenses';

/** 청구(돌려받을 돈) 지급 · 저수지에서 빌리기 · 갚기 */
export function useClaimActions(ctx: ExpenseActionsCtx) {
  const {
    todayRef, nowIso, requireData, mutate, stamp,
  } = ctx;
  /* ---------- 청구 ---------- */

  const settleClaims = useCallback<LedgerApi['settleClaims']>(
    async (expenseIds, date) => {
      const { data: d } = requireData();
      const ids = new Set(expenseIds);
      const due = pendingClaims(d, todayRef.current).filter((c) => ids.has(c.expense.id));
      if (due.length === 0) return;
      // 이벤트통장에서 바로 주는 몫은 지급할 수 있는 돈 안에서만 (넘는 것은 [저수지에서 빌려 지급]으로)
      const current = computeSettlement(d, todayRef.current);
      const refusal = settleRefusal(d, current, due.map((c) => c.expense.id));
      if (refusal) throw new Error(refusal);
      const s = stamp();
      const day = date ?? todayRef.current;
      const rows: Transfer[] = due.map((c) => {
        const what = claimWhat(d, c.expense);
        return {
          id: claimTransferId(c.expense.id),
          date: day,
          kind: 'transfer',
          fromAccountId: c.accountId,
          toAccountId: c.claimAccountId,
          amount: c.amount,
          status: 'done',
          ruleId: null,
          memo: `${c.payer}에게 돌려줌 · ${what}`,
          ...s,
        };
      });
      // 늘 키로 덮어쓴다(없으면 추가). 다른 기기에서 돌려줬다 되돌린(지운) 행이 시트에 있을 수 있는데,
      // insert 는 같은 키를 건너뛰어 아무것도 쓰지 않은 채 돌려준 것처럼 보이기 때문이다
      await mutate(
        (x) => ({ ...x, transfers: rows.reduce((list, r) => upsertIn(list, r), x.transfers) }),
        async (repo) => {
          for (const r of rows) await repo.upsert('transfers', r);
        },
        '돌려준 기록을 저장하지 못했어요',
        { multiStep: rows.length > 1 },
      );
    },
    [requireData, todayRef, stamp, mutate],
  );

  const unsettleClaims = useCallback<LedgerApi['unsettleClaims']>(
    async (expenseIds) => {
      const { data: d } = requireData();
      // 저수지에서 빌려 지급한 청구는 빌린 이체(loan:claim:<지출id>)도 함께 지운다
      const ids = new Set([...expenseIds.map(claimTransferId), ...expenseIds.map(claimLoanTransferId)]);
      const rows = d.transfers
        .filter((t) => ids.has(t.id) && !t.deleted)
        .map((t) => ({ ...t, deleted: true, updatedAt: nowIso() }));
      if (rows.length === 0) return;
      await mutate(
        (x) => ({ ...x, transfers: rows.reduce((list, r) => upsertIn(list, r), x.transfers) }),
        async (repo) => {
          for (const r of rows) await repo.upsert('transfers', r);
        },
        '되돌리지 못했어요',
        { multiStep: rows.length > 1 },
      );
    },
    [requireData, mutate, nowIso],
  );

  /** 지운 행을 되살릴 수 있게 늘 키로 덮어쓰며 이체 여러 개를 쓴다 (순서대로) */
  const upsertTransfers = useCallback(
    (rows: Transfer[], failMessage: string) =>
      mutate(
        (x) => ({ ...x, transfers: rows.reduce((list, r) => upsertIn(list, r), x.transfers) }),
        async (repo) => {
          for (const r of rows) await repo.upsert('transfers', r);
        },
        failMessage,
        { multiStep: rows.length > 1 },
      ),
    [mutate],
  );

  const borrowAndSettleClaims = useCallback<LedgerApi['borrowAndSettleClaims']>(
    async (expenseIds) => {
      const { data: d } = requireData();
      const reservoir = d.accounts.find((a) => !a.deleted && a.role === 'reservoir');
      if (!reservoir) throw new Error('저수지통장이 없어요');
      const ids = new Set(expenseIds);
      const due = pendingClaims(d, todayRef.current).filter((c) => ids.has(c.expense.id));
      if (due.length === 0) return;
      const s = stamp();
      const day = todayRef.current;
      const base = { date: day, kind: 'transfer' as const, status: 'done' as const, ruleId: null, ...s };
      // 빌린 이체를 먼저: 끊겨도 이벤트통장이 모자라지 않고, 다시 누르면 같은 키라 하나씩만 남는다
      const loans: Transfer[] = due.map((c) => ({
        ...base,
        id: claimLoanTransferId(c.expense.id),
        fromAccountId: reservoir.id,
        toAccountId: c.accountId,
        amount: c.amount,
        memo: `저수지에서 빌림 · ${c.payer}에게 돌려줌 · ${claimWhat(d, c.expense)}`,
      }));
      const settles: Transfer[] = due.map((c) => ({
        ...base,
        id: claimTransferId(c.expense.id),
        fromAccountId: c.accountId,
        toAccountId: c.claimAccountId,
        amount: c.amount,
        memo: `${c.payer}에게 돌려줌 · ${claimWhat(d, c.expense)}`,
      }));
      await upsertTransfers([...loans, ...settles], '저수지에서 빌린 기록을 저장하지 못했어요');
    },
    [requireData, stamp, todayRef, upsertTransfers],
  );

  const repayLoan = useCallback<LedgerApi['repayLoan']>(
    async (amount) => {
      const { data: d } = requireData();
      const value = Math.round(amount);
      if (!(value > 0)) throw new Error('갚을 금액을 확인해 주세요');
      const event = d.accounts.find((a) => !a.deleted && a.role === 'event');
      const reservoir = d.accounts.find((a) => !a.deleted && a.role === 'reservoir');
      if (!event || !reservoir) throw new Error('이벤트통장과 저수지통장이 있어야 해요');
      const day = todayRef.current;
      const row: Transfer = {
        id: loanRepayId(monthOf(day)),
        date: day,
        kind: 'transfer',
        fromAccountId: event.id,
        toAccountId: reservoir.id,
        amount: value,
        status: 'done',
        ruleId: null,
        memo: '저수지에 갚음',
        ...stamp(),
      };
      await upsertTransfers([row], '갚은 기록을 저장하지 못했어요');
    },
    [requireData, stamp, todayRef, upsertTransfers],
  );

  const undoRepayLoan = useCallback<LedgerApi['undoRepayLoan']>(async () => {
    const { data: d } = requireData();
    const id = loanRepayId(monthOf(todayRef.current));
    const row = d.transfers.find((t) => t.id === id && !t.deleted);
    if (!row) return;
    await upsertTransfers([{ ...row, deleted: true, updatedAt: nowIso() }], '되돌리지 못했어요');
  }, [requireData, todayRef, upsertTransfers, nowIso]);

  /** 지출과 이체를 함께 쓴다 (expensesFirst: 지출 먼저). 끊기면 다시 읽어 맞춘다 */
  const writeExpensesAndTransfers = useCallback(
    (expenses: Expense[], transfers: Transfer[], failMessage: string, expensesFirst: boolean) =>
      mutate(
        (x) => ({
          ...x,
          expenses: expenses.reduce((list, r) => upsertIn(list, r), x.expenses),
          transfers: transfers.reduce((list, r) => upsertIn(list, r), x.transfers),
        }),
        async (repo) => {
          const writeE = async () => {
            for (const e of expenses) await repo.upsert('expenses', e);
          };
          const writeT = async () => {
            for (const t of transfers) await repo.upsert('transfers', t);
          };
          if (expensesFirst) {
            await writeE();
            await writeT();
          } else {
            await writeT();
            await writeE();
          }
        },
        failMessage,
        { multiStep: true },
      ),
    [mutate],
  );

  const convertToLoan = useCallback<LedgerApi['convertToLoan']>(
    async (expenseIds) => {
      const { data: d } = requireData();
      const event = d.accounts.find((a) => !a.deleted && a.role === 'event');
      if (!event) throw new Error('이벤트통장이 없어요');
      const ids = new Set(expenseIds);
      const rows = loanCandidatesDomain(d).filter((e) => ids.has(e.id));
      if (rows.length === 0) return;
      const s = stamp();
      const transfers: Transfer[] = rows.map((e) => ({
        id: expenseLoanTransferId(e.id),
        date: e.date,
        kind: 'transfer',
        fromAccountId: e.accountId,
        toAccountId: event.id,
        amount: e.amount,
        status: 'done',
        ruleId: null,
        memo: `저수지에서 빌림 · ${claimWhat(d, e)}`,
        ...s,
      }));
      const expenses: Expense[] = rows.map((e) => ({ ...e, accountId: event.id, updatedAt: s.updatedAt }));
      // 빌린 이체 먼저, 그다음 지출의 통장을 옮긴다
      await writeExpensesAndTransfers(expenses, transfers, '갚을 돈으로 바꾸지 못했어요', false);
    },
    [requireData, stamp, writeExpensesAndTransfers],
  );

  const unconvertLoan = useCallback<LedgerApi['unconvertLoan']>(
    async (expenseIds) => {
      const { data: d } = requireData();
      const updatedAt = nowIso();
      const transfers: Transfer[] = [];
      const expenses: Expense[] = [];
      for (const id of expenseIds) {
        const t = d.transfers.find((x) => x.id === expenseLoanTransferId(id) && !x.deleted);
        const e = d.expenses.find((x) => x.id === id);
        if (!t || !e || !t.fromAccountId) continue;
        transfers.push({ ...t, deleted: true, updatedAt });
        expenses.push({ ...e, accountId: t.fromAccountId, updatedAt });
      }
      if (transfers.length === 0) return;
      // 지출을 먼저 저수지로 되돌리고 빌린 이체를 지운다
      await writeExpensesAndTransfers(expenses, transfers, '되돌리지 못했어요', true);
    },
    [requireData, nowIso, writeExpensesAndTransfers],
  );

  /**
   * 저수지에서 빌려 지급 (저수지통장 이벤트 청구): 지출을 이벤트통장으로 옮긴 뒤 빌린 이체 loan:claim:<id>(저수지 → 이벤트통장)와
   * 돌려준 이체 claim:<id>(이벤트통장 → 낸 사람)를 남겨요. 지출을 먼저 옮겨서, 도중에 끊겨 다시 눌러도 같은 키로 하나씩만 남아요
   */
  const borrowReservoirClaims = useCallback<LedgerApi['borrowReservoirClaims']>(
    async (expenseIds) => {
      const { data: d } = requireData();
      const event = d.accounts.find((a) => !a.deleted && a.role === 'event');
      const reservoir = d.accounts.find((a) => !a.deleted && a.role === 'reservoir');
      if (!event || !reservoir) throw new Error('이벤트통장과 저수지통장이 있어야 해요');
      const ids = new Set(expenseIds);
      const due = pendingClaims(d, todayRef.current).filter(
        (c) => ids.has(c.expense.id) && (isReservoirEventExpense(d, c.expense) || c.expense.accountId === event.id),
      );
      if (due.length === 0) return;
      const s = stamp();
      const day = todayRef.current;
      const base = { date: day, kind: 'transfer' as const, status: 'done' as const, ruleId: null, ...s };
      const fromOf = (e: Expense) => (e.accountId === event.id ? reservoir.id : e.accountId);
      const transfers: Transfer[] = [
        ...due.map((c) => ({
          ...base,
          id: claimLoanTransferId(c.expense.id),
          fromAccountId: fromOf(c.expense),
          toAccountId: event.id,
          amount: c.amount,
          // 저수지 지출을 이벤트통장으로 옮기는 것만 표시해 둬요 ([지급 취소]가 지출을 저수지로 되돌릴 수 있게)
          memo: claimLoanMemo(`${c.payer}에게 돌려줌 · ${claimWhat(d, c.expense)}`, c.expense.accountId !== event.id),
        })),
        ...due.map((c) => ({
          ...base,
          id: claimTransferId(c.expense.id),
          fromAccountId: event.id,
          toAccountId: c.claimAccountId,
          amount: c.amount,
          memo: `${c.payer}에게 돌려줌 · ${claimWhat(d, c.expense)}`,
        })),
      ];
      const expenses: Expense[] = due
        .filter((c) => c.expense.accountId !== event.id)
        .map((c) => ({ ...c.expense, accountId: event.id, updatedAt: s.updatedAt }));
      await writeExpensesAndTransfers(expenses, transfers, '저수지에서 빌린 기록을 저장하지 못했어요', true);
    },
    [requireData, stamp, todayRef, writeExpensesAndTransfers],
  );

  /**
   * 저수지에서 이미 돌려준 이벤트 청구를 갚을 돈으로 바꾸기: 지출 → 이벤트통장, 돌려준 이체 → 이벤트통장에서 나간 것,
   * 빌린 이체 loan:claim:<id>(저수지 → 이벤트통장, 돌려준 날) 추가. 잔액은 그대로이고 저수지에 갚을 돈만 늘어요
   */
  const convertSettledReservoirClaims = useCallback<LedgerApi['convertSettledReservoirClaims']>(
    async (expenseIds) => {
      const { data: d } = requireData();
      const event = d.accounts.find((a) => !a.deleted && a.role === 'event');
      if (!event) throw new Error('이벤트통장이 없어요');
      const live = (id: string) => d.transfers.find((t) => t.id === id && !t.deleted && t.status === 'done');
      const isReservoir = (id: Id | null) => !!id && d.accounts.some((a) => a.id === id && a.role === 'reservoir');
      const s = stamp();
      const expenses: Expense[] = [];
      const transfers: Transfer[] = [];
      for (const id of expenseIds) {
        const e = d.expenses.find((x) => x.id === id && !x.deleted);
        const settle = live(claimTransferId(id));
        if (!e || !settle) continue;
        const loan = live(claimLoanTransferId(id));
        const reservoirId = loan?.fromAccountId ?? (isReservoir(settle.fromAccountId) ? settle.fromAccountId : isReservoir(e.accountId) ? e.accountId : null);
        if (!reservoirId) continue;
        if (!loan) {
          transfers.push({
            ...settle,
            ...s,
            id: claimLoanTransferId(id),
            fromAccountId: reservoirId,
            toAccountId: event.id,
            memo: claimLoanMemo(settle.memo, e.accountId !== event.id),
          });
        }
        if (settle.fromAccountId !== event.id) transfers.push({ ...settle, fromAccountId: event.id, updatedAt: s.updatedAt });
        if (e.accountId !== event.id) expenses.push({ ...e, accountId: event.id, updatedAt: s.updatedAt });
      }
      if (expenses.length === 0 && transfers.length === 0) return;
      // 빌린 이체 먼저 (끊겨도 이벤트통장이 모자라지 않게), 그다음 돌려준 이체와 지출
      await writeExpensesAndTransfers(expenses, transfers, '저수지에 갚을 돈으로 바꾸지 못했어요', false);
    },
    [requireData, stamp, writeExpensesAndTransfers],
  );

  /**
   * 위 두 가지 되돌리기: 빌린 이체를 지우고 지출을 그 저수지통장으로 되돌려요.
   * mode='borrowed' 는 돌려준 이체도 지우고(아직 안 돌려준 청구로), 'converted' 는 돌려준 이체를 저수지에서 나간 것으로 되돌려요
   */
  const undoReservoirClaims = useCallback<LedgerApi['undoReservoirClaims']>(
    async (expenseIds, mode) => {
      const { data: d } = requireData();
      const updatedAt = nowIso();
      const expenses: Expense[] = [];
      const transfers: Transfer[] = [];
      for (const id of expenseIds) {
        const loan = d.transfers.find((t) => t.id === claimLoanTransferId(id) && !t.deleted);
        const settle = d.transfers.find((t) => t.id === claimTransferId(id) && !t.deleted);
        const e = d.expenses.find((x) => x.id === id);
        if (!loan || !loan.fromAccountId) continue;
        transfers.push({ ...loan, deleted: true, updatedAt });
        if (settle) {
          transfers.push(mode === 'borrowed' ? { ...settle, deleted: true, updatedAt } : { ...settle, fromAccountId: loan.fromAccountId, updatedAt });
        }
        if (e && e.accountId !== loan.fromAccountId) expenses.push({ ...e, accountId: loan.fromAccountId, updatedAt });
      }
      if (transfers.length === 0) return;
      await writeExpensesAndTransfers(expenses, transfers, '되돌리지 못했어요', true);
    },
    [requireData, nowIso, writeExpensesAndTransfers],
  );

  return {
    settleClaims, unsettleClaims, upsertTransfers, borrowAndSettleClaims, repayLoan, undoRepayLoan, writeExpensesAndTransfers,
    convertToLoan, unconvertLoan, borrowReservoirClaims, convertSettledReservoirClaims, undoReservoirClaims,
  };
}

export type ClaimActionsCtx = ExpenseActionsCtx & ReturnType<typeof useClaimActions>;
