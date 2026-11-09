import type { ISODate, LedgerData, Transfer, YearMonth, Won } from './types';

/** 공용 가계부에서 email 에게 month 에 배분된 용돈 합 (kind='allowance', targetEmail 대소문자 무시) */
export function allowanceFor(shared: LedgerData, email: string, month: YearMonth): Won {
  throw new Error('not implemented');
}

/**
 * 개인 가계부에 아직 없는 용돈 수입 기록. 공용 고정지출의 dayOfMonth 가 지난 회차만, startMonth 와 개인 가계부 생성 월 중 늦은 달부터.
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
  throw new Error('not implemented');
}
