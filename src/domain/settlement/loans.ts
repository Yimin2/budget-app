/**
 * 저수지에서 빌린 돈 (이벤트통장이 저수지에 갚을 돈) — 이체 id 규칙 · 갚을 돈 · 갚을 돈으로 바꿀 지출 · 지출을 고칠 때 따라 고칠 이체 ·
 * 지급한 기록 · 저수지 기록 고치기. 규칙 전체는 settlement/index.ts 머리말
 */
import { isCountedTransfer, isClaimExpense } from '../balances';
import { claimLoanTransferId, claimTransferId, isReservoirEventExpense } from '../claims';
import { monthOf } from '../dates';
import { firstAccountByRole } from '../internal';
import { sumOf } from './internal';
import type { Expense, Id, ISODate, LedgerData, Transfer, Won, YearMonth } from '../types';

export const LOAN_PREFIX = 'loan:';
export const LOAN_REPAY_PREFIX = 'loanpay:';
/** 갚기 제안이 살펴보는 예측 달 수 (이번 달 + 3개월) */
export const REPAY_SAFE_MONTHS = 4;

/** [이벤트통장이 갚을 돈으로 바꾸기]한 지출의 빌린 이체 id */
export function expenseLoanTransferId(expenseId: Id): string {
  return `${LOAN_PREFIX}${expenseId}`;
}
/** 그달 저수지에 갚은 이체 id */
export function loanRepayId(month: YearMonth): string {
  return `${LOAN_REPAY_PREFIX}${month}`;
}

export function isLoanTransferId(id: string): boolean {
  return id.startsWith(LOAN_PREFIX);
}
export function isLoanRepayId(id: string): boolean {
  return id.startsWith(LOAN_REPAY_PREFIX);
}

export interface LoanEntry {
  transfer: Transfer;
  /** claim = 빌려서 청구를 돌려줌, expense = 저수지에서 쓴 이벤트 지출을 갚을 돈으로 바꿈 */
  kind: 'claim' | 'expense';
  expenseId: Id;
}

export interface LoanStatus {
  /** 빌린 돈 합 */
  borrowed: Won;
  /** 갚은 돈 합 */
  repaid: Won;
  /** 저수지에 갚을 돈 (0 아래로는 안 내려감) */
  balance: Won;
  /** 빌린 기록 (최근 순) */
  entries: LoanEntry[];
  /** 갚은 기록 (최근 순) */
  repayments: Transfer[];
  /** 이번 달 갚은 이체 (없으면 null) */
  repaidThisMonth: Transfer | null;
}

/** 저수지에서 빌린 돈 (이벤트통장이 저수지에 갚을 돈) */
export function loanStatus(data: LedgerData, today: ISODate): LoanStatus {
  const entries: LoanEntry[] = [];
  const repayments: Transfer[] = [];
  for (const t of data.transfers) {
    if (!isCountedTransfer(data, t)) continue;
    if (isLoanRepayId(t.id)) repayments.push(t);
    else if (isLoanTransferId(t.id)) {
      const rest = t.id.slice(LOAN_PREFIX.length);
      const kind = rest.startsWith('claim:') ? 'claim' : 'expense';
      entries.push({ transfer: t, kind, expenseId: kind === 'claim' ? rest.slice('claim:'.length) : rest });
    }
  }
  const recent = (a: Transfer, b: Transfer) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  entries.sort((a, b) => recent(a.transfer, b.transfer));
  repayments.sort(recent);
  const borrowed = entries.reduce((s, e) => s + e.transfer.amount, 0);
  const repaid = sumOf(repayments);
  const thisMonthId = loanRepayId(monthOf(today));
  return {
    borrowed,
    repaid,
    balance: Math.max(0, borrowed - repaid),
    entries,
    repayments,
    repaidThisMonth: repayments.find((t) => t.id === thisMonthId) ?? null,
  };
}

/**
 * 이벤트통장이 갚을 돈으로 바꿀 수 있는 지출: 저수지통장에서 나간 보통 지출(청구 아님) 중
 * 이벤트 카테고리(기본 통장이 이벤트통장) 이거나 일정 · 여행에 묶인 것. 오래된 순
 */
