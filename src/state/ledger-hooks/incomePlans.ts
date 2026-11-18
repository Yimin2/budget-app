import { useCallback } from 'react';
import {
  addMonths, autoTransferId, 
  compareMonth, monthOf, newId,
} from '@/domain';
import type { AllocationRule, Id, IncomePlan, Won, YearMonth } from '@/domain/types';
import type { LedgerApi } from '../types';
import { upsertIn, successorRuleId } from './helpers';
import type { RuleActionsCtx } from './rules';

/** 수입 계획 · 배분 금액 바꾸기 */
export function useIncomePlanActions(ctx: RuleActionsCtx) {
  const {
    todayRef, requireData, mutate, upsertRow, insertRows, syncAutoNow,
  } = ctx;
  /* ---------- 설정: 수입 계획 ---------- */

  const cleanIncomePlan = useCallback((plan: Omit<IncomePlan, 'id' | 'deleted'>): Omit<IncomePlan, 'id' | 'deleted'> => {
    if (!plan.personName.trim()) throw new Error('누구 수입인지 이름을 입력해 주세요');
    if (!(plan.amount > 0)) throw new Error('금액을 입력해 주세요');
    if (!plan.accountId) throw new Error('받는 통장을 골라 주세요');
    const day = Math.min(31, Math.max(1, Math.round(plan.dayOfMonth || 1)));
    return {
      ...plan,
      personName: plan.personName.trim(),
      personEmail: plan.personEmail?.trim() || null,
      amount: Math.round(plan.amount),
      dayOfMonth: day,
      memo: plan.memo?.trim() ?? '',
    };
  }, []);

  const addIncomePlan = useCallback<LedgerApi['addIncomePlan']>(
    async ({ id: givenId, ...input }) => {
      const row: IncomePlan = { ...cleanIncomePlan(input), id: givenId || newId(), deleted: false };
      await insertRows('incomePlans', [row], '수입 계획을 추가하지 못했어요');
      await syncAutoNow();
      return row;
    },
    [cleanIncomePlan, insertRows, syncAutoNow],
  );

  /** 수입 계획 고치기 · 지우기 (그 자리에서 고쳐요. 이미 생긴 수입 기록은 그대로) */
  const saveIncomePlan = useCallback<LedgerApi['saveIncomePlan']>(
    async (plan) => {
      const row: IncomePlan = plan.deleted ? plan : { ...plan, ...cleanIncomePlan(plan) };
      await upsertRow('incomePlans', row, '수입 계획을 저장하지 못했어요');
      await syncAutoNow();
    },
    [cleanIncomePlan, upsertRow, syncAutoNow],
  );

  /**
   * 적립액 변경. from(기본: 이번 달 자동 이체가 기록됐으면 다음 달, 아니면 이번 달)부터 새 금액.
   * - 규칙이 from 이후에 시작하면 금액만 바꾼다
   * - 아니면 기존 규칙을 from 전 달로 끝내고 from 부터 새 규칙 (id 는 결정적이라 다시 시도해도 하나만 생긴다)
   * - 이미 끝난 규칙이면 그 뒤를 잇는 규칙(같은 통장 쌍, 끝난 다음 달 시작)을 대신 바꾼다
   */
  const changeRuleAmountFrom = useCallback(
    async (ruleId: Id, amount: Won, fromMonth?: YearMonth) => {
      const { data: d } = requireData();
      if (!(amount >= 0)) throw new Error('금액을 확인해 주세요');
      const cur = monthOf(todayRef.current);
      let rule = d.rules.find((r) => r.id === ruleId && !r.deleted);
      if (!rule) throw new Error('매달 배분 규칙을 찾을 수 없어요');
      const recordedThisMonth = (r: AllocationRule) => d.transfers.some((t) => t.id === autoTransferId(r.id, cur));
      const fromFor = (r: AllocationRule) => fromMonth ?? (recordedThisMonth(r) ? addMonths(cur, 1) : cur);
      // 끝난 규칙 → 뒤를 잇는 규칙으로 (두 번째 변경이 나란한 규칙을 하나 더 만들지 않게)
      for (let guard = 0; guard < 24; guard++) {
        const r: AllocationRule = rule;
        if (r.endMonth === null || compareMonth(r.endMonth, fromFor(r)) >= 0) break;
        const nextStart = addMonths(r.endMonth, 1);
        const successor = d.rules.find(
          (x) =>
            !x.deleted &&
            x.id !== r.id &&
            x.fromAccountId === r.fromAccountId &&
            x.toAccountId === r.toAccountId &&
            x.startMonth === nextStart,
        );
        if (!successor) throw new Error('이미 끝난 배분이라 금액을 바꿀 수 없어요');
        rule = successor;
      }
      const target: AllocationRule = rule;
      const from = fromFor(target);
      const rounded = Math.round(amount);
      const inPlace =
        compareMonth(target.startMonth, from) >= 0 ||
        (compareMonth(target.startMonth, cur) >= 0 && compareMonth(from, addMonths(cur, 1)) <= 0 && recordedThisMonth(target));
      if (inPlace) {
        await upsertRow('rules', { ...target, amount: rounded, needsReview: undefined }, '적립액을 바꾸지 못했어요');
        return;
      }
      const ended: AllocationRule = { ...target, endMonth: addMonths(from, -1), needsReview: undefined };
      const created: AllocationRule = {
        ...target,
        needsReview: undefined,
        id: successorRuleId(target.id, from),
        amount: rounded,
        startMonth: from,
        endMonth: target.endMonth && compareMonth(target.endMonth, from) >= 0 ? target.endMonth : null,
      };
      await mutate(
        (x) => ({ ...x, rules: upsertIn(upsertIn(x.rules, created), ended) }),
        async (repo) => {
          // 새 규칙을 먼저 (결정적 id → 다시 시도해도 하나), 기존 규칙 끝내기는 마지막에
          await repo.insert('rules', [created]);
          await repo.upsert('rules', ended);
        },
        '적립액을 바꾸지 못했어요',
        { multiStep: true },
      );
    },
    [requireData, todayRef, mutate, upsertRow],
  );

  const changeRuleAmount = useCallback<LedgerApi['changeRuleAmount']>(
    async (ruleId, amount, fromMonth) => {
      await changeRuleAmountFrom(ruleId, amount, fromMonth);
      await syncAutoNow();
    },
    [changeRuleAmountFrom, syncAutoNow],
  );

  return {
    cleanIncomePlan, addIncomePlan, saveIncomePlan, changeRuleAmountFrom, changeRuleAmount,
  };
}

export type IncomePlanActionsCtx = RuleActionsCtx & ReturnType<typeof useIncomePlanActions>;
