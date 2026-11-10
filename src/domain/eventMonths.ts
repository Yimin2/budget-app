/**
 * PLAN 4-2 '월별 이벤트 비용' — 이벤트통장 돈이 달마다 어디에 얼마 나갔는지(지난 달) · 나갈지(이번 달 · 앞으로)를 한 줄씩.
 *
 * - 지난 달(기본 12개월): 그달 실제로 쓴 이벤트통장 지출. 저수지에서 빌려 낸(낼) 이벤트 청구도 넣는다 (asEventRecord).
 *   청구는 돌려준 날이 아니라 **쓴 날(지출 날짜)** 의 달에 센다. 이체(돌려준 청구 claim: · 빌린 돈 loan: · 갚은 돈 loanpay: ·
 *   통장끼리 옮긴 돈)는 쓴 돈이 아니라 넣지 않는다. 예외(평소 지출 아님) 표시는 보지 않는다 (실제로 쓴 돈이라)
 * - 묶는 법: 여행에 묶였으면 여행 이름 → 일정에 묶였으면 일정 이름 → 고정 지출 자동 기록(할부 회차 등)이면 그 고정 지출 이름 →
 *   아니면 카테고리 이름 (없으면 '기타')
 * - 이번 달: 오늘까지 쓴 돈(위와 같이 묶음) + 4-2 예측(projectEventAccount)의 그달 남은 일정 · 여행 남은 예산 · 할부 회차 ·
 *   평소 쓰는 돈 + 오늘 뒤 날짜로 미리 기록한 지출. 같은 일정 · 여행 · 할부는 쓴 돈과 예정을 한 줄로 합친다
 * - 앞으로(기본 12개월): 예측의 그달 예정 (위와 같은 줄들). 예측의 '돌려줄 청구'는 쓴 날의 달에 이미 들어 있어 넣지 않는다
 * - 평소 쓰는 돈은 예측 그대로 (usualForMonth · 평균 기간은 usual.ts 를 따른다) 늘 마지막 줄
 */
import { addMonths, formatMonthKo, monthOf, monthRange } from './dates';
import { projectEventAccount } from './events';
import { installmentPlanId, projectionMonthOf, unrecordedInstallmentPayments } from './installments';
import { firstAccountByRole } from './internal';
import { asEventRecord, manWon } from './usual';
import type { Expense, Id, ISODate, LedgerData, Won, YearMonth } from './types';

export type EventMonthPhase = 'past' | 'current' | 'future';
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

export interface EventMonthCost {
  month: YearMonth;
  phase: EventMonthPhase;
  spent: Won;
  planned: Won;
  total: Won;
  /** 금액 큰 순, 평소 쓰는 돈은 늘 마지막 */
  items: EventMonthItem[];
}

export interface EventMonthlyCostsOptions {
  /** 지난 달 수 (기본 12) */
  pastMonths?: number;
  /** 이번 달 뒤 앞으로 달 수 (기본 12) */
  futureMonths?: number;
}

const USUAL_LABEL = '평소 쓰는 돈';

/** 지출 한 건이 들어갈 줄 (열쇠 · 종류 · 이름) */
function expenseGroup(data: LedgerData, e: Expense, names: Names): Pick<EventMonthItem, 'key' | 'kind' | 'label'> {
  if (e.tripId) {
    const trip = names.trips.get(e.tripId);
    if (trip) return { key: `trip:${e.tripId}`, kind: 'trip', label: trip };
  }
  if (e.eventId) {
    const ev = names.events.get(e.eventId);
    if (ev) return { key: `event:${e.eventId}`, kind: 'event', label: ev };
  }
  if (e.fixedExpenseId) {
    const f = data.fixedExpenses.find((x) => x.id === e.fixedExpenseId);
    if (f) {
      const plan = f.kind === 'installment' ? installmentPlanId(f.id) : f.id;
      return { key: `fixed:${plan}`, kind: 'installment', label: f.name };
    }
  }
  const cat = e.categoryId ?? null;
  return { key: `cat:${cat ?? ''}`, kind: 'category', label: (cat !== null ? names.categories.get(cat) : undefined) ?? '기타' };
}

interface Names {
  trips: Map<Id, string>;
  events: Map<Id, string>;
  categories: Map<Id, string>;
}

class MonthBucket {
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
}

/**
 * 이벤트통장 월별 비용: 지난 pastMonths 개월 → 이번 달 → 앞으로 futureMonths 개월 (오래된 순).
 * 이벤트통장이 없으면 빈 목록
 */
