import { describe, expect, it } from 'vitest';
import { account, emptyLedger, expense, fixed, rule, transfer } from './_fixtures';
import {
  budgetState,
  budgetVsActual,
  categoryDonutSlices,
  clampStatsMonth,
  eventYearReview,
  monthCategorySpend,
  spendingTrend,
  statsAsOf,
  statsMonthRange,
  trendAverage,
} from './stats';
import type { Category, LedgerData } from './types';

const TODAY = '2026-11-10';
const cat = (id: string, name: string, role: Category['defaultAccountRole'] = 'fixed'): Category => ({
  id, name, icon: 'dots', defaultAccountRole: role, order: 0, deleted: false,
});
const living = account('fixed', { id: 'acc-living', order: 0 });
const minjiLiving = account('fixed', { id: 'acc-minji', order: 1, ownerName: '민지', ownerEmail: 'minji@x' });
const junhoLiving = account('fixed', { id: 'acc-junho', order: 2, ownerName: '준호', ownerEmail: 'junho@x' });
const eventAcc = account('event', { order: 3, openingBalance: 1_000_000, openingDate: '2025-01-01' });
const reservoir = account('reservoir', { order: 4 });
const income = account('income', { order: 5 });
const allowance = account('allowance', { id: 'acc-allow', order: 6 });

const CATS = [cat('c-food', '식비'), cat('c-cafe', '카페'), cat('c-shop', '쇼핑'), cat('c-fam', '경조사', 'event'), cat('c-gift', '선물', 'event'), cat('c-a', '가'), cat('c-b', '나'), cat('c-c', '다')];

function ledger(p: Partial<LedgerData>): LedgerData {
  return emptyLedger({
    accounts: [living, eventAcc, reservoir, income, allowance],
    categories: CATS,
    ...p,
  });
}

describe('통계 — 상태', () => {
  it('넘으면 over, 90% 이상 warning, 예산 없으면 none', () => {
    expect(budgetState(110, 100)).toBe('over');
    expect(budgetState(100, 100)).toBe('warning');
    expect(budgetState(90, 100)).toBe('warning');
    expect(budgetState(89, 100)).toBe('ok');
    expect(budgetState(50, 0)).toBe('none');
  });

  it('기준 날짜: 이번 달 = 오늘, 지난 달 = 1일', () => {
    expect(statsAsOf('2026-11', TODAY)).toBe(TODAY);
    expect(statsAsOf('2026-09', TODAY)).toBe('2026-09-01');
  });

  it('고를 수 있는 달: 가장 앞 지출 달 ~ 이번 달', () => {
    const data = ledger({ expenses: [expense({ date: '2025-03-02', amount: 1000, accountId: living.id })] });
    expect(statsMonthRange(data, TODAY)).toEqual({ min: '2025-03', max: '2026-11' });
    expect(clampStatsMonth(data, TODAY, '2027-01')).toBe('2026-11');
    expect(clampStatsMonth(data, TODAY, '2020-01')).toBe('2025-03');
    expect(clampStatsMonth(data, TODAY, 'nope')).toBe('2026-11');
    expect(clampStatsMonth(data, TODAY, '2026-02')).toBe('2026-02');
  });
});

