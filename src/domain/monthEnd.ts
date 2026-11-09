import { addMonths, compareMonth, dateInMonth, isValidMonth, localDateOf, monthOf, monthRange } from './dates';
import { monthEndTransferId } from './ids';
import { firstAccountByRole, livingAccountIdFor } from './internal';
import { livingLeftover } from './living';
import type { ISODate, LedgerData, MonthEnd, Transfer, YearMonth, Won } from './types';

/** 월말 처리를 거슬러 묻는 최대 달 수 */
export const MONTH_END_LOOKBACK = 12;

/**
 * 아직 고르지 않은 가장 오래된 달의 월말 처리 {month, leftover}. 없으면 null.
 * - 살펴보는 달: max(가계부 만든 달(이 기기 시간대), 마지막으로 고른 달 + 1, 지난달 − 11) ~ 지난달
 * - 이미 결정(choice ≠ pending)했거나 leftover ≤ 0 인 달은 건너뛴다
 * - 한 달을 고르면 다음 호출이 그다음 달을 돌려준다 (이월하면 다음 달 남은 돈에 더해진다)
 */
export function pendingMonthEnd(data: LedgerData, today: ISODate): { month: YearMonth; leftover: Won } | null {
  const last = addMonths(monthOf(today), -1);
  let from = addMonths(last, -(MONTH_END_LOOKBACK - 1));
  const created = localDateOf(data.settings.createdAt);
  if (created) {
    const cm = monthOf(created);
    if (isValidMonth(cm) && compareMonth(cm, from) > 0) from = cm;
  }
  for (const m of data.monthEnds) {
    if (m.choice === 'pending' || !isValidMonth(m.month)) continue;
    const after = addMonths(m.month, 1);
    if (compareMonth(after, from) > 0) from = after;
  }
  for (const month of monthRange(from, last)) {
    const existing = data.monthEnds.find((m) => m.month === month);
    if (existing && existing.choice !== 'pending') continue;
    const leftover = livingLeftover(data, month);
    if (leftover > 0) return { month, leftover };
  }
  return null;
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
  const monthEnd: MonthEnd = { month, leftover, choice, decidedBy: author, decidedAt: now };
  if (choice !== 'reservoir' || leftover <= 0) return { monthEnd, transfer: null };
  const reservoir = firstAccountByRole(data, 'reservoir');
  const from = livingAccountIdFor(data, month);
  if (!reservoir || !from) return { monthEnd, transfer: null };
  return {
    monthEnd,
    transfer: {
      id: monthEndTransferId(month),
      date: dateInMonth(addMonths(month, 1), 1),
      kind: 'transfer',
      fromAccountId: from,
      toAccountId: reservoir.id,
      amount: leftover,
      status: 'done',
      ruleId: null,
      memo: '남은 생활비',
      author,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    },
  };
}
