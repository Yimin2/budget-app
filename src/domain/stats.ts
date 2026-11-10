/**
 * 통계 화면 (작업정리 11, PLAN 6 [통계]) — 화면과 떼어 둔 셈.
 *
 * - 쓴 돈 = 지우지 않은 모든 지출 (생활비 · 고정비 자동 기록 · 용돈 · 이벤트통장 · 청구 포함). 이체는 쓴 돈이 아니에요.
 *   청구(개인 돈으로 낸 지출)는 돌려준 날이 아니라 쓴 날짜의 달에 셉니다
 * - ① 달별 예산 대비 실제: 그달 생활비 항목(computeLiving, 그달 유효한 예산 행 + 이월)마다 예산 · 쓴 돈 · 상태
 *   (넘음 = 쓴 돈 > 예산, 주의 = 90% 이상, 예산 없음 = 기타 묶음). 그달 고정비(결제 예정 합 · 자동 기록 합)와 용돈(배분 · 용돈 통장에서 나간 돈)
 * - ② 카테고리별 비율: 그달 쓴 돈을 카테고리로 묶어 큰 순, 도넛은 5개 + 기타. 사람을 고르면 실제로 쓴 사람(expenseSpender)으로 거름
 * - ③ 월별 추이: 고른 달까지 12개월의 달마다 쓴 돈 합
 * - ④ 이벤트통장 1년 회고: 고른 달까지 12개월(이번 달이면 오늘까지) 이벤트통장에 들어온 적립 · 쓴 돈 · 잔액 변화 ·
 *   저수지에서 빌린 돈 · 갚은 돈 · 가장 큰 일정 · 여행 · 카테고리별 쓴 돈
 */
import { accountCharges } from './allocation';
import { accountBalance, isCountedTransfer } from './balances';
import { addDays, addMonths, compareMonth, dateInMonth, daysInMonth, isMonthActive, isValidMonth, monthOf, monthRange } from './dates';
import { earliestBudgetMonth } from './budgetMonth';
import { eventPlanGroup, eventRecordNames, eventRecords } from './eventRecords';
import { isComputedRule } from './income';
import { isAutoFixedRecord } from './installments';
import { activeAccountsSorted, firstAccountByRole } from './internal';
import { computeLiving } from './living';
import { ledgerPeople } from './people';
import { isLoanRepayId, isLoanTransferId } from './settlement';
import { expenseSpender } from './spender';
import { USUAL_NO_CATEGORY, type DonutSlice } from './usualBreakdown';
import type { Expense, Id, ISODate, LedgerData, Won, YearMonth } from './types';

/** 월별 추이 · 이벤트통장 회고에서 보는 달 수 */
export const STATS_MONTHS = 12;
/** 도넛에서 색으로 보이는 카테고리 수 (나머지는 '기타') */
export const STATS_DONUT_TOP = 5;
/** 주의로 보는 쓴 비율 */
export const STATS_WARN_RATIO = 0.9;

/* ---------- 고를 수 있는 달 ---------- */

/** 통계에서 고를 수 있는 달: 가장 앞 지출 · 예산 행 · 가계부를 만든 달 ~ 이번 달 (최대 10년 전) */
export function statsMonthRange(data: LedgerData, today: ISODate): { min: YearMonth; max: YearMonth } {
  const max = monthOf(today);
  let min = earliestBudgetMonth(data, today);
  const floor = addMonths(max, -120);
  for (const e of data.expenses) {
    if (e.deleted) continue;
    const m = monthOf(e.date);
    if (isValidMonth(m) && compareMonth(m, min) < 0 && compareMonth(m, floor) >= 0) min = m;
  }
  return { min, max };
}

/** 고를 수 있는 달로 맞추기 */
export function clampStatsMonth(data: LedgerData, today: ISODate, month: YearMonth | null | undefined): YearMonth {
  const { min, max } = statsMonthRange(data, today);
  if (!isValidMonth(month)) return max;
  if (compareMonth(month, min) < 0) return min;
  return compareMonth(month, max) > 0 ? max : month;
}

/* ---------- ① 달별 예산 대비 실제 ---------- */

