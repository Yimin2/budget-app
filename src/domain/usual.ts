/**
 * PLAN 4-2 '평소 쓰는 돈' — 등록하지 않은 채 이벤트통장에서 늘 나가는 돈 (선물 · 갑작스런 경조사 …).
 *
 * - 기록: 지우지 않은 지출 중 통장이 이벤트통장인 것 (저수지에서 빌려 낼 이벤트 청구 포함). 일정(eventId) · 여행(tripId)에 묶인 지출과
 *   고정 지출 자동 기록(할부 회차 등, fixedExpenseId)은 계획된 돈이라 뺀다. 청구 지출은 지출 금액 그대로 한 번만 센다.
 *   통장 시작일 전 날짜로 가져온 지출도 기록으로 센다 (잔액에는 들어가지 않는다).
 *   '예외'(평소 지출 아님, excluded)로 표시한 지출도 뺀다 — 잔액에는 그대로 들어가고, 기록 시작 달을 정할 때는 센다
 * - 기록 시작 달 = 통장 시작일의 달과 가장 이른 이벤트통장 지출의 달 중 이른 쪽. 그 달부터 지난달까지가 '다 지난 기록 달'
 * - 앞으로의 달 M: 작년 같은 달(M − 12)이 다 지난 기록 달이면 그 달 기록 그대로, 아니면 최근 6개월(기록이 있는 다 지난 달,
 *   6개월이 안 되면 있는 만큼) 평균. 다 지난 기록 달이 하나도 없으면 0 (평소 쓰는 돈 줄을 보이지 않는다)
 * - 카테고리별로 따로 셈하고, 그달 등록한 일정 · 그달 이미 기록한(미리 기록한 포함) 평소 지출을 같은 카테고리에서 먼저 뺀다
 *   (예: 작년 5월 경조사 30만, 올해 5월 결혼식 일정 20만 등록 → 경조사 평소 쓰는 돈 10만). 0 아래로는 내려가지 않는다
 */
import { isClaimExpense } from './balances';
import { isReservoirEventExpense } from './claims';
import { addMonths, compareMonth, monthOf, monthRange } from './dates';
import type { Expense, Id, LedgerData, ProjectionMonth, Won, YearMonth } from './types';

/** 최근 평균에 쓰는 달 수 */
export const USUAL_RECENT_MONTHS = 6;

type CategoryKey = Id | null;

export interface UsualHistory {
  /** 기록 시작 달 (기록이 전혀 없으면 null) */
  start: YearMonth | null;
  /** 달별 · 카테고리별 평소 지출 합 */
  byMonth: Map<YearMonth, Map<CategoryKey, Won>>;
}

export interface UsualEstimate {
  /** lastYear = 작년 같은 달 기록, recent = 최근 평균, none = 기록 없음 */
  basis: 'lastYear' | 'recent' | 'none';
  byCategory: Map<CategoryKey, Won>;
  total: Won;
}

/** 이벤트통장의 계획하지 않은 지출(일정 · 여행 · 고정 지출 자동 기록이 아닌 지출)인지. 예외 표시는 보지 않는다 */
export function isUnplannedEventExpense(e: Expense, eventAccountId: Id): boolean {
  return !e.deleted && e.accountId === eventAccountId && !e.eventId && !e.tripId && !e.fixedExpenseId && e.amount > 0;
}

/** 이벤트통장의 평소 지출(계획하지 않았고 예외로 표시하지 않은 지출)인지 */
export function isUsualEventExpense(e: Expense, eventAccountId: Id): boolean {
  return isUnplannedEventExpense(e, eventAccountId) && e.excluded !== true;
}

/**
 * 이벤트통장 기록으로 세는 지출을 이벤트통장 지출로 본 모양 (저수지에서 빌려 낸 이벤트 청구 포함). 아니면 null
 */
export function asEventRecord(data: LedgerData, e: Expense, eventAccountId: Id): Expense | null {
  if (e.deleted || !e.date) return null;
  if (e.accountId === eventAccountId) return e;
  // 저수지에서 빌려 낸(낼) 이벤트 청구도 이벤트통장 기록으로 센다 (PLAN 4-9)
  return isClaimExpense(e) && isReservoirEventExpense(data, e) ? { ...e, accountId: eventAccountId } : null;
}

/** 이벤트통장 평소 지출 기록 (달별 · 카테고리별) */
export function usualHistory(data: LedgerData, eventAccountId: Id): UsualHistory {
  const account = data.accounts.find((a) => a.id === eventAccountId);
  let start: YearMonth | null = account?.openingDate ? monthOf(account.openingDate) : null;
  const byMonth = new Map<YearMonth, Map<CategoryKey, Won>>();
  for (const raw of data.expenses) {
    const e = asEventRecord(data, raw, eventAccountId);
    if (!e) continue;
    const m = monthOf(e.date);
    if (start === null || compareMonth(m, start) < 0) start = m;
    if (!isUsualEventExpense(e, eventAccountId)) continue;
    const cats = byMonth.get(m) ?? new Map<CategoryKey, Won>();
    cats.set(e.categoryId ?? null, (cats.get(e.categoryId ?? null) ?? 0) + e.amount);
    byMonth.set(m, cats);
  }
  return { start, byMonth };
}

