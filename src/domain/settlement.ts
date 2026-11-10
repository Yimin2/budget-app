/**
 * 이번 달 정산 · 저수지에서 빌린 돈 — PLAN 4-9 (정산) · 4-2 (예측).
 *
 * 정산 (매달 정산일 = 이벤트통장 적립일):
 * - 지급할 수 있는 돈 = max(0, 정산일의 이벤트통장 잔액(그날 들어올 적립 포함) − 이번 달 아직 안 쓴 일정 · 여행 · 할부)
 *   (정산일이 지났으면 오늘 기준. 아직 안 돌려준 청구는 잔액에 없으니 따로 빼지 않는다)
 * - 이번 정산에 들어가는 청구 = 정산일(오늘이 더 늦으면 오늘)까지 돌려줄 날이 된 아직 안 돌려준 청구
 * - 이벤트통장 청구는 지출 날짜가 오래된 것부터 지급할 수 있는 돈 안에서 나눈다. 청구는 쪼개지 않는다:
 *   다음 청구가 안 들어가면 건너뛰고 그 뒤의 더 작은 청구를 넣어 본다 (first-fit). 안 들어간 청구는 '다음 달로 넘어가요'
 * - 고정지출통장(생활비) 청구는 그 통장에서 돌려주므로 금액 한도 없이 이번 달 지급에 들어간다
 * - 저수지통장 청구(저수지에 쓸 돈을 개인 돈으로 낸 것)는 '저수지에서 돌려받을 돈'으로 따로 묶는다. 저수지에서 돌려주고 빌린 돈이 아니다
 * - 넘어가는 청구의 지급 예상 달 = 그 청구들을 뺀 예측(평소 쓰는 돈 포함)에서, 오래된 순 누적 금액을 그달부터 12개월 끝까지
 *   예상 잔액이 감당하는 첫 달
 *
 * 저수지에서 빌린 돈 (이벤트통장이 저수지에 갚을 돈) — 이체 탭의 행으로만 적는다 (새 칸 · 새 탭 없음):
 * - loan:claim:<지출id>  저수지 → 이벤트통장. [저수지에서 빌려 지급]: 이 이체 + 돌려준 이체 claim:<지출id>(이벤트통장 → 낸 사람)
 *   → 저수지 −금액, 낸 사람 +금액, 이벤트통장 그대로
 * - loan:<지출id>        저수지 → 이벤트통장. [이벤트통장이 갚을 돈으로 바꾸기]: 저수지에서 나간 이벤트 지출의 통장을 이벤트통장으로
 *   옮기고 이 이체를 남긴다 → 어느 통장 잔액도 바뀌지 않고, 그 지출은 이벤트통장 지출(평소 쓰는 돈 기록 포함)이 된다
 * - loanpay:<YYYY-MM>    이벤트통장 → 저수지. [갚았어요] (한 달에 한 번, 다시 눌러도 하나)
 * - 갚을 돈 = loan: 이체 합 − loanpay: 이체 합 (지우지 않은 완료 이체). 자동으로 옮기지 않는다
 * - 갚기 제안 = 이번 달 넘어가는 청구가 없을 때 min(갚을 돈, 지급하고 남는 돈, 이번 달부터 3개월 뒤까지 예상 잔액의 최솟값),
 *   천 원 단위 내림 (갚을 돈보다 크면 갚을 돈 전부)
 */
import { accountBalance, isCountedTransfer } from './balances';
import { claimLoanTransferId, pendingClaims, settleDayOf } from './claims';
import { dateInMonth, monthOf } from './dates';
import { projectEventAccount } from './events';
import { autoTransferId } from './ids';
import { activeIncomePlans, incomePlanOccurrenceDate, incomeRecordId, isRemainderRule, projectRemainders, ruleAmountFor } from './income';
import { firstAccountByRole } from './internal';
import { ruleOccurrenceDate } from './recurring';
import type { EventProjection, Expense, Id, ISODate, LedgerData, PendingClaim, Transfer, Won, YearMonth } from './types';

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

