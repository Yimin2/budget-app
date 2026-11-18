/**
 * 그달 쓴 돈 목록 — 이벤트 화면 '지난 · 앞으로 12개월' 카드의 고른 달 (PLAN 4-2).
 * 통장에서 나간 날이 아니라 **쓴 날(지출 날짜)** 의 달로 센다. 8월에 쓴 청구는 11월에 돌려줘도 8월 항목으로 남고,
 * 정산 상태(줄 돈 · 11/10 지급 · 저수지에서 빌려 줌)를 붙인다.
 *
 * - monthSpentItems: 한 달의 이벤트통장 기록(eventRecords, scope all · 저수지 이벤트 청구 포함)을
 *   eventRecordGroup(여행 → 일정 → 할부 → 카테고리)으로 묶은 줄. 지난 달 상세 · 통장 시작 전 달(빗금 막대)과 같은 합
 * - thisMonthSpending: 이번 달 쓴 돈 = 지금까지(오늘까지 날짜의 기록) + 예정(이번 달 날짜의 남은 일정 · 할부 회차 · 미리 기록한 지출).
 *   여행은 따로 (숫자 띠 '이번 달 쓴 돈'의 '여행 ○'), 합은 eventMonthUsage 의 spent + planned 와 같다.
 *   그래서 eventMonthUsage 처럼 통장에 기록된 지출만 센다 (reservoirClaims: false)
 */
import { monthOf } from './dates';
import {
  eventRecordGroup,
  eventRecordNames,
  eventRecords,
  eventRecordStatus,
  fixedGroupKey,
  isLiveTripExpense,
  liveTransferIds,
  liveTripIds,
  recordPhase,
  type EventRecordGroupKind,
  type EventRecordStatus,
} from './eventRecords';
import { claimLoanTransferId, claimTransferId } from './claims';
import { installmentPlanId, unrecordedInstallmentPayments } from './installments';
import { expenseLoanTransferId } from './settlement/loans';
import type { Expense, Id, ISODate, LedgerData, ProjectionMonth, Won, YearMonth } from './types';

/** 한 줄 안 청구의 정산 상태별 합 (그냥 지출은 세지 않는다) */
export interface MonthSpentClaims {
  /** 아직 돌려주지 않은 청구 */
  pending: Won;
  /** 돌려준 청구 */
  paid: Won;
  /** 가장 늦게 돌려준 날 (paid > 0 일 때) */
  paidOn: ISODate | null;
  /** 저수지에서 빌려 지급했거나 이벤트통장이 갚을 돈으로 바꾼 지출 */
  borrowed: Won;
}

export type MonthSpentRowKind = EventRecordGroupKind;

export interface MonthSpentRow {
  /** 같은 달 안에서 겹치지 않는 열쇠 (eventRecordGroup key, 예정 일정은 'ev:<id>@<날짜>') */
  key: string;
  kind: MonthSpentRowKind;
  label: string;
  /** 오늘까지 날짜면 spent, 오늘 뒤 날짜 · 아직 안 쓴 일정 · 할부 회차면 planned */
  phase: 'spent' | 'planned';
  amount: Won;
  /** 지출 건수 (예정 일정 · 할부 회차는 1) */
  count: number;
  /** 가장 이른 날짜 (없으면 null) */
  date: ISODate | null;
  /** 이 줄에 든 지출 (날짜 순) */
  expenseIds: Id[];
  /** 여행 줄이면 여행 id */
  tripId?: Id;
  /** 청구가 하나라도 있으면 상태별 합, 없으면 null */
  claims: MonthSpentClaims | null;
}

export interface MonthSpent {
  month: YearMonth;
  /** 줄 합 */
  total: Won;
  /** 지출 건수 */
  count: number;
  /** 금액 큰 순 (같으면 이른 날짜 → 이름) */
  rows: MonthSpentRow[];
}

/** 청구 한 건의 지급 · 빌린 날 (상태에 맞는 이체 날짜) */
export function claimSettledOn(data: LedgerData, e: Expense, status: EventRecordStatus): ISODate | null {
  const ids =
    status === 'claimPaid' ? [claimTransferId(e.id)] : status === 'borrowed' ? [claimLoanTransferId(e.id), expenseLoanTransferId(e.id)] : [];
  const t = data.transfers.find((x) => !x.deleted && x.status === 'done' && ids.includes(x.id));
  return t?.date ?? null;
}

