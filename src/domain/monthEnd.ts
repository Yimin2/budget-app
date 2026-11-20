import { addMonths, compareMonth, dateInMonth, isValidMonth, localDateOf, monthOf, monthRange } from './dates';
import { monthEndTransferId } from './ids';
import { firstAccountByRole, livingAccountIdsFor } from './internal';
import { livingLeftoverItems } from './living';
import type { Account, Id, ISODate, LedgerData, MonthEnd, MonthEndItem, PendingMonthEnd, Transfer, YearMonth, Won } from './types';

/** 월말 처리를 거슬러 묻는 최대 달 수 */
export const MONTH_END_LOOKBACK = 12;

/** 월말에 남은 돈을 보낼 곳 (넘친 돈은 고르지 않아도 다음 달에서 빠져요) */
export type MonthEndDecision = 'reservoir' | 'carryover' | 'allowance';

/**
 * 아직 처리하지 않은 가장 오래된 달의 월말 {month, leftover, over, items}. 없으면 null.
 * - leftover = 남은 항목(양수)의 합, over = 넘친 항목(음수)의 합. items 는 0 이 아닌 항목
 * - 살펴보는 달: max(가계부 만든 달(이 기기 시간대), 마지막으로 처리한 달 + 1, 지난달 − 11) ~ 지난달
 * - 이미 처리(choice ≠ pending)했거나 남은 · 넘친 항목이 없는 달은 건너뛴다
 * - leftover = 0 이면 넘친 돈만 있는 달: 묻지 않고 autoMonthEnds 로 기록해요
 */
export function pendingMonthEnd(data: LedgerData, today: ISODate): PendingMonthEnd | null {
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
    const items = livingLeftoverItems(data, month);
    const leftover = items.reduce((s, i) => s + Math.max(0, i.leftover), 0);
    const over = items.reduce((s, i) => s + Math.min(0, i.leftover), 0);
    if (leftover > 0 || over < 0) return { month, leftover, over, items };
  }
  return null;
}

/**
 * 넘친 돈만 있는 달(남은 항목 없음)을 묻지 않고 처리한 월말 행들, 오래된 달부터.
 * 이월로 적고 넘친 항목만 남겨서 다음 달 같은 항목 예산에서 빠져요. 남은 돈이 있는 달을 만나면 멈춰요 (그 달은 물어요)
 */
export function autoMonthEnds(data: LedgerData, today: ISODate, now: string): MonthEnd[] {
  const out: MonthEnd[] = [];
  let d = data;
  for (let n = 0; n < MONTH_END_LOOKBACK; n++) {
    const p = pendingMonthEnd(d, today);
    if (!p || p.leftover > 0) break;
    const row: MonthEnd = {
      month: p.month, leftover: 0, choice: 'carryover', decidedBy: null, decidedAt: now, overCarried: true,
      items: p.items.filter((i) => i.leftover < 0).map((i) => ({ categoryId: i.categoryId, leftover: i.leftover, ...(i.accountId ? { accountId: i.accountId } : {}) })),
    };
    out.push(row);
    d = { ...d, monthEnds: [...d.monthEnds.filter((m) => m.month !== row.month), row] };
  }
  return out;
}

/**
 * 생활비 통장 주인의 용돈 통장. 생활비 통장 주인(이름 · 이메일)과 같은 주인인 용돈 통장, 없으면 null
 */
export function allowanceAccountFor(data: LedgerData, livingAccountId: Id): Account | null {
  const living = data.accounts.find((a) => a.id === livingAccountId);
  if (!living) return null;
  const name = living.ownerName?.trim() || null;
  const email = living.ownerEmail?.trim().toLowerCase() || null;
  if (!name && !email) return null;
  return (
    data.accounts
      .filter((a) => !a.deleted && a.role === 'allowance')
      .sort((a, b) => a.order - b.order)
      .find((a) => (email && a.ownerEmail?.trim().toLowerCase() === email) || (name && a.ownerName?.trim() === name)) ?? null
  );
}

