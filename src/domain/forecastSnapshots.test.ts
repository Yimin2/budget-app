import { describe, expect, it } from 'vitest';
import { createDemoLedger } from './defaults';
import { projectEventAccount } from './events';
import {
  FORECAST_MONTHS,
  forecastCompare,
  forecastId,
  hasSnapshotFor,
  lastMonthForecasts,
  pendingSnapshot,
  projectedInflow,
  projectedOutflow,
  signedMan,
  snapshotFor,
  snapshotRows,
} from './forecastSnapshots';
import { emptyLedger } from './_fixtures';
import type { ForecastSnapshot } from './types';

const TODAY = '2026-11-20';
const NOW = '2026-11-20T01:00:00.000Z';

function snap(recordedMonth: string, targetMonth: string, expected: number, p: Partial<ForecastSnapshot> = {}): ForecastSnapshot {
  return {
    id: forecastId(recordedMonth, targetMonth),
    recordedMonth,
    targetMonth,
    expected,
    low: null,
    high: null,
    inflow: null,
    outflow: null,
    recordedAt: `${recordedMonth}-01T00:00:00.000Z`,
    deleted: false,
    ...p,
  };
}

describe('예측 기록 만들기', () => {
  const data = createDemoLedger(TODAY, NOW, { claims: true, installments: true, trips: true });
  const projection = projectEventAccount(data, TODAY);

  it('이번 달 + 다음 11개월, id = forecast:<기록한달>:<대상달>, 예상 잔액은 예측 그대로', () => {
    const rows = snapshotRows(data, projection, TODAY, NOW);
    expect(rows).toHaveLength(FORECAST_MONTHS);
    expect(rows[0]!.id).toBe('forecast:2026-11:2026-11');
    expect(rows[11]!.id).toBe('forecast:2026-11:2027-10');
    rows.forEach((r, i) => {
      const m = projection.months[i]!;
      expect(r).toMatchObject({ recordedMonth: '2026-11', targetMonth: m.month, expected: m.endBalance, recordedAt: NOW, deleted: false });
    });
  });

  it('들어올 · 나갈 돈: 앞으로 달은 예측 그대로(시작 + 들어올 − 나갈 = 끝), 이번 달은 1일부터 오늘까지를 더해 한 달 전체로', () => {
    const rows = snapshotRows(data, projection, TODAY, NOW);
    const dec = projection.months[1]!;
    expect(rows[1]!.inflow).toBe(projectedInflow(dec));
    expect(rows[1]!.outflow).toBe(projectedOutflow(dec));
    for (const m of projection.months) expect(m.startBalance + projectedInflow(m) - projectedOutflow(m)).toBe(m.endBalance);
    // 이번 달: 1일 잔액(60만) + 한 달 들어올 돈 − 한 달 나갈 돈 = 달 말 예상
    expect(600_000 + rows[0]!.inflow! - rows[0]!.outflow!).toBe(rows[0]!.expected);
  });

  it('그달 기록이 이미 있으면 쓰지 않아요 (처음 것이 기록) · 지운 기록은 없는 것으로', () => {
    expect(pendingSnapshot(data, projection, TODAY, NOW)).toHaveLength(12);
    const withOne = { ...data, forecasts: [snap('2026-11', '2026-12', 1)] };
    expect(hasSnapshotFor(withOne, '2026-11')).toBe(true);
    expect(pendingSnapshot(withOne, projection, TODAY, NOW)).toEqual([]);
    const deleted = { ...data, forecasts: [snap('2026-11', '2026-12', 1, { deleted: true })] };
    expect(pendingSnapshot(deleted, projection, TODAY, NOW)).toHaveLength(12);
    // 지난달 기록만 있으면 이번 달 기록을 써요
    expect(pendingSnapshot({ ...data, forecasts: [snap('2026-10', '2026-11', 1)] }, projection, TODAY, NOW)).toHaveLength(12);
  });

  it('이벤트통장이 없으면 쓰지 않아요', () => {
    const none = emptyLedger();
    expect(pendingSnapshot(none, projectEventAccount(none, TODAY), TODAY, NOW)).toEqual([]);
    expect(pendingSnapshot(none, null, TODAY, NOW)).toEqual([]);
  });
});

describe('견줄 기록 고르기', () => {
  const forecasts = [snap('2026-08', '2026-10', -50_000), snap('2026-09', '2026-10', -100_000), snap('2026-10', '2026-10', -200_000), snap('2026-11', '2026-10', 9)];
  it('대상 달에 기록한 것(그달 처음 예측)을 먼저', () => {
    expect(snapshotFor({ forecasts }, '2026-10')!.expected).toBe(-200_000);
  });
  it('없으면 그 달을 담은 가장 최근의 앞선 기록, 그것도 없으면 null', () => {
    expect(snapshotFor({ forecasts: forecasts.slice(0, 2) }, '2026-10')!.expected).toBe(-100_000);
    expect(snapshotFor({ forecasts }, '2026-09')).toBeNull();
  });
  it('앞으로 달의 지난달 예측', () => {
    const map = lastMonthForecasts({ forecasts: [snap('2026-10', '2026-12', 5), snap('2026-09', '2026-12', 7)] }, TODAY);
    expect(map.get('2026-12')!.expected).toBe(5);
  });
});

describe('예상과 실제 견주기', () => {
  it("'그달 처음 예상 −20만 → 실제 +5만 (25만 아꼈어요)' · 더 썼어요 · 예상대로예요", () => {
    expect(forecastCompare(snap('2026-10', '2026-10', -200_000), { endBalance: 50_000, inflow: 0, outflow: 0 }).headline).toBe(
      '그달 처음 예상 −20만 → 실제 +5만 (25만 아꼈어요)',
    );
    expect(forecastCompare(snap('2026-10', '2026-10', 300_000), { endBalance: 120_000, inflow: 0, outflow: 0 }).headline).toBe(
      '그달 처음 예상 +30만 → 실제 +12만 (18만 더 썼어요)',
    );
    expect(forecastCompare(snap('2026-09', '2026-10', 0), { endBalance: 400, inflow: 0, outflow: 0 }).headline).toBe(
      '9월에 한 예상 0원 → 실제 0원 (예상대로예요)',
    );
    expect(signedMan(-1_234_000)).toBe('−123.4만');
  });

  it('들어올 · 나갈 돈이 있으면 그 차이로 설명, 들어온 돈이 바뀌었으면 따로 한 줄', () => {
    const s = snap('2026-10', '2026-10', -200_000, { inflow: 500_000, outflow: 700_000 });
    const same = forecastCompare(s, { endBalance: 50_000, inflow: 500_000, outflow: 450_000 });
    expect(same.detail).toBe('그달 처음 예상: 들어올 돈 50만 · 나갈 돈 70만 → 실제: 들어온 돈 50만 · 나간 돈 45만 (25만 덜 썼어요)');
    expect(same.inflowNote).toBeNull();
    const changed = forecastCompare(s, { endBalance: 250_000, inflow: 700_000, outflow: 450_000 });
    expect(changed.inflowNote).toBe('적립 등 들어온 돈이 50만 → 70만으로 바뀌었어요');
    expect(forecastCompare(s, { endBalance: -300_000, inflow: 500_000, outflow: 800_000 }).detail).toMatch(/\(10만 더 썼어요\)$/);
    expect(forecastCompare(snap('2026-10', '2026-10', 0), { endBalance: 0, inflow: 1, outflow: 1 }).detail).toBeNull();
  });
});