/** 줄을 모으는 통: 같은 열쇠(+ 단계)는 한 줄로 */
class RowBucket {
  private rows = new Map<string, MonthSpentRow>();
  private dates = new Map<Id, ISODate>();

  add(
    group: { key: string; kind: MonthSpentRowKind; label: string; tripId?: Id },
    phase: 'spent' | 'planned',
    amount: Won,
    date: ISODate | null,
    expense?: Expense,
    claim?: { status: EventRecordStatus; on: ISODate | null },
  ) {
    const id = `${phase}|${group.key}`;
    const row: MonthSpentRow = this.rows.get(id) ?? {
      key: group.key,
      kind: group.kind,
      label: group.label,
      phase,
      amount: 0,
      count: 0,
      date: null,
      expenseIds: [],
      claims: null,
      ...(group.tripId ? { tripId: group.tripId } : {}),
    };
    row.amount += amount;
    row.count += 1;
    if (date && (row.date === null || date < row.date)) row.date = date;
    if (expense) {
      row.expenseIds.push(expense.id);
      this.dates.set(expense.id, expense.date);
    }
    if (claim && claim.status !== 'plain') {
      const c = row.claims ?? { pending: 0, paid: 0, paidOn: null, borrowed: 0 };
      if (claim.status === 'claimPending') c.pending += amount;
      else if (claim.status === 'borrowed') c.borrowed += amount;
      else {
        c.paid += amount;
        if (claim.on && (c.paidOn === null || claim.on > c.paidOn)) c.paidOn = claim.on;
      }
      row.claims = c;
    }
    this.rows.set(id, row);
  }

  list(): MonthSpentRow[] {
    const byDate = (a: Id, b: Id) => {
      const da = this.dates.get(a) ?? '';
      const db = this.dates.get(b) ?? '';
      return da < db ? -1 : da > db ? 1 : 0;
    };
    return [...this.rows.values()].filter((r) => r.amount > 0).map((r) => ({ ...r, expenseIds: [...r.expenseIds].sort(byDate) }));
  }
}

const byAmount = (a: MonthSpentRow, b: MonthSpentRow) =>
  b.amount - a.amount || ((a.date ?? '') < (b.date ?? '') ? -1 : (a.date ?? '') > (b.date ?? '') ? 1 : a.label.localeCompare(b.label, 'ko'));
const byDate = (a: MonthSpentRow, b: MonthSpentRow) =>
  (a.date ?? '') < (b.date ?? '') ? -1 : (a.date ?? '') > (b.date ?? '') ? 1 : b.amount - a.amount || a.label.localeCompare(b.label, 'ko');

export interface MonthSpentOptions {
  /** 저수지에서 빌려 낸(낼) 이벤트 청구도 셀지 (기본 true) */
  reservoirClaims?: boolean;
  /** 주면 오늘 뒤 날짜는 예정(planned)으로 (기본: 모두 spent) */
  today?: ISODate;
}

/**
 * 그달 쓴 돈 줄 (쓴 날 기준): eventRecords(scope all, 기본 저수지 이벤트 청구 포함)를 eventRecordGroup 으로 묶고,
 * 청구는 정산 상태별 합(줄 돈 · 지급함 + 지급일 · 저수지에서 빌려 줌)을 붙인다. 금액 큰 순
 */
export function monthSpentItems(data: LedgerData, eventAccountId: Id, month: YearMonth, opts: MonthSpentOptions = {}): MonthSpent {
  const { reservoirClaims = true, today } = opts;
  const names = eventRecordNames(data);
  const live = liveTransferIds(data);
  const bucket = new RowBucket();
  let count = 0;
  for (const { expense, record } of eventRecords(data, eventAccountId, { scope: 'all', reservoirClaims, month })) {
    const status = eventRecordStatus(data, expense, live);
    const g = eventRecordGroup(data, expense, names);
    const tripId = g.kind === 'trip' ? expense.tripId : undefined;
    bucket.add({ ...g, ...(tripId ? { tripId } : {}) }, today ? recordPhase(record, today) : 'spent', record.amount, record.date, expense, {
      status,
      on: claimSettledOn(data, expense, status),
    });
    count += 1;
  }
  const rows = bucket.list().sort(byAmount);
  return { month, total: rows.reduce((s, r) => s + r.amount, 0), count, rows };
}