/** 다 지난 기록 달 중 최근 n개월 (오래된 순) */
export function recentHistoryMonths(history: UsualHistory, thisMonth: YearMonth, n = USUAL_RECENT_MONTHS): YearMonth[] {
  if (history.start === null) return [];
  const last = addMonths(thisMonth, -1);
  const from = compareMonth(addMonths(thisMonth, -n), history.start) < 0 ? history.start : addMonths(thisMonth, -n);
  if (compareMonth(from, last) > 0) return [];
  return monthRange(from, last);
}

function inHistory(history: UsualHistory, month: YearMonth, thisMonth: YearMonth): boolean {
  return history.start !== null && compareMonth(month, history.start) >= 0 && compareMonth(month, thisMonth) < 0;
}

/** 최근 n개월 카테고리별 평균 (원 단위 반올림) */
export function recentUsualAverage(history: UsualHistory, thisMonth: YearMonth): Map<CategoryKey, Won> {
  const months = recentHistoryMonths(history, thisMonth);
  const sum = new Map<CategoryKey, Won>();
  for (const m of months) {
    for (const [c, v] of history.byMonth.get(m) ?? []) sum.set(c, (sum.get(c) ?? 0) + v);
  }
  const out = new Map<CategoryKey, Won>();
  for (const [c, v] of sum) out.set(c, Math.round(v / months.length));
  return out;
}

const total = (m: Map<CategoryKey, Won>) => [...m.values()].reduce((s, v) => s + v, 0);

/** 달 M 의 평소 쓰는 돈 추정 (일정 · 이미 쓴 돈을 빼기 전) */
export function estimateUsual(history: UsualHistory, month: YearMonth, thisMonth: YearMonth): UsualEstimate {
  const lastYear = addMonths(month, -12);
  if (inHistory(history, lastYear, thisMonth)) {
    const byCategory = new Map(history.byMonth.get(lastYear) ?? []);
    return { basis: 'lastYear', byCategory, total: total(byCategory) };
  }
  if (recentHistoryMonths(history, thisMonth).length === 0) return { basis: 'none', byCategory: new Map(), total: 0 };
  const byCategory = recentUsualAverage(history, thisMonth);
  return { basis: 'recent', byCategory, total: total(byCategory) };
}

/**
 * 예측 한 달의 평소 쓰는 돈 = 카테고리마다 max(0, 추정 − 그달 등록한 일정 − 그달 이미 기록한 평소 지출) 의 합.
 * events: 그달 예측에 들어간 일정 회차(남은 금액), 카테고리는 일정 행에서 찾는다
 */
export function usualForMonth(
  data: LedgerData,
  eventAccountId: Id,
  history: UsualHistory,
  month: YearMonth,
  thisMonth: YearMonth,
  events: ProjectionMonth['events'],
): { usual: Won; basis: UsualEstimate['basis'] } {
  const est = estimateUsual(history, month, thisMonth);
  if (est.basis === 'none' || est.total <= 0) return { usual: 0, basis: est.basis };
  const used = new Map<CategoryKey, Won>();
  const add = (c: CategoryKey, v: Won) => used.set(c, (used.get(c) ?? 0) + v);
  for (const o of events) {
    const row = data.events.find((e) => e.id === o.id);
    add(row?.categoryId ?? null, o.amount);
  }
  for (const [c, v] of history.byMonth.get(month) ?? []) add(c, v);
  let usual = 0;
  for (const [c, v] of est.byCategory) usual += Math.max(0, v - (used.get(c) ?? 0));
  return { usual, basis: est.basis };
}

/** 범위(아끼면 · 많이 쓰면)에 쓰는 기록 달 수 (최근 24개월) */
export const USUAL_RANGE_MONTHS = 24;
/** 백분위로 폭을 정하는 최소 달 수. 이보다 적으면 표준편차 */
export const USUAL_PERCENTILE_MIN = 6;

/** 정렬된 값의 p 백분위 (선형 보간, 0 ≤ p ≤ 1) */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export interface UsualSpread {
  method: 'percentile' | 'stddev' | 'none';
  points: number;
  /** 보통에서 뺄 폭 (아끼면) */
  low: Won;
  /** 보통에 더할 폭 (많이 쓰면) */
  high: Won;
}

/**
 * 평소 쓰는 돈이 달마다 얼마나 흔들리는지 (PLAN 4-2 범위).
 * 다 지난 기록 달 중 최근 24개월의 달별 합(기록이 없는 달은 0)을 본다.
 * 6개월 이상이면 백분위: 아래 = 중앙값 − P25, 위 = P75 − 중앙값. 2~5개월이면 표준편차(모집단) 하나를 위아래로.
 * 1개월 이하면 폭 0. 원 단위 반올림
 */
