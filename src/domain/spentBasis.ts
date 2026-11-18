/**
 * 이벤트통장 달 말 잔액 — 쓴 날 기준 (PLAN 4-2 · 이벤트 화면).
 *
 * 개인 돈으로 낸 청구는 정산일에 통장에서 빠지지만, 그 돈을 **쓴 달**에 이미 쓴 것으로 센다.
 * 그래서 쓴 날 기준 잔액 = 통장 잔액 − 아직 돌려주지 않은 청구(돌려줄 돈).
 * 8월에 쓰고 11월에 돌려준 축의금은 8월 잔액에서 빠지고, 11월에는 다시 빼지 않는다.
 *
 * - 지난 달(최근 3개월): 기록으로 계산한 실제 달 말 잔액 − 그날까지 쓰고 그날 뒤에 돌려준(또는 아직 안 돌려준) 청구
 * - 이번 달 · 앞으로 달: 예측(projectEventAccount) 달 말 잔액 − 그달 뒤에 돌려줄 청구 (claimList 는 모두 이미 쓴 돈)
 * - 쓴 돈 = 그달에 쓴(쓸) 이벤트통장 돈. 지난 청구를 돌려주는 돈 · 옮겨 갈 돈은 쓴 돈이 아니다
 */
import { accountBalance } from './balances';
import { addDays, addMonths, dateInMonth, daysInMonth, monthOf } from './dates';
import { eventRecords, eventRecordStatus, liveTransferIds } from './eventRecords';
import { claimSettledOn, monthSpentItems, thisMonthSpending, type MonthSpentRow, type ThisMonthSpending } from './monthSpent';
import { accountFlow, pastMonthEnds } from './pastBalances';
import type { EventProjection, Id, ISODate, LedgerData, ProjectionMonth, Won, YearMonth } from './types';

/** 지난 달 막대 개수 */
export const SPENT_BASIS_PAST_MONTHS = 3;

export type SpentBasisKind = 'past' | 'this' | 'future';

export interface SpentBasisMonth {
  month: YearMonth;
  kind: SpentBasisKind;
  /** 달 시작 잔액 (쓴 날 기준) */
  start: Won;
  /** 들어온(올) 돈: 적립 · 이체 · 수입 */
  inflow: Won;
  /** 그달 쓴(쓸) 돈 */
  spent: Won;
  /** 옮겨 갈 돈 (예정 이체 나감) */
  transferOut: Won;
  /** 그 밖에 나간 돈 (지난 달 · 이번 달의 저수지 갚기 같은 이체 등. 들어온 돈이 더 많으면 음수) */
  other: Won;
  /** 달 말 잔액 (쓴 날 기준) */
  end: Won;
  /** 달 말 통장 잔액 */
  bankEnd: Won;
  /** 달 말에 아직 돌려주지 않은 청구 (= bankEnd − end) */
  owed: Won;
  /** 그달 통장에서 돌려줄(준) 지난 청구 */
  repaid: Won;
  /** 앞으로 달이면 예측 한 달 */
  projection?: ProjectionMonth;
}

export interface SpentBasisView {
  months: SpentBasisMonth[];
  /** 지금 통장 잔액 */
  balance: Won;
  /** 지금 돌려줄 돈 (이벤트통장이 돌려줄, 이미 쓴 청구) */
  owedNow: Won;
  /** 지금 쓸 수 있는 돈 = balance − owedNow */
  usable: Won;
  /** 이번 달 쓴 돈 (지금까지 + 예정, 여행 따로) */
  thisMonth: ThisMonthSpending | null;
  /** 쓴 날 기준으로 모자라는 달 (이번 달부터) */
  shortages: SpentBasisMonth[];
}

interface ClaimSpan {
  amount: Won;
  spent: ISODate;
  paidOn: ISODate | null;
}

/** 이벤트통장이 돌려줄(준) 청구: 쓴 날 · 돌려준 날. 저수지에서 빌려 준 청구는 저수지 몫이라 빼요 */
function claimSpans(data: LedgerData, accountId: Id): ClaimSpan[] {
  const live = liveTransferIds(data);
  const out: ClaimSpan[] = [];
  for (const { expense, record } of eventRecords(data, accountId, { scope: 'all', reservoirClaims: false })) {
    const status = eventRecordStatus(data, expense, live);
    if (status !== 'claimPending' && status !== 'claimPaid') continue;
    out.push({ amount: record.amount, spent: record.date, paidOn: status === 'claimPaid' ? claimSettledOn(data, expense, status) : null });
  }
  return out;
}

/** 그날 끝에 아직 돌려주지 않은 청구 합 */
function owedAt(spans: ClaimSpan[], day: ISODate): Won {
  let sum = 0;
  for (const c of spans) if (c.spent <= day && (c.paidOn === null || c.paidOn > day)) sum += c.amount;
  return sum;
}

