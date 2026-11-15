import { useCallback } from 'react';
import {
  newId, validateTrip, cleanTripItems,
} from '@/domain';
import type { Id, Trip } from '@/domain/types';
import type { LedgerApi, NewTrip } from '../types';
import type { SettleRecordActionsCtx } from './settleRecords';

/** 여행 */
export function useTripActions(ctx: SettleRecordActionsCtx) {
  const {
    nowIso, requireData, upsertRow, insertRows, stamp,
  } = ctx;
  /* ---------- 여행 ---------- */

  const tripRow = useCallback((input: NewTrip): Pick<Trip, 'name' | 'startDate' | 'endDate' | 'budget' | 'items' | 'memo'> => {
    const err = validateTrip(input);
    if (err) throw new Error(err);
    return {
      name: input.name.trim(),
      startDate: input.startDate,
      endDate: input.endDate,
      budget: Math.max(0, Math.round(input.budget || 0)),
      items: cleanTripItems(input.items),
      memo: input.memo?.trim() ?? '',
    };
  }, []);

  const addTrip = useCallback<LedgerApi['addTrip']>(
    async (input) => {
      const row: Trip = { id: newId(), ...tripRow(input), ...stamp() };
      await insertRows('trips', [row], '여행을 추가하지 못했어요');
      return row;
    },
    [tripRow, stamp, insertRows],
  );

  const findTrip = useCallback(
    (id: Id): Trip => {
      const t = requireData().data.trips.find((x) => x.id === id);
      if (!t) throw new Error('여행을 찾을 수 없어요');
      return t;
    },
    [requireData],
  );

  const updateTrip = useCallback<LedgerApi['updateTrip']>(
    async (id, input) => {
      const t = findTrip(id);
      await upsertRow('trips', { ...t, ...tripRow(input), updatedAt: nowIso() }, '여행을 고치지 못했어요');
    },
    [findTrip, tripRow, upsertRow, nowIso],
  );

  const deleteTrip = useCallback<LedgerApi['deleteTrip']>(
    async (id) => {
      const t = findTrip(id);
      if (t.deleted) return;
      await upsertRow('trips', { ...t, deleted: true, updatedAt: nowIso() }, '여행을 지우지 못했어요');
    },
    [findTrip, upsertRow, nowIso],
  );

  const restoreTrip = useCallback<LedgerApi['restoreTrip']>(
    async (id) => {
      const t = findTrip(id);
      if (!t.deleted) return;
      await upsertRow('trips', { ...t, deleted: false, updatedAt: nowIso() }, '여행을 되살리지 못했어요');
    },
    [findTrip, upsertRow, nowIso],
  );

  return {
    tripRow, addTrip, findTrip, updateTrip, deleteTrip, restoreTrip,
  };
}

export type TripActionsCtx = SettleRecordActionsCtx & ReturnType<typeof useTripActions>;
