import { describe, expect, it } from 'vitest';
import { account, emptyLedger, event, expense, fixed, transfer } from './_fixtures';
import { eventMonthlyCosts, eventMonthSummaryText, eventMonthTopItems, shortMan } from './eventMonths';
import { projectEventAccount } from './events';
import type { Category, Expense, LedgerData, Trip } from './types';

const TODAY = '2026-11-10';
const income = account('income', { order: 0, openingDate: '2026-01-01' });
const eventAcc = account('event', { order: 2, openingBalance: 5_000_000, openingDate: '2026-01-01' });
const reservoir = account('reservoir', { order: 3, openingBalance: 9_000_000, openingDate: '2026-01-01' });

const cat = (id: string, name: string): Category => ({ id, name, icon: 'gift', defaultAccountRole: 'event', order: 0, deleted: false });
const CATS = [cat('c-fam', '경조사'), cat('c-gift', '선물')];

const spend = (date: string, amount: number, p: Partial<Expense> = {}) => expense({ date, amount, accountId: eventAcc.id, ...p });

function ledger(p: Partial<LedgerData> = {}): LedgerData {
  return emptyLedger({ accounts: [income, eventAcc, reservoir], categories: CATS, ...p });
}

const monthOf = (data: LedgerData, m: string) => eventMonthlyCosts(data, TODAY).find((x) => x.month === m)!;

