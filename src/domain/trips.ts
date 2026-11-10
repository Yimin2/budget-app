/**
 * 여행 (PLAN 4-11). 여행 예산은 늘 이벤트통장에서 나간다.
 * - 날짜가 다른 지출(몇 달 전 항공권, 여행 중 식비)을 지출의 tripId 로 묶는다. 통장은 실제로 나간 통장 그대로
 *   (예전 기록은 저수지에서 나갔을 수도 있다) — 그래도 여행 쓴 돈에는 들어간다
 * - 남은 예산 = 총예산 − 묶은 지출 합. 이 돈은 아직 이벤트통장에서 나가지 않았으므로 예측(4-2)에 여행 날짜의 달로 넣는다
 *   묶은 지출은 이미 잔액(지난 날짜) · 오늘 뒤 지출(scheduledSpending) · 청구(정산일)로 잡혀 있어 남은 예산에서 빼야 두 번 빠지지 않는다
 */
import { addDays, dateInMonth, monthOf } from './dates';
import { firstAccountByRole } from './internal';
import type { Expense, Id, ISODate, LedgerData, Trip, TripItem, TripItemStatus, TripStatus, Won, YearMonth } from './types';

/** 항목 순서 */
export const TRIP_ITEMS: TripItem[] = ['flight', 'stay', 'transport', 'food', 'tour', 'shopping', 'other'];

export const TRIP_ITEM_LABELS: Record<TripItem, string> = {
  flight: '항공',
  stay: '숙박',
  transport: '교통',
  food: '식비',
  tour: '투어',
  shopping: '쇼핑',
  other: '기타',
};

/** 항목 아이콘 (UI 키트 Icon 이름) */
export const TRIP_ITEM_ICONS: Record<TripItem, string> = {
  flight: 'plane',
  stay: 'home-heart',
  transport: 'bus',
  food: 'utensils',
  tour: 'ticket',
  shopping: 'shopping-bag',
  other: 'dots',
};

export function isTripItem(v: unknown): v is TripItem {
  return typeof v === 'string' && (TRIP_ITEMS as string[]).includes(v);
}

const DAY_MS = 86_400_000;
function dayNumber(date: ISODate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** 두 날짜 사이 일수 (b − a) */
export function daysBetween(a: ISODate, b: ISODate): number {
  return dayNumber(b) - dayNumber(a);
}

/** 끝나는 날 (시작일보다 앞이거나 비면 시작일) */
export function tripEndDate(trip: Pick<Trip, 'startDate' | 'endDate'>): ISODate {
  return trip.endDate && trip.endDate >= trip.startDate ? trip.endDate : trip.startDate;
}

/** 항목 예산 합 */
export function tripItemBudgetTotal(trip: Pick<Trip, 'items'>): Won {
  return TRIP_ITEMS.reduce((s, k) => s + Math.max(0, trip.items[k] ?? 0), 0);
}

/** 총예산 (0 이면 항목 예산 합) */
export function tripBudget(trip: Pick<Trip, 'budget' | 'items'>): Won {
  return trip.budget > 0 ? trip.budget : tripItemBudgetTotal(trip);
}

export function tripPhase(trip: Pick<Trip, 'startDate' | 'endDate'>, today: ISODate): TripStatus['phase'] {
  if (today < trip.startDate) return 'upcoming';
  if (today > tripEndDate(trip)) return 'past';
  return 'ongoing';
}

/** 지출이 이 여행에 묶였는지 */
export function isTripExpense(e: Pick<Expense, 'tripId' | 'deleted'>, tripId: Id): boolean {
  return !e.deleted && !!e.tripId && e.tripId === tripId;
}

/** 여행 항목 (빈 칸은 기타) */
export function expenseTripItem(e: Pick<Expense, 'tripItem'>): TripItem {
  return isTripItem(e.tripItem) ? e.tripItem : 'other';
}

/**
 * 남은 예산을 예측 달로 나눈다. 여행 날짜 중 오늘부터(시작 전이면 시작일부터) 끝나는 날까지의 날 수 비율로 나누고
 * 원 단위 나머지는 첫 달에. 끝난 여행 · 남은 예산 0 이하는 빈 배열
 */
export function spreadTripRemaining(
  trip: Pick<Trip, 'startDate' | 'endDate'>,
  remaining: Won,
  today: ISODate,
): { month: YearMonth; amount: Won }[] {
  const end = tripEndDate(trip);
  if (!(remaining > 0) || end < today) return [];
  const from = trip.startDate > today ? trip.startDate : today;
  const days = new Map<YearMonth, number>();
  const total = daysBetween(from, end) + 1;
  // 아주 긴 여행이어도 달 수만큼만 돈다 (달 경계로 건너뛴다)
  let d = from;
  while (d <= end) {
    const m = monthOf(d);
    const lastOfMonth = dateInMonth(m, 31);
    const stop = lastOfMonth < end ? lastOfMonth : end;
    days.set(m, (days.get(m) ?? 0) + daysBetween(d, stop) + 1);
    d = addDays(stop, 1);
  }
  const out = [...days.entries()].map(([month, n]) => ({ month, amount: Math.floor((remaining * n) / total) }));
  const assigned = out.reduce((s, x) => s + x.amount, 0);
  if (out[0]) out[0].amount += remaining - assigned;
  return out.filter((x) => x.amount > 0);
}

/** 여행 하나의 상태 */
export function tripStatus(data: LedgerData, trip: Trip, today: ISODate): TripStatus {
  const eventAccountId = firstAccountByRole(data, 'event')?.id ?? null;
  const expenses = data.expenses
    .filter((e) => isTripExpense(e, trip.id))
    .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? -1 : 1) : a.date < b.date ? -1 : 1));
  const spent = expenses.reduce((s, e) => s + e.amount, 0);
  const spentElsewhere = expenses.reduce((s, e) => (e.accountId !== eventAccountId ? s + e.amount : s), 0);
  const byItem = new Map<TripItem, Won>();
  for (const e of expenses) byItem.set(expenseTripItem(e), (byItem.get(expenseTripItem(e)) ?? 0) + e.amount);
  const items: TripItemStatus[] = [];
  for (const item of TRIP_ITEMS) {
    const raw = trip.items[item];
    const budget = typeof raw === 'number' && raw > 0 ? raw : null;
    const itemSpent = byItem.get(item) ?? 0;
    if (budget === null && itemSpent === 0) continue;
    items.push({ item, budget, spent: itemSpent, remaining: budget === null ? null : budget - itemSpent });
  }
  const budget = tripBudget(trip);
  const remaining = budget - spent;
  const phase = tripPhase(trip, today);
  return {
    trip,
    budget,
    spent,
    remaining,
    spentElsewhere,
    items,
    itemBudgetTotal: tripItemBudgetTotal(trip),
    expenses,
    phase,
    daysUntil: phase === 'upcoming' ? daysBetween(today, trip.startDate) : null,
    projected: spreadTripRemaining(trip, Math.max(0, remaining), today),
  };
}

