import { activeAccountsSorted } from './internal';
import type { Expense, Id, ISODate, LedgerData, Transfer, Won } from './types';

const MONTH_END_PREFIX = 'monthend:';

/**
 * 잔액에 넣는 이체인지: 삭제 안 됨 · done · 그리고 월말 처리 이체(monthend:<월>)는 그달 월말 행이 '저수지'로 정해졌을 때만.
 * (두 사람이 동시에 다른 선택을 하거나, 이체만 저장되고 월말 행 저장이 실패해도 돈이 두 번 잡히지 않게)
 */
export function isCountedTransfer(data: LedgerData, t: Transfer): boolean {
  if (t.deleted || t.status !== 'done') return false;
  if (t.id.startsWith(MONTH_END_PREFIX)) {
    const month = t.id.slice(MONTH_END_PREFIX.length);
    return data.monthEnds.some((m) => m.month === month && m.choice === 'reservoir');
  }
  return true;
}

/** 개인 돈으로 내고 돌려받는 지출(청구, PLAN 4-9)인지: 낸 사람 이름이 있으면 */
export function isClaimExpense(e: Pick<Expense, 'paidBy'>): boolean {
  return typeof e.paidBy === 'string' && e.paidBy.trim() !== '';
}

/**
 * 지출이 잔액에서 빠지는 통장. 보통 지출은 지출의 통장, 청구 지출은 낸 사람 통장(없으면 null — 어느 통장 잔액도 줄지 않음).
 * 청구는 함께 쓰는 통장에서 돌려줄 때(이체 claim:<지출id>) 비로소 그 통장 잔액이 줄어든다 (두 번 빠지지 않게)
 */
export function expenseBalanceAccountId(e: Expense): Id | null {
  return isClaimExpense(e) ? (e.claimAccountId ?? null) : e.accountId;
}

/**
 * 통장 잔액 = 시작 잔액 + 들어온 돈(done) − 나간 돈(done) − 지출. openingDate ≤ 날짜 ≤ asOf 만. 삭제 행 제외.
 * 청구 지출은 낸 사람 통장에서 빠지고, 함께 쓰는 통장은 돌려준 이체로 줄어든다 (expenseBalanceAccountId)
 */
export function accountBalance(data: LedgerData, accountId: Id, asOf: ISODate): Won {
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account) return 0;
  const from = account.openingDate;
  const inRange = (date: ISODate) => date >= from && date <= asOf;
  let balance = account.openingBalance;
  for (const t of data.transfers) {
    if (t.toAccountId !== accountId && t.fromAccountId !== accountId) continue;
    if (!inRange(t.date) || !isCountedTransfer(data, t)) continue;
    if (t.toAccountId === accountId) balance += t.amount;
    if (t.fromAccountId === accountId) balance -= t.amount;
  }
  for (const e of data.expenses) {
    if (e.deleted || expenseBalanceAccountId(e) !== accountId || !inRange(e.date)) continue;
    balance -= e.amount;
  }
  return balance;
}
/** 삭제되지 않은 모든 통장의 잔액 (id → 잔액) */
export function allBalances(data: LedgerData, asOf: ISODate): Record<Id, Won> {
  const out: Record<Id, Won> = {};
  for (const a of activeAccountsSorted(data)) out[a.id] = accountBalance(data, a.id, asOf);
  return out;
}
/** 실제 잔액을 입력받아 차이만큼 adjustment 이체를 만들 금액 (양수=늘림, 음수=줄임, 0=없음) */
export function adjustmentDelta(data: LedgerData, accountId: Id, actual: Won, asOf: ISODate): Won {
  return actual - accountBalance(data, accountId, asOf) + 0;
}