/** 청구를 돌려주는 통장의 종류 */
export type ClaimSource = 'event' | 'reservoir' | 'other';

export function claimSource(data: LedgerData, accountId: Id): ClaimSource {
  const role = data.accounts.find((a) => a.id === accountId)?.role;
  return role === 'event' ? 'event' : role === 'reservoir' ? 'reservoir' : 'other';
}

export interface PersonClaims {
  name: string;
  amount: Won;
  /** 오래된 순 */
  claims: PendingClaim[];
}

/** 사람마다 묶기 (처음 나온 순서 = 오래된 사람 먼저) */
export function groupByPerson(claims: PendingClaim[]): PersonClaims[] {
  const out: PersonClaims[] = [];
  for (const c of claims) {
    const g = out.find((x) => x.name === c.payer);
    if (g) {
      g.amount += c.amount;
      g.claims.push(c);
    } else out.push({ name: c.payer, amount: c.amount, claims: [c] });
  }
  return out;
}

const sumOf = (list: { amount: Won }[]) => list.reduce((s, x) => s + x.amount, 0);

/** 오래된 순: 지출 날짜 → 돌려줄 날 → id */
function oldestFirst(a: PendingClaim, b: PendingClaim): number {
  const ad = a.expense.date;
  const bd = b.expense.date;
  if (ad !== bd) return ad < bd ? -1 : 1;
  if (a.due !== b.due) return a.due < b.due ? -1 : 1;
  return a.expense.id < b.expense.id ? -1 : a.expense.id > b.expense.id ? 1 : 0;
}

/**
 * 오래된 순 first-fit 나누기. 청구는 쪼개지 않는다: 안 들어가는 청구는 건너뛰고 뒤의 더 작은 청구를 넣어 본다
 */
export function allocateClaims(claims: PendingClaim[], payable: Won): { paid: PendingClaim[]; carried: PendingClaim[]; left: Won } {
  let left = Math.max(0, payable);
  const paid: PendingClaim[] = [];
  const carried: PendingClaim[] = [];
  for (const c of [...claims].sort(oldestFirst)) {
    if (c.amount <= left) {
      paid.push(c);
      left -= c.amount;
    } else carried.push(c);
  }
  return { paid, carried, left };
}

/** 이번 달 정산일 (정산일이 말일보다 크면 말일) */
export function settleDateOf(data: LedgerData, today: ISODate): ISODate {
  const m = monthOf(today);
  return dateInMonth(m, settleDayOf(data, m));
}

/**
 * asOf(이번 달 안) 날의 통장 잔액 + 그날까지 들어오거나 나갈, 아직 기록되지 않은 이번 달 매달 배분 · 수입 계획 · 예정 이체
 */
