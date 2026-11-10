/**
 * 이벤트통장 기록 — 이벤트통장 돈이 언제 · 어디에 얼마 나갔는지 셀 때 함께 쓰는 한 곳.
 * 월별 이벤트 비용(eventMonths) · 평소 쓰는 돈(usual · usualBreakdown) · 예외 후보(exceptions) ·
 * 통계 1년 회고(stats) · 이번 달 사용(settlement/usage)이 모두 여기서 지출을 고른다.
 *
 * - 기록 = 지우지 않았고 날짜가 있는 지출 중 통장이 이벤트통장인 것.
 *   reservoirClaims(기본 켬)면 저수지에서 빌려 낸(낼) 이벤트 청구(PLAN 4-9)도 이벤트통장 지출로 본다 (통장만 이벤트통장으로 바꾼 모양).
 *   통계 회고 · 이번 달 사용은 통장에 실제로 기록된 지출만 센다 (reservoirClaims: false)
 * - 이체는 지출이 아니라 여기 들어오지 않는다 (돌려준 청구 claim: · 빌린 돈 loan: · 갚은 돈 loanpay: · 통장끼리 옮긴 돈)
 * - scope: all = 모두 (월별 비용 · 회고 · 이번 달 사용), unplanned = 일정 · 여행 · 고정 지출 자동 기록에 묶이지 않은 0원 넘는 지출
 *   (예외 후보), usual = unplanned 중 예외(평소 지출 아님)로 표시하지 않은 것 (평소 쓰는 돈)
 * - 청구는 돌려준 날이 아니라 쓴 날(지출 날짜)의 달에 센다
 * - 달별로 보는 두 모양: eventRecordMonths = 달마다 여행 · 일정 · 할부 · 카테고리로 묶은 줄 (월별 이벤트 비용의 지난 달),
 *   eventRecordList = 달마다 지출 한 건씩 + 정산 상태 (돌려줄 청구 · 지급함 · 저수지에서 빌림 · 이벤트통장 지출)
 */
import { isClaimExpense } from './balances';
import { claimLoanTransferId, claimTransferId, isReservoirEventExpense } from './claims';
import { monthOf, monthRange } from './dates';
import { installmentPlanId } from './installments';
import { expenseLoanTransferId } from './settlement/loans';
import type { Expense, Id, ISODate, LedgerData, Won, YearMonth } from './types';

export type EventRecordScope = 'all' | 'unplanned' | 'usual';

export interface EventRecordFilter {
  /** 저수지에서 빌려 낸(낼) 이벤트 청구도 이벤트통장 기록으로 셀지 (기본 true) */
  reservoirClaims?: boolean;
  /** 어떤 지출을 셀지 (기본 all) */
  scope?: EventRecordScope;
  /** 이 달의 지출만 */
  month?: YearMonth;
  /** 이 날짜부터 (포함) */
  from?: ISODate;
  /** 이 날짜까지 (포함) */
  to?: ISODate;
}

export interface EventRecord {
  /** 가계부에 저장된 지출 그대로 */
  expense: Expense;
  /** 이벤트통장 지출로 본 모양 (저수지 이벤트 청구는 accountId 가 이벤트통장) */
  record: Expense;
  /** 쓴 날의 달 */
  month: YearMonth;
}

/** 이벤트통장의 계획하지 않은 지출(일정 · 여행 · 고정 지출 자동 기록이 아닌 지출)인지. 예외 표시는 보지 않는다 */
export function isUnplannedEventExpense(e: Expense, eventAccountId: Id): boolean {
  return !e.deleted && e.accountId === eventAccountId && !e.eventId && !e.tripId && !e.fixedExpenseId && e.amount > 0;
}

/** 이벤트통장의 평소 지출(계획하지 않았고 예외로 표시하지 않은 지출)인지 */
export function isUsualEventExpense(e: Expense, eventAccountId: Id): boolean {
  return isUnplannedEventExpense(e, eventAccountId) && e.excluded !== true;
}

/** 이벤트통장 기록(asEventRecord 로 본 모양)이 scope 에 드는지 */
export function inEventRecordScope(record: Expense, eventAccountId: Id, scope: EventRecordScope = 'all'): boolean {
  if (scope === 'usual') return isUsualEventExpense(record, eventAccountId);
  if (scope === 'unplanned') return isUnplannedEventExpense(record, eventAccountId);
  return true;
}

/**
 * 이벤트통장 기록으로 세는 지출을 이벤트통장 지출로 본 모양 (저수지에서 빌려 낸 이벤트 청구 포함). 아니면 null.
 * reservoirClaims: false 면 통장이 이벤트통장인 지출만
 */
