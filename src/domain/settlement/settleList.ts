/**
 * 정산 화면 (/plan/settle) 한 목록 — 이벤트통장 기록(eventRecordList)과 아직 줄 돈 · 지급한 청구를 달마다 한 목록으로 (PLAN 4-9).
 * - 줄마다 정산 상태: 줄 돈(claimPending) · 지급함(claimPaid) · 저수지에서 빌려 줌(borrowed) · 그냥 지출(plain)
 * - 이벤트통장 기록에 없는 청구(생활비 통장 청구 · 저수지의 이벤트 아닌 청구)도 줄 돈 · 지급함이면 같은 목록에 넣는다
 * - 쓴 날(지출 날짜)의 달에 넣고, 최근 달 먼저 · 달 안에서는 최근 것 먼저
 * - 사람 필터는 지출을 실제로 쓴 사람(expenseSpender)으로 거른다
 */
import { monthlyRepayment } from '../compromise';
import { addMonths, monthOf } from '../dates';
import { eventRecordList, eventRecordStatus, liveTransferIds, type EventRecordStatus } from '../eventRecords';
import { ledgerPeople } from '../people';
import { expenseSpender } from '../spender';
import { isCarriedOverClaim, type Settlement } from './claimsAllocation';
import { paidClaims, type LoanEntry, type PaidClaim } from './loans';
import { settleRoster, type SettleItem } from './summary';
import type { Expense, Id, ISODate, LedgerData, Won, YearMonth } from '../types';

export interface SettleRow {
  /** 가계부에 저장된 지출 그대로 */
  expense: Expense;
  month: YearMonth;
  amount: Won;
  status: EventRecordStatus;
  /** 아직 줄 돈이면 정산 화면 항목 (고를 수 있다). 그 밖에는 null */
  item: SettleItem | null;
  /** 지급한 청구면 그 기록 (빌려 지급한 것 포함) */
  paid: PaidClaim | null;
  /** 저수지에서 빌린 기록 (loan:claim:<id> · loan:<id>) */
  loan: LoanEntry | null;
}

export interface SettleMonth {
  month: YearMonth;
  /** 그달 기록 합 */
  total: Won;
  /** 그달 줄 돈 합 · 건수 */
  pendingTotal: Won;
  pendingCount: number;
  /** 최근 것 먼저 */
  rows: SettleRow[];
}

const recent = (a: SettleRow, b: SettleRow) =>
  a.expense.date !== b.expense.date
    ? a.expense.date < b.expense.date
      ? 1
      : -1
    : a.expense.id < b.expense.id
      ? 1
      : a.expense.id > b.expense.id
        ? -1
        : 0;

function toMonths(rows: SettleRow[]): SettleMonth[] {
  const byMonth = new Map<YearMonth, SettleRow[]>();
  for (const r of rows) byMonth.set(r.month, [...(byMonth.get(r.month) ?? []), r]);
  return [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([month, list]) => {
      const pending = list.filter((r) => r.item !== null);
      return {
        month,
        total: list.reduce((t, r) => t + r.amount, 0),
        pendingTotal: pending.reduce((t, r) => t + r.amount, 0),
        pendingCount: pending.length,
        rows: [...list].sort(recent),
      };
    });
}

/**
 * 정산 화면 목록: 이벤트통장 기록(저수지 이벤트 청구 포함) + 그 밖의 줄 돈 · 지급한 청구를 달마다 (최근 달 먼저).
 * 줄 돈은 정산 화면 항목(settleRoster)과 같은 것만 고를 수 있다 (금액 0 청구는 그냥 지출로 본다)
 */