/** 그달 쓸 돈 (예측 한 달, 돌려주기 · 옮겨 갈 돈 빼고) */
export function projectedSpend(m: ProjectionMonth): Won {
  return m.planned + m.usual + m.extra + (m.scheduledSpending ?? 0) + (m.installments ?? 0) + (m.trips ?? 0);
}

/** 그달 들어올 돈 (예측 한 달) */
function projectedInflow(m: ProjectionMonth): Won {
  return m.contributions + m.transfersIn + (m.income ?? 0);
}

/**
 * 이벤트 화면의 달 말 잔액 (쓴 날 기준): 지난 3개월 + 이번 달 + 앞으로 달.
 * 예측이 없거나 이벤트통장이 없으면 null
 */
export function spentBasisView(data: LedgerData, projection: EventProjection | null, today: ISODate): SpentBasisView | null {
  const accountId = projection?.accountId;
  if (!projection || !accountId || projection.months.length === 0) return null;
  const spans = claimSpans(data, accountId);
  const thisMonth = monthOf(today);
  const months: SpentBasisMonth[] = [];

  // 지난 달
  for (const p of pastMonthEnds(data, accountId, today, SPENT_BASIS_PAST_MONTHS)) {
    const first = dateInMonth(p.month, 1);
    const last = dateInMonth(p.month, daysInMonth(p.month));
    const startOwed = owedAt(spans, addDays(first, -1));
    const owed = owedAt(spans, last);
    const start = p.startBalance - startOwed;
    const end = p.endBalance - owed;
    const spent = monthSpentItems(data, accountId, p.month, { reservoirClaims: false }).total;
    const repaid = spans.filter((c) => c.paidOn !== null && monthOf(c.paidOn) === p.month).reduce((s, c) => s + c.amount, 0);
    months.push({
      month: p.month,
      kind: 'past',
      start,
      inflow: p.inflow,
      spent,
      transferOut: 0,
      other: start + p.inflow - spent - end,
      end,
      bankEnd: p.endBalance,
      owed,
      repaid,
    });
  }

  // 이번 달 · 앞으로 달: 그달 뒤에 돌려줄 청구를 빼요
  const pm = projection.months;
  const claimsAfter: Won[] = new Array(pm.length).fill(0);
  for (let i = pm.length - 2; i >= 0; i--) claimsAfter[i] = claimsAfter[i + 1]! + (pm[i + 1]!.claims ?? 0);
  const owedNow = claimsAfter[0]! + (pm[0]!.claims ?? 0);
  const m0 = pm[0]!;
  const thisSpend = m0.month === thisMonth ? thisMonthSpending(data, accountId, today, m0) : null;

  pm.forEach((m, i) => {
    const end = m.endBalance - claimsAfter[i]!;
    const prev = months[months.length - 1];
    const isThis = m.month === thisMonth;
    if (isThis && thisSpend) {
      const first = dateInMonth(m.month, 1);
      const bankStart = accountBalance(data, accountId, addDays(first, -1));
      const start = prev && prev.month === addMonths(m.month, -1) ? prev.end : bankStart - owedAt(spans, addDays(first, -1));
      const soFar = accountFlow(data, accountId, first, today);
      const inflow = soFar.inflow + projectedInflow(m);
      const spent = thisSpend.total + thisSpend.trip + thisSpend.overdue + m.usual + m.extra;
      const repaidSoFar = spans.filter((c) => c.paidOn !== null && monthOf(c.paidOn) === m.month).reduce((s, c) => s + c.amount, 0);
      months.push({
        month: m.month,
        kind: 'this',
        start,
        inflow,
        spent,
        transferOut: m.transfersOut,
        other: start + inflow - spent - m.transfersOut - end,
        end,
        bankEnd: m.endBalance,
        owed: claimsAfter[i]!,
        repaid: repaidSoFar + (m.claims ?? 0),
        projection: m,
      });
      return;
    }
    const start = prev ? prev.end : m.startBalance - (claimsAfter[i]! + (m.claims ?? 0));
    const inflow = projectedInflow(m);
    const spent = projectedSpend(m);
    months.push({
      month: m.month,
      kind: isThis ? 'this' : 'future',
      start,
      inflow,
      spent,
      transferOut: m.transfersOut,
      other: start + inflow - spent - m.transfersOut - end,
      end,
      bankEnd: m.endBalance,
      owed: claimsAfter[i]!,
      repaid: m.claims ?? 0,
      projection: m,
    });
  });

  return {
    months,
    balance: projection.currentBalance,
    owedNow,
    usable: projection.currentBalance - owedNow,
    thisMonth: thisSpend,
    shortages: months.filter((m) => m.kind !== 'past' && m.end < 0),
  };
}

/** 지난 달 쓴 돈 줄 (쓴 날 기준, 정산 상태 붙임) */
export function pastMonthRows(data: LedgerData, accountId: Id, month: YearMonth): MonthSpentRow[] {
  return monthSpentItems(data, accountId, month, { reservoirClaims: false }).rows;
}