/** over = 넘음, warning = 90% 이상, ok = 보통, none = 예산 없음 */
export type BudgetState = 'ok' | 'warning' | 'over' | 'none';

export function budgetState(spent: Won, budget: Won): BudgetState {
  if (budget <= 0) return 'none';
  if (spent > budget) return 'over';
  if (spent >= budget * STATS_WARN_RATIO) return 'warning';
  return 'ok';
}

export interface BudgetActualRow {
  key: string;
  categoryId: Id | null;
  name: string;
  /** 사람별 생활비 통장이 여럿일 때 통장 주인 */
  owner: string | null;
  /** 그달 예산 (예산 행 + 지난달 이월) */
  budget: Won;
  spent: Won;
  /** 쓴 비율 (예산이 없으면 0) */
  ratio: number;
  state: BudgetState;
}

export interface BudgetActualFixed {
  /** 그달 결제일이 있는 고정비(세부 항목 포함) · 용돈 · 할부 결제 합 */
  planned: Won;
  /** 그달 자동 기록된 고정비 · 할부 합 */
  paid: Won;
}

export interface BudgetActualAllowance {
  /** 그달 용돈 통장으로 가는 매달 같은 금액 배분 합 */
  planned: Won;
  /** 그달 용돈 통장에서 나간 돈 */
  spent: Won;
}

export interface BudgetActual {
  month: YearMonth;
  rows: BudgetActualRow[];
  /** 생활비 예산 합 · 쓴 돈 합 */
  budget: Won;
  spent: Won;
  overCount: number;
  warningCount: number;
  fixed: BudgetActualFixed | null;
  allowance: BudgetActualAllowance | null;
}

/** 통계가 그달을 볼 기준 날짜: 이번 달 = 오늘, 다른 달 = 그달 1일 */
export function statsAsOf(month: YearMonth, today: ISODate): ISODate {
  return month === monthOf(today) ? today : `${month}-01`;
}

const monthStart = (m: YearMonth): ISODate => `${m}-01`;
const monthEnd = (m: YearMonth): ISODate => dateInMonth(m, daysInMonth(m));

export function budgetVsActual(data: LedgerData, month: YearMonth, today: ISODate): BudgetActual {
  const living = computeLiving(data, statsAsOf(month, today));
  const rows: BudgetActualRow[] = living.items
    .filter((i) => i.monthBudget > 0 || i.spent !== 0)
    .map((i) => {
      const budget = Math.max(0, i.monthBudget);
      return {
        key: `${i.accountId ?? ''}:${i.categoryId ?? ''}`,
        categoryId: i.categoryId,
        name: i.name,
        owner: i.owner ?? null,
        budget,
        spent: i.spent,
        ratio: budget > 0 ? i.spent / budget : 0,
        state: budgetState(i.spent, budget),
      };
    });

  const accounts = activeAccountsSorted(data);
  const from = monthStart(month);
  const to = monthStart(addMonths(month, 1));
  const planned = accounts.flatMap((a) => accountCharges(data, a.id, from, to)).reduce((s, c) => s + c.amount, 0);
  const paid = data.expenses.reduce((s, e) => (!e.deleted && isAutoFixedRecord(e) && monthOf(e.date) === month ? s + e.amount : s), 0);
  const fixed = planned > 0 || paid > 0 ? { planned, paid } : null;

  const allowanceIds = new Set(accounts.filter((a) => a.role === 'allowance').map((a) => a.id));
  let allowance: BudgetActualAllowance | null = null;
  if (allowanceIds.size > 0) {
    const plannedAllowance = data.rules.reduce(
      (s, r) =>
        !r.deleted && allowanceIds.has(r.toAccountId) && !isComputedRule(r) && isMonthActive(month, r.startMonth, r.endMonth) ? s + r.amount : s,
      0,
    );
    const spent = data.expenses.reduce((s, e) => (!e.deleted && allowanceIds.has(e.accountId) && monthOf(e.date) === month ? s + e.amount : s), 0);
    allowance = { planned: plannedAllowance, spent };
  }

  return {
    month,
    rows,
    budget: rows.reduce((s, r) => s + r.budget, 0),
    spent: rows.reduce((s, r) => s + r.spent, 0),
    overCount: rows.filter((r) => r.state === 'over').length,
    warningCount: rows.filter((r) => r.state === 'warning').length,
    fixed,
    allowance,
  };
}

