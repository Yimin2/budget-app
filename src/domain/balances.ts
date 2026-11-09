import type { Id, ISODate, LedgerData, Won } from './types';

/** 통장 잔액 = 시작 잔액 + 들어온 돈(done) − 나간 돈(done) − 지출. openingDate ≤ 날짜 ≤ asOf 만. 삭제 행 제외 */
export function accountBalance(data: LedgerData, accountId: Id, asOf: ISODate): Won {
  throw new Error('not implemented');
}
/** 삭제되지 않은 모든 통장의 잔액 (id → 잔액) */
export function allBalances(data: LedgerData, asOf: ISODate): Record<Id, Won> {
  throw new Error('not implemented');
}
/** 실제 잔액을 입력받아 차이만큼 adjustment 이체를 만들 금액 (양수=늘림, 음수=줄임, 0=없음) */
export function adjustmentDelta(data: LedgerData, accountId: Id, actual: Won, asOf: ISODate): Won {
  throw new Error('not implemented');
}
