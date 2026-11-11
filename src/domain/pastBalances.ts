/**
 * 지난 달 실제 달 말 잔액 (PLAN 4-2 '앞으로 12개월' 왼쪽 회색 막대).
 * 시트에 적어 둔 잔액이 아니라 기록(이체 · 지출)으로 계산해요 — accountBalance 와 같은 규칙
 * (삭제 행 제외 · done 이체만 · 월말 처리 이체는 저수지로 정한 달만 · 청구 지출은 낸 사람 통장).
 */
import { accountBalance, expenseBalanceAccountId, isCountedTransfer } from './balances';
import { addDays, addMonths, compareMonth, dateInMonth, daysInMonth, isValidDate, monthOf, monthRange } from './dates';
import type { Id, ISODate, LedgerData, Won, YearMonth } from './types';

/** 지난 달 막대 기본 개수 */
export const PAST_MONTHS = 12;

export interface PastMonth {
  month: YearMonth;
  /** 달 시작 잔액 (전달 말 잔액. 통장 시작 달은 시작 잔액) */
  startBalance: Won;
  /** 들어온 돈 (이체 들어옴) */
  inflow: Won;
  /** 나간 돈 (이체 나감 + 지출) */
  outflow: Won;
  /** 달 말 실제 잔액 = 시작 + 들어온 돈 − 나간 돈 */
  endBalance: Won;
}

/** 그 통장의 첫 달: 통장 시작일의 달 (시작일이 비었으면 첫 기록의 달). 기록도 없으면 null */
export function accountStartMonth(data: LedgerData, accountId: Id): YearMonth | null {
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account) return null;
  if (isValidDate(account.openingDate)) return monthOf(account.openingDate);
  let first: ISODate | null = null;
  for (const t of data.transfers) {
    if (t.toAccountId !== accountId && t.fromAccountId !== accountId) continue;
    if (!isCountedTransfer(data, t) || !isValidDate(t.date)) continue;
    if (first === null || t.date < first) first = t.date;
  }
  for (const e of data.expenses) {
    if (e.deleted || expenseBalanceAccountId(e) !== accountId || !isValidDate(e.date)) continue;
    if (first === null || e.date < first) first = e.date;
  }
  return first ? monthOf(first) : null;
}

/**
 * 한 달(from ~ to 날짜) 동안 통장에 들어오고 나간 돈. accountBalance 와 같은 규칙이라
 * 시작 잔액 + inflow − outflow = to 날짜의 잔액이에요
 */
export function accountFlow(data: LedgerData, accountId: Id, from: ISODate, to: ISODate): { inflow: Won; outflow: Won } {
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account) return { inflow: 0, outflow: 0 };
  const opening = account.openingDate;
  const inRange = (d: ISODate) => d >= from && d <= to && d >= opening;
  let inflow = 0;
  let outflow = 0;
  for (const t of data.transfers) {
    if (t.toAccountId !== accountId && t.fromAccountId !== accountId) continue;
    if (!inRange(t.date) || !isCountedTransfer(data, t)) continue;
    // 같은 통장 안 이체는 들어오고 나가서 0
    if (t.toAccountId === accountId) inflow += t.amount;
    if (t.fromAccountId === accountId) outflow += t.amount;
  }
  for (const e of data.expenses) {
    if (e.deleted || expenseBalanceAccountId(e) !== accountId || !inRange(e.date)) continue;
    outflow += e.amount;
  }
  return { inflow, outflow };
}

/**
 * 이번 달 바로 앞까지 최근 count 개월의 실제 달 말 잔액 (오래된 순).
 * 통장 시작 달(accountStartMonth)부터만. 이번 달이 시작 달이면 빈 배열
 */
export function pastMonthEnds(data: LedgerData, accountId: Id, today: ISODate, count = PAST_MONTHS): PastMonth[] {
  const start = accountStartMonth(data, accountId);
  if (!start || count <= 0) return [];
  const thisMonth = monthOf(today);
  const last = addMonths(thisMonth, -1);
  let from = addMonths(thisMonth, -count);
  if (compareMonth(from, start) < 0) from = start;
  if (compareMonth(from, last) > 0) return [];
  return monthRange(from, last).map((month) => {
    const first = dateInMonth(month, 1);
    const end = dateInMonth(month, daysInMonth(month));
    const startBalance = accountBalance(data, accountId, addDays(first, -1));
    const { inflow, outflow } = accountFlow(data, accountId, first, end);
    return { month, startBalance, inflow, outflow, endBalance: accountBalance(data, accountId, end) };
  });
}

/** 이번 달 1일부터 오늘까지 통장에서 이미 나간 돈 (이체 나감 + 지출) */
export function spentSoFarThisMonth(data: LedgerData, accountId: Id, today: ISODate): Won {
  return accountFlow(data, accountId, dateInMonth(monthOf(today), 1), today).outflow;
}