/* ---------- ② 카테고리별 비율 ---------- */

export interface CategorySpend {
  key: string;
  categoryId: Id | null;
  name: string;
  amount: Won;
  count: number;
}

function categoryNames(data: LedgerData): Map<Id, string> {
  return new Map(data.categories.map((c) => [c.id, c.name]));
}

/** 지출을 카테고리로 묶어 큰 순 (같으면 이름 순). 0원 이하 묶음은 빼요 */
export function groupByCategory(data: LedgerData, expenses: Iterable<Expense>): CategorySpend[] {
  const names = categoryNames(data);
  const groups = new Map<string, CategorySpend>();
  for (const e of expenses) {
    const key = e.categoryId ?? '_none';
    const g = groups.get(key) ?? {
      key,
      categoryId: e.categoryId ?? null,
      name: (e.categoryId ? names.get(e.categoryId) : undefined) ?? USUAL_NO_CATEGORY,
      amount: 0,
      count: 0,
    };
    g.amount += e.amount;
    g.count += 1;
    groups.set(key, g);
  }
  return [...groups.values()].filter((g) => g.amount > 0).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'ko'));
}

/** 그달 지출 (지우지 않은 것). spenderKey 를 주면 실제로 쓴 사람이 그 사람인 것만 */
export function monthExpenses(data: LedgerData, month: YearMonth, spenderKey: string | null = null): Expense[] {
  const people = spenderKey ? ledgerPeople(data) : [];
  return data.expenses.filter(
    (e) => !e.deleted && monthOf(e.date) === month && (!spenderKey || expenseSpender(data, e, people).key === spenderKey),
  );
}

export function monthCategorySpend(data: LedgerData, month: YearMonth, spenderKey: string | null = null): CategorySpend[] {
  return groupByCategory(data, monthExpenses(data, month, spenderKey));
}

/** 도넛 조각: 큰 카테고리 top 개 + 나머지 '기타' 하나 */
export function categoryDonutSlices(rows: CategorySpend[], top = STATS_DONUT_TOP): DonutSlice[] {
  const live = rows.filter((r) => r.amount > 0);
  const total = live.reduce((s, r) => s + r.amount, 0);
  if (total <= 0) return [];
  const slices: DonutSlice[] = live.slice(0, top).map((r, i) => ({ key: r.key, name: r.name, amount: r.amount, share: r.amount / total, colorIndex: i }));
  const rest = live.slice(top).reduce((s, r) => s + r.amount, 0);
  if (rest > 0) slices.push({ key: '_other', name: '기타', amount: rest, share: rest / total, colorIndex: null });
  return slices;
}

/* ---------- ③ 월별 추이 ---------- */

export interface TrendMonth {
  month: YearMonth;
  total: Won;
  count: number;
}

/** endMonth 까지 n 달(오래된 순)의 쓴 돈 합 */
export function spendingTrend(data: LedgerData, endMonth: YearMonth, n = STATS_MONTHS): TrendMonth[] {
  const months = monthRange(addMonths(endMonth, -(n - 1)), endMonth);
  const byMonth = new Map(months.map((m) => [m, { month: m, total: 0, count: 0 }]));
  for (const e of data.expenses) {
    if (e.deleted) continue;
    const t = byMonth.get(monthOf(e.date));
    if (!t) continue;
    t.total += e.amount;
    t.count += 1;
  }
  return months.map((m) => byMonth.get(m)!);
}

/** 기록이 있는 달(1건 이상)의 평균. 없으면 0 */
export function trendAverage(trend: TrendMonth[]): Won {
  const live = trend.filter((t) => t.count > 0);
  return live.length === 0 ? 0 : Math.round(live.reduce((s, t) => s + t.total, 0) / live.length);
}

/* ---------- ④ 이벤트통장 1년 회고 ---------- */

export interface EventReviewItem {
  key: string;
  kind: 'event' | 'trip';
  name: string;
  amount: Won;
  /** 그 일정 · 여행 지출 중 가장 이른 날짜 */
  firstDate: ISODate;
}

