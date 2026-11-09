/** domain 내부 도우미 (index 에서 내보내지 않음) */
import { isMonthActive } from './dates';
import type { Account, AccountRole, Id, LedgerData, YearMonth } from './types';

export function activeAccountsSorted(data: LedgerData): Account[] {
  return data.accounts.filter((a) => !a.deleted).sort((a, b) => a.order - b.order);
}

export function firstAccountByRole(data: LedgerData, role: AccountRole): Account | null {
  return activeAccountsSorted(data).find((a) => a.role === role) ?? null;
}

/** 생활비 지출 통장: 그달 유효한 living 고정지출의 accountId, 없으면 role='fixed' 첫 통장 */
export function livingAccountIdFor(data: LedgerData, month: YearMonth): Id | null {
  const living = data.fixedExpenses.find(
    (f) => !f.deleted && f.kind === 'living' && isMonthActive(month, f.startMonth, f.endMonth),
  );
  if (living) return living.accountId;
  const anyLiving = data.fixedExpenses.find((f) => !f.deleted && f.kind === 'living');
  if (anyLiving) return anyLiving.accountId;
  return firstAccountByRole(data, 'fixed')?.id ?? null;
}
