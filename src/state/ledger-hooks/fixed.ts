import { useCallback } from 'react';
import {
  endBillSeries, isDatedBill, normalizeBill, splitBillAmount, livingItemChanges, livingOverrideRow, 
  monthOf, isValidMonth,
} from '@/domain';
import type { FixedExpense } from '@/domain/types';
import type { LedgerApi } from '../types';
import { upsertIn } from './helpers';
import type { AccountActionsCtx } from './accounts';

/** 고정 지출 · 생활비 항목 */
export function useFixedActions(ctx: AccountActionsCtx) {
  const {
    todayRef, requireData, mutate, upsertRow, syncAutoNow,
  } = ctx;
  /* ---------- 설정: 고정 지출·카테고리·즐겨찾기 ---------- */

  const saveFixed = useCallback(
    async (fixed: FixedExpense) => {
      // 고정비 · 용돈: 시작일 · 해지일 · 세부 항목에 맞춰 시작월 · 종료월 · 합계를 맞춰요 (PLAN 4-15)
      const row = !fixed.deleted && isDatedBill(fixed) ? normalizeBill(fixed, todayRef.current) : fixed;
      await upsertRow('fixedExpenses', row, '고정 지출을 저장하지 못했어요');
      await syncAutoNow();
    },
    [todayRef, upsertRow, syncAutoNow],
  );
  /** 고정비 금액 변경 (언제부터): 행을 나눠 지난 자동 기록은 그대로 (PLAN 4-15) */
  const changeFixedAmount = useCallback<LedgerApi['changeFixedAmount']>(
    async (rowId, amount, from) => {
      const { data: d } = requireData();
      const recorded = new Set(d.expenses.map((e) => e.id));
      const res = splitBillAmount(d.fixedExpenses, rowId, amount, from, recorded, todayRef.current);
      if (!res.ok) throw new Error(res.error);
      await mutate(
        (x) => ({ ...x, fixedExpenses: res.rows.reduce((list, r) => upsertIn(list, r), x.fixedExpenses) }),
        async (repo) => {
          // 새 행을 먼저 (결정적 id), 앞 행 끝내기는 마지막에
          for (const r of res.rows) await repo.upsert('fixedExpenses', r);
        },
        '금액을 바꾸지 못했어요',
        { multiStep: res.rows.length > 1 },
      );
      await syncAutoNow();
    },
    [requireData, todayRef, mutate, syncAutoNow],
  );
  /** 생활비 항목 고치기 · 끝내기 · 지우기: 금액 · 쓰는 방식 · 쓰는 날은 이번 달부터만 (PLAN 4-1) */
  const saveLivingItem = useCallback<LedgerApi['saveLivingItem']>(
    async (prevId, next) => {
      const { data: d } = requireData();
      const prev = d.fixedExpenses.find((f) => f.id === prevId);
      if (!prev) throw new Error('생활비 예산을 찾을 수 없어요');
      const rows = livingItemChanges(d.fixedExpenses, prev, next, monthOf(todayRef.current));
      await mutate(
        (x) => ({ ...x, fixedExpenses: rows.reduce((list, r) => upsertIn(list, r), x.fixedExpenses) }),
        async (repo) => {
          // 새 행을 먼저 (결정적 id), 앞 행 끝내기는 그다음
          for (const r of rows) await repo.upsert('fixedExpenses', r);
        },
        '생활비 예산을 저장하지 못했어요',
        { multiStep: rows.length > 1 },
      );
      await syncAutoNow();
    },
    [requireData, todayRef, mutate, syncAutoNow],
  );
  /** 생활비 항목의 '이 달만 다른 금액' 넣기 · 고치기 (amount=null 이면 지우기) */
  const setLivingOverride = useCallback<LedgerApi['setLivingOverride']>(
    async (rowId, month, amount) => {
      const { data: d } = requireData();
      const base = d.fixedExpenses.find((f) => f.id === rowId);
      if (!base) throw new Error('생활비 예산을 찾을 수 없어요');
      if (!isValidMonth(month)) throw new Error('달을 골라 주세요');
      if (amount !== null && !(amount >= 0)) throw new Error('금액을 입력해 주세요');
      const row = livingOverrideRow(d.fixedExpenses, base, month, amount ?? 0);
      const exists = d.fixedExpenses.some((f) => f.id === row.id && !f.deleted);
      if (amount === null && !exists) return;
      const saved = amount === null ? { ...(d.fixedExpenses.find((f) => f.id === row.id) ?? row), deleted: true } : row;
      await upsertRow('fixedExpenses', saved, amount === null ? '이 달 금액을 지우지 못했어요' : '이 달 금액을 저장하지 못했어요');
      await syncAutoNow();
    },
    [requireData, upsertRow, syncAutoNow],
  );
  /** 고정비 그만 내기 (해지일) · 지우기 (모든 행) */
  const endFixedSeries = useCallback<LedgerApi['endFixedSeries']>(
    async (seriesId, end) => {
      const { data: d } = requireData();
      const rows =
        end === null
          ? d.fixedExpenses.filter((f) => !f.deleted && isDatedBill(f) && (f.id === seriesId || f.id.startsWith(`${seriesId}@`))).map((f) => ({ ...f, deleted: true }))
          : endBillSeries(d.fixedExpenses, seriesId, end, todayRef.current);
      if (rows.length === 0) return;
      await mutate(
        (x) => ({ ...x, fixedExpenses: rows.reduce((list, r) => upsertIn(list, r), x.fixedExpenses) }),
        async (repo) => {
          for (const r of rows) await repo.upsert('fixedExpenses', r);
        },
        end === null ? '고정 지출을 지우지 못했어요' : '고정 지출을 끝내지 못했어요',
        { multiStep: rows.length > 1 },
      );
      await syncAutoNow();
    },
    [requireData, todayRef, mutate, syncAutoNow],
  );

  return {
    saveFixed, changeFixedAmount, saveLivingItem, setLivingOverride, endFixedSeries,
  };
}

export type FixedActionsCtx = AccountActionsCtx & ReturnType<typeof useFixedActions>;