describe('월별 이벤트 비용', () => {
  it('지난 12개월 → 이번 달 → 앞으로 12개월, 달마다 지난/이번/앞으로를 표시해요', () => {
    const list = eventMonthlyCosts(ledger(), TODAY);
    expect(list).toHaveLength(25);
    expect(list[0]).toMatchObject({ month: '2025-11', phase: 'past' });
    expect(list[12]).toMatchObject({ month: '2026-11', phase: 'current' });
    expect(list[24]).toMatchObject({ month: '2027-11', phase: 'future' });
    expect(eventMonthlyCosts(ledger(), TODAY, { pastMonths: 2, futureMonths: 3 }).map((m) => m.month)).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });

  it('이벤트통장이 없으면 빈 목록', () => {
    expect(eventMonthlyCosts(emptyLedger({ accounts: [income] }), TODAY)).toEqual([]);
  });

  it('지난 달: 쓴 돈을 여행 → 일정 → 할부 → 카테고리 순으로 묶어요', () => {
    const trip: Trip = {
      id: 't1', name: '제주 여행', startDate: '2026-09-01', endDate: '2026-09-03', budget: 0, items: {}, memo: '', author: 'a',
      createdAt: '', updatedAt: '', deleted: false,
    };
    const tv = fixed({ id: 'tv', name: 'TV 할부', kind: 'installment', amount: 50_000, accountId: eventAcc.id, dayOfMonth: 5, startMonth: '2026-09', endMonth: '2026-10' });
    const birthday = event({ id: 'ev-b', name: '장모님 생신', date: '2026-09-20', amount: 300_000, accountId: eventAcc.id, status: 'done', categoryId: 'c-fam' });
    const data = ledger({
      trips: [trip],
      events: [birthday],
      fixedExpenses: [tv],
      expenses: [
        spend('2026-09-02', 400_000, { tripId: 't1', eventId: 'ev-b' }),
        spend('2026-09-20', 280_000, { eventId: 'ev-b', categoryId: 'c-fam' }),
        spend('2026-09-05', 50_000, { fixedExpenseId: 'tv' }),
        spend('2026-09-11', 30_000, { categoryId: 'c-gift' }),
        spend('2026-09-12', 20_000, { categoryId: 'c-gift', excluded: true }),
        spend('2026-09-13', 10_000),
        spend('2026-09-14', 99_000, { deleted: true }),
      ],
    });
    const sep = monthOf(data, '2026-09');
    expect(sep.phase).toBe('past');
    expect(sep.total).toBe(790_000);
    expect(sep.spent).toBe(790_000);
    expect(sep.planned).toBe(0);
    expect(sep.items.map((i) => [i.label, i.amount, i.kind])).toEqual([
      ['제주 여행', 400_000, 'trip'],
      ['장모님 생신', 280_000, 'event'],
      ['TV 할부', 50_000, 'installment'],
      ['선물', 50_000, 'category'],
      ['기타', 10_000, 'category'],
    ]);
    expect(sep.items.find((i) => i.label === '선물')!.expenseIds).toHaveLength(2);
  });

  it('청구는 돌려준 날이 아니라 쓴 날의 달에 세고, 이체(돌려준 청구 · 빌린 돈 · 갚은 돈)는 넣지 않아요', () => {
    const claim = spend('2026-08-28', 120_000, { id: 'ex-claim', categoryId: 'c-fam', paidBy: '민지', claimAccountId: income.id });
    // 저수지 돈으로 낸 이벤트 청구 (빌려 돌려줌)도 이벤트통장 지출로 세요
    const borrowed = expense({ id: 'ex-res', date: '2026-08-15', amount: 70_000, accountId: reservoir.id, categoryId: 'c-gift', paidBy: '민구', claimAccountId: income.id });
    const data = ledger({
      expenses: [claim, borrowed],
      transfers: [
        transfer({ id: 'claim:ex-claim', date: '2026-09-21', amount: 120_000, fromAccountId: eventAcc.id, toAccountId: income.id }),
        transfer({ id: 'loan:claim:ex-res', date: '2026-09-21', amount: 70_000, fromAccountId: reservoir.id, toAccountId: eventAcc.id }),
        transfer({ id: 'loanpay:1', date: '2026-10-05', amount: 70_000, fromAccountId: eventAcc.id, toAccountId: reservoir.id }),
      ],
    });
    expect(monthOf(data, '2026-08').items.map((i) => [i.label, i.amount])).toEqual([
      ['경조사', 120_000],
      ['선물', 70_000],
    ]);
    expect(monthOf(data, '2026-09').total).toBe(0);
    expect(monthOf(data, '2026-10').total).toBe(0);
  });

  it('이번 달: 오늘까지 쓴 돈 + 남은 일정 · 미리 기록한 지출 · 평소 쓰는 돈. 같은 일정은 한 줄로 합쳐요', () => {
    const party = event({ id: 'ev-p', name: '돌잔치', date: '2026-11-25', amount: 200_000, accountId: eventAcc.id, categoryId: 'c-fam' });
    const data = ledger({
      events: [party],
      expenses: [
        spend('2026-11-03', 50_000, { eventId: 'ev-p', categoryId: 'c-fam' }),
        spend('2026-11-05', 30_000, { categoryId: 'c-gift' }),
        spend('2026-11-28', 40_000, { categoryId: 'c-gift' }),
        // 평소 쓰는 돈 기록: 기록 시작(1월)부터 10개월 평균 선물 120,000 → 이번 달 선물 70,000 을 빼고 50,000
        ...['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m) => spend(`${m}-15`, 200_000, { categoryId: 'c-gift' })),
      ],
    });
    const nov = monthOf(data, '2026-11');
    const p = projectEventAccount(data, TODAY).months[0]!;
    expect(nov.phase).toBe('current');
    const byLabel = Object.fromEntries(nov.items.map((i) => [i.label, i]));
    expect(byLabel['돌잔치']).toMatchObject({ spent: 50_000, planned: 150_000, amount: 200_000 });
    expect(byLabel['선물']).toMatchObject({ spent: 30_000, planned: 40_000 });
    expect(p.usual).toBe(50_000);
    expect(byLabel['평소 쓰는 돈']).toMatchObject({ planned: p.usual, shortLabel: '평소' });
    expect(nov.items[nov.items.length - 1]!.kind).toBe('usual');
    expect(nov.spent).toBe(80_000);
    expect(nov.planned).toBe(150_000 + 40_000 + p.usual);
  });

  it('앞으로: 예측의 일정(반복 펼침) · 여행 남은 예산 · 할부 회차 · 평소 쓰는 돈을 예측과 같은 금액으로 보여요', () => {
    const trip: Trip = {
      id: 't2', name: '오사카', startDate: '2027-02-10', endDate: '2027-02-12', budget: 900_000, items: {}, memo: '', author: 'a',
      createdAt: '', updatedAt: '', deleted: false,
    };
    const tv = fixed({ id: 'tv', name: 'TV 할부', kind: 'installment', amount: 50_000, accountId: eventAcc.id, dayOfMonth: 5, startMonth: '2026-12', endMonth: '2027-05' });
    const data = ledger({
      trips: [trip],
      fixedExpenses: [tv],
      events: [event({ id: 'ev-m', name: '장모님 생신', date: '2026-12-12', amount: 300_000, accountId: eventAcc.id, repeat: 'yearly', categoryId: 'c-fam' })],
      expenses: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m) => spend(`${m}-15`, 500_000, { categoryId: 'c-gift' })),
    });
    const list = eventMonthlyCosts(data, TODAY);
    const proj = projectEventAccount(data, TODAY, { horizonMonths: 13 });
    for (const m of proj.months) {
      const c = list.find((x) => x.month === m.month)!;
      expect(c.planned).toBe(m.planned + m.usual + (m.trips ?? 0) + (m.installments ?? 0));
    }
    const dec = list.find((x) => x.month === '2026-12')!;
    expect(dec.phase).toBe('future');
    expect(dec.items.map((i) => i.label)).toEqual(['장모님 생신', 'TV 할부', '평소 쓰는 돈']);
    expect(list.find((x) => x.month === '2027-02')!.items[0]).toMatchObject({ label: '오사카', kind: 'trip', amount: 900_000 });
    // 매년 반복은 13번째 달(다음 해 같은 달)에도 펼쳐요
    expect(list.find((x) => x.month === '2027-11')).toBeTruthy();
    expect(list.find((x) => x.month === '2027-06')!.items.some((i) => i.kind === 'installment')).toBe(false);
  });

  it('한 줄 요약: 큰 줄 2개 + 평소 (평소가 없으면 3개), 금액은 천 원 단위', () => {
    const plan: Partial<LedgerData> = {
      fixedExpenses: [fixed({ id: 'tv', name: 'TV 할부', kind: 'installment', amount: 50_000, accountId: eventAcc.id, dayOfMonth: 5, startMonth: '2026-12', endMonth: '2027-05' })],
      events: [
        event({ name: '장모님 생신', date: '2026-12-12', amount: 300_000, accountId: eventAcc.id, categoryId: 'c-fam' }),
        event({ name: '조카 선물', date: '2026-12-20', amount: 20_000, accountId: eventAcc.id, categoryId: 'c-gift' }),
      ],
    };
    const data = ledger({
      ...plan,
      expenses: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m) => spend(`${m}-15`, 500_000)),
    });
    const dec = monthOf(data, '2026-12');
    expect(eventMonthTopItems(dec).map((i) => i.shortLabel)).toEqual(['장모님 생신', 'TV 할부', '평소']);
    // 평소 쓰는 돈: 기록 시작(1월)부터 10개월 평균 300만/10 = 30만
    expect(eventMonthSummaryText(dec, TODAY)).toBe('12월 67만 · 장모님 생신 30만 · TV 할부 5만 · 평소 30만');
    // 기록이 없으면 평소 쓰는 돈이 없어 큰 줄 3개
    const bare = ledger(plan);
    expect(eventMonthSummaryText(monthOf(bare, '2026-12'), TODAY)).toBe('12월 37만 · 장모님 생신 30만 · TV 할부 5만 · 조카 선물 2만');
    expect(eventMonthSummaryText(monthOf(bare, '2027-01'), TODAY)).toBe('2027년 1월 5만 · TV 할부 5만');
    const empty = monthOf(ledger(), '2026-03');
    expect(eventMonthSummaryText(empty, TODAY)).toBe('3월 0원');
    expect(eventMonthTopItems({ items: [1, 2, 3, 4].map((n) => ({ ...dec.items[0]!, key: `k${n}`, kind: 'category' as const })) })).toHaveLength(3);
  });

  it('shortMan: 천 원 단위 반올림, 원 없이', () => {
    expect(shortMan(850_000)).toBe('85만');
    expect(shortMan(5_000)).toBe('5천');
    expect(shortMan(828_400)).toBe('82.8만');
    expect(shortMan(0)).toBe('0원');
  });
});
