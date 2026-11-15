import { useCallback, useMemo } from 'react';
import {
  allBalances, installmentPlans, judgeInstallment, canClaimOnAccount, unlinkedOwnerNames, memberName,
  categoryUseScores, claimPayers as claimPayersDomain, computeSettlement,
  loanCandidates as loanCandidatesDomain, computeClaimDue, computeLiving, judgeEvent, judgeLiving,
  monthOf, pendingMonthEnd as pendingMonthEndDomain, projectEventAccount, suggestShortageFixes, summarizeClaims, tripStatuses,
  livingByAccount, myLivingAccountId, spenderOptions, mySpenderKey,
} from '@/domain';
import type { Account, Id, LivingStatus } from '@/domain/types';
import type { LedgerApi } from '../types';
import { sortedActive } from './helpers';
import type { LedgerCoreCtx } from './core';

/** data 에서 계산한 값 (잔액 · 생활비 · 예측 · 청구 등) */
export function useLedgerDerived(ctx: LedgerCoreCtx) {
  const {
    session, author, today, data,
  } = ctx;
  /* ---------- 계산값 ---------- */

  const activeAccounts = useMemo(() => (data ? sortedActive(data.accounts) : []), [data]);
  const activeCategories = useMemo(() => (data ? sortedActive(data.categories) : []), [data]);
  const pickableCategories = useMemo(() => activeCategories.filter((c) => c.hidden !== true), [activeCategories]);
  const categoryScores = useMemo(() => (data ? categoryUseScores(data.expenses, today) : new Map<Id, number>()), [data, today]);
  const accountByRole = useCallback(
    (role: Account['role']) => activeAccounts.find((a) => a.role === role) ?? null,
    [activeAccounts],
  );
  const incomeAccounts = useMemo(() => activeAccounts.filter((a) => a.role === 'income'), [activeAccounts]);
  const living = useMemo(() => (data ? computeLiving(data, today) : null), [data, today]);
  // 사람별 생활비 (PLAN 4-14): 생활비 통장마다, 로그인한 사람의 통장, '누가 썼나요?'에서 고를 사람
  const demo = session.mode === 'demo';
  const myLivingId = useMemo(
    () => (data ? myLivingAccountId(data, monthOf(today), author, { fallbackFirst: demo }) : null),
    [data, today, author, demo],
  );
  // 로그인한 사람(나)을 맨 앞(왼쪽)에, 나머지는 원래 순서대로
  const livingViews = useMemo(() => {
    const views = data ? livingByAccount(data, today) : [];
    return myLivingId ? [...views.filter((v) => v.accountId === myLivingId), ...views.filter((v) => v.accountId !== myLivingId)] : views;
  }, [data, today, myLivingId]);
  const spenders = useMemo(() => {
    const list = data ? spenderOptions(data, monthOf(today)) : [];
    return myLivingId
      ? [...list.filter((x) => x.livingAccountId === myLivingId), ...list.filter((x) => x.livingAccountId !== myLivingId)]
      : list;
  }, [data, today, myLivingId]);
  const mySpender = useMemo(() => mySpenderKey(spenders, author, myLivingId), [spenders, author, myLivingId]);
  const livingFor = useCallback<LedgerApi['livingFor']>(
    (accountId) => {
      if (!data) return null;
      // 통장이 하나면(예전 가계부) 합친 계산과 같다
      if (livingViews.length <= 1) return living;
      const id = accountId ?? myLivingId;
      const hit = livingViews.find((v) => v.accountId === id);
      if (hit) return hit.status;
      return id ? computeLiving(data, today, id) : living;
    },
    [data, today, living, livingViews, myLivingId],
  );
  // 로그인한 내가 어느 생활비 통장과도 이어지지 않았으면 고를 주인 이름 (홈 '누가 나인지 골라 주세요')
  const meChoices = useMemo(
    () => (data && !demo && !myLivingId && livingViews.length > 1 ? unlinkedOwnerNames(data) : []),
    [data, demo, myLivingId, livingViews.length],
  );
  const balances = useMemo(() => (data ? allBalances(data, today) : {}), [data, today]);
  const eventProjection = useMemo(() => (data ? projectEventAccount(data, today) : null), [data, today]);
  const shortageFix = useMemo(
    () =>
      data && eventProjection && eventProjection.shortages.length > 0
        ? suggestShortageFixes(data, today, eventProjection)
        : null,
    [data, today, eventProjection],
  );
  const pendingMonthEnd = useMemo(() => (data ? pendingMonthEndDomain(data, today) : null), [data, today]);
  const claims = useMemo(() => (data ? summarizeClaims(data, today) : null), [data, today]);
  const claimPayers = useMemo(() => (data ? claimPayersDomain(data) : []), [data]);
  const settlement = useMemo(
    () => (data && eventProjection?.accountId ? computeSettlement(data, today, eventProjection) : null),
    [data, today, eventProjection],
  );
  const loanCandidates = useMemo(() => (data ? loanCandidatesDomain(data) : []), [data]);
  const installments = useMemo(() => (data ? installmentPlans(data, today) : []), [data, today]);
  const trips = useMemo(() => (data ? tripStatuses(data, today) : []), [data, today]);
  const installmentHint = useCallback<LedgerApi['installmentHint']>(
    (amount, source, categoryId, opts) => {
      if (!data) return null;
      if (source === 'event') return judgeInstallment({ source: 'event', data, today, tripId: opts?.tripId ?? null }, amount);
      const living: LivingStatus | null = livingFor(opts?.livingAccountId);
      if (!living) return null;
      let cat: Id | null;
      if (categoryId === undefined) {
        const budgeted = living.items.filter((i) => !i.unbudgeted);
        if (budgeted.length !== 1) return null;
        cat = budgeted[0]!.categoryId;
      } else cat = categoryId;
      return judgeInstallment({ source: 'living', living, categoryId: cat }, amount);
    },
    [data, livingFor, today],
  );
  const previewClaimDue = useCallback<LedgerApi['previewClaimDue']>(
    (accountId, amount, expenseId) => {
      if (!data || !canClaimOnAccount(data, accountId)) return null;
      return computeClaimDue(data, { accountId, amount: Math.max(0, amount), expenseId }, today);
    },
    [data, today],
  );

  const judge = useCallback<LedgerApi['judge']>(
    (amount, source, categoryId, opts) => {
      if (!data) return null;
      if (source === 'living') {
        // 고른 사람의 생활비 예산으로 (기본: 나)
        const living = livingFor(opts?.livingAccountId);
        if (!living) return null;
        if (categoryId === undefined) {
          const budgeted = living.items.filter((i) => !i.unbudgeted);
          if (budgeted.length !== 1) return null;
          return judgeLiving(living, budgeted[0]!.categoryId, amount);
        }
        return judgeLiving(living, categoryId, amount);
      }
      return judgeEvent(data, today, amount, { tripId: opts?.tripId ?? null });
    },
    [data, livingFor, today],
  );

  const displayName = useCallback((email: string) => memberName(data, email), [data]);

  return {
    activeAccounts, activeCategories, pickableCategories, categoryScores, accountByRole, incomeAccounts, living, demo, myLivingId,
    livingViews, spenders, mySpender, livingFor, meChoices, balances, eventProjection, shortageFix, pendingMonthEnd, claims, claimPayers,
    settlement, loanCandidates, installments, trips, installmentHint, previewClaimDue, judge, displayName,
  };
}

export type LedgerDerivedCtx = LedgerCoreCtx & ReturnType<typeof useLedgerDerived>;
