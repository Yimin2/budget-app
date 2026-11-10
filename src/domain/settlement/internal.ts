/** 정산 모듈끼리만 쓰는 도우미 (domain index 로 내보내지 않는다) */
import type { PendingClaim, Won } from '../types';

export const sumOf = (list: { amount: Won }[]) => list.reduce((s, x) => s + x.amount, 0);

/** 오래된 순: 지출 날짜 → 돌려줄 날 → id */
export function oldestFirst(a: PendingClaim, b: PendingClaim): number {
  const ad = a.expense.date;
  const bd = b.expense.date;
  if (ad !== bd) return ad < bd ? -1 : 1;
  if (a.due !== b.due) return a.due < b.due ? -1 : 1;
  return a.expense.id < b.expense.id ? -1 : a.expense.id > b.expense.id ? 1 : 0;
}