/** 예산 대비 쓴 정도: 넘으면 over, 90% 이상이면 near, 아니면 ok. 비교할 예산이 없으면 쓴 돈이 있을 때 near */
export type TripSpendState = 'ok' | 'near' | 'over';

export function tripSpendState(spent: Won, limit: Won | null): TripSpendState {
  if (limit === null || limit <= 0) return spent > 0 ? 'near' : 'ok';
  if (spent > limit) return 'over';
  return spent >= limit * 0.9 ? 'near' : 'ok';
}

/** 항목 예산이 없는 항목들이 함께 쓰는 나머지 예산 (총예산 − 항목 예산 합) */
export interface TripLeftoverPool {
  budget: Won;
  /** 예산 없는 항목들의 쓴 돈 합 */
  spent: Won;
  /** budget − spent (음수 = 넘음) */
  remaining: Won;
}

/**
 * 항목 한 줄의 예산 기준
 * - own: 항목 예산이 있음 → 항목 예산 vs 그 항목 쓴 돈
 * - pool: 항목 예산이 없고 나머지 예산이 있음 → 나머지 예산 vs 예산 없는 항목들 쓴 돈 합 (함께 씀)
 * - outside: 항목 예산도 나머지 예산도 없음 → 쓴 돈이 있으면 '예산 밖'
 */
export interface TripItemLine extends TripItemStatus {
  basis: 'own' | 'pool' | 'outside';
  state: TripSpendState;
}

/** 항목별 줄 + 나머지 예산. 나머지 예산 = 총예산 − 항목 예산 합 (총예산이 없거나 0 이하면 null) */
export function tripItemLines(s: Pick<TripStatus, 'trip' | 'items' | 'itemBudgetTotal'>): {
  pool: TripLeftoverPool | null;
  lines: TripItemLine[];
} {
  const leftover = s.trip.budget > 0 ? s.trip.budget - s.itemBudgetTotal : 0;
  const poolSpent = s.items.reduce((sum, it) => (it.budget === null ? sum + it.spent : sum), 0);
  const pool = leftover > 0 ? { budget: leftover, spent: poolSpent, remaining: leftover - poolSpent } : null;
  const poolState = pool ? tripSpendState(pool.spent, pool.budget) : 'ok';
  const lines = s.items.map((it): TripItemLine => {
    if (it.budget !== null) return { ...it, basis: 'own', state: tripSpendState(it.spent, it.budget) };
    if (pool) return { ...it, basis: 'pool', state: poolState };
    return { ...it, basis: 'outside', state: it.spent > 0 ? 'near' : 'ok' };
  });
  return { pool, lines };
}

