import { useCallback } from 'react';
import {
  canClaimOnAccount, claimAccountFor, claimTransferId,
  claimLoanTransferId, expenseLoanTransferId, followLoanTransfers, computeClaimDue,
  isClaimExpense, isClaimSettled, newId, isTripItem,
} from '@/domain';
import type { Expense, Id, Transfer } from '@/domain/types';
import type { LedgerApi, NewExpense } from '../types';
import { upsertIn } from './helpers';
import type { LedgerDerivedCtx } from './derived';

/** 지출 기록 · 고치기 · 지우기 */
export function useExpenseActions(ctx: LedgerDerivedCtx) {
  const {
    todayRef, nowIso, requireData, mutate, upsertRow, insertRows, stamp,
  } = ctx;
  /* ---------- 지출 ---------- */

  /** 지출의 여행 칸. 여행 id 가 있으면 지우지 않은 여행인지 확인해요 (지금 묶인 여행은 지웠어도 그대로) */
  const tripFields = useCallback(
    (tripId: Id | null | undefined, tripItem: unknown, keep?: Id | null): Pick<Expense, 'tripId' | 'tripItem'> => {
      const id = tripId?.trim() || null;
      if (!id) return {};
      const t = requireData().data.trips.find((x) => x.id === id);
      if (!t || (t.deleted && id !== keep)) throw new Error('여행을 찾을 수 없어요. 여행을 다시 골라 주세요');
      return { tripId: id, tripItem: isTripItem(tripItem) ? tripItem : null };
    },
    [requireData],
  );

  const addExpense = useCallback(
    async (input: NewExpense): Promise<Expense> => {
      if (!(input.amount > 0)) throw new Error('금액을 입력해 주세요');
      const amount = Math.round(input.amount);
      const payer = input.paidBy?.trim() || null;
      let claim: Pick<Expense, 'paidBy' | 'claimAccountId' | 'claimDue'> = {};
      if (payer) {
        const { data: d } = requireData();
        if (!canClaimOnAccount(d, input.accountId)) {
          throw new Error('개인 돈으로 낸 지출은 이벤트통장 · 고정지출통장 · 저수지통장 중 하나에 기록해 주세요');
        }
        claim = {
          paidBy: payer,
          claimAccountId: claimAccountFor(d, payer),
          claimDue: computeClaimDue(d, { accountId: input.accountId, amount }, todayRef.current),
        };
      }
      const trip = tripFields(input.tripId, input.tripItem);
      // 일정과 여행은 하나만 (둘 다 묶으면 일정 남은 금액과 여행 남은 예산에서 두 번 빠진다)
      if (trip.tripId && input.eventId) throw new Error('일정과 여행 중 하나만 연결해 주세요');
      const row: Expense = {
        id: newId(),
        date: input.date,
        amount,
        accountId: input.accountId,
        categoryId: input.categoryId,
        memo: input.memo ?? '',
        eventId: input.eventId ?? null,
        fixedExpenseId: null,
        ...stamp(),
        ...claim,
        ...trip,
        ...(input.excluded ? { excluded: true } : {}),
      };
      await insertRows('expenses', [row], '지출을 기록하지 못했어요');
      return row;
    },
    [tripFields, stamp, insertRows, requireData, todayRef],
  );

  const setExpenseExclusions = useCallback<LedgerApi['setExpenseExclusions']>(
    async (changes) => {
      const { data: d } = requireData();
      const at = nowIso();
      const rows: Expense[] = [];
      for (const c of changes) {
        const prev = d.expenses.find((e) => e.id === c.id && !e.deleted);
        if (!prev || (prev.excluded === true) === c.excluded) continue;
        const { excluded: _old, ...rest } = prev;
        rows.push({ ...rest, ...(c.excluded ? { excluded: true } : {}), updatedAt: at });
      }
      if (rows.length === 0) return 0;
      const byId = new Map(rows.map((r) => [r.id, r]));
      // 화면에 먼저 반영하고, 바뀐 행만 한 번에 저장해요. 실패하면 되돌려요
      await mutate(
        (cur) => ({ ...cur, expenses: cur.expenses.map((e) => byId.get(e.id) ?? e) }),
        (repo) => repo.upsertMany('expenses', rows),
        '예외 표시를 저장하지 못했어요',
      );
      return rows.length;
    },
    [requireData, mutate, nowIso],
  );

  /** 지출과 그 지출에 딸린 이체(돌려준 이체 claim:<지출id> · 빌린 이체 loan:…)를 함께 쓴다. 이체 먼저: 끊기면 다시 읽어 맞춘다 */
  const writeExpenseWith = useCallback(
    (expense: Expense, linked: Transfer[], failMessage: string) =>
      linked.length === 0
        ? upsertRow('expenses', expense, failMessage)
        : mutate(
            (x) => ({
              ...x,
              expenses: upsertIn(x.expenses, expense),
              transfers: linked.reduce((list, t) => upsertIn(list, t), x.transfers),
            }),
            async (repo) => {
              for (const t of linked) await repo.upsert('transfers', t);
              await repo.upsert('expenses', expense);
            },
            failMessage,
            { multiStep: true },
          ),
    [mutate, upsertRow],
  );

  /**
   * 고치기. 아직 돌려주지 않은 청구는 낸 사람 · 통장 · 금액이 바뀌면 돌려받을 통장과 정산일을 다시 정해요.
   * 낸 사람을 비우면 보통 지출이 돼요. 이미 돌려준 청구는 청구 칸을 그대로 둬요.
   * 저수지에서 빌린 이체(loan:<지출id> · loan:claim:<지출id>)는 금액 · 날짜를 따라 고치고, 지출을 지우거나 이벤트통장 밖으로 옮기면 지워요
   */
  const updateExpense = useCallback(
    async (expense: Expense) => {
      const { data: d } = requireData();
      const prev = d.expenses.find((e) => e.id === expense.id);
      let next: Expense = { ...expense, updatedAt: nowIso() };
      if (expense.tripId !== undefined || prev?.tripId) {
        const trip = tripFields(expense.tripId, expense.tripItem, prev?.tripId ?? null);
        next = { ...next, tripId: trip.tripId ?? null, tripItem: trip.tripItem ?? null };
      }
      // 일정과 여행은 하나만: 여행에 묶이면 일정 연결은 푼다 (예전 기록이 둘 다 가졌어도)
      if (next.tripId && next.eventId) next = { ...next, eventId: null };
      // 지웠던 지출을 되살리면, 함께 지웠던 이체(돌려준 이체 · 빌린 이체)도 되살린다 (deleteExpense 가 같은 시각으로 지운 것만)
      if (prev && prev.deleted && !next.deleted) {
        const ids = new Set([claimTransferId(prev.id), claimLoanTransferId(prev.id), expenseLoanTransferId(prev.id)]);
        const revived = d.transfers
          .filter((t) => ids.has(t.id) && t.deleted && t.updatedAt === prev.updatedAt)
          .map((t) => ({ ...t, deleted: false, updatedAt: next.updatedAt }));
        if (revived.length > 0) {
          if (isClaimExpense(prev)) {
            next = { ...next, paidBy: prev.paidBy, claimAccountId: prev.claimAccountId ?? null, claimDue: prev.claimDue ?? null };
          }
          await writeExpenseWith(next, revived, '지출을 고치지 못했어요');
          return;
        }
      }
      const linked: Transfer[] = [];
      const settle = prev ? d.transfers.find((t) => t.id === claimTransferId(prev.id)) : undefined;
      if (prev && isClaimExpense(prev) && isClaimSettled(d, prev.id)) {
        next = { ...next, paidBy: prev.paidBy, claimAccountId: prev.claimAccountId ?? null, claimDue: prev.claimDue ?? null };
        // 이미 돌려준 청구의 금액 · 통장을 바꾸면 돌려준 이체도 같이 고친다 (낸 사람 통장 · 함께 쓰는 통장 잔액이 어긋나지 않게)
        if (settle && (next.amount !== settle.amount || next.accountId !== settle.fromAccountId || next.deleted)) {
          if (!next.deleted && !canClaimOnAccount(d, next.accountId)) {
            throw new Error('돌려준 청구는 이벤트통장 · 고정지출통장 · 저수지통장으로만 옮길 수 있어요');
          }
          linked.push(
            next.deleted
              ? { ...settle, deleted: true, updatedAt: next.updatedAt }
              : { ...settle, amount: next.amount, fromAccountId: next.accountId, updatedAt: next.updatedAt },
          );
        }
      } else if (isClaimExpense(next)) {
        const payer = next.paidBy!.trim();
        const changed =
          !prev || !isClaimExpense(prev) || prev.paidBy?.trim() !== payer || prev.accountId !== next.accountId || prev.amount !== next.amount;
        if (changed) {
          if (!canClaimOnAccount(d, next.accountId)) {
            throw new Error('개인 돈으로 낸 지출은 이벤트통장 · 고정지출통장 · 저수지통장 중 하나에 기록해 주세요');
          }
          next = {
            ...next,
            paidBy: payer,
            claimAccountId: claimAccountFor(d, payer),
            claimDue: computeClaimDue(d, { accountId: next.accountId, amount: next.amount, expenseId: next.id }, todayRef.current),
          };
        }
      } else if (prev && isClaimExpense(prev)) {
        next = { ...next, paidBy: null, claimAccountId: null, claimDue: null };
      }
      if (prev) linked.push(...followLoanTransfers(d, next));
      await writeExpenseWith(next, linked, '지출을 고치지 못했어요');
    },
    [requireData, nowIso, writeExpenseWith, tripFields, todayRef],
  );

  return {
    tripFields, addExpense, setExpenseExclusions, writeExpenseWith, updateExpense,
  };
}

export type ExpenseActionsCtx = LedgerDerivedCtx & ReturnType<typeof useExpenseActions>;
