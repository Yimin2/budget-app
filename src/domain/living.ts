import { addMonths, daysInMonth, daysLeftInMonth, isMonthActive, monthOf } from './dates';
import { livingAccountIdFor } from './internal';
import { floorTo100 } from './money';
import type { ISODate, LedgerData, LivingStatus, YearMonth, Won } from './types';

function budgetFor(data: LedgerData, month: YearMonth): { base: Won; carryIn: Won } {
  const base = data.fixedExpenses
    .filter((f) => !f.deleted && f.kind === 'living' && isMonthActive(month, f.startMonth, f.endMonth))
    .reduce((s, f) => s + f.amount, 0);
  const prev = data.monthEnds.find((m) => m.month === addMonths(month, -1) && m.choice === 'carryover');
  return { base, carryIn: prev ? prev.leftover : 0 };
}

function livingExpenses(data: LedgerData, month: YearMonth, accountId: string | null) {
  if (accountId === null) return [];
  return data.expenses.filter(
    (e) =>
      !e.deleted &&
      e.fixedExpenseId === null &&
      e.eventId === null &&
      e.accountId === accountId &&
      monthOf(e.date) === month,
  );
}

/**
 * PLAN 4-1. 생활비 계산.
 * - 이번 달 생활비 = kind='living' 이고 month 에 유효한 고정지출 합 + 지난달 MonthEnd(choice='carryover').leftover
 * - 생활비 지출 = 삭제 안 된 지출 중 fixedExpenseId=null, eventId=null 이고 accountId 가 생활비 통장(living 고정지출의 accountId, 없으면 role='fixed' 첫 통장)인 것
 * - 하루 생활비 = (남은 생활비 + 오늘 쓴 생활비) ÷ 남은 일수(오늘 포함), 100원 내림
 */
export function computeLiving(data: LedgerData, today: ISODate): LivingStatus {
  const month = monthOf(today);
  const { base, carryIn } = budgetFor(data, month);
  const monthBudget = base + carryIn;
  const livingAccountId = livingAccountIdFor(data, month);
  const rows = livingExpenses(data, month, livingAccountId);
  const spent = rows.reduce((s, e) => s + e.amount, 0);
  const spentToday = rows.filter((e) => e.date === today).reduce((s, e) => s + e.amount, 0);
  const remaining = monthBudget - spent;
  const daysLeft = Math.max(1, daysLeftInMonth(today));
  const startOfDay = remaining + spentToday;
  const dailyBudget = startOfDay > 0 ? floorTo100(startOfDay / daysLeft) : 0;
  return {
    month,
    monthBudget,
    carryIn,
    spent,
    spentToday,
    remaining,
    daysLeft,
    dailyBudget,
    todayAvailable: dailyBudget - spentToday,
    livingAccountId,
  };
}
/** 특정 달의 생활비 남은 돈 (월말 처리용). 그달 말일 기준 */
export function livingLeftover(data: LedgerData, month: YearMonth): Won {
  const lastDay = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  return computeLiving(data, lastDay).remaining;
}