export function loanCandidates(data: LedgerData): Expense[] {
  const reservoirIds = new Set(data.accounts.filter((a) => !a.deleted && a.role === 'reservoir').map((a) => a.id));
  if (reservoirIds.size === 0 || !firstAccountByRole(data, 'event')) return [];
  const eventCats = new Set(data.categories.filter((c) => !c.deleted && c.defaultAccountRole === 'event').map((c) => c.id));
  return data.expenses
    .filter(
      (e) =>
        !e.deleted &&
        e.amount > 0 &&
        reservoirIds.has(e.accountId) &&
        !(typeof e.paidBy === 'string' && e.paidBy.trim() !== '') &&
        (Boolean(e.eventId) || Boolean(e.tripId) || (e.categoryId !== null && eventCats.has(e.categoryId))),
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * 지출을 고칠 때 따라 고칠 빌린 이체 (next.updatedAt 으로).
 * - loan:<지출id>: 지출을 지우거나 이벤트통장 밖으로 옮기면 지우고, 금액 · 날짜가 바뀌면 같이 고친다
 * - loan:claim:<지출id>: 지출을 지우면 지우고, 금액이 바뀌면 같이 고친다
 */
export function followLoanTransfers(data: LedgerData, next: Expense): Transfer[] {
  const out: Transfer[] = [];
  const live = (id: string) => data.transfers.find((t) => t.id === id && !t.deleted);
  const own = live(expenseLoanTransferId(next.id));
  if (own) {
    if (next.deleted || next.accountId !== own.toAccountId) out.push({ ...own, deleted: true, updatedAt: next.updatedAt });
    else if (own.amount !== next.amount || own.date !== next.date) {
      out.push({ ...own, amount: next.amount, date: next.date, updatedAt: next.updatedAt });
    }
  }
  const viaClaim = live(claimLoanTransferId(next.id));
  if (viaClaim) {
    if (next.deleted) out.push({ ...viaClaim, deleted: true, updatedAt: next.updatedAt });
    else if (viaClaim.amount !== next.amount) out.push({ ...viaClaim, amount: next.amount, updatedAt: next.updatedAt });
  }
  return out;
}

/**
 * 저수지에서 이미 돌려준 이벤트 청구 (가져온 기록 등): 저수지통장 이벤트 지출이고, 돌려준 이체 claim:<지출id> 가 저수지에서 나갔고,
 * 아직 빌린 이체 loan:claim:<지출id> 가 없는 것. 오래된 순.
 * 갚을 돈으로 바꾸면 지출을 이벤트통장으로, 돌려준 이체를 이벤트통장에서 나간 것으로 고치고 빌린 이체를 남긴다 (잔액은 그대로)
 */
export function settledReservoirEventClaims(data: LedgerData): Expense[] {
  const live = new Map(data.transfers.filter((t) => !t.deleted && t.status === 'done').map((t) => [t.id, t]));
  return data.expenses
    .filter((e) => {
      if (e.deleted || !isClaimExpense(e) || !isReservoirEventExpense(data, e)) return false;
      const settle = live.get(claimTransferId(e.id));
      return Boolean(settle && settle.fromAccountId === e.accountId && !live.has(claimLoanTransferId(e.id)));
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
}

/* ───────── 지급한 기록 · 저수지 기록 고치기 (/plan/settle#paid · #loan) ───────── */

/**
 * 저수지통장 지출을 이벤트통장으로 옮겨 빌려 지급(또는 갚을 돈으로 바꾸기)했다는 표시. 빌린 이체 loan:claim:<지출id> 의 메모에 넣는다.
 * [지급 취소] · [빌린 기록만 취소]가 지출을 저수지로 되돌릴지 이 표시로 정한다 (이벤트통장 청구를 빌려 지급한 것은 옮기지 않았다)
 */
export const RESERVOIR_MOVED_MEMO = '저수지 돈으로 낸 지출';

/** 빌린 이체 메모: '저수지에서 빌림 · (저수지 돈으로 낸 지출 · )나머지' */
export function claimLoanMemo(rest: string, moved: boolean): string {
  return `저수지에서 빌림 · ${moved ? `${RESERVOIR_MOVED_MEMO} · ` : ''}${rest}`;
}

/**
 * 빌려 지급할 때 지출을 저수지에서 이벤트통장으로 옮겼으면 되돌릴 저수지통장 id, 아니면 null.
 * 빌린 이체가 살아 있고, 메모에 옮긴 표시가 있고, 보낸 통장이 저수지이고, 지출이 지금 그 통장에 있지 않을 때
 */
export function claimLoanMovedFrom(data: LedgerData, expenseId: Id): Id | null {
  const loan = data.transfers.find((t) => t.id === claimLoanTransferId(expenseId) && !t.deleted);
  const e = data.expenses.find((x) => x.id === expenseId);
  if (!loan || !e || !loan.fromAccountId || !loan.memo.includes(RESERVOIR_MOVED_MEMO)) return null;
  const from = data.accounts.find((a) => a.id === loan.fromAccountId);
  if (!from || from.role !== 'reservoir' || e.accountId === from.id) return null;
  return from.id;
}

export interface PaidClaim {
  expense: Expense;
  /** 돌려준 이체 claim:<지출id> */
  transfer: Transfer;
  payer: string;
  amount: Won;
  /** 지급한 날 (돌려준 이체 날짜) */
  date: ISODate;
  /** 저수지에서 빌려 지급했는지 (빌린 이체 loan:claim:<지출id> 가 살아 있으면) */
  borrowed: boolean;
}

/** 지급한 청구 (지운 지출 제외), 최근 순: 지급한 날 → 만든 시각 → id */
export function paidClaims(data: LedgerData): PaidClaim[] {
  const live = new Map(data.transfers.filter((t) => !t.deleted && t.status === 'done').map((t) => [t.id, t]));
  const out: PaidClaim[] = [];
  for (const e of data.expenses) {
    if (e.deleted || !isClaimExpense(e)) continue;
    const t = live.get(claimTransferId(e.id));
    if (!t) continue;
    out.push({
      expense: e,
      transfer: t,
      payer: (e.paidBy ?? '').trim(),
      amount: t.amount,
      date: t.date,
      borrowed: live.has(claimLoanTransferId(e.id)),
    });
  }
  return out.sort((a, b) =>
    a.date !== b.date
      ? a.date < b.date ? 1 : -1
      : a.transfer.createdAt !== b.transfer.createdAt
        ? a.transfer.createdAt < b.transfer.createdAt ? 1 : -1
        : a.expense.id < b.expense.id ? 1 : a.expense.id > b.expense.id ? -1 : 0,
  );
}

/** 정산 화면의 저수지 기록 한 줄: 빌린 기록(청구 지급 · 지출 바꾸기) 또는 갚은 기록 */
export type LoanRecord =
  | { kind: 'claim' | 'expense'; transfer: Transfer; expenseId: Id }
  | { kind: 'repay'; transfer: Transfer; expenseId: null };

/** 빌리고 갚은 기록을 한 목록으로 (최근 순) */
export function loanRecords(loan: LoanStatus): LoanRecord[] {
  const list: LoanRecord[] = [
    ...loan.entries.map((e) => ({ kind: e.kind, transfer: e.transfer, expenseId: e.expenseId })),
    ...loan.repayments.map((t) => ({ kind: 'repay' as const, transfer: t, expenseId: null })),
  ];
  return list.sort((a, b) =>
    a.transfer.date !== b.transfer.date
      ? a.transfer.date < b.transfer.date ? 1 : -1
      : a.transfer.createdAt < b.transfer.createdAt ? 1 : a.transfer.createdAt > b.transfer.createdAt ? -1 : 0,
  );
}

/**
 * 내역 → 이체에서 이 이체를 고칠 곳: 돌려준 이체(claim:)는 정산 화면 '지급한 기록', 빌리고 갚은 이체(loan: · loanpay:)는 '저수지'.
 * 그 밖의 이체는 null
 */
export function settleEditHref(transferId: string): string | null {
  if (transferId.startsWith('claim:')) return '/plan/settle#paid';
  if (isLoanTransferId(transferId) || isLoanRepayId(transferId)) return '/plan/settle#loan';
  return null;
}
