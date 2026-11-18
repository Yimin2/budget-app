import { useCallback } from 'react';
import {
  compareMonth,
  dateInMonth, isMonthActive, newId, 
} from '@/domain';
import type { Account, Id, Transfer } from '@/domain/types';
import type { LedgerApi } from '../types';
import { sortedActive } from './helpers';
import type { IncomePlanActionsCtx } from './incomePlans';

/** 이벤트통장 부족 대처 */
export function useShortageActions(ctx: IncomePlanActionsCtx) {
  const {
    requireData, insertRows, stamp, accountByRole, syncAutoNow, addRule, changeRuleAmountFrom,
  } = ctx;
  /* ---------- 부족 대처 ---------- */

  const applyIncreaseMonthly = useCallback<LedgerApi['applyIncreaseMonthly']>(
    async (fix) => {
      const { data: d } = requireData();
      const event = accountByRole('event');
      if (!event) throw new Error('이벤트통장이 없어요');
      // fix.fromMonth 에 유효한 이벤트통장 적립 규칙 (여럿이면 가장 늦게 시작한 것)
      const active = d.rules
        .filter(
          (r) =>
            !r.deleted &&
            r.toAccountId === event.id &&
            r.amount > 0 &&
            isMonthActive(fix.fromMonth, r.startMonth, r.endMonth),
        )
        .sort((a, b) => compareMonth(b.startMonth, a.startMonth));
      const rule = active[0];
      if (rule) {
        await changeRuleAmountFrom(rule.id, rule.amount + fix.amount, fix.fromMonth);
        await syncAutoNow();
        return;
      }
      // 수입통장이 여럿이면(사람별) 이번 달 배분을 가장 많이 보내는 통장에서 적립해요
      const incomes = sortedActive(d.accounts).filter((a) => a.role === 'income');
      const sent = (id: Id) =>
        d.rules
          .filter((r) => !r.deleted && r.fromAccountId === id && isMonthActive(fix.fromMonth, r.startMonth, r.endMonth))
          .reduce((s, r) => s + r.amount, 0);
      const income = incomes.reduce<Account | null>((best, a) => (!best || sent(a.id) > sent(best.id) ? a : best), null);
      if (!income) throw new Error('수입통장이 없어서 적립을 늘릴 수 없어요');
      await addRule({
        fromAccountId: income.id,
        toAccountId: event.id,
        amount: fix.amount,
        dayOfMonth: 1,
        startMonth: fix.fromMonth,
        endMonth: null,
      });
    },
    [requireData, accountByRole, changeRuleAmountFrom, syncAutoNow, addRule],
  );

  const applyFromReservoir = useCallback<LedgerApi['applyFromReservoir']>(
    async (fix) => {
      const event = accountByRole('event');
      if (!event) throw new Error('이벤트통장이 없어요');
      const row: Transfer = {
        id: newId(),
        date: dateInMonth(fix.month, 1),
        kind: 'transfer',
        fromAccountId: fix.reservoirAccountId,
        toAccountId: event.id,
        amount: fix.amount,
        status: 'planned',
        ruleId: null,
        memo: '이벤트 부족 대비',
        ...stamp(),
      };
      await insertRows('transfers', [row], '저수지에서 옮기는 계획을 저장하지 못했어요');
    },
    [accountByRole, insertRows, stamp],
  );

  return {
    applyIncreaseMonthly, applyFromReservoir,
  };
}

export type ShortageActionsCtx = IncomePlanActionsCtx & ReturnType<typeof useShortageActions>;
