import type { ISODate, LedgerData, MonthEnd, Transfer, YearMonth, Won } from './types';

/** 지난달 월말 처리가 필요하면 {month, leftover}. 이미 결정(choice ≠ pending)됐거나 leftover ≤ 0 이면 null */
export function pendingMonthEnd(data: LedgerData, today: ISODate): { month: YearMonth; leftover: Won } | null {
  throw new Error('not implemented');
}

/** 결정 기록: MonthEnd 행 + reservoir 면 생활비 통장 → 저수지 transfer(done, 다음 달 1일). 저수지 통장 없으면 transfer 없음 */
export function decideMonthEnd(
  data: LedgerData,
  month: YearMonth,
  leftover: Won,
  choice: 'reservoir' | 'carryover',
  author: string,
  now: string,
): { monthEnd: MonthEnd; transfer: Transfer | null } {
  throw new Error('not implemented');
}
