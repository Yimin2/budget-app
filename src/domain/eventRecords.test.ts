import { describe, expect, it } from 'vitest';
import { account, emptyLedger, event, expense, fixed, transfer } from './_fixtures';
import {
  asEventRecord,
  eventPlanGroup,
  eventRecordGroup,
  eventRecordList,
  eventRecordMonths,
  eventRecordNames,
  eventRecords,
  eventRecordStatus,
  isLiveTripExpense,
  liveTripIds,
  recordPhase,
  sumByMonthAndCategory,
} from './eventRecords';
import { eventMonthlyCosts } from './eventMonths';
import { computeSettlement, eventMonthUsage } from './settlement';
import { eventYearReview } from './stats';
import type { Category, Expense, LedgerData, Trip } from './types';

const TODAY = '2026-11-10';
const income = account('income', { order: 0, openingDate: '2026-01-01' });
const eventAcc = account('event', { order: 2, openingBalance: 5_000_000, openingDate: '2026-01-01' });
const reservoir = account('reservoir', { order: 3, openingBalance: 9_000_000, openingDate: '2026-01-01' });

const cat = (id: string, name: string, role: Category['defaultAccountRole'] = 'event'): Category => ({
  id, name, icon: 'gift', defaultAccountRole: role, order: 0, deleted: false,
});
const CATS = [cat('c-fam', '경조사'), cat('c-gift', '선물'), cat('c-food', '식비', 'fixed')];

const spend = (date: string, amount: number, p: Partial<Expense> = {}) => expense({ date, amount, accountId: eventAcc.id, ...p });

const trip = (id: string, name: string, deleted = false): Trip => ({
  id, name, startDate: '2026-09-01', endDate: '2026-09-03', budget: 0, items: {}, memo: '', author: 'a', createdAt: '', updatedAt: '', deleted,
});

function ledger(p: Partial<LedgerData> = {}): LedgerData {
  return emptyLedger({ accounts: [income, eventAcc, reservoir], categories: CATS, ...p });
}

/** 여러 경로가 섞인 가계부: 보통 · 일정 · 여행 · 할부 · 예외 · 청구 · 저수지 이벤트 청구 · 저수지 보통 지출 · 지운 지출 */
function mixed(): LedgerData {
  return ledger({
    trips: [trip('t1', '제주 여행'), trip('t-old', '지운 여행', true)],
    events: [event({ id: 'ev-b', name: '장모님 생신', date: '2026-09-20', amount: 300_000, accountId: eventAcc.id, status: 'done' })],
    fixedExpenses: [fixed({ id: 'tv', name: 'TV 할부', kind: 'installment', amount: 50_000, accountId: eventAcc.id, dayOfMonth: 5, startMonth: '2026-09', endMonth: '2026-10' })],
    expenses: [
      spend('2026-09-11', 30_000, { id: 'plain', categoryId: 'c-gift' }),
      spend('2026-09-20', 280_000, { id: 'ev', eventId: 'ev-b', categoryId: 'c-fam' }),
      spend('2026-09-02', 400_000, { id: 'trip', tripId: 't1' }),
      spend('2026-09-03', 10_000, { id: 'trip-old', tripId: 't-old', categoryId: 'c-gift' }),
      spend('2026-09-05', 50_000, { id: 'tv-1', fixedExpenseId: 'tv' }),
      spend('2026-10-12', 20_000, { id: 'excl', categoryId: 'c-gift', excluded: true }),
      spend('2026-10-28', 120_000, { id: 'claim', categoryId: 'c-fam', paidBy: '민지', claimAccountId: income.id }),
      expense({ id: 'res-claim', date: '2026-10-15', amount: 70_000, accountId: reservoir.id, categoryId: 'c-gift', paidBy: '민구', claimAccountId: income.id }),
      expense({ id: 'res-plain', date: '2026-10-16', amount: 90_000, accountId: reservoir.id, categoryId: 'c-gift' }),
      expense({ id: 'res-food-claim', date: '2026-10-17', amount: 15_000, accountId: reservoir.id, categoryId: 'c-food', paidBy: '민구' }),
      spend('2026-10-01', 99_000, { id: 'gone', deleted: true }),
      spend('2026-11-20', 40_000, { id: 'ahead', categoryId: 'c-gift' }),
    ],
    transfers: [transfer({ id: 'claim:claim', date: '2026-11-05', amount: 120_000, fromAccountId: eventAcc.id, toAccountId: income.id })],
  });
}

const ids = (list: { expense: Expense }[]) => list.map((r) => r.expense.id);

