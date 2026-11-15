import { useCallback } from 'react';
import {
  decideMonthEnd as decideMonthEndDomain, pendingMonthEnd as pendingMonthEndDomain,
} from '@/domain';
import { upsertIn, insertIn } from './helpers';
import type { NextMonthActionsCtx } from './nextMonth';

/** 월말 남은 돈 정하기 */
export function useMonthEndActions(ctx: NextMonthActionsCtx) {
  const {
    repoRef, todayRef, authorRef, clockRef, setDataBoth, nowIso, withPendingWrites, requireData, requireOnline, mutate,
  } = ctx;
  /* ---------- 월말 ---------- */

  const decideMonthEnd = useCallback(
    async (choice: 'reservoir' | 'carryover') => {
      requireOnline();
      const { repo, data: d } = requireData();
      const day = todayRef.current;
      // 공용 가계부: 먼저 고른 사람의 선택을 따른다
      let latest = d;
      const loadStart = ++clockRef.current;
      try {
        latest = withPendingWrites(await repo.load(), loadStart);
      } catch {
        latest = d;
      }
      if (repoRef.current !== repo) return;
      if (latest !== d) setDataBoth(latest);
      const pending = pendingMonthEndDomain(latest, day);
      if (!pending) return;
      const { monthEnd, transfers: endTransfers } = decideMonthEndDomain(
        latest,
        pending.month,
        pending.leftover,
        choice,
        authorRef.current,
        nowIso(),
        pending.items.map((i) => ({ categoryId: i.categoryId, leftover: i.leftover, ...(i.accountId ? { accountId: i.accountId } : {}) })),
      );
      await mutate(
        (x) => ({
          ...x,
          monthEnds: upsertIn(x.monthEnds, monthEnd),
          transfers: insertIn(x.transfers, endTransfers),
        }),
        async (r) => {
          // 이체(결정적 id)를 먼저, 월말 행은 마지막에. 이체는 월말 행이 '저수지'일 때만 잔액에 들어간다
          if (endTransfers.length) await r.insert('transfers', endTransfers);
          await r.upsert('monthEnds', monthEnd);
        },
        '월말 처리를 저장하지 못했어요',
        { multiStep: true },
      );
    },
    [requireOnline, requireData, todayRef, clockRef, repoRef, setDataBoth, authorRef, nowIso, mutate, withPendingWrites],
  );

  return {
    decideMonthEnd,
  };
}

export type MonthEndActionsCtx = NextMonthActionsCtx & ReturnType<typeof useMonthEndActions>;