const PHASE_ORDER: Record<TripStatus['phase'], number> = { ongoing: 0, upcoming: 1, past: 2 };

/** 지우지 않은 여행 모두: 여행 중 → 다가오는 여행(가까운 순) → 지난 여행(최근 순) */
export function tripStatuses(data: LedgerData, today: ISODate): TripStatus[] {
  return data.trips
    .filter((t) => !t.deleted)
    .map((t) => tripStatus(data, t, today))
    .sort((a, b) => {
      const p = PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase];
      if (p !== 0) return p;
      if (a.phase === 'past') return a.trip.startDate < b.trip.startDate ? 1 : a.trip.startDate > b.trip.startDate ? -1 : 0;
      return a.trip.startDate < b.trip.startDate ? -1 : a.trip.startDate > b.trip.startDate ? 1 : 0;
    });
}

/** 이벤트통장 예측에 넣을 여행 남은 예산 (달별 · 여행별) */
export function tripOutflows(data: LedgerData, today: ISODate): { month: YearMonth; tripId: Id; name: string; amount: Won }[] {
  const out: { month: YearMonth; tripId: Id; name: string; amount: Won }[] = [];
  for (const t of data.trips) {
    if (t.deleted) continue;
    for (const p of tripStatus(data, t, today).projected) out.push({ month: p.month, tripId: t.id, name: t.name, amount: p.amount });
  }
  return out;
}

/** 여행 입력 (추가 · 고치기) */
export interface TripInput {
  name: string;
  startDate: ISODate;
  endDate: ISODate;
  budget: Won;
  items?: Partial<Record<TripItem, Won>>;
  memo?: string;
}

/** 0 · 빈 값은 빼고 원 단위 정수로 */
export function cleanTripItems(items: Partial<Record<TripItem, Won>> | undefined): Partial<Record<TripItem, Won>> {
  const out: Partial<Record<TripItem, Won>> = {};
  for (const k of TRIP_ITEMS) {
    const v = items?.[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = Math.round(v);
  }
  return out;
}

/** 입력 확인. 문제가 없으면 null */
export function validateTrip(input: TripInput): string | null {
  if (!input.name.trim()) return '여행 이름을 입력해 주세요';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return '떠나는 날을 골라 주세요';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) return '돌아오는 날을 골라 주세요';
  if (input.endDate < input.startDate) return '돌아오는 날이 떠나는 날보다 빨라요';
  if (daysBetween(input.startDate, input.endDate) > 366) return '여행 기간은 1년 안으로 넣어 주세요';
  const budget = Number.isFinite(input.budget) ? input.budget : 0;
  if (budget < 0) return '예산을 확인해 주세요';
  if (budget === 0 && tripItemBudgetTotal({ items: cleanTripItems(input.items) }) === 0) return '예산을 입력해 주세요';
  return null;
}

/** 카테고리 이름으로 짐작한 여행 항목 (모르면 null) */
export function tripItemForCategory(name: string | null | undefined): TripItem | null {
  const n = (name ?? '').replace(/\s/g, '');
  if (!n) return null;
  if (/항공|비행/.test(n)) return 'flight';
  if (/숙박|호텔|숙소/.test(n)) return 'stay';
  if (/교통|택시|버스|렌트/.test(n)) return 'transport';
  if (/식비|카페|식당|음식/.test(n)) return 'food';
  if (/투어|입장|관광|문화/.test(n)) return 'tour';
  if (/쇼핑|선물/.test(n)) return 'shopping';
  return null;
}

/** 지출에 묶을 수 있는 여행: 지우지 않은 여행 (여행 중 · 다가오는 여행 먼저) + 지금 묶인 여행 */
export function linkableTrips(data: LedgerData, today: ISODate, currentTripId: Id | null = null): Trip[] {
  const list = tripStatuses(data, today).map((s) => s.trip);
  if (currentTripId && !list.some((t) => t.id === currentTripId)) {
    const cur = data.trips.find((t) => t.id === currentTripId);
    if (cur) list.push(cur);
  }
  return list;
}

/** "제주 여행 · 12월 20일~23일" 같은 기간 문구 */
export function tripPeriodText(trip: Pick<Trip, 'startDate' | 'endDate'>): string {
  const end = tripEndDate(trip);
  const md = (d: ISODate) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
  if (end === trip.startDate) return md(trip.startDate);
  const sameMonth = end.slice(0, 7) === trip.startDate.slice(0, 7);
  const nights = daysBetween(trip.startDate, end);
  return `${md(trip.startDate)}~${sameMonth ? `${Number(end.slice(8, 10))}일` : md(end)} (${nights}박 ${nights + 1}일)`;
}