describe('이벤트통장 기록 고르기', () => {
  it('이벤트통장 지출 + 저수지 이벤트 청구 (지운 지출 · 저수지 보통 지출 · 이벤트 아닌 저수지 청구는 빼요)', () => {
    const data = mixed();
    expect(ids(eventRecords(data, eventAcc.id))).toEqual([
      'plain', 'ev', 'trip', 'trip-old', 'tv-1', 'excl', 'claim', 'res-claim', 'ahead',
    ]);
    const res = eventRecords(data, eventAcc.id).find((r) => r.expense.id === 'res-claim')!;
    expect(res.record.accountId).toBe(eventAcc.id);
    expect(res.expense.accountId).toBe(reservoir.id);
    expect(res.month).toBe('2026-10');
  });

  it('reservoirClaims: false 면 통장에 기록된 이벤트통장 지출만', () => {
    expect(ids(eventRecords(mixed(), eventAcc.id, { reservoirClaims: false }))).not.toContain('res-claim');
    expect(asEventRecord(mixed(), mixed().expenses.find((e) => e.id === 'res-claim')!, eventAcc.id, false)).toBeNull();
  });

  it('scope: unplanned 는 일정 · 여행 · 고정 지출 자동 기록을 빼고, usual 은 예외 표시도 빼요', () => {
    expect(ids(eventRecords(mixed(), eventAcc.id, { scope: 'unplanned' }))).toEqual(['plain', 'excl', 'claim', 'res-claim', 'ahead']);
    expect(ids(eventRecords(mixed(), eventAcc.id, { scope: 'usual' }))).toEqual(['plain', 'claim', 'res-claim', 'ahead']);
  });

  it('달 · 날짜 범위로 거를 수 있어요 (범위 끝 포함)', () => {
    expect(ids(eventRecords(mixed(), eventAcc.id, { month: '2026-10' }))).toEqual(['excl', 'claim', 'res-claim']);
    expect(ids(eventRecords(mixed(), eventAcc.id, { from: '2026-09-05', to: '2026-10-15' }))).toEqual(['plain', 'ev', 'tv-1', 'excl', 'res-claim']);
  });

  it('날짜가 없는 지출은 기록이 아니에요', () => {
    const data = ledger({ expenses: [spend('', 10_000)] });
    expect(eventRecords(data, eventAcc.id)).toEqual([]);
  });

  it('달별 · 카테고리별 합', () => {
    const sums = sumByMonthAndCategory(eventRecords(mixed(), eventAcc.id, { scope: 'usual' }));
    expect([...sums.keys()]).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(Object.fromEntries(sums.get('2026-10')!)).toEqual({ 'c-fam': 120_000, 'c-gift': 70_000 });
  });

  it('지운 여행에 묶인 지출은 여행 지출로 보지 않아요 · 오늘 뒤 날짜는 예정', () => {
    const live = liveTripIds(mixed());
    expect(isLiveTripExpense({ tripId: 't1' }, live)).toBe(true);
    expect(isLiveTripExpense({ tripId: 't-old' }, live)).toBe(false);
    expect(isLiveTripExpense({}, live)).toBe(false);
    expect(recordPhase({ date: TODAY }, TODAY)).toBe('spent');
    expect(recordPhase({ date: '2026-11-11' }, TODAY)).toBe('planned');
  });
});

describe('묶음 이름', () => {
  it('월별 비용: 여행 → 일정 → 할부 → 카테고리 (지운 여행은 건너뛰어요)', () => {
    const data = mixed();
    const names = eventRecordNames(data);
    const group = (id: string) => eventRecordGroup(data, data.expenses.find((e) => e.id === id)!, names);
    expect(group('trip')).toEqual({ key: 'trip:t1', kind: 'trip', label: '제주 여행' });
    expect(group('ev')).toEqual({ key: 'event:ev-b', kind: 'event', label: '장모님 생신' });
    expect(group('tv-1')).toMatchObject({ kind: 'installment', label: 'TV 할부' });
    expect(group('trip-old')).toEqual({ key: 'cat:c-gift', kind: 'category', label: '선물' });
    expect(eventRecordGroup(data, spend('2026-09-01', 1), names)).toEqual({ key: 'cat:', kind: 'category', label: '기타' });
  });

  it('통계 회고: 여행 · 일정만, 지운 것도 이름으로, 이름이 없으면 여행 · 일정', () => {
    const names = eventRecordNames(mixed(), { includeDeleted: true });
    expect(eventPlanGroup({ tripId: 't-old', eventId: null }, names)).toEqual({ key: 'trip:t-old', kind: 'trip', label: '지운 여행' });
    expect(eventPlanGroup({ tripId: 'nope', eventId: null }, names)).toMatchObject({ label: '여행' });
    expect(eventPlanGroup({ eventId: 'nope' }, names)).toEqual({ key: 'event:nope', kind: 'event', label: '일정' });
    expect(eventPlanGroup({ eventId: null }, names)).toBeNull();
  });
});