export function asEventRecord(data: LedgerData, e: Expense, eventAccountId: Id, reservoirClaims = true): Expense | null {
  if (e.deleted || !e.date) return null;
  if (e.accountId === eventAccountId) return e;
  if (!reservoirClaims) return null;
  // 저수지에서 빌려 낸(낼) 이벤트 청구도 이벤트통장 기록으로 센다 (PLAN 4-9)
  return isClaimExpense(e) && isReservoirEventExpense(data, e) ? { ...e, accountId: eventAccountId } : null;
}

/** 이벤트통장 기록 (가계부 지출 순서 그대로) */
export function eventRecords(data: LedgerData, eventAccountId: Id, filter: EventRecordFilter = {}): EventRecord[] {
  const { reservoirClaims = true, scope = 'all', month, from, to } = filter;
  const out: EventRecord[] = [];
  for (const expense of data.expenses) {
    const record = asEventRecord(data, expense, eventAccountId, reservoirClaims);
    if (!record) continue;
    const m = monthOf(record.date);
    if (month !== undefined && m !== month) continue;
    if (from !== undefined && record.date < from) continue;
    if (to !== undefined && record.date > to) continue;
    if (!inEventRecordScope(record, eventAccountId, scope)) continue;
    out.push({ expense, record, month: m });
  }
  return out;
}

/** 달별 · 카테고리별 합 (카테고리가 없으면 null) */
export function sumByMonthAndCategory(records: Iterable<EventRecord>): Map<YearMonth, Map<Id | null, Won>> {
  const byMonth = new Map<YearMonth, Map<Id | null, Won>>();
  for (const { record: e, month } of records) {
    const cats = byMonth.get(month) ?? new Map<Id | null, Won>();
    const key = e.categoryId ?? null;
    cats.set(key, (cats.get(key) ?? 0) + e.amount);
    byMonth.set(month, cats);
  }
  return byMonth;
}

/** 지우지 않은 여행 id */
export function liveTripIds(data: LedgerData): Set<Id> {
  return new Set(data.trips.filter((t) => !t.deleted).map((t) => t.id));
}

/** 지출이 지우지 않은 여행에 묶였는지 */
export function isLiveTripExpense(e: Pick<Expense, 'tripId'>, liveTrips: Set<Id>): boolean {
  return !!e.tripId && liveTrips.has(e.tripId);
}

/** 오늘까지 날짜면 쓴 돈, 오늘 뒤 날짜로 미리 기록했으면 예정 */
export function recordPhase(e: Pick<Expense, 'date'>, today: ISODate): 'spent' | 'planned' {
  return e.date <= today ? 'spent' : 'planned';
}

/* ---------- 묶음 이름 ---------- */

export type EventRecordGroupKind = 'trip' | 'event' | 'installment' | 'category';

export interface EventRecordGroup {
  /** 'trip:<id>' · 'event:<id>' · 'fixed:<할부 id>' · 'cat:<카테고리 id>' */
  key: string;
  kind: EventRecordGroupKind;
  label: string;
}

export interface EventRecordNames {
  trips: Map<Id, string>;
  events: Map<Id, string>;
  categories: Map<Id, string>;
}

/** 묶음 이름표. includeDeleted 면 지운 여행 · 일정 이름도 (통계 회고) */
export function eventRecordNames(data: LedgerData, opts: { includeDeleted?: boolean } = {}): EventRecordNames {
  const all = opts.includeDeleted === true;
  return {
    trips: new Map(data.trips.filter((t) => all || !t.deleted).map((t) => [t.id, t.name])),
    events: new Map(data.events.filter((e) => all || !e.deleted).map((e) => [e.id, e.name])),
    categories: new Map(data.categories.map((c) => [c.id, c.name])),
  };
}

export const tripGroupKey = (id: Id) => `trip:${id}`;
export const eventGroupKey = (id: Id) => `event:${id}`;
export const fixedGroupKey = (planId: Id) => `fixed:${planId}`;

/**
 * 지출 한 건이 들어갈 줄 (월별 이벤트 비용): 이름표에 있는 여행 → 일정 → 고정 지출 자동 기록(할부는 할부 하나로) →
 * 카테고리 (없으면 '기타')
 */
export function eventRecordGroup(data: LedgerData, e: Expense, names: EventRecordNames): EventRecordGroup {
  if (e.tripId) {
    const trip = names.trips.get(e.tripId);
    if (trip) return { key: tripGroupKey(e.tripId), kind: 'trip', label: trip };
  }
  if (e.eventId) {
    const ev = names.events.get(e.eventId);
    if (ev) return { key: eventGroupKey(e.eventId), kind: 'event', label: ev };
  }
  if (e.fixedExpenseId) {
    const f = data.fixedExpenses.find((x) => x.id === e.fixedExpenseId);
    if (f) {
      const plan = f.kind === 'installment' ? installmentPlanId(f.id) : f.id;
      return { key: fixedGroupKey(plan), kind: 'installment', label: f.name };
    }
  }
  const cat = e.categoryId ?? null;
  return { key: `cat:${cat ?? ''}`, kind: 'category', label: (cat !== null ? names.categories.get(cat) : undefined) ?? '기타' };
}

