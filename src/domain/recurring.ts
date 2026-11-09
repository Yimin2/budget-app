import { compareMonth, dateInMonth, isMonthActive, isValidMonth, monthOf, monthRange } from './dates';
import { autoFixedExpenseId, autoTransferId } from './ids';
import type { AllocationRule, AutoRecords, Expense, FixedExpense, Id, ISODate, LedgerData, Transfer, YearMonth } from './types';

/** 이 통장들 중 가장 늦은 시작일 (모르는 통장은 건너뜀). 그날 전의 기록은 잔액에 들어가지 않는다 */
function latestOpeningDate(data: LedgerData, accountIds: (Id | null)[]): ISODate | null {
  let latest: ISODate | null = null;
  for (const id of accountIds) {
    if (!id) continue;
    const a = data.accounts.find((x) => x.id === id);
    if (a && a.openingDate && (latest === null || a.openingDate > latest)) latest = a.openingDate;
  }
  return latest;
}

/** 반복 기록을 펼칠 첫 달: 시작월과 (통장 시작일의 달) 중 늦은 달 */
function firstMonth(startMonth: YearMonth, opening: ISODate | null): YearMonth {
  if (!opening) return startMonth;
  const om = monthOf(opening);
  return isValidMonth(om) && compareMonth(om, startMonth) > 0 ? om : startMonth;
}

/**
 * 월배분 규칙의 month 회차 날짜. 그달에 규칙이 유효하지 않거나, 날짜가 보내는·받는 통장의 시작일보다 앞이면 null
 * (시작일 전 기록은 한쪽 통장에만 잡혀 돈이 사라진 것처럼 보이고, 시작 잔액에 이미 들어 있는 돈이다)
 */
export function ruleOccurrenceDate(data: LedgerData, rule: AllocationRule, month: YearMonth): ISODate | null {
  if (rule.deleted || !isValidMonth(rule.startMonth) || !isMonthActive(month, rule.startMonth, rule.endMonth)) return null;
  const date = dateInMonth(month, rule.dayOfMonth);
  const opening = latestOpeningDate(data, [rule.fromAccountId, rule.toAccountId]);
  if (opening && date < opening) return null;
  return date;
}

/** 고정 지출의 month 회차 날짜 (규칙과 같은 기준) */
export function fixedOccurrenceDate(data: LedgerData, f: FixedExpense, month: YearMonth): ISODate | null {
  if (f.deleted || f.dayOfMonth === null || !isValidMonth(f.startMonth) || !isMonthActive(month, f.startMonth, f.endMonth)) return null;
  const date = dateInMonth(month, f.dayOfMonth);
  const opening = latestOpeningDate(data, [f.accountId]);
  if (opening && date < opening) return null;
  return date;
}

/**
 * 아직 만들지 않은 자동 기록 (앱을 열 때 호출).
 * - 월배분 규칙: rule.startMonth ~ 이번 달, 그달 dayOfMonth 가 오늘 이전(포함)인 회차 → transfer(kind='transfer', status='done', ruleId, id=autoTransferId)
 * - 고정지출 bill/allowance: startMonth ~ 이번 달, dayOfMonth 가 지난 회차 → expense(fixedExpenseId, id=autoFixedExpenseId)
 * - 이미 같은 id 가 있으면(삭제 포함) 만들지 않는다. 종료월·삭제된 규칙 제외
 * - 미래 planned 이체가 같은 규칙 회차를 대신하지 않는다
 * - 통장 시작일보다 앞선 회차는 만들지 않는다 (시작 잔액에 이미 들어 있음). 시작월이 'YYYY-MM' 이 아니면 건너뛴다
 */
export function pendingAutoRecords(data: LedgerData, today: ISODate, author: string, now: string): AutoRecords {
  const thisMonth = monthOf(today);
  const transferIds = new Set(data.transfers.map((t) => t.id));
  const expenseIds = new Set(data.expenses.map((e) => e.id));
  const transfers: Transfer[] = [];
  const expenses: Expense[] = [];

  for (const rule of data.rules) {
    if (rule.deleted || rule.amount <= 0 || !isValidMonth(rule.startMonth)) continue;
    const from = firstMonth(rule.startMonth, latestOpeningDate(data, [rule.fromAccountId, rule.toAccountId]));
    for (const m of monthRange(from, thisMonth)) {
      const date = ruleOccurrenceDate(data, rule, m);
      if (date === null || date > today) continue;
      const id = autoTransferId(rule.id, m);
      if (transferIds.has(id)) continue;
      transferIds.add(id);
      transfers.push({
        id,
        date,
        kind: 'transfer',
        fromAccountId: rule.fromAccountId,
        toAccountId: rule.toAccountId,
        amount: rule.amount,
        status: 'done',
        ruleId: rule.id,
        memo: '매달 배분',
        author,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      });
    }
  }

  for (const f of data.fixedExpenses) {
    if (f.deleted || f.kind === 'living' || f.dayOfMonth === null || f.amount <= 0 || !isValidMonth(f.startMonth)) continue;
    const from = firstMonth(f.startMonth, latestOpeningDate(data, [f.accountId]));
    for (const m of monthRange(from, thisMonth)) {
      const date = fixedOccurrenceDate(data, f, m);
      if (date === null || date > today) continue;
      const id = autoFixedExpenseId(f.id, m);
      if (expenseIds.has(id)) continue;
      expenseIds.add(id);
      expenses.push({
        id,
        date,
        amount: f.amount,
        accountId: f.accountId,
        categoryId: f.categoryId,
        memo: f.name,
        eventId: null,
        fixedExpenseId: f.id,
        author,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      });
    }
  }
  return { transfers, expenses };
}
