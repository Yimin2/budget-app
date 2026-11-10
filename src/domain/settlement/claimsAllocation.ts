/**
 * 이번 달 정산 — 청구를 이벤트통장 · 고정지출통장 · 저수지 몫으로 나누고, 지급할 수 있는 돈 안에서 오래된 순 first-fit 으로 나눈다.
 * 고른 청구 다시 보기 · 지급 나누기 · 지급한 청구 목록. 규칙 전체는 settlement/index.ts 머리말
 */
import { accountBalance } from '../balances';
import { isReservoirEventExpense, pendingClaims, settleDayOf } from '../claims';
import { dateInMonth, monthOf } from '../dates';
import { projectEventAccount } from '../events';
import { autoTransferId } from '../ids';
import { unrecordedInstallmentPayments } from '../installments';
import { activeIncomePlans, incomePlanOccurrenceDate, incomeRecordId, isComputedRule, projectRemainders, ruleAmountFor } from '../income';
import { firstAccountByRole } from '../internal';
import { formatWon } from '../money';
import { ruleOccurrenceDate } from '../recurring';
import { oldestFirst, sumOf } from './internal';
import { type LoanStatus, loanStatus, REPAY_SAFE_MONTHS } from './loans';
import type { EventProjection, Id, ISODate, LedgerData, PendingClaim, Won, YearMonth } from '../types';

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
  const remainders = rules.some(isComputedRule) ? projectRemainders(data, today, 1) : new Map<string, Won>();
  for (const r of rules) {
    const date = ruleOccurrenceDate(data, r, month);
    if (date === null || date > asOf || transferIds.has(autoTransferId(r.id, month))) continue;
    const sign = (r.toAccountId === accountId ? 1 : 0) - (r.fromAccountId === accountId ? 1 : 0);
    balance += sign * ruleAmountFor(r, month, remainders, data);
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
  /** 이번 달 첫날 (이날 전에 돌려줄 날이 된 청구 = 지난달부터 못 준 청구) */
  monthStart: ISODate;
  /** 정산 기준일의 이벤트통장 잔액 (그날까지 들어올 적립 포함) = recorded + incoming */
  balance: Won;
  /** 정산 기준일까지 기록된 이벤트통장 잔액 (지갑에 있는 돈, 음수면 모자란 돈) */
  recorded: Won;
  /** 정산 기준일까지 들어오거나(+) 나갈(−) 아직 기록 안 된 이번 달 적립 · 수입 · 예정 이체 */
  incoming: Won;
  /** 그 돈이 들어오는 날 (하루뿐일 때만, 여러 날이거나 없으면 null) */
  incomingOn: ISODate | null;
  /** 이벤트통장이 모자란 돈 = max(0, −recorded) */
  shortfall: Won;
  /** 쓸 수 있는 돈 = max(0, balance) (잔액이 음수면 들어올 돈이 먼저 메운다) */
  available: Won;
  /** 이번 달 아직 안 쓴 일정 · 여행 · 할부 */
  reserved: Won;
  /** reserved 중 여행 남은 예산 */
  reservedTrips: Won;
  /** 지난달부터 못 준 이벤트통장 청구 중 먼저 돌려줄 합 (available 안에서 오래된 순 first-fit) */
  oldPay: Won;
  /** 이번 달 청구에 쓸 수 있는 돈 = max(0, available − oldPay − reserved) */
  freshLimit: Won;
  /** 지급할 수 있는 돈 = oldPay + freshLimit */
  payable: Won;
  /** 지난달 청구를 먼저 돌려주면 이번 달 일정에 모자라는 돈 (없으면 null) */
  plannedShort: { month: YearMonth; amount: Won } | null;
  /** 이번 달 지급 (사람별) — 이벤트통장 몫(한도 안) + 고정지출통장 몫 */
  pay: PersonClaims[];
  payTotal: Won;
  /** 이벤트통장 몫으로 이번 달 지급하는 합 */
  eventPayTotal: Won;
  /** 다음 달로 넘어가요 (이벤트통장 몫 중 안 들어간 것) */
  carry: CarryPerson[];
  carryTotal: Won;
  /** 저수지에서 지급할 청구 (저수지통장의 이벤트 아닌 청구, 돌려줄 날 상관없이 모두). 사람에게 줄 돈이고, 빌린 돈이 아니다 */
  reservoir: PersonClaims[];
  reservoirTotal: Won;
  /** 저수지에서 빌려 지급할 청구 (저수지통장의 이벤트 청구, 돌려줄 날 상관없이 모두). 사람에게 줄 돈이고, 지급하면 저수지에 갚을 돈이 된다 */
  reservoirLoan: PersonClaims[];
  reservoirLoanTotal: Won;
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

/**
 * 이벤트통장 청구의 한도: 지난달부터 못 준 청구(old)는 쓸 수 있는 돈 전체 안에서 오래된 순 first-fit,
 * 이번 달 청구는 그 뒤 이번 달 일정 · 여행 · 할부를 뺀 남은 돈 안에서
 */
function eventLimits(available: Won, reserved: Won, old: PendingClaim[]) {
  const oldAlloc = allocateClaims(old, available);
  const oldPaid = sumOf(oldAlloc.paid);
  return { oldAlloc, oldPaid, freshLimit: Math.max(0, available - oldPaid - reserved) };
}

/** 정산 기준일까지 아직 기록 안 된 이번 달 적립 · 수입 · 예정 이체가 모두 같은 날이면 그날, 아니면 null */
function scheduledDate(data: LedgerData, accountId: Id, today: ISODate, asOf: ISODate): ISODate | null {
  const month = monthOf(today);
  const dates = new Set<ISODate>();
  const transferIds = new Set(data.transfers.map((t) => t.id));
  for (const r of data.rules) {
    if (r.deleted || (r.toAccountId !== accountId && r.fromAccountId !== accountId)) continue;
    const date = ruleOccurrenceDate(data, r, month);
    if (date !== null && date <= asOf && !transferIds.has(autoTransferId(r.id, month))) dates.add(date);
  }
  for (const p of activeIncomePlans(data, month, accountId)) {
    const date = incomePlanOccurrenceDate(data, p, month);
    if (date !== null && date <= asOf && !transferIds.has(incomeRecordId(p.id, month))) dates.add(date);
  }
  for (const t of data.transfers) {
    if (t.deleted || t.status !== 'planned' || monthOf(t.date) !== month || t.date > asOf) continue;
    if (t.toAccountId === accountId || t.fromAccountId === accountId) dates.add(t.date);
  }
  return dates.size === 1 ? [...dates][0]! : null;
}

/**
 * 정산에서 남겨 둘 이번 달 돈 = 이번 달 날짜의 아직 안 쓴 일정(반복 회차 포함) + 이번 달 여행 남은 예산 + 이번 달 할부 회차.
 * 평소 쓰는 돈(usual)은 넣지 않는다. 예측은 지난달 날짜인데 아직 '예정'인 일정 · 기록 안 된 지난 할부 회차도 이번 달 나갈 돈으로 모으지만,
 * 그건 대개 '썼어요'를 누르지 않은 지난 일정이라 정산 한도에서는 빼지 않는다 (줄 수 있는 돈이 까닭 없이 작아지지 않게)
 */
export function reservedThisMonth(data: LedgerData, eventAccountId: Id, today: ISODate, proj: EventProjection): Won {
  const month = monthOf(today);
  const m0 = proj.months.find((m) => m.month === month);
  if (!m0) return 0;
  const planned = m0.events.reduce((t, e) => (monthOf(e.date) === month ? t + e.amount : t), 0);
  const installments = unrecordedInstallmentPayments(data, eventAccountId).reduce((t, p) => (p.month === month ? t + p.amount : t), 0);
  return planned + (m0.trips ?? 0) + installments;
}

/** 지난달부터 못 준 청구인지 (돌려줄 날이 이번 달 첫날 전) — 정산 화면의 '지난달부터' 표시 */
export function isCarriedOverClaim(s: Pick<Settlement, 'monthStart'>, c: PendingClaim): boolean {
  return c.due < s.monthStart;
}

/** 이번 달 정산 */
export function computeSettlement(data: LedgerData, today: ISODate, projection?: EventProjection): Settlement {
  const date = settleDateOf(data, today);
  const asOf = date > today ? date : today;
  const eventAcc = firstAccountByRole(data, 'event');
  const reservoirAcc = firstAccountByRole(data, 'reservoir');
  const proj = projection ?? projectEventAccount(data, today);
  const reserved = eventAcc ? reservedThisMonth(data, eventAcc.id, today, proj) : 0;
  const reservedTrips = eventAcc ? (proj.months.find((m) => m.month === monthOf(today))?.trips ?? 0) : 0;
  const balance = eventAcc ? balanceWithScheduled(data, eventAcc.id, today, asOf) : 0;
  const recorded = eventAcc ? accountBalance(data, eventAcc.id, asOf) : 0;
  const incoming = balance - recorded;
  const incomingOn = eventAcc && incoming !== 0 ? scheduledDate(data, eventAcc.id, today, asOf) : null;
  const available = Math.max(0, balance);
  const monthStart = dateInMonth(monthOf(today), 1);

  const pending = pendingClaims(data, today);
  const reservoirClaims: PendingClaim[] = [];
  const reservoirLoanClaims: PendingClaim[] = [];
  const eventDue: PendingClaim[] = [];
  const otherDue: PendingClaim[] = [];
  const later: PendingClaim[] = [];
  for (const c of pending) {
    const src = claimSource(data, c.accountId);
    if (src === 'reservoir') (isReservoirEventExpense(data, c.expense) ? reservoirLoanClaims : reservoirClaims).push(c);
    else if (c.due > asOf) later.push(c);
    else if (src === 'event') eventDue.push(c);
    else otherDue.push(c);
  }
  // 지난달부터 못 준 청구를 먼저 (이번 달 일정보다도 먼저), 이번 달 청구는 이번 달 일정을 뺀 남은 돈 안에서
  const limits = eventLimits(available, reserved, eventDue.filter((c) => c.due < monthStart));
  const oldAlloc = limits.oldAlloc;
  const freshAlloc = allocateClaims(
    eventDue.filter((c) => c.due >= monthStart),
    limits.freshLimit,
  );
  const alloc = { paid: [...oldAlloc.paid, ...freshAlloc.paid], carried: [...oldAlloc.carried, ...freshAlloc.carried] };
  const oldPay = limits.oldPaid;
  const freshLimit = limits.freshLimit;
  const payable = oldPay + freshLimit;
  const afterOld = available - oldPay;
  const plannedShort = oldPay > 0 && reserved > afterOld ? { month: monthOf(today), amount: reserved - afterOld } : null;
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
    reservoirClaims.some((c) => c.due <= today) ||
    reservoirLoanClaims.some((c) => c.due <= today);

  return {
    date,
    asOf,
    eventAccountId: eventAcc?.id ?? null,
    reservoirAccountId: reservoirAcc?.id ?? null,
    monthStart,
    balance,
    recorded,
    incoming,
    incomingOn,
    shortfall: Math.max(0, -recorded),
    available,
    reserved,
    reservedTrips,
    oldPay,
    freshLimit,
    payable,
    plannedShort,
    pay,
    payTotal: sumOf(pay),
    eventPayTotal,
    carry,
    carryTotal: sumOf(carry),
    reservoir: groupByPerson([...reservoirClaims].sort(oldestFirst)),
    reservoirTotal: sumOf(reservoirClaims),
    reservoirLoan: groupByPerson([...reservoirLoanClaims].sort(oldestFirst)),
    reservoirLoanTotal: sumOf(reservoirLoanClaims),
    upcoming,
    spare,
    loan,
    repay,
    dueNow,
  };
}

/** 돌려받을 돈 요약을 함께 쓰는 통장 몫과 저수지 몫으로 나눠 사람별로 (많은 순) */
export function claimsBySource(
  data: LedgerData,
  pending: PendingClaim[],
): { shared: PersonClaims[]; reservoir: PersonClaims[]; reservoirLoan: PersonClaims[] } {
  const byAmount = (a: PersonClaims, b: PersonClaims) => b.amount - a.amount || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const isRes = (c: PendingClaim) => claimSource(data, c.accountId) === 'reservoir';
  const shared = groupByPerson(pending.filter((c) => !isRes(c))).sort(byAmount);
  const reservoir = groupByPerson(pending.filter((c) => isRes(c) && !isReservoirEventExpense(data, c.expense))).sort(byAmount);
  const reservoirLoan = groupByPerson(pending.filter((c) => isRes(c) && isReservoirEventExpense(data, c.expense))).sort(byAmount);
  return { shared, reservoir, reservoirLoan };
}

/** 정산 화면에서 고를 수 있는 청구 묶음 */
export type SettlementGroup = 'pay' | 'carry' | 'reservoir' | 'reservoirLoan' | 'upcoming';

/**
 * 처음 골라 둘 청구: 이번 달 지급(나눠 둔 것)과 돌려줄 날이 된 저수지 청구. 넘어가는 청구 · 아직 날이 안 된 청구는 고르지 않는다
 */
export function defaultSettlementSelection(s: Settlement): Set<Id> {
  const out = new Set<Id>();
  for (const g of s.pay) for (const c of g.claims) out.add(c.expense.id);
  for (const g of [...s.reservoir, ...s.reservoirLoan]) for (const c of g.claims) if (c.due <= s.asOf) out.add(c.expense.id);
  return out;
}

export interface SelectionCheck {
  /** 고른 청구 (오래된 순) */
  claims: PendingClaim[];
  total: Won;
  /** 이벤트통장에서 돌려줄 몫 (지급할 수 있는 돈과 견준다) */
  eventTotal: Won;
  /** 지급할 수 있는 돈에 안 드는 이벤트통장 청구의 합 = 저수지에서 빌려 줄 돈 (0 이면 맞음) */
  excess: Won;
  fits: boolean;
  /** 지급할 수 있는 돈 안에 드는 청구 (이벤트통장 몫은 지난달 청구 먼저 · 오래된 순 first-fit, 다른 통장 몫은 모두) */
  within: Id[];
  /** 안 드는 이벤트통장 청구 — [저수지에서 빌려 지급]으로만 줄 수 있다 */
  over: Id[];
  /** 이벤트통장에서 바로 지급하는(안에 드는) 이벤트통장 청구의 합 */
  withinEventTotal: Won;
}

/**
 * 고른 청구가 지급할 수 있는 돈 안에 드는지 다시 본다. 이벤트통장 청구만 한도와 견주고(고정지출 · 저수지 청구는 한도 없음),
 * 지난달부터 못 준 청구는 쓸 수 있는 돈 전체 안에서 먼저, 이번 달 청구는 이번 달 일정을 뺀 남은 돈 안에서
 * 오래된 순 first-fit 으로 안에 드는 것과 넘는 것을 나눈다. 지난달 청구 몫으로 먼저 잡아 둔 돈(oldPay)은 이번 달 청구에 쓰지 않는다
 */
export function checkSettlementSelection(data: LedgerData, s: Settlement, selected: Iterable<Id>): SelectionCheck {
  const ids = new Set(selected);
  const all = [...s.pay, ...s.carry, ...s.reservoir, ...s.reservoirLoan, ...s.upcoming].flatMap((g) => g.claims);
  const seen = new Set<Id>();
  const claims = all.filter((c) => ids.has(c.expense.id) && !seen.has(c.expense.id) && seen.add(c.expense.id)).sort(oldestFirst);
  const event = claims.filter((c) => claimSource(data, c.accountId) === 'event');
  const eventTotal = sumOf(event);
  const old = allocateClaims(
    event.filter((c) => isCarriedOverClaim(s, c)),
    s.available,
  );
  const earmark = Math.max(sumOf(old.paid), s.oldPay);
  const fresh = allocateClaims(
    event.filter((c) => !isCarriedOverClaim(s, c)),
    Math.max(0, s.available - earmark - s.reserved),
  );
  const overClaims = [...old.carried, ...fresh.carried].sort(oldestFirst);
  const overSet = new Set(overClaims.map((c) => c.expense.id));
  const excess = sumOf(overClaims);
  return {
    claims,
    total: sumOf(claims),
    eventTotal,
    excess,
    fits: overClaims.length === 0,
    within: claims.filter((c) => !overSet.has(c.expense.id)).map((c) => c.expense.id),
    over: overClaims.map((c) => c.expense.id),
    withinEventTotal: eventTotal - excess,
  };
}

/**
 * [지급했어요]로 이벤트통장에서 바로 지급할 수 있는지 (상태 계층이 쓰기 전에 본다). 안 되면 이유, 되면 null
 */
export function settleRefusal(data: LedgerData, s: Settlement, expenseIds: Iterable<Id>): string | null {
  const check = checkSettlementSelection(data, s, expenseIds);
  if (check.fits) return null;
  return s.payable > 0
    ? `이벤트통장에서 줄 수 있는 돈은 ${formatWon(s.payable)}이에요. 넘는 ${formatWon(check.excess)}은 저수지에서 빌려 지급해 주세요`
    : `이벤트통장에서 줄 수 있는 돈이 없어요. ${formatWon(check.excess)}은 저수지에서 빌려 지급해 주세요`;
}

export interface SettlePlan {
  /** 고른 청구 (오래된 순) */
  claims: PendingClaim[];
  total: Won;
  /** 그냥 지급 (이벤트통장 몫 중 한도 안 + 고정지출통장 + 저수지에서 지급) */
  settle: Id[];
  /** 저수지에서 빌려 지급하는 이벤트통장 청구 (지급할 수 있는 돈을 넘는 것) */
  over: Id[];
  /** 저수지에서 빌려 지급하는 저수지통장 이벤트 청구 */
  borrow: Id[];
  /** 지급할 수 있는 돈보다 많은 금액 */
  excess: Won;
  /** 넘는 돈 없이 지급할 수 있는지 */
  fits: boolean;
}

/**
 * 정산 화면에서 고른 청구를 어떻게 지급할지 나눈다. 저수지통장 이벤트 청구는 늘 저수지에서 빌려 지급하고,
 * 나머지는 checkSettlementSelection 으로 지급할 수 있는 돈과 견준다 (넘는 이벤트통장 청구 = over)
 */
export function planSettlement(data: LedgerData, s: Settlement, selected: Iterable<Id>): SettlePlan {
  const ids = new Set(selected);
  const borrowIds = new Set(s.reservoirLoan.flatMap((g) => g.claims.map((c) => c.expense.id)).filter((id) => ids.has(id)));
  const rest = [...ids].filter((id) => !borrowIds.has(id));
  const check = checkSettlementSelection(data, s, rest);
  const borrowClaims = s.reservoirLoan.flatMap((g) => g.claims).filter((c) => borrowIds.has(c.expense.id));
  const claims = [...check.claims, ...borrowClaims].sort(oldestFirst);
  return {
    claims,
    total: sumOf(claims),
    settle: check.within,
    over: check.over,
    borrow: borrowClaims.map((c) => c.expense.id),
    excess: check.excess,
    fits: check.fits,
  };
}
