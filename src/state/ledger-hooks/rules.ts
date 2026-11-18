import { useCallback } from 'react';
import {
  canAutoFill, 
  newId, pendingAutoRecords, conflictingRemainderRule,
  isRemainderRule,
} from '@/domain';
import type { AllocationRule, LedgerData } from '@/domain/types';
import type { LedgerRepository } from '@/storage/types';
import { insertIn } from './helpers';
import type { EventActionsCtx } from './events';

/** 배분 규칙 */
export function useRuleActions(ctx: EventActionsCtx) {
  const {
    todayRef, authorRef, nowIso, requireData, mutate, upsertRow, insertRows,
  } = ctx;
  /* ---------- 설정: 규칙 ---------- */

  /** 규칙·고정 지출·통장이 바뀐 뒤 지금 만들어야 할 자동 기록을 바로 만든다 (다음에 열 때 금액이 바뀌어 보이지 않게) */
  const syncAutoNow = useCallback(async () => {
    let current: { repo: LedgerRepository; data: LedgerData };
    try {
      current = requireData();
    } catch {
      return;
    }
    const auto = pendingAutoRecords(current.data, todayRef.current, authorRef.current, nowIso());
    if (auto.transfers.length === 0 && auto.expenses.length === 0) return;
    try {
      await mutate(
        (d) => ({
          ...d,
          transfers: insertIn(d.transfers, auto.transfers),
          expenses: insertIn(d.expenses, auto.expenses),
        }),
        async (repo) => {
          if (auto.transfers.length) await repo.insert('transfers', auto.transfers);
          if (auto.expenses.length) await repo.insert('expenses', auto.expenses);
        },
        '자동 기록을 저장하지 못했어요',
        { multiStep: true },
      );
    } catch {
      // 다음에 열 때 다시 만든다 (id 가 같아 중복 없음)
    }
  }, [todayRef, authorRef, nowIso, requireData, mutate]);

  const saveRule = useCallback(
    async (rule: AllocationRule) => {
      if (!rule.deleted && isRemainderRule(rule) && conflictingRemainderRule(requireData().data, rule)) {
        throw new Error('같은 통장에서 같은 날 나머지를 보내는 배분이 이미 있어요');
      }
      // 용돈 등 생활비가 아닌 통장으로 가는 배분은 알아서 맞추기로 저장하지 않아요 (4-7)
      if (!rule.deleted && rule.kind === 'auto' && !canAutoFill(requireData().data.accounts.find((a) => a.id === rule.toAccountId))) {
        throw new Error('알아서 맞추기는 생활비 통장으로 보낼 때만 고를 수 있어요');
      }
      await upsertRow('rules', rule, '매달 배분을 저장하지 못했어요');
      await syncAutoNow();
    },
    [upsertRow, syncAutoNow, requireData],
  );

  const addRule = useCallback(
    async ({ id: givenId, ...input }: Omit<AllocationRule, 'id' | 'deleted'> & { id?: string }): Promise<AllocationRule> => {
      if (input.fromAccountId === input.toAccountId) throw new Error('보내는 통장과 받는 통장이 같아요');
      if (isRemainderRule(input) && conflictingRemainderRule(requireData().data, input)) {
        throw new Error('같은 통장에서 같은 날 나머지를 보내는 배분이 이미 있어요');
      }
      if (input.kind === 'auto' && !canAutoFill(requireData().data.accounts.find((a) => a.id === input.toAccountId))) {
        throw new Error('알아서 맞추기는 생활비 통장으로 보낼 때만 고를 수 있어요');
      }
      const computed = isRemainderRule(input) || input.kind === 'auto';
      const id = givenId || newId();
      const row: AllocationRule = computed ? { ...input, amount: 0, id, deleted: false } : { ...input, id, deleted: false };
      await insertRows('rules', [row], '매달 배분을 추가하지 못했어요');
      await syncAutoNow();
      return row;
    },
    [insertRows, syncAutoNow, requireData],
  );

  return {
    syncAutoNow, saveRule, addRule,
  };
}

export type RuleActionsCtx = EventActionsCtx & ReturnType<typeof useRuleActions>;