export interface EventYearReview {
  accountId: Id;
  from: YearMonth;
  to: YearMonth;
  /** 마지막 날 (이번 달이면 오늘) */
  until: ISODate;
  startBalance: Won;
  endBalance: Won;
  /** 잔액 변화 = 끝 잔액 − 시작 잔액 */
  net: Won;
  /** 들어온 적립 · 수입 (빌린 돈 · 잔액 맞추기 제외) */
  contributed: Won;
  /** 쓴 돈 (청구는 쓴 날짜 기준) */
  spent: Won;
  spentCount: number;
  /** 그중 청구(개인 돈으로 낸 것) */
  claimSpent: Won;
  /** 저수지에서 빌린 돈 · 갚은 돈 */
  borrowed: Won;
  repaid: Won;
  /** 다른 통장으로 옮긴 돈 (청구 돌려주기 · 갚기 제외) */
  movedOut: Won;
  /** 가장 큰 일정 · 여행 (최대 5개) */
  topEvents: EventReviewItem[];
  byCategory: CategorySpend[];
}

const isClaimTransferId = (id: string) => id.startsWith('claim:');

/** 이벤트통장 1년 회고. 이벤트통장이 없으면 null */
export function eventYearReview(data: LedgerData, endMonth: YearMonth, today: ISODate, n = STATS_MONTHS, top = 5): EventYearReview | null {
  const acc = firstAccountByRole(data, 'event');
  if (!acc) return null;
  const from = addMonths(endMonth, -(n - 1));
  const startDate = monthStart(from);
  const lastDay = monthEnd(endMonth);
  const until = today < lastDay ? (today < startDate ? startDate : today) : lastDay;
  const inRange = (d: ISODate) => d >= startDate && d <= until;

  // 통장에 실제로 기록된 이벤트통장 지출만 (저수지 이벤트 청구는 저수지에서 빌린 돈으로 따로 보여요)
  const expenses = eventRecords(data, acc.id, { reservoirClaims: false, from: startDate, to: until }).map((r) => r.record);
  const spent = expenses.reduce((s, e) => s + e.amount, 0);
  const claimSpent = expenses.reduce((s, e) => (typeof e.paidBy === 'string' && e.paidBy.trim() !== '' ? s + e.amount : s), 0);

  let contributed = 0;
  let borrowed = 0;
  let repaid = 0;
  let movedOut = 0;
  for (const t of data.transfers) {
    if (!inRange(t.date) || !isCountedTransfer(data, t)) continue;
    if (isLoanTransferId(t.id)) {
      if (t.toAccountId === acc.id) borrowed += t.amount;
      continue;
    }
    if (isLoanRepayId(t.id)) {
      if (t.fromAccountId === acc.id) repaid += t.amount;
      continue;
    }
    if (t.kind === 'adjustment') continue;
    if (t.toAccountId === acc.id) contributed += t.amount;
    else if (t.fromAccountId === acc.id && !isClaimTransferId(t.id)) movedOut += t.amount;
  }

  const names = eventRecordNames(data, { includeDeleted: true });
  const groups = new Map<string, EventReviewItem>();
  for (const e of expenses) {
    const group = eventPlanGroup(e, names);
    if (!group) continue;
    const g = groups.get(group.key) ?? { key: group.key, kind: group.kind, name: group.label, amount: 0, firstDate: e.date };
    g.amount += e.amount;
    if (e.date < g.firstDate) g.firstDate = e.date;
    groups.set(group.key, g);
  }
  const topEvents = [...groups.values()]
    .filter((g) => g.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.firstDate.localeCompare(b.firstDate))
    .slice(0, top);

  const startBalance = accountBalance(data, acc.id, addDays(startDate, -1));
  const endBalance = accountBalance(data, acc.id, until);
  return {
    accountId: acc.id,
    from,
    to: endMonth,
    until,
    startBalance,
    endBalance,
    net: endBalance - startBalance,
    contributed,
    spent,
    spentCount: expenses.length,
    claimSpent,
    borrowed,
    repaid,
    movedOut,
    topEvents,
    byCategory: groupByCategory(data, expenses),
  };
}
