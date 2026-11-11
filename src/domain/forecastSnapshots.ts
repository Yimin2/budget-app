/**
 * 예측 기록 (PLAN 4-2 · 5장 '예측기록' 탭): 달마다 처음 연 날의 '앞으로 12개월' 예측을 남겨 두고,
 * 지난 달에 '그때 예상한 잔액'과 실제 달 말 잔액을 견줘 봐요.
 *
 * - 쓰는 때: 그달 기록이 하나도 없으면(그달 처음 열었거나 앞선 쓰기가 실패) 이번 달 + 다음 11개월 예측을 한 번에 써요.
 *   이미 있으면 쓰지 않아요 (그달 처음 쓴 것이 기록, 덮어쓰지 않음). id 가 정해져 있어 두 사람이 동시에 열어도 한 줄씩만 남아요
 * - 견주는 기록(snapshotFor): 대상 달에 기록한 것 = 그달 처음 연 날의 예측. 없으면 그 달을 담은 가장 최근의 앞선 기록
 */
import { addMonths, compareMonth, isValidMonth, monthOf } from './dates';
import { formatManShort } from './money';
import { accountFlow } from './pastBalances';
import type { EventProjection, ForecastSnapshot, ISODate, LedgerData, ProjectionMonth, Timestamp, Won, YearMonth } from './types';

/** 한 번에 남기는 달 수 (이번 달 + 다음 11개월) */
export const FORECAST_MONTHS = 12;

export function forecastId(recordedMonth: YearMonth, targetMonth: YearMonth): string {
  return `forecast:${recordedMonth}:${targetMonth}`;
}

function live(data: Pick<LedgerData, 'forecasts'>): ForecastSnapshot[] {
  return (data.forecasts ?? []).filter((f) => !f.deleted && isValidMonth(f.recordedMonth) && isValidMonth(f.targetMonth));
}

/** 그달에 남긴 예측 기록이 있는지 */
export function hasSnapshotFor(data: Pick<LedgerData, 'forecasts'>, recordedMonth: YearMonth): boolean {
  return live(data).some((f) => f.recordedMonth === recordedMonth);
}

/** 예측 한 달의 들어올 돈 (적립 · 옮겨 올 돈 · 수입. 적립이 음수면 나갈 돈 쪽) */
export function projectedInflow(m: ProjectionMonth): Won {
  return Math.max(0, m.contributions) + m.transfersIn + (m.income ?? 0);
}

/** 예측 한 달의 나갈 돈 (시작 잔액 + 들어올 돈 − 나갈 돈 = 달 말 잔액) */
export function projectedOutflow(m: ProjectionMonth): Won {
  return (
    Math.max(0, -m.contributions) + m.transfersOut + m.planned + m.usual + m.extra + (m.scheduledSpending ?? 0) + (m.claims ?? 0) +
    (m.installments ?? 0) + (m.trips ?? 0)
  );
}

/**
 * 예측을 기록 행으로: 이번 달부터 FORECAST_MONTHS 개월 (범위가 없으면 아끼면 · 많이 쓰면은 빈 칸).
 * 이번 달 들어올 · 나갈 돈은 1일부터 오늘까지 이미 들어오고 나간 돈을 더해 한 달 전체로 적어요 (실제와 견줄 수 있게)
 */
export function snapshotRows(data: LedgerData, projection: EventProjection, today: ISODate, now: Timestamp): ForecastSnapshot[] {
  const recordedMonth = monthOf(today);
  const sofar = projection.accountId ? accountFlow(data, projection.accountId, `${recordedMonth}-01`, today) : { inflow: 0, outflow: 0 };
  const end = addMonths(recordedMonth, FORECAST_MONTHS - 1);
  const range = projection.range?.months;
  return projection.months
    .filter((m) => compareMonth(m.month, recordedMonth) >= 0 && compareMonth(m.month, end) <= 0)
    .map((m) => {
      const r = range?.find((x) => x.month === m.month);
      const first = m.month === recordedMonth;
      return {
        id: forecastId(recordedMonth, m.month),
        recordedMonth,
        targetMonth: m.month,
        expected: m.endBalance,
        low: r ? r.endLow : null,
        high: r ? r.endHigh : null,
        inflow: projectedInflow(m) + (first ? sofar.inflow : 0),
        outflow: projectedOutflow(m) + (first ? sofar.outflow : 0),
        recordedAt: now,
        deleted: false,
      };
    });
}

/**
 * 지금 남겨야 할 예측 기록. 그달 기록이 이미 있거나 이벤트통장 예측이 없으면 빈 배열 (다시 불러도 같아요)
 */
export function pendingSnapshot(data: LedgerData, projection: EventProjection | null, today: ISODate, now: Timestamp): ForecastSnapshot[] {
  if (!projection || !projection.accountId || projection.months.length === 0) return [];
  if (hasSnapshotFor(data, monthOf(today))) return [];
  return snapshotRows(data, projection, today, now);
}