export function balanceWithScheduled(data: LedgerData, accountId: Id, today: ISODate, asOf: ISODate): Won {
  const month = monthOf(today);
  let balance = accountBalance(data, accountId, asOf);
  const transferIds = new Set(data.transfers.map((t) => t.id));
  const rules = data.rules.filter((r) => !r.deleted && (r.toAccountId === accountId || r.fromAccountId === accountId));
  const remainders = rules.some(isRemainderRule) ? projectRemainders(data, today, 1) : new Map<string, Won>();
  for (const r of rules) {
    const date = ruleOccurrenceDate(data, r, month);
    if (date === null || date > asOf || transferIds.has(autoTransferId(r.id, month))) continue;
    const sign = (r.toAccountId === accountId ? 1 : 0) - (r.fromAccountId === accountId ? 1 : 0);
    balance += sign * ruleAmountFor(r, month, remainders);
  }
  for (const p of activeIncomePlans(data, month, accountId)) {
    const date = incomePlanOccurrenceDate(data, p, month);
    if (date === null || date > asOf || transferIds.has(incomeRecordId(p.id, month))) continue;
    balance += p.amount;
  }
  for (const t of data.transfers) {
    if (t.deleted || t.status !== 'planned' || monthOf(t.date) !== month || t.date > asOf) continue;
    if (t.toAccountId === accountId) balance += t.amount;
    if (t.fromAccountId === accountId) balance -= t.amount;
  }
  return balance;
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

export interface CarryPerson extends PersonClaims {
  /** 지급 예상 달 (12개월 안에 어려우면 null) */
  estimate: YearMonth | null;
}

export interface UpcomingPerson extends PersonClaims {
  /** 가장 이른 돌려줄 날 */
  due: ISODate;
}

export interface Settlement {
  /** 이번 달 정산일 */
  date: ISODate;
  /** 정산 기준일 = 정산일과 오늘 중 늦은 날 */
  asOf: ISODate;
  eventAccountId: Id | null;
  reservoirAccountId: Id | null;
  /** 정산 기준일의 이벤트통장 잔액 (그날까지 들어올 적립 포함) */
  balance: Won;
  /** 이번 달 아직 안 쓴 일정 · 여행 · 할부 */
  reserved: Won;
  /** 지급할 수 있는 돈 = max(0, balance − reserved) */
  payable: Won;
  /** 이번 달 지급 (사람별) — 이벤트통장 몫(한도 안) + 고정지출통장 몫 */
  pay: PersonClaims[];
  payTotal: Won;
  /** 이벤트통장 몫으로 이번 달 지급하는 합 */
  eventPayTotal: Won;
  /** 다음 달로 넘어가요 (이벤트통장 몫 중 안 들어간 것) */
  carry: CarryPerson[];
  carryTotal: Won;
  /** 저수지에서 돌려받을 돈 (저수지통장 청구, 돌려줄 날 상관없이 모두) */
  reservoir: PersonClaims[];
  reservoirTotal: Won;
  /** 아직 돌려줄 날이 안 된 이벤트 · 고정지출통장 청구 */
  upcoming: UpcomingPerson[];
  /** 지급하고 남는 돈 = payable − eventPayTotal */
  spare: Won;
  loan: LoanStatus;
  /** 저수지에 갚기 제안 (없으면 null) */
  repay: { amount: Won; month: YearMonth } | null;
  /** 홈에 보여 줄 만큼 지금 할 일이 있는지 (오늘까지 돌려줄 날이 된 청구가 있으면) */
  dueNow: boolean;
}

/** 넘어가는 청구의 지급 예상 달 (오래된 순 누적, 그 청구들을 뺀 예측 기준). 청구 id → 달 */
function estimateCarry(data: LedgerData, today: ISODate, carried: PendingClaim[]): Map<Id, YearMonth | null> {
  const out = new Map<Id, YearMonth | null>();
  if (carried.length === 0) return out;
  const ids = new Set(carried.map((c) => c.expense.id));
  // 넘어가는 청구는 예측 기간 밖으로 미뤄 그 돈을 빼지 않은 예측을 만든다 (평소 쓰는 돈 기록에는 그대로 남는다)
  const without: LedgerData = {
    ...data,
    expenses: data.expenses.map((e) => (ids.has(e.id) ? { ...e, claimDue: '9999-12-31' } : e)),
  };
  const months = projectEventAccount(without, today).months;
  // k 달부터 끝까지 예상 잔액의 최솟값
  const tailMin: Won[] = new Array<Won>(months.length);
  for (let i = months.length - 1; i >= 0; i--) {
    const v = months[i]!.endBalance;
    tailMin[i] = i === months.length - 1 ? v : Math.min(v, tailMin[i + 1]!);
  }
  let cum = 0;
  for (const c of [...carried].sort(oldestFirst)) {
    cum += c.amount;
    let found: YearMonth | null = null;
    for (let k = 1; k < months.length; k++) {
      if (tailMin[k]! >= cum) {
        found = months[k]!.month;
        break;
      }
    }
    out.set(c.expense.id, found);
  }
  return out;
}

/** 이번 달 정산 */
export function computeSettlement(data: LedgerData, today: ISODate, projection?: EventProjection): Settlement {
  const date = settleDateOf(data, today);
  const asOf = date > today ? date : today;
  const eventAcc = firstAccountByRole(data, 'event');
  const reservoirAcc = firstAccountByRole(data, 'reservoir');
  const proj = projection ?? projectEventAccount(data, today);
  const m0 = proj.months[0];
  const reserved = m0 ? m0.planned + (m0.trips ?? 0) + (m0.installments ?? 0) : 0;
  const balance = eventAcc ? balanceWithScheduled(data, eventAcc.id, today, asOf) : 0;
  const payable = Math.max(0, balance - reserved);

  const pending = pendingClaims(data, today);
  const reservoirClaims: PendingClaim[] = [];
  const eventDue: PendingClaim[] = [];
  const otherDue: PendingClaim[] = [];
  const later: PendingClaim[] = [];
  for (const c of pending) {
    const src = claimSource(data, c.accountId);
    if (src === 'reservoir') reservoirClaims.push(c);
    else if (c.due > asOf) later.push(c);
    else if (src === 'event') eventDue.push(c);
    else otherDue.push(c);
  }
  const alloc = allocateClaims(eventDue, payable);
  const eventPayTotal = sumOf(alloc.paid);
  const pay = groupByPerson([...alloc.paid, ...otherDue].sort(oldestFirst));
  const estimates = estimateCarry(data, today, alloc.carried);
  const carry: CarryPerson[] = groupByPerson(alloc.carried).map((g) => {
    let estimate: YearMonth | null = null;
    for (const c of g.claims) {
      const e = estimates.get(c.expense.id) ?? null;
      if (e === null) {
        estimate = null;
        break;
      }
      if (estimate === null || e > estimate) estimate = e;
    }
    return { ...g, estimate };
  });
  const upcoming: UpcomingPerson[] = groupByPerson([...later].sort(oldestFirst)).map((g) => ({
    ...g,
    due: g.claims.reduce((m, c) => (c.due < m ? c.due : m), g.claims[0]!.due),
  }));
  const spare = Math.max(0, payable - eventPayTotal);
  const loan = loanStatus(data, today);

  let repay: Settlement['repay'] = null;
  if (eventAcc && reservoirAcc && loan.balance > 0 && alloc.carried.length === 0 && !loan.repaidThisMonth) {
    const safe = proj.months.slice(0, REPAY_SAFE_MONTHS).reduce((m, x) => Math.min(m, x.endBalance), Infinity);
    const cap = Math.min(loan.balance, spare, Number.isFinite(safe) ? safe : 0);
    const amount = cap >= loan.balance ? loan.balance : Math.floor(cap / 1000) * 1000;
    if (amount > 0) repay = { amount, month: monthOf(today) };
  }

  const roundClaims = [...eventDue, ...otherDue];
  const dueNow =
    (roundClaims.length > 0 && (today >= date || roundClaims.some((c) => c.due <= today))) ||
    reservoirClaims.some((c) => c.due <= today);

  return {
    date,
    asOf,
    eventAccountId: eventAcc?.id ?? null,
    reservoirAccountId: reservoirAcc?.id ?? null,
    balance,
    reserved,
    payable,
    pay,
    payTotal: sumOf(pay),
    eventPayTotal,
    carry,
    carryTotal: sumOf(carry),
    reservoir: groupByPerson([...reservoirClaims].sort(oldestFirst)),
    reservoirTotal: sumOf(reservoirClaims),
    upcoming,
    spare,
    loan,
    repay,
    dueNow,
  };
}

/** 돌려받을 돈 요약을 함께 쓰는 통장 몫과 저수지 몫으로 나눠 사람별로 (많은 순) */
export function claimsBySource(data: LedgerData, pending: PendingClaim[]): { shared: PersonClaims[]; reservoir: PersonClaims[] } {
  const byAmount = (a: PersonClaims, b: PersonClaims) => b.amount - a.amount || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const shared = groupByPerson(pending.filter((c) => claimSource(data, c.accountId) !== 'reservoir')).sort(byAmount);
  const reservoir = groupByPerson(pending.filter((c) => claimSource(data, c.accountId) === 'reservoir')).sort(byAmount);
  return { shared, reservoir };
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
