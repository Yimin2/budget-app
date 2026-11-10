import { compareMonth, dateInMonth, isMonthActive, isValidMonth, monthOf, monthRange } from './dates';
import { autoFixedExpenseId, autoTransferId } from './ids';
import {
  installmentDay, installmentGroups, installmentMemo, installmentPayments, installmentPlanId, installmentRowEnd, isInstallment,
} from './installments';
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

/**
 * 고정 지출의 month 회차 날짜 (규칙과 같은 기준). 할부는 마지막 회차(종료월 · 전체 회차)까지.
 * 할부의 결제일 빈 칸은 1일 (회차 계산 installmentPayments 와 같게 — 낸 것으로 세면서 기록은 안 하는 일이 없게)
 */
export function fixedOccurrenceDate(data: LedgerData, f: FixedExpense, month: YearMonth): ISODate | null {
  const end = isInstallment(f) ? installmentRowEnd(f) : f.endMonth;
  if (isInstallment(f) && end === null) return null;
  const day = isInstallment(f) ? installmentDay(f) : f.dayOfMonth;
  if (f.deleted || day === null || !isValidMonth(f.startMonth) || !isMonthActive(month, f.startMonth, end)) return null;
  const date = dateInMonth(month, day);
  const opening = latestOpeningDate(data, [f.accountId]);
  if (opening && date < opening) return null;
  return date;
}

/**
 * 아직 만들지 않은 자동 기록 (앱을 열 때 호출).
 * - 월배분 규칙: rule.startMonth ~ 이번 달, 그달 dayOfMonth 가 오늘 이전(포함)인 회차 → transfer(kind='transfer', status='done', ruleId, id=autoTransferId)
 * - 고정지출 bill/allowance/installment: startMonth ~ 이번 달, dayOfMonth 가 지난 회차 → expense(fixedExpenseId, id=autoFixedExpenseId)
 *   할부는 마지막 회차까지만, 같은 달을 두 행이 덮으면 그달을 맡은 행만. 메모에 회차('TV 할부 16/24회차')
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

  const plans = installmentGroups(data.fixedExpenses);
  const payments = new Map([...plans].map(([id, rows]) => [id, installmentPayments(rows)]));
  for (const f of data.fixedExpenses) {
    if (f.deleted || f.kind === 'living' || f.amount <= 0 || !isValidMonth(f.startMonth)) continue;
    if (f.dayOfMonth === null && !isInstallment(f)) continue;
    const from = firstMonth(f.startMonth, latestOpeningDate(data, [f.accountId]));
    const planPayments = isInstallment(f) ? (payments.get(installmentPlanId(f.id)) ?? []) : null;
    for (const m of monthRange(from, thisMonth)) {
      const date = fixedOccurrenceDate(data, f, m);
      if (date === null || date > today) continue;
      let memo = f.name;
      if (planPayments) {
        const p = planPayments.find((x) => x.month === m);
        if (!p || p.rowId !== f.id) continue; // 같은 달을 맡은 다른 행이 있다
        const last = planPayments[planPayments.length - 1];
        memo = installmentMemo(f.name, p.number, last ? last.number : p.number);
      }
      const id = autoFixedExpenseId(f.id, m);
      if (expenseIds.has(id)) continue;
      expenseIds.add(id);
      expenses.push({
        id,
        date,
        amount: f.amount,
        accountId: f.accountId,
        categoryId: f.categoryId,
        memo,
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
