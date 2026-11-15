import { useCallback } from 'react';
import {
  newId, seriesBaseId, 
} from '@/domain';
import type { Expense, Id, ISODate, PlannedEvent, Won } from '@/domain/types';
import type { LedgerApi, NewEvent } from '../types';
import { upsertIn, nextToWrite } from './helpers';
import type { TripActionsCtx } from './trips';

/** 일정 */
export function useEventActions(ctx: TripActionsCtx) {
  const {
    todayRef, nowIso, requireData, mutate, upsertRow, insertRows, stamp, activeAccounts, accountByRole,
  } = ctx;
  /* ---------- 일정 ---------- */

  const findEvent = useCallback(
    (id: Id): PlannedEvent => {
      const ev = requireData().data.events.find((e) => e.id === id);
      if (!ev) throw new Error('일정을 찾을 수 없어요');
      return ev;
    },
    [requireData],
  );

  const addEvent = useCallback(
    async (input: NewEvent): Promise<PlannedEvent> => {
      if (!input.name.trim()) throw new Error('일정 이름을 입력해 주세요');
      if (!(input.amount >= 0)) throw new Error('금액을 확인해 주세요');
      const accountId =
        input.accountId ?? accountByRole('event')?.id ?? accountByRole('allowance')?.id ?? activeAccounts[0]?.id;
      if (!accountId) throw new Error('일정에 쓸 통장이 없어요. 통장을 먼저 만들어 주세요');
      const row: PlannedEvent = {
        id: newId(),
        date: input.date,
        name: input.name.trim(),
        amount: Math.round(input.amount),
        accountId,
        categoryId: input.categoryId ?? null,
        status: 'planned',
        repeat: input.repeat ?? 'none',
        memo: input.memo ?? '',
        ...stamp(),
        ...(input.lunar && (input.repeat ?? 'none') === 'yearly' ? { lunar: input.lunar } : {}),
      };
      await insertRows('events', [row], '일정을 추가하지 못했어요');
      return row;
    },
    [accountByRole, activeAccounts, insertRows, stamp],
  );

  /** 매년 일정 한 번에 등록: 결정적 id 라 다시 눌러도(함께 쓰는 사람이 동시에 눌러도) 같은 행이에요 */
  const registerAnnualEvents = useCallback<LedgerApi['registerAnnualEvents']>(
    async (drafts) => {
      const { data: d } = requireData();
      const accountId = accountByRole('event')?.id ?? accountByRole('allowance')?.id ?? activeAccounts[0]?.id;
      if (!accountId) throw new Error('일정에 쓸 통장이 없어요. 통장을 먼저 만들어 주세요');
      const s = stamp();
      const rows: PlannedEvent[] = [];
      for (const dr of drafts) {
        if (rows.some((r) => r.id === dr.id)) continue;
        if (d.events.some((e) => !e.deleted && seriesBaseId(e.id) === dr.id)) continue;
        rows.push({
          id: dr.id,
          date: dr.date,
          name: dr.name,
          amount: Math.round(dr.amount),
          accountId,
          categoryId: dr.categoryId,
          status: 'planned',
          repeat: 'yearly',
          memo: '',
          ...s,
          ...(dr.lunar ? { lunar: dr.lunar } : {}),
        });
      }
      if (rows.length === 0) return [];
      const byId = new Map(rows.map((r) => [r.id, r]));
      await mutate(
        (cur) => ({ ...cur, events: [...cur.events.filter((e) => !byId.has(e.id)), ...rows] }),
        (repo) => repo.upsertMany('events', rows),
        '매년 일정을 넣지 못했어요',
      );
      return rows;
    },
    [requireData, accountByRole, activeAccounts, stamp, mutate],
  );

  const updateEvent = useCallback(
    (event: PlannedEvent) => upsertRow('events', { ...event, updatedAt: nowIso() }, '일정을 고치지 못했어요'),
    [upsertRow, nowIso],
  );

  /**
   * 완료: 지출(id = event:<일정id>) → 반복이면 다음 회차(결정적 id) → 상태 done 순서로 저장.
   * 중간에 실패해도 다시 누르면 같은 행을 다시 쓰므로 지출이 두 번 생기지 않는다
   */
  const completeEvent = useCallback(
    async (id: Id, actualAmount: Won, date?: ISODate) => {
      const ev = findEvent(id);
      if (!(actualAmount >= 0)) throw new Error('쓴 금액을 확인해 주세요');
      const { data: d } = requireData();
      const day = todayRef.current;
      const s = stamp();
      const expense: Expense = {
        id: `event:${ev.id}`,
        date: date ?? (ev.date <= day ? ev.date : day),
        amount: Math.round(actualAmount),
        accountId: ev.accountId,
        categoryId: ev.categoryId,
        memo: ev.name,
        eventId: ev.id,
        fixedExpenseId: null,
        ...s,
      };
      const done: PlannedEvent = { ...ev, status: 'done', updatedAt: s.updatedAt };
      const next = nextToWrite(ev, d.events, s);
      await mutate(
        (x) => ({
          ...x,
          expenses: actualAmount > 0 ? upsertIn(x.expenses, expense) : x.expenses,
          events: upsertIn(next ? upsertIn(x.events, next) : x.events, done),
        }),
        async (repo) => {
          if (actualAmount > 0) await repo.upsert('expenses', expense);
          if (next) await repo.upsert('events', next);
          await repo.upsert('events', done);
        },
        '일정을 완료하지 못했어요',
        { multiStep: true },
      );
    },
    [findEvent, requireData, todayRef, stamp, mutate],
  );

  /** 이번 회차만 취소. 반복 일정이면 다음 회차를 만들어 반복이 이어진다 */
  const cancelEvent = useCallback(
    async (id: Id) => {
      const ev = findEvent(id);
      const { data: d } = requireData();
      const s = stamp();
      const canceled: PlannedEvent = { ...ev, status: 'canceled', updatedAt: s.updatedAt };
      const next = nextToWrite(ev, d.events, s);
      if (!next) {
        await upsertRow('events', canceled, '일정을 취소하지 못했어요');
        return;
      }
      await mutate(
        (x) => ({ ...x, events: upsertIn(upsertIn(x.events, next), canceled) }),
        async (repo) => {
          await repo.upsert('events', next);
          await repo.upsert('events', canceled);
        },
        '일정을 취소하지 못했어요',
        { multiStep: true },
      );
    },
    [findEvent, requireData, stamp, upsertRow, mutate],
  );

  const deleteEvent = useCallback(
    async (id: Id) => {
      const ev = findEvent(id);
      await upsertRow('events', { ...ev, deleted: true, updatedAt: nowIso() }, '일정을 지우지 못했어요');
    },
    [findEvent, upsertRow, nowIso],
  );

  return {
    findEvent, addEvent, registerAnnualEvents, updateEvent, completeEvent, cancelEvent, deleteEvent,
  };
}

export type EventActionsCtx = TripActionsCtx & ReturnType<typeof useEventActions>;
