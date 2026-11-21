import { useCallback } from 'react';
import {
  adjustmentDelta, 
  newId, 
} from '@/domain';
import type { Account, Id, Transfer, Won } from '@/domain/types';
import type { LedgerApi } from '../types';
import { nextOrder } from './helpers';
import type { InstallmentActionsCtx } from './installments';

/** 통장 · 이체 · 실제 잔액 맞추기 */
export function useAccountActions(ctx: InstallmentActionsCtx) {
  const {
    todayRef, nowIso, requireData, upsertRow, insertRows, stamp, syncAutoNow, upsertTransfers,
  } = ctx;
  /* ---------- 통장·이체 ---------- */

  const saveAccount = useCallback(
    async (account: Account) => {
      await upsertRow('accounts', account, '통장을 저장하지 못했어요');
      await syncAutoNow();
    },
    [upsertRow, syncAutoNow],
  );

  const addAccount = useCallback<LedgerApi['addAccount']>(
    async (input) => {
      const { data: d } = requireData();
      if (!input.name.trim()) throw new Error('통장 이름을 입력해 주세요');
      const row: Account = {
        id: newId(),
        name: input.name.trim(),
        role: input.role,
        openingBalance: Math.round(input.openingBalance),
        openingDate: todayRef.current,
        order: nextOrder(d.accounts),
        ownerName: input.ownerName?.trim() || null,
        ownerEmail: input.ownerEmail?.trim() || null,
        deleted: false,
      };
      await insertRows('accounts', [row], '통장을 추가하지 못했어요');
      await syncAutoNow();
      return row;
    },
    [requireData, todayRef, insertRows, syncAutoNow],
  );

  const addTransfer = useCallback<LedgerApi['addTransfer']>(
    async (input) => {
      if (!(input.amount > 0)) throw new Error('금액을 입력해 주세요');
      if (input.kind === 'transfer' && input.fromAccountId === input.toAccountId)
        throw new Error('보내는 통장과 받는 통장이 같아요');
      // 정해진 id(두 폰에서 같은 일을 눌러도 한 건)는 이미 있으면 그대로
      if (input.id && requireData().data.transfers.some((t) => t.id === input.id && !t.deleted)) return;
      const row: Transfer = {
        id: input.id ?? newId(),
        date: input.date,
        kind: input.kind,
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        amount: Math.round(input.amount),
        status: 'done',
        ruleId: null,
        memo: input.memo ?? '',
        ...stamp(),
      };
      await insertRows('transfers', [row], '기록하지 못했어요');
      // 월급(수입)을 기록하면 그 월급날 배분을 바로 만들어요 (정해 둔 날을 기다리지 않고 들어온 날에)
      if (row.kind === 'income') await syncAutoNow();
    },
    [insertRows, stamp, syncAutoNow, requireData],
  );

  const deleteTransfer = useCallback(
    async (id: Id) => {
      const row = requireData().data.transfers.find((t) => t.id === id);
      if (!row) throw new Error('기록을 찾을 수 없어요');
      await upsertRow('transfers', { ...row, deleted: true, updatedAt: nowIso() }, '기록을 지우지 못했어요');
    },
    [requireData, upsertRow, nowIso],
  );

  /** '오늘 보낼 돈'에서 보냈어요 · 바꿨어요 (sent=false 면 되돌려요). 여러 줄을 한 번에 */
  const markSent = useCallback<LedgerApi['markSent']>(
    async (ids, sent) => {
      const { data: d } = requireData();
      const at = nowIso();
      const rows = d.transfers
        .filter((t) => ids.includes(t.id) && !t.deleted)
        .map((t) => {
          const next: Transfer = { ...t, updatedAt: at };
          if (sent) next.sentAt = at;
          else delete next.sentAt;
          return next;
        });
      if (rows.length === 0) return;
      await upsertTransfers(rows, sent ? '보냈다고 표시하지 못했어요' : '되돌리지 못했어요');
    },
    [requireData, nowIso, upsertTransfers],
  );

  const adjustBalance = useCallback(
    async (accountId: Id, actual: Won) => {
      const { data: d } = requireData();
      const day = todayRef.current;
      const delta = adjustmentDelta(d, accountId, Math.round(actual), day);
      if (delta === 0) return;
      const row: Transfer = {
        id: newId(),
        date: day,
        kind: 'adjustment',
        fromAccountId: delta < 0 ? accountId : null,
        toAccountId: delta > 0 ? accountId : null,
        amount: Math.abs(delta),
        status: 'done',
        ruleId: null,
        memo: '잔액 맞추기',
        ...stamp(),
      };
      await insertRows('transfers', [row], '잔액을 맞추지 못했어요');
    },
    [requireData, todayRef, stamp, insertRows],
  );

  return {
    saveAccount, addAccount, addTransfer, deleteTransfer, markSent, adjustBalance,
  };
}

export type AccountActionsCtx = InstallmentActionsCtx & ReturnType<typeof useAccountActions>;