export function eventMonthlyCosts(data: LedgerData, today: ISODate, opts: EventMonthlyCostsOptions = {}): EventMonthCost[] {
  const account = firstAccountByRole(data, 'event');
  if (!account) return [];
  const past = Math.max(0, opts.pastMonths ?? 12);
  const future = Math.max(0, opts.futureMonths ?? 12);
  const thisMonth = monthOf(today);
  const first = addMonths(thisMonth, -past);
  const last = addMonths(thisMonth, future);

  const names: Names = {
    trips: new Map(data.trips.filter((t) => !t.deleted).map((t) => [t.id, t.name])),
    events: new Map(data.events.filter((e) => !e.deleted).map((e) => [e.id, e.name])),
    categories: new Map(data.categories.map((c) => [c.id, c.name])),
  };
  const buckets = new Map<YearMonth, MonthBucket>(monthRange(first, last).map((m) => [m, new MonthBucket()]));

  // 실제 지출 (쓴 날의 달). 오늘 뒤 날짜로 미리 기록한 지출은 그달의 예정
  for (const raw of data.expenses) {
    const e = asEventRecord(data, raw, account.id);
    if (!e) continue;
    const bucket = buckets.get(monthOf(e.date));
    if (!bucket) continue;
    bucket.add(expenseGroup(data, raw, names), e.date <= today ? 'spent' : 'planned', e.amount, raw);
  }

  // 이번 달 · 앞으로: 4-2 예측의 예정 (이번 달 포함 future + 1 개월)
  const projection = projectEventAccount(data, today, { horizonMonths: future + 1 });
  const installments = unrecordedInstallmentPayments(data, account.id);
  for (const m of projection.months) {
    const bucket = buckets.get(m.month);
    if (!bucket) continue;
    for (const ev of m.events) bucket.add({ key: `event:${ev.id}`, kind: 'event', label: ev.name }, 'planned', ev.amount);
    for (const t of m.tripList ?? []) bucket.add({ key: `trip:${t.id}`, kind: 'trip', label: t.name }, 'planned', t.amount);
    for (const p of installments) {
      if (projectionMonthOf(p, today) !== m.month) continue;
      const row = data.fixedExpenses.find((f) => f.id === p.rowId);
      bucket.add({ key: `fixed:${installmentPlanId(p.rowId)}`, kind: 'installment', label: row?.name ?? '할부' }, 'planned', p.amount);
    }
    if (m.usual > 0) bucket.add({ key: 'usual', kind: 'usual', label: USUAL_LABEL }, 'planned', m.usual);
  }

  return [...buckets.entries()].map(([month, bucket]) => {
    const items = bucket.result();
    const spent = items.reduce((s, i) => s + i.spent, 0);
    const planned = items.reduce((s, i) => s + i.planned, 0);
    const phase: EventMonthPhase = month < thisMonth ? 'past' : month === thisMonth ? 'current' : 'future';
    return { month, phase, spent, planned, total: spent + planned, items };
  });
}

/** 한 줄 요약용 짧은 금액: 천 원 단위 반올림 '30만' · '5천' · '82.8만' (0 은 '0원') */
export function shortMan(n: Won): string {
  const s = manWon(n);
  return s === '0원' ? s : s.replace(/원$/, '');
}

/**
 * 달 한 줄 요약에 보일 줄: 평소 쓰는 돈이 아닌 줄 중 큰 것 2개 + 평소 쓰는 돈 (평소 쓰는 돈이 없으면 3개)
 */
export function eventMonthTopItems(cost: Pick<EventMonthCost, 'items'>): EventMonthItem[] {
  const usual = cost.items.find((i) => i.kind === 'usual');
  const rest = cost.items.filter((i) => i.kind !== 'usual');
  return usual ? [...rest.slice(0, 2), usual] : rest.slice(0, 3);
}

/**
 * '12월 85만 · 장모님 생신 30만 · TV 할부 5만 · 평소 50만'. 연도가 오늘과 다르면 '2027년 1월 …'.
 * 나간 돈이 없으면 '3월 0원'
 */
export function eventMonthSummaryText(cost: EventMonthCost, today: ISODate): string {
  const head = `${formatMonthKo(cost.month, Number(today.slice(0, 4)))} ${shortMan(cost.total)}`;
  const parts = eventMonthTopItems(cost).map((i) => `${i.shortLabel} ${shortMan(i.amount)}`);
  return [head, ...parts].join(' · ');
}