/**
 * 일정 · 여행에 묶인 지출의 줄 (통계 회고): 여행 id 가 있으면 여행, 아니면 일정. 이름이 없으면 '여행' · '일정'.
 * 묶이지 않은 지출은 null
 */
export function eventPlanGroup(e: Pick<Expense, 'tripId' | 'eventId'>, names: EventRecordNames): (EventRecordGroup & { kind: 'trip' | 'event' }) | null {
  if (e.tripId) return { key: tripGroupKey(e.tripId), kind: 'trip', label: names.trips.get(e.tripId)?.trim() || '여행' };
  if (e.eventId) return { key: eventGroupKey(e.eventId), kind: 'event', label: names.events.get(e.eventId)?.trim() || '일정' };
  return null;
}

/* ---------- 달별 줄 (월별 이벤트 비용 · 지난 달 쓴 돈 목록) ---------- */

export type EventMonthItemKind = 'trip' | 'event' | 'installment' | 'category' | 'usual';

export interface EventMonthItem {
  /** 같은 달 안에서 겹치지 않는 열쇠 ('event:<id>' · 'trip:<id>' · 'fixed:<할부 id>' · 'cat:<카테고리 id>' · 'usual') */
  key: string;
  kind: EventMonthItemKind;
  /** 화면에 보일 이름 ('장모님 생신' · 'TV 할부' · '경조사' · '평소 쓰는 돈') */
  label: string;
  /** 한 줄 요약에 쓰는 짧은 이름 (평소 쓰는 돈 → '평소') */
  shortLabel: string;
  /** 이미 쓴 돈 (오늘까지 날짜의 지출) */
  spent: Won;
  /** 나갈 돈 (예측 · 오늘 뒤 날짜로 미리 기록한 지출) */
  planned: Won;
  amount: Won;
  /** 이 줄에 들어간 지출 (고치기 창을 열 때, 날짜 순) */
  expenseIds: Id[];
}

export interface EventRecordMonth {
  month: YearMonth;
  spent: Won;
  planned: Won;
  total: Won;
  /** 금액 큰 순, 평소 쓰는 돈은 늘 마지막 */
  items: EventMonthItem[];
}

/** 한 달의 줄을 모으는 통. 같은 열쇠는 한 줄로 합치고, 쓴 돈(spent)과 예정(planned)을 따로 센다 */
export class EventMonthBucket {
  private items = new Map<string, EventMonthItem>();
  private dates = new Map<Id, ISODate>();

  add(group: Pick<EventMonthItem, 'key' | 'kind' | 'label'>, part: 'spent' | 'planned', amount: Won, expense?: Expense) {
    const item =
      this.items.get(group.key) ??
      ({ ...group, shortLabel: group.kind === 'usual' ? '평소' : group.label, spent: 0, planned: 0, amount: 0, expenseIds: [] } as EventMonthItem);
    item[part] += amount;
    item.amount += amount;
    if (expense) {
      item.expenseIds.push(expense.id);
      this.dates.set(expense.id, expense.date);
    }
    this.items.set(group.key, item);
  }

