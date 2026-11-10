/** domain 내부 도우미 (index 에서 내보내지 않음) */
import { isMonthActive } from './dates';
import type { Account, AccountRole, Id, LedgerData, YearMonth } from './types';

export function activeAccountsSorted(data: LedgerData): Account[] {
  return data.accounts.filter((a) => !a.deleted).sort((a, b) => a.order - b.order);
}

export function firstAccountByRole(data: LedgerData, role: AccountRole): Account | null {
  return activeAccountsSorted(data).find((a) => a.role === role) ?? null;
}

/**
 * 그달 생활비 통장들 (PLAN 4-1 · 4-14).
 * 그달 유효한 living 고정지출의 통장들 (통장 순서, 지운 통장은 뒤). 없으면 아무 living 행의 통장 하나, 그것도 없으면 role='fixed' 첫 통장
 */
export function livingAccountIdsFor(data: LedgerData, month: YearMonth): Id[] {
  const rows = data.fixedExpenses.filter((f) => !f.deleted && f.kind === 'living' && isMonthActive(month, f.startMonth, f.endMonth));
  if (rows.length > 0) {
    const ids: Id[] = [];
    for (const r of rows) if (!ids.includes(r.accountId)) ids.push(r.accountId);
    const order = new Map(activeAccountsSorted(data).map((a, i) => [a.id, i]));
    const first = new Map(ids.map((id, i) => [id, i]));
    return ids.sort(
      (a, b) => (order.get(a) ?? 1e6) - (order.get(b) ?? 1e6) || (first.get(a) ?? 0) - (first.get(b) ?? 0),
    );
  }
  const anyLiving = data.fixedExpenses.find((f) => !f.deleted && f.kind === 'living');
  if (anyLiving) return [anyLiving.accountId];
  const fixed = firstAccountByRole(data, 'fixed');
  return fixed ? [fixed.id] : [];
}

/** 생활비 지출 통장 (여럿이면 첫 통장): 그달 유효한 living 고정지출의 accountId, 없으면 role='fixed' 첫 통장 */
export function livingAccountIdFor(data: LedgerData, month: YearMonth): Id | null {
  return livingAccountIdsFor(data, month)[0] ?? null;
}
