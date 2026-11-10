/** 새 행 id (UUID v4) */
export function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** 자동 기록의 결정적 id — 두 사람이 동시에 열어도 중복되지 않게 */
export function autoTransferId(ruleId: string, month: string): string {
  return `auto:${ruleId}:${month}`;
}
export function autoFixedExpenseId(fixedId: string, month: string): string {
  return `fixed:${fixedId}:${month}`;
}
export function allowanceIncomeId(sharedLedgerId: string, fixedId: string, month: string): string {
  return `allowance:${sharedLedgerId}:${fixedId}:${month}`;
}
/** 월말 처리(저수지로) 이체의 결정적 id */
export function monthEndTransferId(month: string): string {
  return `monthend:${month}`;
}
/**
 * 용돈 배분 규칙 id 앞부분 (8-2). 용돈 항목에서 옮긴 배분(`allowance-rule-<고정지출id>`)과 새 가계부 마법사의 용돈 배분.
 * 정한 금액 그대로 보내는 배분이라 '알아서 맞추기' 자동 고치기(4-15)가 건드리지 않는다
 */
export const ALLOWANCE_RULE_PREFIX = 'allowance-rule-';
export function allowanceRuleId(fixedId: string): string {
  return `${ALLOWANCE_RULE_PREFIX}${fixedId}`;
}
export function isAllowanceRuleId(id: string): boolean {
  return id.startsWith(ALLOWANCE_RULE_PREFIX);
}