  /** 금액 큰 순 (같으면 이름 순), 평소 쓰는 돈은 늘 마지막. 0원 줄은 뺀다 */
  result(): EventMonthItem[] {
    const byDate = (a: Id, b: Id) => {
      const da = this.dates.get(a) ?? '';
      const db = this.dates.get(b) ?? '';
      return da < db ? -1 : da > db ? 1 : 0;
    };
    const list = [...this.items.values()].filter((i) => i.amount > 0).map((i) => ({ ...i, expenseIds: [...i.expenseIds].sort(byDate) }));
    const usual = list.filter((i) => i.kind === 'usual');
    const rest = list
      .filter((i) => i.kind !== 'usual')
      .sort((a, b) => b.amount - a.amount || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    return [...rest, ...usual];
  }

  /** 그달 합계와 줄 */
  month(month: YearMonth): EventRecordMonth {
    const items = this.result();
    const spent = items.reduce((s, i) => s + i.spent, 0);
    const planned = items.reduce((s, i) => s + i.planned, 0);
    return { month, spent, planned, total: spent + planned, items };
  }
}

/**
 * fromMonth ~ toMonth 의 달마다 이벤트통장 기록을 eventRecordGroup 으로 묶은 통 (오래된 순, 기록이 없는 달도 빈 통).
 * 오늘까지 날짜는 쓴 돈, 오늘 뒤 날짜로 미리 기록한 지출은 예정. 예측 줄을 더할 때(eventMonthlyCosts) 쓴다
 */
export function eventRecordBuckets(
  data: LedgerData,
  eventAccountId: Id,
  fromMonth: YearMonth,
  toMonth: YearMonth,
  today: ISODate,
  filter: Omit<EventRecordFilter, 'month'> = {},
): Map<YearMonth, EventMonthBucket> {
  const buckets = new Map<YearMonth, EventMonthBucket>(monthRange(fromMonth, toMonth).map((m) => [m, new EventMonthBucket()]));
  const names = eventRecordNames(data);
  for (const { expense: raw, record: e, month } of eventRecords(data, eventAccountId, filter)) {
    const bucket = buckets.get(month);
    if (!bucket) continue;
    bucket.add(eventRecordGroup(data, raw, names), recordPhase(e, today), e.amount, raw);
  }
  return buckets;
}

/**
 * 지난 달처럼 기록만으로 보는 달별 이벤트통장 쓴 돈 (fromMonth ~ toMonth, 오래된 순). 예측은 넣지 않는다.
 * 같은 달이면 eventMonthlyCosts 의 지난 달 줄과 같다
 */
export function eventRecordMonths(
  data: LedgerData,
  eventAccountId: Id,
  fromMonth: YearMonth,
  toMonth: YearMonth,
  today: ISODate,
  filter: Omit<EventRecordFilter, 'month'> = {},
): EventRecordMonth[] {
  return [...eventRecordBuckets(data, eventAccountId, fromMonth, toMonth, today, filter).entries()].map(([m, b]) => b.month(m));
}

/* ---------- 지출마다 정산 상태 (달별 한 목록) ---------- */

/**
 * 이벤트통장 기록 한 건의 정산 상태
 * - claimPending: 아직 돌려주지 않은 청구 (개인 돈으로 냄)
 * - claimPaid: 돌려준 청구 (돌려준 이체 claim:<지출id>)
 * - borrowed: 저수지에서 빌려 지급했거나(loan:claim:<지출id>) 이벤트통장이 갚을 돈으로 바꾼 지출(loan:<지출id>)
 * - plain: 이벤트통장 돈으로 바로 쓴 지출
 */
export type EventRecordStatus = 'claimPending' | 'claimPaid' | 'borrowed' | 'plain';

/** 지우지 않은 완료 이체 id (eventRecordStatus 를 여러 번 부를 때 한 번만 만든다) */
export function liveTransferIds(data: LedgerData): Set<string> {
  return new Set(data.transfers.filter((t) => !t.deleted && t.status === 'done').map((t) => t.id));
}

export function eventRecordStatus(data: LedgerData, e: Expense, live: Set<string> = liveTransferIds(data)): EventRecordStatus {
  if (live.has(claimLoanTransferId(e.id)) || live.has(expenseLoanTransferId(e.id))) return 'borrowed';
  if (!isClaimExpense(e)) return 'plain';
  return live.has(claimTransferId(e.id)) ? 'claimPaid' : 'claimPending';
}

export interface EventRecordListItem extends EventRecord {
  status: EventRecordStatus;
}

export interface EventRecordListMonth {
  month: YearMonth;
  /** 그달 기록 합 */
  total: Won;
  /** 최근 것 먼저 (날짜 → id) */
  items: EventRecordListItem[];
}

/**
 * 이벤트통장 기록을 달별 한 목록으로 (최근 달 먼저, 기록이 있는 달만). 지출마다 정산 상태를 붙인다.
 * 기본은 저수지 이벤트 청구까지 (reservoirClaims), 모든 지출 (scope all)
 */
export function eventRecordList(data: LedgerData, eventAccountId: Id, filter: EventRecordFilter = {}): EventRecordListMonth[] {
  const live = liveTransferIds(data);
  const byMonth = new Map<YearMonth, EventRecordListItem[]>();
  for (const r of eventRecords(data, eventAccountId, filter)) {
    const list = byMonth.get(r.month) ?? [];
    list.push({ ...r, status: eventRecordStatus(data, r.expense, live) });
    byMonth.set(r.month, list);
  }
  const recent = (a: EventRecordListItem, b: EventRecordListItem) =>
    a.record.date !== b.record.date ? (a.record.date < b.record.date ? 1 : -1) : a.record.id < b.record.id ? 1 : a.record.id > b.record.id ? -1 : 0;
  return [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([month, items]) => ({ month, total: items.reduce((s, i) => s + i.record.amount, 0), items: items.sort(recent) }));
}
