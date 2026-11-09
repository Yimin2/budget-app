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
