import { useCallback } from 'react';
import {
  isDatedBill, normalizeBill, moveCategoryTo as moveCategoryToDomain, orderedCategories, setHiddenRows, planCategoryMerge, applyMergeRows,
  type CategoryMergeRows, 
  newId, nextBudgetMonth, nextMonthCopy, nextMonthReset, splitFixedRow, splitMonthRow,
  type BudgetTable, type NextMonthWrites,
} from '@/domain';
import type { Category, FixedExpense, Id, LedgerData, YearMonth } from '@/domain/types';
import type { LedgerApi } from '../types';
import { type Keyed, upsertIn, nextOrder } from './helpers';
import type { FixedActionsCtx } from './fixed';

/** 예산 달별 보기(다음 달 준비) · 카테고리 */
export function useNextMonthActions(ctx: FixedActionsCtx) {
  const {
    todayRef, requireData, mutate, upsertRow, insertRows, syncAutoNow,
  } = ctx;
  /* ---------- 예산 달별 보기: 다음 달 준비 (작업정리 13) ---------- */

  /** 다음 달 행 나누기 · 지우기를 표마다 한 번에: first(새 행 / 지울 행) → then(앞 행) → 설정 '준비한달' */
  const writeNextMonth = useCallback(
    async (w: NextMonthWrites, preparedMonth: YearMonth | null, failMessage: string) => {
      const tables: BudgetTable[] = ['rules', 'incomePlans', 'fixedExpenses'];
      await mutate(
        (x) => {
          let out: LedgerData = { ...x, settings: { ...x.settings, preparedMonth } };
          for (const step of [w.first, w.then]) {
            for (const t of tables) {
              const rows = step[t] as Keyed[];
              if (rows.length) out = { ...out, [t]: rows.reduce((list, r) => upsertIn(list, r), out[t] as Keyed[]) };
            }
          }
          return out;
        },
        async (repo) => {
          for (const step of [w.first, w.then]) {
            for (const t of tables) {
              const rows = step[t];
              if (rows.length) await repo.upsertMany(t, rows as never);
            }
          }
          await repo.updateSettings({ preparedMonth });
        },
        failMessage,
        { multiStep: true },
      );
    },
    [mutate],
  );

  const prepareNextMonth = useCallback<LedgerApi['prepareNextMonth']>(async () => {
    const { data: d } = requireData();
    await writeNextMonth(nextMonthCopy(d, todayRef.current), nextBudgetMonth(todayRef.current), '다음 달 예산을 준비하지 못했어요');
  }, [requireData, todayRef, writeNextMonth]);

  const resetNextMonth = useCallback<LedgerApi['resetNextMonth']>(async () => {
    const { data: d } = requireData();
    await writeNextMonth(nextMonthReset(d, todayRef.current), null, '다음 달 예산을 초기화하지 못했어요');
    await syncAutoNow();
  }, [requireData, writeNextMonth, todayRef, syncAutoNow]);

  const splitForNextMonth = useCallback<LedgerApi['splitForNextMonth']>(
    async (table, rowId) => {
      const { data: d } = requireData();
      const today = todayRef.current;
      const next = nextBudgetMonth(today);
      const w: NextMonthWrites = {
        first: { rules: [], incomePlans: [], fixedExpenses: [] },
        then: { rules: [], incomePlans: [], fixedExpenses: [] },
      };
      let createdId: Id = rowId;
      if (table === 'rules') {
        const row = d.rules.find((r) => r.id === rowId);
        const s = row ? splitMonthRow('rules', row, next) : null;
        if (s) [w.first.rules, w.then.rules, createdId] = [[s.created], [s.ended], s.created.id];
      } else if (table === 'incomePlans') {
        const row = d.incomePlans.find((r) => r.id === rowId);
        const s = row ? splitMonthRow('incomePlans', row, next) : null;
        if (s) [w.first.incomePlans, w.then.incomePlans, createdId] = [[s.created], [s.ended], s.created.id];
      } else {
        const row = d.fixedExpenses.find((r) => r.id === rowId);
        const s = row ? splitFixedRow(row, next, today) : null;
        if (s) [w.first.fixedExpenses, w.then.fixedExpenses, createdId] = [[s.created], [s.ended], s.created.id];
      }
      if (createdId === rowId) return rowId;
      await writeNextMonth(w, d.settings.preparedMonth ?? null, '다음 달 예산을 나누지 못했어요');
      return createdId;
    },
    [requireData, todayRef, writeNextMonth],
  );

  const addFixed = useCallback(
    async ({ id: givenId, ...input }: Omit<FixedExpense, 'id' | 'deleted'> & { id?: string }): Promise<FixedExpense> => {
      if (!input.name.trim()) throw new Error('이름을 입력해 주세요');
      const raw: FixedExpense = { ...input, name: input.name.trim(), id: givenId || newId(), deleted: false };
      const row = isDatedBill(raw) ? normalizeBill(raw, todayRef.current) : raw;
      await insertRows('fixedExpenses', [row], '고정 지출을 추가하지 못했어요');
      await syncAutoNow();
      return row;
    },
    [insertRows, syncAutoNow, todayRef],
  );

  const saveCategory = useCallback(
    (category: Category) => upsertRow('categories', category, '카테고리를 저장하지 못했어요'),
    [upsertRow],
  );
  const addCategory = useCallback(
    async (input: Omit<Category, 'id' | 'deleted' | 'order'>): Promise<Category> => {
      const { data: d } = requireData();
      if (!input.name.trim()) throw new Error('카테고리 이름을 입력해 주세요');
      const row: Category = { ...input, name: input.name.trim(), id: newId(), order: nextOrder(d.categories), deleted: false };
      await insertRows('categories', [row], '카테고리를 추가하지 못했어요');
      return row;
    },
    [requireData, insertRows],
  );

  const moveCategoryTo = useCallback<LedgerApi['moveCategoryTo']>(
    async (id, toIndex) => {
      const { data: d } = requireData();
      const changed = moveCategoryToDomain(d.categories, id, toIndex);
      if (changed.length === 0) return false;
      const byId = new Map(changed.map((c) => [c.id, c]));
      // 화면에 먼저 반영하고, 바뀐 행만 한 번에 저장해요. 실패하면 되돌려요
      await mutate(
        (cur) => ({ ...cur, categories: cur.categories.map((c) => byId.get(c.id) ?? c) }),
        (repo) => repo.upsertMany('categories', changed),
        '카테고리 순서를 바꾸지 못했어요',
      );
      return true;
    },
    [requireData, mutate],
  );

  const setCategoriesHidden = useCallback<LedgerApi['setCategoriesHidden']>(
    async (ids, hidden) => {
      const { data: d } = requireData();
      const changed = setHiddenRows(d.categories, ids, hidden);
      if (changed.length === 0) return 0;
      const byId = new Map(changed.map((c) => [c.id, c]));
      await mutate(
        (cur) => ({ ...cur, categories: cur.categories.map((c) => byId.get(c.id) ?? c) }),
        (repo) => repo.upsertMany('categories', changed),
        hidden ? '카테고리를 숨기지 못했어요' : '카테고리를 다시 보이게 하지 못했어요',
      );
      return changed.length;
    },
    [requireData, mutate],
  );

  /** 합치기 · 되돌리기 행 쓰기: 다시 해도 같은 옮기기를 먼저, 금액을 더하는 예산 행은 한 번에, 카테고리 지우기는 마지막에 */
  const writeMergeRows = useCallback(
    (rows: CategoryMergeRows, failMessage: string) =>
      mutate(
        (cur) => applyMergeRows(cur, rows),
        async (repo) => {
          if (rows.expenses.length > 0) await repo.upsertMany('expenses', rows.expenses);
          if (rows.events.length > 0) await repo.upsertMany('events', rows.events);
          if (rows.favorites.length > 0) await repo.upsertMany('favorites', rows.favorites);
          if (rows.fixedExpenses.length > 0) await repo.upsertMany('fixedExpenses', rows.fixedExpenses);
          if (rows.categories.length > 0) await repo.upsertMany('categories', rows.categories);
        },
        failMessage,
        { multiStep: true },
      ),
    [mutate],
  );
  const mergeCategory = useCallback<LedgerApi['mergeCategory']>(
    async (sourceId, targetId) => {
      const { data: d } = requireData();
      const plan = planCategoryMerge(d, sourceId, targetId);
      await writeMergeRows(plan, '카테고리를 합치지 못했어요');
      return plan;
    },
    [requireData, writeMergeRows],
  );
  const undoCategoryMerge = useCallback<LedgerApi['undoCategoryMerge']>(
    (plan) => writeMergeRows(plan.undo, '합치기를 되돌리지 못했어요'),
    [writeMergeRows],
  );

  /** 한 칸씩 옮기기 (-1 위로 · +1 아래로) = 지금 자리 + delta 로 옮기기 */
  const moveCategory = useCallback<LedgerApi['moveCategory']>(
    async (id, delta) => {
      const { data: d } = requireData();
      const from = orderedCategories(d.categories).findIndex((c) => c.id === id);
      if (from < 0) return false;
      return moveCategoryTo(id, from + Math.trunc(delta));
    },
    [requireData, moveCategoryTo],
  );

  return {
    writeNextMonth, prepareNextMonth, resetNextMonth, splitForNextMonth, addFixed, saveCategory, addCategory, moveCategoryTo,
    setCategoriesHidden, writeMergeRows, mergeCategory, undoCategoryMerge, moveCategory,
  };
}

export type NextMonthActionsCtx = FixedActionsCtx & ReturnType<typeof useNextMonthActions>;
