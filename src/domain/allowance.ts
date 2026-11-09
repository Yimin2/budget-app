import { compareMonth, dateInMonth, isMonthActive, isValidMonth, localDateOf, monthOf, monthRange } from './dates';
import { allowanceIncomeId } from './ids';
import { firstAccountByRole } from './internal';
import type { FixedExpense, ISODate, LedgerData, Transfer, YearMonth, Won } from './types';

function allowancesFor(shared: LedgerData, email: string): FixedExpense[] {
  const target = email.trim().toLowerCase();
  return shared.fixedExpenses.filter(
    (f) => !f.deleted && f.kind === 'allowance' && (f.targetEmail ?? '').trim().toLowerCase() === target,
  );
}

/** 공용 가계부에서 email 에게 month 에 배분된 용돈 합 (kind='allowance', targetEmail 대소문자 무시) */
export function allowanceFor(shared: LedgerData, email: string, month: YearMonth): Won {
  return allowancesFor(shared, email)
    .filter((f) => isMonthActive(month, f.startMonth, f.endMonth))
    .reduce((s, f) => s + f.amount, 0);
}

/**
 * 개인 가계부에 아직 없는 용돈 수입 기록. 공용 고정지출의 dayOfMonth 가 지난 회차만, startMonth 와 개인 가계부 생성 월(이 기기 시간대) 중 늦은 달부터.
 * 받는 통장의 시작일보다 앞선 회차는 만들지 않는다 (시작 잔액에 이미 들어 있음).
 * 받는 통장 = 개인 가계부 role='allowance' 첫 통장 (없으면 []). id = allowanceIncomeId(sharedLedgerId, fixedId, month)
 */
export function pendingAllowanceIncome(
  personal: LedgerData,
  shared: LedgerData,
  sharedLedgerId: string,
  email: string,
  today: ISODate,
  now: string,
): Transfer[] {
  const account = firstAccountByRole(personal, 'allowance');
  if (!account) return [];
  const thisMonth = monthOf(today);
  const created = localDateOf(personal.settings.createdAt);
  let createdMonth = created ? monthOf(created) : thisMonth;
  if (account.openingDate && isValidMonth(monthOf(account.openingDate)) && compareMonth(monthOf(account.openingDate), createdMonth) > 0) {
    createdMonth = monthOf(account.openingDate);
  }
  const existing = new Set(personal.transfers.map((t) => t.id));
  const out: Transfer[] = [];
  for (const f of allowancesFor(shared, email)) {
    if (f.amount <= 0 || !isValidMonth(f.startMonth)) continue;
    const start = compareMonth(f.startMonth, createdMonth) >= 0 ? f.startMonth : createdMonth;
    for (const m of monthRange(start, thisMonth)) {
      if (!isMonthActive(m, f.startMonth, f.endMonth)) continue;
      const date = dateInMonth(m, f.dayOfMonth ?? 1);
      if (date > today || (account.openingDate && date < account.openingDate)) continue;
      const id = allowanceIncomeId(sharedLedgerId, f.id, m);
      if (existing.has(id)) continue;
      existing.add(id);
      out.push({
        id,
        date,
        kind: 'income',
        fromAccountId: null,
        toAccountId: account.id,
        amount: f.amount,
        status: 'done',
        ruleId: null,
        memo: `${shared.settings.name} 용돈`,
        author: email,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      });
    }
  }
  return out;
}