export function usualSpread(history: UsualHistory, thisMonth: YearMonth, values?: number[]): UsualSpread {
  const pts = values ?? recentHistoryMonths(history, thisMonth, USUAL_RANGE_MONTHS).map((m) => total(history.byMonth.get(m) ?? new Map()));
  const n = pts.length;
  if (n < 2) return { method: 'none', points: n, low: 0, high: 0 };
  if (n >= USUAL_PERCENTILE_MIN) {
    const sorted = [...pts].sort((a, b) => a - b);
    const med = percentile(sorted, 0.5);
    return {
      method: 'percentile',
      points: n,
      low: Math.max(0, Math.round(med - percentile(sorted, 0.25))),
      high: Math.max(0, Math.round(percentile(sorted, 0.75) - med)),
    };
  }
  const mean = pts.reduce((s, v) => s + v, 0) / n;
  const sd = Math.round(Math.sqrt(pts.reduce((s, v) => s + (v - mean) ** 2, 0) / n));
  return { method: 'stddev', points: n, low: sd, high: sd };
}

export interface UsualInsight {
  /** 최근 평균에 쓴 달 수 (1~6) */
  months: number;
  /** 최근 평균 평소 쓰는 돈 (한 달) */
  monthlyUsual: Won;
  /** 앞으로 예측 기간 동안 등록한 일정 · 여행 남은 예산의 한 달 평균 */
  monthlyPlanned: Won;
  /** 매달 적립 */
  monthlyContribution: Won;
  /** 적립 − (평소 쓰는 돈 + 등록한 일정). 음수면 매달 그만큼 줄어든다 */
  gap: Won;
  /** 평소 쓰는 돈 카테고리 상위 3개 (최근 평균) */
  topCategories: { categoryId: Id | null; name: string; amount: Won }[];
  /** 작년(최근 12개월) 기록 중 평소 지출이 가장 많았던 달 */
  heaviest: { month: YearMonth; amount: Won } | null;
  /** 한 줄 안내 */
  message: string;
}

/** 천 원 단위로 반올림한 '62만원' 꼴 */
export function manWon(n: Won): string {
  const r = Math.round(Math.abs(n) / 1000) * 1000;
  if (r === 0) return '0원';
  const whole = Math.floor(r / 10000);
  const rest = (r % 10000) / 1000;
  const body = whole === 0 ? `${rest}천` : rest === 0 ? `${whole.toLocaleString('en-US')}만` : `${whole.toLocaleString('en-US')}.${rest}만`;
  return `${body}원`;
}

/**
 * 적립액을 살펴볼 때 쓰는 정보 (정보만, 바꾸는 버튼 없음).
 * 매달 나가는 돈 = 최근 6개월 평소 쓰는 돈 평균 + 앞으로 12개월 등록한 일정(여행 남은 예산 포함) 한 달 평균.
 * 이벤트통장이 없거나 다 지난 기록 달이 없으면 null
 */
export function usualSpendingInsight(
  data: LedgerData,
  today: string,
  projection: { accountId: Id | null; monthlyContribution: Won; months: ProjectionMonth[] },
): UsualInsight | null {
  if (!projection.accountId) return null;
  const thisMonth = monthOf(today);
  const history = usualHistory(data, projection.accountId);
  const recent = recentHistoryMonths(history, thisMonth);
  if (recent.length === 0) return null;
  const avg = recentUsualAverage(history, thisMonth);
  const monthlyUsual = total(avg);
  const n = Math.max(1, projection.months.length);
  const monthlyPlanned = Math.round(projection.months.reduce((s, m) => s + m.planned + (m.trips ?? 0), 0) / n);
  const monthlyContribution = projection.monthlyContribution;
  const need = monthlyUsual + monthlyPlanned;
  const gap = monthlyContribution - need;

  const names = new Map(data.categories.map((c) => [c.id, c.name]));
  const topCategories = [...avg.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([categoryId, amount]) => ({
      categoryId,
      name: (categoryId !== null ? names.get(categoryId) : undefined) ?? '기타',
      amount,
    }));

  let heaviest: UsualInsight['heaviest'] = null;
  for (const m of recentHistoryMonths(history, thisMonth, 12)) {
    const v = total(history.byMonth.get(m) ?? new Map());
    if (v > 0 && (!heaviest || v > heaviest.amount)) heaviest = { month: m, amount: v };
  }

  const roundedGap = Math.round(gap / 1000) * 1000;
  const message =
    roundedGap < 0
      ? `평소 매달 ${manWon(need)}을 쓰는데 적립은 ${manWon(monthlyContribution)}이에요. 이대로면 매달 ${manWon(-gap)}씩 줄어요`
      : roundedGap > 0
        ? `적립이 평소 쓰는 돈보다 ${manWon(gap)} 많아요`
        : '적립과 평소 쓰는 돈이 거의 같아요';
  return { months: recent.length, monthlyUsual, monthlyPlanned, monthlyContribution, gap, topCategories, heaviest, message };
}