/** 남은 항목(양수)을 생활비 통장마다 합해요. 통장이 없는 예전 항목은 첫 생활비 통장 */
function positivesByAccount(items: MonthEndItem[], primary: Id): Map<Id, Won> {
  const per = new Map<Id, Won>();
  for (const i of items) {
    if (i.leftover <= 0) continue;
    const acc = i.accountId ?? primary;
    per.set(acc, (per.get(acc) ?? 0) + i.leftover);
  }
  return per;
}

/**
 * '개인 지출용'을 고를 수 있는지: 남은 돈이 있는 생활비 통장마다 주인의 용돈 통장이 있어야 해요.
 * 고를 수 있으면 [생활비 통장, 용돈 통장, 금액] 목록, 아니면 null
 */
export function allowanceTargets(data: LedgerData, month: YearMonth, items: MonthEndItem[]): { from: Id; to: Account; amount: Won }[] | null {
  const primary = livingAccountIdsFor(data, month)[0] ?? null;
  if (!primary) return null;
  const out: { from: Id; to: Account; amount: Won }[] = [];
  for (const [from, amount] of positivesByAccount(items, primary)) {
    const to = allowanceAccountFor(data, from);
    if (!to) return null;
    out.push({ from, to, amount });
  }
  return out.length > 0 ? out : null;
}

/**
 * 결정 기록: MonthEnd 행(항목별 남은 돈 포함, overCarried) + 저수지 · 용돈이면 생활비 통장에서 나가는 이체(done, 다음 달 1일).
 * - 넘친 항목(음수)은 무엇을 골라도 다음 달 같은 항목에서 빠져요. 그래서 보내는 돈은 남은 항목(양수)만이에요
 * - 저수지: 생활비 통장마다 남은 항목 합을 저수지로. 첫 생활비 통장은 monthend:<월>, 나머지는 monthend:<월>@<통장id>
 * - 용돈: 생활비 통장마다 그 주인의 용돈 통장으로 (id 같은 방식). 용돈 통장이 없으면 보낼 수 없어요(이체 없음)
 * - 이월: 다음 달 computeLiving 이 items 를 같은 통장 · 같은 항목에 더해요
 */
export function decideMonthEnd(
  data: LedgerData,
  month: YearMonth,
  leftover: Won,
  choice: MonthEndDecision,
  author: string,
  now: string,
  items: MonthEndItem[] | null = null,
): { monthEnd: MonthEnd; transfer: Transfer | null; transfers: Transfer[] } {
  const clean = items
    ? items
        .filter((i) => i.leftover !== 0)
        .map((i) => ({ categoryId: i.categoryId, leftover: i.leftover, ...(i.accountId ? { accountId: i.accountId } : {}) }))
    : null;
  const monthEnd: MonthEnd = {
    month, leftover, choice, decidedBy: author, decidedAt: now, items: clean && clean.length > 0 ? clean : null, overCarried: true,
  };
  const none = { monthEnd, transfer: null, transfers: [] };
  if (choice === 'carryover' || leftover <= 0) return none;
  const ids = livingAccountIdsFor(data, month);
  const primary = ids[0] ?? null;
  if (!primary) return none;
  const make = (from: Id, to: Id, amount: Won, memo: string): Transfer => ({
    id: from === primary ? monthEndTransferId(month) : `${monthEndTransferId(month)}@${from}`,
    date: dateInMonth(addMonths(month, 1), 1),
    kind: 'transfer',
    fromAccountId: from,
    toAccountId: to,
    amount,
    status: 'done',
    ruleId: null,
    memo,
    author,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  });
  // 예전 기록처럼 항목 구분이 없으면 합계 한 줄
  const per = clean && clean.length > 0 ? positivesByAccount(clean, primary) : new Map([[primary, leftover]]);
  const transfers: Transfer[] = [];
  if (choice === 'reservoir') {
    const reservoir = firstAccountByRole(data, 'reservoir');
    if (!reservoir) return none;
    for (const [acc, amount] of per) if (amount > 0 && acc !== reservoir.id) transfers.push(make(acc, reservoir.id, amount, '남은 생활비'));
  } else {
    for (const [acc, amount] of per) {
      const to = allowanceAccountFor(data, acc);
      if (amount > 0 && to && to.id !== acc) transfers.push(make(acc, to.id, amount, '남은 생활비 → 용돈'));
    }
  }
  return { monthEnd, transfer: transfers[0] ?? null, transfers };
}
