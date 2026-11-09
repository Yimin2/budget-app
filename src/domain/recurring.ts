import type { AutoRecords, ISODate, LedgerData } from './types';

/**
 * 아직 만들지 않은 자동 기록 (앱을 열 때 호출).
 * - 월배분 규칙: rule.startMonth ~ 이번 달, 그달 dayOfMonth 가 오늘 이전(포함)인 회차 → transfer(kind='transfer', status='done', ruleId, id=autoTransferId)
 * - 고정지출 bill/allowance: startMonth ~ 이번 달, dayOfMonth 가 지난 회차 → expense(fixedExpenseId, id=autoFixedExpenseId)
 * - 이미 같은 id 가 있으면(삭제 포함) 만들지 않는다. 종료월·삭제된 규칙 제외
 * - 미래 planned 이체가 같은 규칙 회차를 대신하지 않는다
 */
export function pendingAutoRecords(data: LedgerData, today: ISODate, author: string, now: string): AutoRecords {
  throw new Error('not implemented');
}