describe('통계 — ① 달별 예산 대비 실제', () => {
  const rows = [
    fixed({ kind: 'living', accountId: living.id, categoryId: 'c-food', amount: 400_000, spread: 'monthly' }),
    fixed({ kind: 'living', accountId: living.id, categoryId: 'c-cafe', amount: 100_000, spread: 'monthly' }),
    fixed({ kind: 'living', accountId: living.id, categoryId: 'c-shop', amount: 200_000, spread: 'monthly' }),
    fixed({ kind: 'bill', accountId: living.id, name: '월세', amount: 500_000, dayOfMonth: 25 }),
  ];
  const data = ledger({
    fixedExpenses: rows,
    rules: [rule({ fromAccountId: income.id, toAccountId: allowance.id, amount: 300_000, startMonth: '2026-01' })],
    expenses: [
      expense({ date: '2026-10-03', amount: 450_000, accountId: living.id, categoryId: 'c-food' }),
      expense({ date: '2026-10-04', amount: 95_000, accountId: living.id, categoryId: 'c-cafe' }),
      expense({ date: '2026-10-05', amount: 50_000, accountId: living.id, categoryId: 'c-shop' }),
      expense({ date: '2026-10-06', amount: 30_000, accountId: living.id, categoryId: null }),
      expense({ date: '2026-10-25', amount: 500_000, accountId: living.id, fixedExpenseId: rows[3]!.id, categoryId: null }),
      expense({ date: '2026-10-12', amount: 40_000, accountId: allowance.id }),
      // 다른 달은 안 셈
      expense({ date: '2026-11-03', amount: 1_000_000, accountId: living.id, categoryId: 'c-food' }),
    ],
  });

  it('지난 달: 항목마다 예산 · 쓴 돈 · 상태, 고정비 · 용돈 합', () => {
    const b = budgetVsActual(data, '2026-10', TODAY);
    const byName = Object.fromEntries(b.rows.map((r) => [r.name, r]));
    expect(byName['식비']).toMatchObject({ budget: 400_000, spent: 450_000, state: 'over' });
    expect(byName['카페']).toMatchObject({ budget: 100_000, spent: 95_000, state: 'warning' });
    expect(byName['쇼핑']).toMatchObject({ budget: 200_000, spent: 50_000, state: 'ok', ratio: 0.25 });
    expect(byName['기타(예산 없음)']).toMatchObject({ budget: 0, spent: 30_000, state: 'none' });
    expect(b.overCount).toBe(1);
    expect(b.warningCount).toBe(1);
    expect(b.budget).toBe(700_000);
    expect(b.spent).toBe(625_000);
    expect(b.fixed).toEqual({ planned: 500_000, paid: 500_000 });
    expect(b.allowance).toEqual({ planned: 300_000, spent: 40_000 });
  });

  it('용돈 통장 · 고정비가 없으면 null', () => {
    const b = budgetVsActual(ledger({ accounts: [living], fixedExpenses: [rows[0]!] }), '2026-10', TODAY);
    expect(b.fixed).toBeNull();
    expect(b.allowance).toBeNull();
    expect(b.rows.map((r) => r.name)).toEqual(['식비']);
  });
});

