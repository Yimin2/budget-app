import { useCallback } from 'react';
import {
  autoMonthEnds, decideMonthEnd as decideMonthEndDomain, pendingMonthEnd as pendingMonthEndDomain, type MonthEndDecision,
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
    async (choice: MonthEndDecision) => {
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
      // 넘친 돈만 있는 달은 묻지 않아요 (불러올 때 처리)
      if (!pending || pending.leftover <= 0) return;
      const { monthEnd, transfers: endTransfers } = decideMonthEndDomain(
        latest,
        pending.month,
        pending.leftover,
        choice,
        authorRef.current,
        nowIso(),
        pending.items.map((i) => ({ categoryId: i.categoryId, leftover: i.leftover, ...(i.accountId ? { accountId: i.accountId } : {}) })),
      );
      // 이어지는 달이 넘친 돈만 있으면 함께 처리해요 (다음 달 예산에서 빼기)
      const after = { ...latest, monthEnds: upsertIn(latest.monthEnds, monthEnd), transfers: insertIn(latest.transfers, endTransfers) };
      const follow = autoMonthEnds(after, day, nowIso());
      await mutate(
        (x) => ({
          ...x,
          monthEnds: follow.reduce((list, m) => upsertIn(list, m), upsertIn(x.monthEnds, monthEnd)),
          transfers: insertIn(x.transfers, endTransfers),
        }),
        async (r) => {
          // 이체(결정적 id)를 먼저, 월말 행은 마지막에. 이체는 월말 행이 '저수지' · '용돈'일 때만 잔액에 들어간다
          if (endTransfers.length) await r.insert('transfers', endTransfers);
          await r.upsert('monthEnds', monthEnd);
          if (follow.length) await r.upsertMany('monthEnds', follow);
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