describe('달별 줄 (지난 달 쓴 돈)', () => {
  it('기록만으로 본 달별 줄은 월별 이벤트 비용의 지난 달과 같아요', () => {
    const data = mixed();
    const past = eventRecordMonths(data, eventAcc.id, '2025-11', '2026-10', TODAY);
    const costs = eventMonthlyCosts(data, TODAY).filter((c) => c.phase === 'past');
    expect(past).toEqual(costs.map(({ phase: _phase, ...rest }) => rest));
    const sep = past.find((m) => m.month === '2026-09')!;
    expect(sep.total).toBe(30_000 + 280_000 + 400_000 + 10_000 + 50_000);
    expect(sep.items.map((i) => i.label)).toEqual(['제주 여행', '장모님 생신', 'TV 할부', '선물']);
  });

  it('오늘 뒤 날짜로 미리 기록한 지출은 예정으로 따로 세요', () => {
    const nov = eventRecordMonths(mixed(), eventAcc.id, '2026-11', '2026-11', TODAY)[0]!;
    expect(nov).toMatchObject({ month: '2026-11', spent: 0, planned: 40_000, total: 40_000 });
  });
});

describe('달별 한 목록 (정산 상태)', () => {
  it('지출마다 상태: 돌려줄 청구 · 지급함 · 저수지에서 빌림 · 이벤트통장 지출', () => {
    const data = ledger({
      expenses: [
        spend('2026-10-01', 10_000, { id: 'a' }),
        spend('2026-10-02', 20_000, { id: 'b', paidBy: '민지' }),
        spend('2026-10-03', 30_000, { id: 'c', paidBy: '민지' }),
        spend('2026-10-04', 40_000, { id: 'd', paidBy: '민구' }),
        spend('2026-10-05', 50_000, { id: 'e', categoryId: 'c-gift' }),
      ],
      transfers: [
        transfer({ id: 'claim:c', date: '2026-10-21', amount: 30_000, fromAccountId: eventAcc.id }),
        transfer({ id: 'claim:d', date: '2026-10-21', amount: 40_000, fromAccountId: eventAcc.id }),
        transfer({ id: 'loan:claim:d', date: '2026-10-21', amount: 40_000, fromAccountId: reservoir.id, toAccountId: eventAcc.id }),
        transfer({ id: 'loan:e', date: '2026-10-05', amount: 50_000, fromAccountId: reservoir.id, toAccountId: eventAcc.id }),
        transfer({ id: 'claim:b', date: '2026-10-21', amount: 20_000, fromAccountId: eventAcc.id, deleted: true }),
      ],
    });
    const status = (id: string) => eventRecordStatus(data, data.expenses.find((e) => e.id === id)!);
    expect(status('a')).toBe('plain');
    expect(status('b')).toBe('claimPending');
    expect(status('c')).toBe('claimPaid');
    expect(status('d')).toBe('borrowed');
    expect(status('e')).toBe('borrowed');
  });

  it('최근 달 먼저, 달 안에서는 최근 것 먼저 · 달마다 합', () => {
    const list = eventRecordList(mixed(), eventAcc.id);
    expect(list.map((m) => m.month)).toEqual(['2026-11', '2026-10', '2026-09']);
    const oct = list[1]!;
    expect(oct.total).toBe(20_000 + 120_000 + 70_000);
    expect(oct.items.map((i) => [i.expense.id, i.status])).toEqual([
      ['claim', 'claimPaid'],
      ['res-claim', 'claimPending'],
      ['excl', 'plain'],
    ]);
  });
});

describe('통장에 기록된 지출만 세는 곳', () => {
  it('통계 회고 · 이번 달 사용은 저수지 이벤트 청구를 이벤트통장 쓴 돈에 넣지 않아요', () => {
    const data = ledger({
      expenses: [
        spend('2026-11-02', 10_000, { id: 'own' }),
        expense({ id: 'res', date: '2026-11-03', amount: 70_000, accountId: reservoir.id, categoryId: 'c-gift', paidBy: '민구', claimAccountId: income.id }),
      ],
    });
    expect(eventRecords(data, eventAcc.id, { month: '2026-11' })).toHaveLength(2);
    expect(eventYearReview(data, '2026-11', TODAY)!.spent).toBe(10_000);
    expect(eventMonthUsage(data, computeSettlement(data, TODAY), TODAY).spent).toBe(10_000);
  });
});