export function settleList(data: LedgerData, s: Settlement): SettleMonth[] {
  const items = new Map<Id, SettleItem>();
  for (const p of settleRoster(s)) for (const i of p.items) items.set(i.claim.expense.id, i);
  const paid = new Map(paidClaims(data).map((p) => [p.expense.id, p]));
  const loans = new Map(s.loan.entries.map((e) => [e.expenseId, e]));
  const live = liveTransferIds(data);
  const rows: SettleRow[] = [];
  const seen = new Set<Id>();
  const push = (expense: Expense, amount: Won, status: EventRecordStatus) => {
    seen.add(expense.id);
    const item = items.get(expense.id) ?? null;
    rows.push({
      expense,
      month: monthOf(expense.date),
      amount,
      status: status === 'claimPending' && !item ? 'plain' : status,
      item,
      paid: paid.get(expense.id) ?? null,
      loan: loans.get(expense.id) ?? null,
    });
  };
  if (s.eventAccountId) {
    for (const m of eventRecordList(data, s.eventAccountId)) for (const r of m.items) push(r.expense, r.record.amount, r.status);
  }
  // 이벤트통장 기록에 없는 줄 돈 (생활비 통장 청구 · 저수지에서 지급할 청구)
  for (const [id, item] of items) {
    if (!seen.has(id)) push(item.claim.expense, item.claim.amount, 'claimPending');
  }
  // 이벤트통장 기록에 없는 지급한 청구
  for (const [id, p] of paid) {
    if (!seen.has(id) && p.expense.date) push(p.expense, p.expense.amount, eventRecordStatus(data, p.expense, live));
  }
  return toMonths(rows);
}

/** 사람 필터: 지출을 실제로 쓴 사람의 키(expenseSpender, 사람이면 멤버 이메일 소문자)가 같은 줄만. 합계도 다시 센다 */
export function filterSettleList(data: LedgerData, months: SettleMonth[], personKey: string | null): SettleMonth[] {
  if (!personKey) return months;
  const people = ledgerPeople(data);
  const key = personKey.trim().toLowerCase();
  return toMonths(months.flatMap((m) => m.rows).filter((r) => expenseSpender(data, r.expense, people).key === key));
}

/** 줄 돈만: 고를 수 있는 줄만 남기고, 줄 돈이 없는 달은 뺀다 (합계는 그달 모든 기록 그대로) */
export function pendingOnly(months: SettleMonth[]): SettleMonth[] {
  return months.filter((m) => m.pendingCount > 0).map((m) => ({ ...m, rows: m.rows.filter((r) => r.item !== null) }));
}

export interface SettlePersonDue {
  name: string;
  /** 아직 줄 돈 합 (정산일 전 청구 포함) */
  amount: Won;
  /** 그중 지난달부터 못 준 돈 */
  overdue: Won;
  /** 못 준 돈이 처음 생긴 달 (가장 이른 돌려줄 날의 달). 없으면 null */
  overdueMonth: YearMonth | null;
}

/** 사람별 줄 돈 (정산 화면 오른쪽 '사람별'): 사람 순서는 settleRoster 그대로 */
export function settlePeopleDue(s: Settlement): SettlePersonDue[] {
  return settleRoster(s).map((p) => {
    const old = p.items.filter((i) => isCarriedOverClaim(s, i.claim));
    const first = old.reduce<ISODate | null>((m, i) => (m === null || i.claim.due < m ? i.claim.due : m), null);
    return {
      name: p.name,
      amount: p.amount,
      overdue: old.reduce((t, i) => t + i.claim.amount, 0),
      overdueMonth: first ? monthOf(first) : null,
    };
  });
}

/**
 * 저수지 빚을 매달 같은 금액으로 갚으면: 한 달 갚을 돈 = 빚 ÷ 개월(천 원 단위 올림, 추천 타협안과 같은 셈),
 * 다음 달부터 갚아 끝나는 달. 빚이 없으면 null
 */
export function loanPayoff(balance: Won, months: number, thisMonth: YearMonth): { monthly: Won; endMonth: YearMonth } | null {
  if (!(balance > 0) || !(months > 0)) return null;
  const monthly = monthlyRepayment(balance, months);
  const count = Math.ceil(balance / monthly);
  return { monthly, endMonth: addMonths(thisMonth, count) };
}