/** 대상 달과 견줄 기록: 그달에 기록한 것, 없으면 그 달을 담은 가장 최근의 앞선 기록. 없으면 null */
export function snapshotFor(data: Pick<LedgerData, 'forecasts'>, targetMonth: YearMonth): ForecastSnapshot | null {
  let best: ForecastSnapshot | null = null;
  for (const f of live(data)) {
    if (f.targetMonth !== targetMonth || compareMonth(f.recordedMonth, targetMonth) > 0) continue;
    if (!best || compareMonth(f.recordedMonth, best.recordedMonth) > 0) best = f;
  }
  return best;
}

/** 대상 달 → 견줄 기록 (snapshotFor 를 여러 달에) */
export function snapshotsByTarget(data: Pick<LedgerData, 'forecasts'>, months: YearMonth[]): Map<YearMonth, ForecastSnapshot> {
  const out = new Map<YearMonth, ForecastSnapshot>();
  for (const m of months) {
    const s = snapshotFor(data, m);
    if (s) out.set(m, s);
  }
  return out;
}

/** 앞으로 달마다 지난달에 남긴 예측 (그달 기록한 달 = 이번 달 − 1). 지난달 기록이 없으면 빈 지도 */
export function lastMonthForecasts(data: Pick<LedgerData, 'forecasts'>, today: ISODate): Map<YearMonth, ForecastSnapshot> {
  const prev = addMonths(monthOf(today), -1);
  const out = new Map<YearMonth, ForecastSnapshot>();
  for (const f of live(data)) if (f.recordedMonth === prev) out.set(f.targetMonth, f);
  return out;
}

/** '+5만' / '−20만' / '0원' (부호를 늘 붙여요) */
export function signedMan(n: Won): string {
  if (Math.round(n / 1000) === 0) return '0원';
  return `${n > 0 ? '+' : '−'}${formatManShort(Math.abs(n))}`;
}

export interface ForecastCompare {
  /** '그달 처음 예상 −20만 → 실제 +5만 (25만 아꼈어요)' */
  headline: string;
  /** '그달 처음 예상: 들어올 돈 50만 · 나갈 돈 70만 → 실제: 들어온 돈 50만 · 나간 돈 45만 (25만 덜 썼어요)'. 기록에 들어올 · 나갈 돈이 없으면 null */
  detail: string | null;
  /** 들어온 돈이 예상과 달랐으면 '적립 등 들어온 돈이 50만 → 70만으로 바뀌었어요'. 같으면 null */
  inflowNote: string | null;
}

const same = (a: Won, b: Won) => Math.round((a - b) / 1000) === 0;

/**
 * 예상과 실제 견주기 (PLAN 4-2 지난 달 요약). 달 말 잔액: 실제가 더 많으면 아꼈어요, 적으면 더 썼어요, 천 원 안쪽이면 예상대로예요.
 * 나갈 돈: 덜 썼어요 · 더 썼어요. 들어온 돈이 달라졌으면 따로 한 줄. 기록이 대상 달보다 앞선 달 것이면 '○월에 한 예상'
 */
export function forecastCompare(
  snapshot: Pick<ForecastSnapshot, 'expected' | 'recordedMonth' | 'targetMonth' | 'inflow' | 'outflow'>,
  actual: { endBalance: Won; inflow: Won; outflow: Won },
): ForecastCompare {
  const head =
    snapshot.recordedMonth === snapshot.targetMonth ? '그달 처음 예상' : `${Number(snapshot.recordedMonth.slice(5, 7))}월에 한 예상`;
  const diff = actual.endBalance - snapshot.expected;
  const tail = same(actual.endBalance, snapshot.expected)
    ? '예상대로예요'
    : diff > 0
      ? `${formatManShort(diff)} 아꼈어요`
      : `${formatManShort(-diff)} 더 썼어요`;
  const headline = `${head} ${signedMan(snapshot.expected)} → 실제 ${signedMan(actual.endBalance)} (${tail})`;
  let detail: string | null = null;
  let inflowNote: string | null = null;
  if (snapshot.inflow !== null && snapshot.outflow !== null) {
    const out = actual.outflow - snapshot.outflow;
    const outTail = same(actual.outflow, snapshot.outflow)
      ? '나간 돈은 예상대로예요'
      : out < 0
        ? `${formatManShort(-out)} 덜 썼어요`
        : `${formatManShort(out)} 더 썼어요`;
    detail =
      `${head}: 들어올 돈 ${formatManShort(snapshot.inflow)} · 나갈 돈 ${formatManShort(snapshot.outflow)} → ` +
      `실제: 들어온 돈 ${formatManShort(actual.inflow)} · 나간 돈 ${formatManShort(actual.outflow)} (${outTail})`;
    if (!same(actual.inflow, snapshot.inflow)) {
      inflowNote = `적립 등 들어온 돈이 ${formatManShort(snapshot.inflow)} → ${formatManShort(actual.inflow)}으로 바뀌었어요`;
    }
  }
  return { headline, detail, inflowNote };
}
