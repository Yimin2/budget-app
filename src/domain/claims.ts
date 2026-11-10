/**
 * 청구(돌려받기) — PLAN 4-9.
 * 누군가 이벤트통장·고정지출통장(생활비 포함)에 쓸 돈을 개인 돈으로 내면, 함께 쓰는 통장이 나중에 돌려준다.
 * - 지출 행에 낸 사람(paidBy) · 돌려받을 통장(claimAccountId) · 정산일(claimDue)을 적는다
 * - 돌려주면 이체 claim:<지출id> (함께 쓰는 통장 → 낸 사람 통장, 없으면 받는 통장 없이) 를 남긴다.
 *   이 이체가 있으면(지워지지 않은 완료 이체) 돌려준 것으로 본다 — 지출 행을 다시 쓰지 않아도 되고 다시 시도해도 하나만 생긴다
 * - 아직 안 돌려준 청구는 함께 쓰는 통장 잔액에서 빠지지 않고, 예측에서 정산일 달에 나갈 돈으로 잡힌다
 */
import { accountBalance, isClaimExpense } from './balances';
import { addMonths, dateInMonth, formatDateKo, isMonthActive, isValidDate, monthOf } from './dates';
import { activeAccountsSorted } from './internal';
import { withSubject } from './korean';
import { formatWon } from './money';
import type { ClaimSummary, Expense, Id, ISODate, LedgerData, PendingClaim, Won } from './types';

/** 정산일을 정할 규칙이 없을 때의 기본 월급날 */
export const DEFAULT_SETTLE_DAY = 21;

/** 돌려준 이체의 결정적 id */
export function claimTransferId(expenseId: Id): string {
  return `claim:${expenseId}`;
}

/** 이 청구를 돌려줬는지 (이체 claim:<지출id> 가 지워지지 않은 완료 기록으로 있으면) */
export function isClaimSettled(data: LedgerData, expenseId: Id): boolean {
  const id = claimTransferId(expenseId);
  return data.transfers.some((t) => t.id === id && !t.deleted && t.status === 'done');
}

function validDay(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 31;
}

/**
 * 정산일(매달 며칠) = 다음 월급날.
 * 1) 설정의 정산일 2) 그달 유효한 수입통장 → 이벤트통장 매달 배분의 이체일 (여럿이면 금액이 큰 것) 3) 21일
 */
export function settleDayOf(data: LedgerData, month?: string): number {
  if (validDay(data.settings.settleDay)) return data.settings.settleDay;
  return autoSettleDay(data, month);
}

/** 설정을 빼고 정한 자동 정산일 (설정 화면의 '자동' 설명용) */
export function autoSettleDay(data: LedgerData, month?: string): number {
  const accounts = activeAccountsSorted(data);
  const incomeIds = new Set(accounts.filter((a) => a.role === 'income').map((a) => a.id));
  const eventIds = new Set(accounts.filter((a) => a.role === 'event').map((a) => a.id));
  const rules = data.rules
    .filter(
      (r) =>
        !r.deleted &&
        incomeIds.has(r.fromAccountId) &&
        eventIds.has(r.toAccountId) &&
        validDay(r.dayOfMonth) &&
        (month === undefined || isMonthActive(month, r.startMonth, r.endMonth)),
    )
    .sort((a, b) => b.amount - a.amount);
  const rule = rules[0];
  if (rule) return rule.dayOfMonth;
  // 이번 달에 유효한 규칙이 없으면 기간과 상관없이 한 번 더 찾는다
  if (month !== undefined) return autoSettleDay(data);
  return DEFAULT_SETTLE_DAY;
}

/**
 * from 날짜 기준 다음 정산일. 그달 정산일이 from 이후(sameDay=true 면 같은 날 포함)면 그날, 아니면 다음 달 정산일
 * (말일보다 큰 날은 말일)
 */
export function nextSettleDate(data: LedgerData, from: ISODate, sameDay = true): ISODate {
  const m = monthOf(from);
  const here = dateInMonth(m, settleDayOf(data, m));
  if (sameDay ? here >= from : here > from) return here;
  const next = addMonths(m, 1);
  return dateInMonth(next, settleDayOf(data, next));
}

function payerOf(e: Expense): string {
  return (e.paidBy ?? '').trim();
}

/** 지출의 정산일. 시트 빈 칸이면 지출 날짜 기준 다음 정산일 */
export function claimDueOf(data: LedgerData, e: Expense): ISODate {
  if (e.claimDue && isValidDate(e.claimDue)) return e.claimDue;
  return nextSettleDate(data, isValidDate(e.date) ? e.date : monthOf(e.date) + '-01');
}

/** 아직 돌려주지 않은 청구 (지운 지출 · 돌려준 청구 제외), 정산일 → 날짜 순 */
export function pendingClaims(data: LedgerData, today: ISODate): PendingClaim[] {
  const settled = new Set(
    data.transfers.filter((t) => !t.deleted && t.status === 'done' && t.id.startsWith('claim:')).map((t) => t.id),
  );
  const out: PendingClaim[] = [];
  for (const e of data.expenses) {
    if (e.deleted || !isClaimExpense(e) || !(e.amount > 0)) continue;
    if (settled.has(claimTransferId(e.id))) continue;
    const due = claimDueOf(data, e);
    out.push({
      expense: e,
      payer: payerOf(e),
      amount: e.amount,
      accountId: e.accountId,
      claimAccountId: e.claimAccountId ?? null,
      due,
      dueNow: due <= today,
    });
  }
  return out.sort((a, b) =>
    a.due !== b.due ? (a.due < b.due ? -1 : 1) : a.expense.date !== b.expense.date ? (a.expense.date < b.expense.date ? -1 : 1) : 0,
  );
}