/** 이번 달 쓴 돈 (PLAN 4-2 · 숫자 띠 '이번 달 쓴 돈'과 같은 합) */
export interface ThisMonthSpending {
  month: YearMonth;
  /** 오늘까지 날짜로 쓴 이벤트통장 지출 (여행 빼고, 청구는 쓴 날 기준) = eventMonthUsage.spent */
  spent: Won;
  /** 이번 달 날짜의 남은 일정 · 할부 회차 + 오늘 뒤 날짜로 미리 기록한 지출 (여행 빼고) = eventMonthUsage.planned */
  planned: Won;
  /** spent + planned */
  total: Won;
  /** 지금까지 쓴 줄 (날짜 순) */
  spentRows: MonthSpentRow[];
  /** 예정 줄 (날짜 순, 날짜 없는 할부는 뒤) */
  plannedRows: MonthSpentRow[];
  /** 이번 달 여행 = 여행에 묶은 이번 달 지출 + 여행 남은 예산 = eventMonthUsage.tripSpent + tripPlanned */
  trip: Won;
  /** 여행마다 (금액 큰 순) */
  tripRows: MonthSpentRow[];
  /**
   * 예측이 이번 달에 빼지만 이번 달 쓴 돈은 아닌 일정 · 할부: 날짜가 지났는데 아직 '썼어요'를 누르지 않은 지난 달 일정 · 기록 안 된 지난 할부 회차
   */
  overdue: Won;
}

/**
 * 이번 달 쓴 돈: 오늘까지 쓴 기록(쓴 날 기준) + 이번 달 예정. m0 = 그달 예측 (일정 · 여행 남은 예산).
 * 지난 지출 돌려주기 · 평소 쓰는 돈 예상 · 옮겨 갈 돈은 넣지 않는다 (잔액 계산에서만)
 */
export function thisMonthSpending(data: LedgerData, eventAccountId: Id, today: ISODate, m0: ProjectionMonth): ThisMonthSpending {
  const month = monthOf(today);
  const names = eventRecordNames(data);
  const live = liveTransferIds(data);
  const liveTrips = liveTripIds(data);
  const main = new RowBucket();
  const trips = new RowBucket();
  for (const { expense, record } of eventRecords(data, eventAccountId, { scope: 'all', reservoirClaims: false, month })) {
    const status = eventRecordStatus(data, expense, live);
    const claim = { status, on: claimSettledOn(data, expense, status) };
    const phase = recordPhase(record, today);
    if (isLiveTripExpense(record, liveTrips)) {
      const name = names.trips.get(record.tripId!) ?? '여행';
      trips.add({ key: `trip:${record.tripId}`, kind: 'trip', label: name, tripId: record.tripId! }, 'spent', record.amount, record.date, expense, claim);
      continue;
    }
    main.add(eventRecordGroup(data, expense, names), phase, record.amount, record.date, expense, claim);
  }
  for (const t of m0.tripList ?? []) trips.add({ key: `trip:${t.id}`, kind: 'trip', label: t.name, tripId: t.id }, 'spent', t.amount, null);
  let overdue = 0;
  for (const [i, e] of m0.events.entries()) {
    if (monthOf(e.date) !== month) {
      overdue += e.amount;
      continue;
    }
    main.add({ key: `ev:${e.id}@${e.date}@${i}`, kind: 'event', label: e.name }, 'planned', e.amount, e.date);
  }
  let instThisMonth = 0;
  for (const p of unrecordedInstallmentPayments(data, eventAccountId)) {
    if (p.month !== month) continue;
    const row = data.fixedExpenses.find((f) => f.id === p.rowId);
    main.add({ key: fixedGroupKey(installmentPlanId(p.rowId)), kind: 'installment', label: row?.name ?? '할부' }, 'planned', p.amount, p.date);
    instThisMonth += p.amount;
  }
  overdue += Math.max(0, (m0.installments ?? 0) - instThisMonth);
  const rows = main.list();
  const spentRows = rows.filter((r) => r.phase === 'spent').sort(byDate);
  const plannedRows = rows.filter((r) => r.phase === 'planned').sort(byDate);
  const spent = spentRows.reduce((s, r) => s + r.amount, 0);
  const planned = plannedRows.reduce((s, r) => s + r.amount, 0);
  const tripRows = trips.list().sort(byAmount);
  return {
    month,
    spent,
    planned,
    total: spent + planned,
    spentRows,
    plannedRows,
    trip: tripRows.reduce((s, r) => s + r.amount, 0),
    tripRows,
    overdue,
  };
}
