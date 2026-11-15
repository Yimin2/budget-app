import { useCallback } from 'react';
import {
  buildInstallmentRows, deleteInstallmentRows, earliestChangeMonth, installmentPlan, installmentPrepayId, prepaidAmounts,
  remainingAmountsFrom, replanInstallment, revisedAmounts, 
  newId, 
} from '@/domain';
import type { Expense, FixedExpense, Id } from '@/domain/types';
import type { LedgerApi, NewInstallment } from '../types';
import { upsertIn, insertIn } from './helpers';
import type { ShortageActionsCtx } from './shortage';

/** 할부 */
export function useInstallmentActions(ctx: ShortageActionsCtx) {
  const {
    todayRef, requireData, mutate, stamp, syncAutoNow,
  } = ctx;
  /* ---------- 할부 ---------- */

  /**
   * 할부 행 쓰기. replanInstallment 가 준 순서(뒤 행 지우기 → 새 행 → 앞 행 끝내기)대로 쓰고, 미리 갚기 지출은 맨 마지막에 쓴다.
   * 그래서 중간에 끊겨도 미리 갚은 돈이 기록된 채 옛 회차가 계속 기록되는 일(두 번 내기)이 없다.
   * 같은 id 의 지운 미리 갚기 지출이 있으면(지웠다가 다시 미리 갚기) 되살린다
   */
  const writeInstallmentRows = useCallback(
    async (rows: FixedExpense[], failMessage: string, expense?: Expense) => {
      if (rows.length === 0 && !expense) return;
      const revive = !!expense && requireData().data.expenses.some((e) => e.id === expense.id);
      await mutate(
        (x) => ({
          ...x,
          fixedExpenses: rows.reduce((list, r) => upsertIn(list, r), x.fixedExpenses),
          expenses: expense ? (revive ? upsertIn(x.expenses, expense) : insertIn(x.expenses, [expense])) : x.expenses,
        }),
        async (repo) => {
          for (const r of rows) await repo.upsert('fixedExpenses', r);
          if (expense) {
            if (revive) await repo.upsert('expenses', expense);
            else await repo.insert('expenses', [expense]);
          }
        },
        failMessage,
        { multiStep: rows.length + (expense ? 1 : 0) > 1 },
      );
      await syncAutoNow();
    },
    [mutate, syncAutoNow, requireData],
  );

  const findPlan = useCallback(
    (planId: Id) => {
      const plan = installmentPlan(requireData().data, planId, todayRef.current);
      if (!plan) throw new Error('할부를 찾을 수 없어요');
      return plan;
    },
    [requireData, todayRef],
  );

  const addInstallment = useCallback<LedgerApi['addInstallment']>(
    async (input: NewInstallment) => {
      const planId = newId();
      const rows = buildInstallmentRows(input, planId, todayRef.current);
      await mutate(
        (x) => ({ ...x, fixedExpenses: insertIn(x.fixedExpenses, rows) }),
        (repo) => repo.insert('fixedExpenses', rows),
        '할부를 추가하지 못했어요',
      );
      await syncAutoNow();
      return planId;
    },
    [mutate, syncAutoNow, todayRef],
  );

  const reviseInstallment = useCallback<LedgerApi['reviseInstallment']>(
    async (planId, change) => {
      const plan = findPlan(planId);
      const from = change.fromMonth ?? earliestChangeMonth(plan);
      if (!from) throw new Error('이미 다 낸 할부예요');
      const amounts = revisedAmounts(plan, from, { monthly: change.monthly, remaining: change.remaining });
      if (amounts.length === 0) throw new Error('남은 회차를 1회 이상으로 정해 주세요. 그만 낼 거라면 그만 내기를 골라 주세요');
      const { name, accountId, categoryId, dayOfMonth } = change;
      const rows = replanInstallment(plan, from, amounts, { name, accountId, categoryId, dayOfMonth });
      await writeInstallmentRows(rows, '할부를 고치지 못했어요');
    },
    [findPlan, writeInstallmentRows],
  );

  const prepayInstallment = useCallback<LedgerApi['prepayInstallment']>(
    async (planId, input) => {
      const plan = findPlan(planId);
      const from = earliestChangeMonth(plan);
      if (!from || !plan.next) throw new Error('이미 다 낸 할부예요');
      const remaining = remainingAmountsFrom(plan, from).reduce((s, a) => s + a, 0);
      const amounts = prepaidAmounts(plan, from, input.amount, input.keep);
      const rows = replanInstallment(plan, from, amounts);
      const s = stamp();
      const expense: Expense = {
        id: installmentPrepayId(plan.id, from, remaining, input.amount),
        date: input.date ?? todayRef.current,
        amount: Math.round(input.amount),
        accountId: plan.next.accountId,
        categoryId: plan.categoryId,
        memo: `${plan.name} 미리 갚기`,
        eventId: null,
        // 할부 id 행(첫 행)은 지우지 않으므로 늘 남아 있다
        fixedExpenseId: plan.id,
        ...s,
      };
      try {
        await writeInstallmentRows(rows, '미리 갚기를 끝까지 저장하지 못했어요', expense);
      } catch (e) {
        // 지출은 맨 마지막에 쓰므로, 실패했으면 미리 갚은 돈은 아직 기록되지 않았다
        const why = e instanceof Error ? e.message.replace(/[.\s]+$/, '') : '미리 갚기를 끝까지 저장하지 못했어요';
        throw new Error(`${why}. 미리 갚은 돈은 아직 기록되지 않았어요. 할부 회차를 확인하고 다시 해 주세요`);
      }
    },
    [findPlan, stamp, todayRef, writeInstallmentRows],
  );

  const endInstallment = useCallback<LedgerApi['endInstallment']>(
    async (planId) => {
      const plan = findPlan(planId);
      const from = earliestChangeMonth(plan);
      if (!from) return;
      await writeInstallmentRows(replanInstallment(plan, from, []), '할부를 멈추지 못했어요');
    },
    [findPlan, writeInstallmentRows],
  );

  const deleteInstallment = useCallback<LedgerApi['deleteInstallment']>(
    async (planId) => {
      await writeInstallmentRows(deleteInstallmentRows(findPlan(planId)), '할부를 지우지 못했어요');
    },
    [findPlan, writeInstallmentRows],
  );

  return {
    writeInstallmentRows, findPlan, addInstallment, reviseInstallment, prepayInstallment, endInstallment, deleteInstallment,
  };
}

export type InstallmentActionsCtx = ShortageActionsCtx & ReturnType<typeof useInstallmentActions>;
