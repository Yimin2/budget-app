/**
 * 이번 달 이벤트통장 쓴 돈 · 예정 · 들어올 돈 — 이벤트 화면 · 홈의 정산 한 줄 카드 머리말 (PLAN 4-9).
 * 쓴 돈은 eventRecords(통장에 기록된 지출만, 쓴 날 기준)로 센다
 */
import { isCountedTransfer } from '../balances';
import { eventRecords, isLiveTripExpense, liveTripIds, recordPhase } from '../eventRecords';
import { monthOf } from '../dates';
import { autoTransferId } from '../ids';
import { activeIncomePlans, incomePlanOccurrenceDate, incomeRecordId, isComputedRule, projectRemainders, ruleAmountFor } from '../income';
import { ruleOccurrenceDate } from '../recurring';
import { isLoanTransferId } from './loans';
import type { Settlement } from './claimsAllocation';
import type { Id, ISODate, LedgerData, Won } from '../types';

/** 이번 달 이벤트통장 쓴 돈 · 예정 · 들어올 돈 — 이벤트 화면 · 홈의 정산 한 줄 카드 머리말 (PLAN 4-9) */
export interface EventMonthUsage {
  /**
   * 이번 달 1일 ~ 오늘 날짜로 쓴 이벤트통장 지출 (돌려줄 청구 포함, 지급 여부와 상관없이 쓴 날 기준).
   * 지난달 이전에 쓴 청구를 이번 달에 지급 처리해도 넣지 않는다. 이체(지급 · 갚기 · 빌리기)는 세지 않는다
   */
  spent: Won;
  /** 이번 달 남은 예정 = 아직 안 쓴 이번 달 일정 · 여행 · 할부(reservedThisMonth) + 오늘 뒤 날짜로 미리 기록한 이번 달 이벤트통장 지출 */
  planned: Won;
  /** 이번 달 여행에 묶은 이벤트통장 지출 (오늘까지, spent 에는 없다) */
  tripSpent: Won;
  /** 이번 달 여행 남은 예산 + 오늘 뒤 날짜의 여행 지출 (planned 에는 없다) */
  tripPlanned: Won;
  /** 이번 달 정산일에 이벤트통장에서 돌려줄 청구 (지급할 수 있는 돈 안 = eventPayTotal, 예정에는 넣지 않는다 — 쓴 날에 이미 셈) */
  plannedClaims: Won;
  /** 이번 달 이벤트통장에 들어오는(들어온) 돈 = 이번 달 적립 · 수입 · 이체(기록된 것 + 아직 기록 안 된 매달 배분 · 수입 계획 · 예정 이체). 저수지에서 빌린 이체(loan:)는 뺀다 */
  incoming: Won;
  /** 이벤트통장에서 줄 수 있는 돈에 안 들어가 다음 달로 넘어가는 청구 합 (= carryTotal) */
  unpaid: Won;
  /** 그 사람마다 (많은 순) */
  unpaidPeople: { name: string; amount: Won }[];
}

/** 이번 달 이벤트통장으로 들어오는 돈 (기록된 것 + 아직 기록 안 된 매달 배분 · 수입 계획 · 예정 이체, 빌린 이체 제외) */
function monthIncoming(data: LedgerData, accountId: Id, today: ISODate): Won {
  const month = monthOf(today);
  let total = 0;
  const transferIds = new Set(data.transfers.map((t) => t.id));
  for (const t of data.transfers) {
    if (t.toAccountId !== accountId || t.fromAccountId === accountId || monthOf(t.date) !== month || isLoanTransferId(t.id)) continue;
    if (isCountedTransfer(data, t) || (!t.deleted && t.status === 'planned')) total += t.amount;
  }
  const rules = data.rules.filter((r) => !r.deleted && r.toAccountId === accountId && r.fromAccountId !== accountId);
  const remainders = rules.some(isComputedRule) ? projectRemainders(data, today, 1) : new Map<string, Won>();
  for (const r of rules) {
    if (ruleOccurrenceDate(data, r, month) === null || transferIds.has(autoTransferId(r.id, month))) continue;
    total += ruleAmountFor(r, month, remainders, data);
  }
  for (const p of activeIncomePlans(data, month, accountId)) {
    if (incomePlanOccurrenceDate(data, p, month) === null || transferIds.has(incomeRecordId(p.id, month))) continue;
    total += p.amount;
  }
  return total;
}

/** 이번 달 이벤트통장 쓴 돈 · 예정 · 들어올 돈 · 다음 달로 넘어가는 청구 (이벤트통장이 없으면 금액은 0) */
export function eventMonthUsage(data: LedgerData, s: Settlement, today: ISODate): EventMonthUsage {
  const unpaidPeople = s.carry
    .map((g) => ({ name: g.name, amount: g.amount }))
    .sort((a, b) => b.amount - a.amount || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const acc = s.eventAccountId;
  if (!acc) return { spent: 0, planned: 0, tripSpent: 0, tripPlanned: 0, plannedClaims: 0, incoming: 0, unpaid: s.carryTotal, unpaidPeople };
  const month = monthOf(today);
  // 이번 달 사용 = 지출 날짜가 이번 달인 이벤트통장 지출 (돌려줄 청구 포함). 지급한 날이 아니라 쓴 날 기준이라,
  // 지난달 이전에 쓴 청구를 이번 달에 지급 처리해도 이번 달 쓴 돈에 들어가지 않아요.
  // 여행에 묶은 지출 · 여행 남은 예산은 따로 (홈에서 '여행 ○만'으로 옆에 보여요)
  const liveTrips = liveTripIds(data);
  let spent = 0;
  let ahead = 0;
  let tripSpent = 0;
  let tripAhead = 0;
  for (const { record: e } of eventRecords(data, acc, { reservoirClaims: false, month })) {
    const trip = isLiveTripExpense(e, liveTrips);
    if (recordPhase(e, today) === 'spent') {
      if (trip) tripSpent += e.amount;
      else spent += e.amount;
    } else if (trip) tripAhead += e.amount;
    else ahead += e.amount;
  }
  const plannedClaims = s.eventPayTotal;
  const tripLeft = s.reservedTrips;
  return {
    spent,
    planned: s.reserved - tripLeft + ahead,
    tripSpent,
    tripPlanned: tripLeft + tripAhead,
    plannedClaims,
    incoming: monthIncoming(data, acc, today),
    unpaid: s.carryTotal,
    unpaidPeople,
  };
}