/** 홈 · 이벤트 화면의 '돌려받을 돈' 요약 */
export function summarizeClaims(data: LedgerData, today: ISODate): ClaimSummary {
  const pending = pendingClaims(data, today);
  const byName = new Map<string, Won>();
  for (const c of pending) byName.set(c.payer, (byName.get(c.payer) ?? 0) + c.amount);
  const byPayer = [...byName.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    total: pending.reduce((s, c) => s + c.amount, 0),
    byPayer,
    nextDue: pending[0]?.due ?? null,
    dueNow: pending.filter((c) => c.dueNow),
    pending,
  };
}

/** 통장에서 아직 돌려주지 않은 청구 합 (except: 계산에서 뺄 지출 id) */
export function pendingClaimsTotal(data: LedgerData, accountId: Id, today: ISODate, except?: Id): Won {
  return pendingClaims(data, today).reduce(
    (s, c) => (c.accountId === accountId && c.expense.id !== except ? s + c.amount : s),
    0,
  );
}

/**
 * 새 청구의 정산일 (PLAN 4-9).
 * - 이벤트통장 · 저수지통장 지출: 그 통장 잔액 − 다른 청구가 금액을 감당하면 오늘, 아니면 다음 월급날(오늘 뒤)
 *   (expenseId 를 주면 그 지출은 잔액 · 다른 청구 어느 쪽에도 세지 않는다 — 보통 지출을 청구로 바꿀 때도 맞게)
 * - 그 밖의 통장(고정지출 · 생활비): 늘 다음 월급날(오늘 포함)
 */
export function computeClaimDue(
  data: LedgerData,
  input: { accountId: Id; amount: Won; expenseId?: Id },
  today: ISODate,
): ISODate {
  const account = data.accounts.find((a) => a.id === input.accountId);
  if (account?.role === 'event' || account?.role === 'reservoir') {
    // 고치는 지출은 없는 것으로 보고 센다: 보통 지출을 청구로 바꾸면 그 지출은 더 이상 이 통장 잔액에서 빠지지 않는다
    const base = input.expenseId ? { ...data, expenses: data.expenses.filter((e) => e.id !== input.expenseId) } : data;
    const free = accountBalance(base, account.id, today) - pendingClaimsTotal(base, account.id, today);
    if (free >= input.amount) return today;
    return nextSettleDate(data, today, false);
  }
  return nextSettleDate(data, today, true);
}

/** 낸 사람 이름으로 돌려받을 통장 찾기: 그 사람이 주인인 수입통장 → 용돈 · 기타 통장. 없으면 null */
export function claimAccountFor(data: LedgerData, payer: string): Id | null {
  const name = payer.trim();
  if (!name) return null;
  const owned = activeAccountsSorted(data).filter((a) => (a.ownerName ?? '').trim() === name);
  const rank = (role: string) => (role === 'income' ? 0 : role === 'allowance' ? 1 : role === 'other' ? 2 : 3);
  owned.sort((a, b) => rank(a.role) - rank(b.role));
  const best = owned[0];
  return best && rank(best.role) < 3 ? best.id : null;
}

/** 낸 사람으로 고를 수 있는 이름: 통장 주인(수입통장 먼저) → 멤버 표시 이름. 겹치면 한 번 */
export function claimPayers(data: LedgerData): string[] {
  const out: string[] = [];
  const add = (n: string | null | undefined) => {
    const v = (n ?? '').trim();
    if (v && !out.includes(v)) out.push(v);
  };
  const accounts = activeAccountsSorted(data);
  for (const a of accounts) if (a.role === 'income') add(a.ownerName);
  for (const a of accounts) if (a.role !== 'income') add(a.ownerName);
  for (const m of data.members) add(m.displayName);
  return out;
}

/** 청구할 수 있는 통장인지: 이벤트통장 · 고정지출통장 · 저수지통장(생활비 포함) · 저수지통장 */
export function canClaimOnAccount(data: LedgerData, accountId: Id): boolean {
  const role = data.accounts.find((a) => a.id === accountId)?.role;
  return role === 'event' || role === 'fixed' || role === 'reservoir';
}

export { withSubject } from './korean';

/**
 * 기록 직후 · 목록에 보여 줄 한 줄.
 * 정산일이 오늘(또는 지남): "가람에게 50,000원, 오늘 돌려주세요" / 아니면 "가람이 11월 21일에 돌려받아요"
 */
export function claimMessage(claim: { payer: string; amount: Won; due: ISODate }, today: ISODate): string {
  if (claim.due <= today) return `${claim.payer}에게 ${formatWon(claim.amount)}, 오늘 돌려주세요`;
  return `${withSubject(claim.payer)} ${formatDateKo(claim.due, false)}에 ${formatWon(claim.amount)} 돌려받아요`;
}

/** 지출 하나의 청구 안내 (청구가 아니면 null) */
export function claimMessageFor(data: LedgerData, e: Expense, today: ISODate): string | null {
  if (!isClaimExpense(e)) return null;
  if (isClaimSettled(data, e.id)) return `${payerOf(e)}에게 돌려줬어요`;
  return claimMessage({ payer: payerOf(e), amount: e.amount, due: claimDueOf(data, e) }, today);
}
