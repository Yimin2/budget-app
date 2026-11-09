/** 새 행 id (UUID v4) */
export function newId(): string {
  throw new Error('not implemented');
}
/** 자동 기록의 결정적 id — 두 사람이 동시에 열어도 중복되지 않게 */
export function autoTransferId(ruleId: string, month: string): string {
  throw new Error('not implemented');
}
export function autoFixedExpenseId(fixedId: string, month: string): string {
  throw new Error('not implemented');
}
export function allowanceIncomeId(sharedLedgerId: string, fixedId: string, month: string): string {
  throw new Error('not implemented');
}
