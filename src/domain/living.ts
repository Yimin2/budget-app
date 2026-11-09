import type { ISODate, LedgerData, LivingStatus, YearMonth, Won } from './types';

/**
 * PLAN 4-1. 생활비 계산.
 * - 이번 달 생활비 = kind='living' 이고 month 에 유효한 고정지출 합 + 지난달 MonthEnd(choice='carryover').leftover
 * - 생활비 지출 = 삭제 안 된 지출 중 fixedExpenseId=null, eventId=null 이고 accountId 가 생활비 통장(living 고정지출의 accountId, 없으면 role='fixed' 첫 통장)인 것
 * - 하루 생활비 = (남은 생활비 + 오늘 쓴 생활비) ÷ 남은 일수(오늘 포함), 100원 내림
 */
export function computeLiving(data: LedgerData, today: ISODate): LivingStatus {
  throw new Error('not implemented');
}
/** 특정 달의 생활비 남은 돈 (월말 처리용). 그달 말일 기준 */
export function livingLeftover(data: LedgerData, month: YearMonth): Won {
  throw new Error('not implemented');
}