describe('통계 — ② 카테고리별 비율', () => {
  const data = ledger({
    accounts: [minjiLiving, junhoLiving, eventAcc],
    members: [
      { email: 'minji@x', displayName: '민지' },
      { email: 'junho@x', displayName: '준호' },
    ],
    expenses: [
      expense({ date: '2026-11-01', amount: 60_000, accountId: minjiLiving.id, categoryId: 'c-food' }),
      expense({ date: '2026-11-02', amount: 40_000, accountId: junhoLiving.id, categoryId: 'c-food' }),
      expense({ date: '2026-11-02', amount: 30_000, accountId: junhoLiving.id, categoryId: 'c-cafe' }),
      expense({ date: '2026-11-03', amount: 20_000, accountId: minjiLiving.id, categoryId: 'c-shop' }),
      expense({ date: '2026-11-03', amount: 10_000, accountId: minjiLiving.id, categoryId: 'c-a' }),
      expense({ date: '2026-11-03', amount: 9_000, accountId: minjiLiving.id, categoryId: 'c-b' }),
      expense({ date: '2026-11-03', amount: 8_000, accountId: minjiLiving.id, categoryId: 'c-c' }),
      expense({ date: '2026-11-04', amount: 7_000, accountId: minjiLiving.id, categoryId: null }),
      // 청구: 낸 사람(준호)이 쓴 사람, 쓴 날짜 달에 셈
      expense({ date: '2026-11-05', amount: 5_000, accountId: eventAcc.id, categoryId: 'c-gift', paidBy: '준호' }),
      expense({ date: '2026-10-30', amount: 99_000, accountId: minjiLiving.id, categoryId: 'c-food' }),
      expense({ date: '2026-11-06', amount: 99_000, accountId: minjiLiving.id, categoryId: 'c-food', deleted: true }),
    ],
  });

  it('전체: 카테고리마다 합 · 큰 순, 분류 없음 포함', () => {
    const rows = monthCategorySpend(data, '2026-11');
    expect(rows.map((r) => [r.name, r.amount])).toEqual([
      ['식비', 100_000],
      ['카페', 30_000],
      ['쇼핑', 20_000],
      ['가', 10_000],
      ['나', 9_000],
      ['다', 8_000],
      ['분류 없음', 7_000],
      ['선물', 5_000],
    ]);
    expect(rows[0]!.count).toBe(2);
  });

  it('도넛: 5개 + 기타 (몫 합 1)', () => {
    const slices = categoryDonutSlices(monthCategorySpend(data, '2026-11'));
    expect(slices.map((s) => s.name)).toEqual(['식비', '카페', '쇼핑', '가', '나', '기타']);
    expect(slices.at(-1)).toMatchObject({ key: '_other', amount: 20_000, colorIndex: null });
    expect(slices.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
    expect(categoryDonutSlices([])).toEqual([]);
  });

  it('사람 고르기: 실제로 쓴 사람으로 거름', () => {
    expect(monthCategorySpend(data, '2026-11', 'junho@x').map((r) => [r.name, r.amount])).toEqual([
      ['식비', 40_000],
      ['카페', 30_000],
      ['선물', 5_000],
    ]);
    expect(monthCategorySpend(data, '2026-11', 'minji@x').reduce((s, r) => s + r.amount, 0)).toBe(114_000);
  });
});

describe('통계 — ③ 월별 추이', () => {
  it('고른 달까지 12개월, 기록 없는 달은 0, 평균은 기록 있는 달만', () => {
    const data = ledger({
      expenses: [
        expense({ date: '2026-11-01', amount: 100_000, accountId: living.id }),
        expense({ date: '2026-11-09', amount: 50_000, accountId: eventAcc.id }),
        expense({ date: '2026-06-01', amount: 30_000, accountId: living.id }),
        expense({ date: '2025-11-30', amount: 1_000, accountId: living.id }),
      ],
    });
    const t = spendingTrend(data, '2026-11');
    expect(t).toHaveLength(12);
    expect(t[0]!.month).toBe('2025-12');
    expect(t.at(-1)).toEqual({ month: '2026-11', total: 150_000, count: 2 });
    expect(t.find((m) => m.month === '2026-06')!.total).toBe(30_000);
    expect(t.find((m) => m.month === '2026-07')!.total).toBe(0);
    expect(trendAverage(t)).toBe(90_000);
    expect(trendAverage([])).toBe(0);
  });
});

describe('통계 — ④ 이벤트통장 1년 회고', () => {
  const data = ledger({
    events: [
      { id: 'ev-wed', date: '2026-05-16', name: '민수 결혼식', amount: 200_000, accountId: eventAcc.id, categoryId: 'c-fam', status: 'done', repeat: 'none', memo: '', author: 'a@x', createdAt: '', updatedAt: '', deleted: false },
    ],
    trips: [
      { id: 'trip-jeju', name: '제주', startDate: '2026-08-01', endDate: '2026-08-03', budget: 0, items: {}, memo: '', author: 'a@x', createdAt: '', updatedAt: '', deleted: false },
    ],
    transfers: [
      transfer({ date: '2026-01-21', amount: 500_000, fromAccountId: income.id, toAccountId: eventAcc.id }),
      transfer({ date: '2026-02-21', amount: 500_000, fromAccountId: income.id, toAccountId: eventAcc.id }),
      transfer({ id: 'loan:claim:x1', date: '2026-03-21', amount: 300_000, fromAccountId: reservoir.id, toAccountId: eventAcc.id }),
      transfer({ id: 'loanpay:2026-06', date: '2026-06-21', amount: 100_000, fromAccountId: eventAcc.id, toAccountId: reservoir.id }),
      transfer({ id: 'claim:x1', date: '2026-03-21', amount: 300_000, fromAccountId: eventAcc.id, toAccountId: income.id }),
      transfer({ date: '2026-04-01', amount: 50_000, fromAccountId: eventAcc.id, toAccountId: reservoir.id }),
      transfer({ date: '2026-04-02', amount: 10_000, kind: 'adjustment', toAccountId: eventAcc.id }),
      // 기간 밖
      transfer({ date: '2025-11-21', amount: 999_000, fromAccountId: income.id, toAccountId: eventAcc.id }),
      transfer({ date: '2026-11-21', amount: 999_000, fromAccountId: income.id, toAccountId: eventAcc.id }),
    ],
    expenses: [
      expense({ id: 'x1', date: '2026-03-02', amount: 300_000, accountId: eventAcc.id, categoryId: 'c-gift', paidBy: '민지', claimAccountId: income.id }),
      expense({ date: '2026-05-16', amount: 200_000, accountId: eventAcc.id, categoryId: 'c-fam', eventId: 'ev-wed' }),
      expense({ date: '2026-07-20', amount: 150_000, accountId: eventAcc.id, categoryId: 'c-fam', tripId: 'trip-jeju' }),
      expense({ date: '2026-08-02', amount: 250_000, accountId: eventAcc.id, categoryId: null, tripId: 'trip-jeju' }),
      expense({ date: '2026-11-05', amount: 20_000, accountId: eventAcc.id, categoryId: 'c-gift' }),
      // 오늘 뒤 · 다른 통장 · 기간 밖
      expense({ date: '2026-11-20', amount: 70_000, accountId: eventAcc.id, categoryId: 'c-gift' }),
      expense({ date: '2026-05-01', amount: 70_000, accountId: living.id, categoryId: 'c-food' }),
      expense({ date: '2025-11-30', amount: 70_000, accountId: eventAcc.id, categoryId: 'c-gift' }),
    ],
  });

  it('적립 · 쓴 돈(청구는 쓴 날짜) · 빌린 돈 · 갚은 돈 · 옮긴 돈 · 잔액 변화', () => {
    const r = eventYearReview(data, '2026-11', TODAY)!;
    expect(r.from).toBe('2025-12');
    expect(r.until).toBe(TODAY);
    expect(r.contributed).toBe(1_000_000);
    expect(r.spent).toBe(920_000);
    expect(r.spentCount).toBe(5);
    expect(r.claimSpent).toBe(300_000);
    expect(r.borrowed).toBe(300_000);
    expect(r.repaid).toBe(100_000);
    expect(r.movedOut).toBe(50_000);
    // 시작 잔액 = 100만 + 기간 앞 적립 99.9만 − 기간 앞 지출 7만
    expect(r.startBalance).toBe(1_929_000);
    // 잔액 변화 = 적립 100만 + 빌림 30만 + 맞추기 1만 − 돌려준 청구 30만 − 갚음 10만 − 옮김 5만 − 보통 지출 62만
    expect(r.net).toBe(1_000_000 + 300_000 + 10_000 - 300_000 - 100_000 - 50_000 - 620_000);
    expect(r.endBalance - r.startBalance).toBe(r.net);
  });

  it('가장 큰 일정 · 여행과 카테고리별 쓴 돈', () => {
    const r = eventYearReview(data, '2026-11', TODAY)!;
    expect(r.topEvents.map((e) => [e.kind, e.name, e.amount, e.firstDate])).toEqual([
      ['trip', '제주', 400_000, '2026-07-20'],
      ['event', '민수 결혼식', 200_000, '2026-05-16'],
    ]);
    expect(r.byCategory.map((c) => [c.name, c.amount])).toEqual([
      ['선물', 320_000],
      ['경조사', 350_000],
      ['분류 없음', 250_000],
    ].sort((a, b) => (b[1] as number) - (a[1] as number)));
  });

  it('지난 달을 고르면 그달 말일까지, 이벤트통장이 없으면 null', () => {
    const r = eventYearReview(data, '2026-06', TODAY)!;
    expect(r.from).toBe('2025-07');
    expect(r.until).toBe('2026-06-30');
    expect(r.spent).toBe(70_000 + 300_000 + 200_000);
    expect(eventYearReview(ledger({ accounts: [living] }), '2026-11', TODAY)).toBeNull();
  });
});
