import { describe, expect, it } from 'vitest';
import { account, emptyLedger, expense } from './_fixtures';
import type { Category, Expense, LedgerData } from './types';
import { usualSpendingInsight } from './usual';
import {
  savingsBar,
  usualBreakdown,
  usualDonutSlices,
  usualSpenderOptions,
  usualTrend,
  type UsualBreakdownRow,
} from './usualBreakdown';

const TODAY = '2026-11-10';
const eventAcc = account('event', { order: 2, openingDate: '2026-05-01' });
const minjiAcc = account('income', { id: 'acc-minji', order: 0, ownerName: '민지', ownerEmail: 'minji@x' });
const junhoAcc = account('income', { id: 'acc-junho', order: 1, ownerName: '준호', ownerEmail: 'junho@x' });
const cat = (id: string, name: string): Category => ({ id, name, icon: 'gift', defaultAccountRole: 'event', order: 0, deleted: false });
const CATS = [cat('c-fam', '경조사'), cat('c-gift', '선물'), cat('c-cafe', '카페'), cat('c-book', '책'), cat('c-pet', '반려'), cat('c-hobby', '취미')];

const spend = (date: string, amount: number, p: Partial<Expense> = {}) => expense({ date, amount, accountId: eventAcc.id, ...p });

function ledger(expenses: Expense[]): LedgerData {
  return emptyLedger({
    accounts: [minjiAcc, junhoAcc, eventAcc],
    categories: CATS,
    members: [
      { email: 'minji@x', displayName: '민지' },
      { email: 'junho@x', displayName: '준호' },
    ],
    expenses,
  });
}

const MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

describe('평소 쓰는 돈 항목별 평균', () => {
  it('최근 6개월 합 ÷ 6, 건수 · 건당 · 지난달, 월 평균 큰 순. 합은 카드의 평소 쓰는 돈과 같아요', () => {
    const data = ledger([
      ...MONTHS.map((m) => spend(`${m}-03`, 120_000, { categoryId: 'c-fam', author: 'minji@x' })),
      spend('2026-06-10', 30_000, { categoryId: 'c-gift', author: 'junho@x' }),
      spend('2026-10-20', 90_000, { categoryId: 'c-gift', author: 'junho@x' }),
      spend('2026-10-21', 10_000, { categoryId: null, author: 'junho@x' }),
    ]);
    const b = usualBreakdown(data, eventAcc.id, TODAY);
    expect(b.months).toEqual(MONTHS);
    expect(b.rows.map((r) => r.name)).toEqual(['경조사', '선물', '분류 없음']);
    const [fam, gift, none] = b.rows as [UsualBreakdownRow, UsualBreakdownRow, UsualBreakdownRow];
    expect(fam).toMatchObject({ monthly: 120_000, sum: 720_000, count: 6, perItem: 120_000, lastMonth: 120_000, trend: 'same' });
    expect(gift).toMatchObject({ monthly: 20_000, sum: 120_000, count: 2, perItem: 60_000, lastMonth: 90_000, trend: 'up' });
    expect(none).toMatchObject({ monthly: 1667, count: 1, trend: 'up' });
    // 그 항목 지출은 최근 것 먼저, 실제로 쓴 사람(이벤트통장 → 기록한 사람)
    expect(gift.items.map((i) => [i.date, i.spenderName])).toEqual([
      ['2026-10-20', '준호'],
      ['2026-06-10', '준호'],
    ]);
    const insight = usualSpendingInsight(data, TODAY, { accountId: eventAcc.id, monthlyContribution: 0, months: [] })!;
    expect(b.monthlyTotal).toBe(insight.monthlyUsual);
  });

  it('일정 · 여행 · 고정 지출 자동 기록 · 예외 · 다른 통장 · 이번 달 · 6개월 전 지출은 세지 않아요', () => {
    const data = ledger([
      spend('2026-10-01', 50_000, { categoryId: 'c-fam' }),
      spend('2026-10-02', 1_000_000, { categoryId: 'c-fam', excluded: true }),
      spend('2026-10-03', 70_000, { categoryId: 'c-fam', eventId: 'ev-1' }),
      spend('2026-10-04', 70_000, { categoryId: 'c-fam', tripId: 'trip-1' }),
      spend('2026-10-05', 70_000, { categoryId: 'c-fam', fixedExpenseId: 'fx-1' }),
      spend('2026-11-02', 70_000, { categoryId: 'c-fam' }),
      spend('2026-04-30', 70_000, { categoryId: 'c-fam' }),
      expense({ date: '2026-10-06', amount: 70_000, accountId: minjiAcc.id, categoryId: 'c-fam' }),
    ]);
    const b = usualBreakdown(data, eventAcc.id, TODAY);
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0]).toMatchObject({ count: 1, sum: 50_000, monthly: Math.round(50_000 / 6) });
    // 2026-04 지출이 기록 시작을 4월로 당겨도 기간은 최근 6개월 (5~10월)
    expect(b.months).toEqual(MONTHS);
  });

  it('사람을 고르면 그 사람이 쓴 지출만 (월 평균 · 건수 · 합 모두)', () => {
    const data = ledger([
      ...MONTHS.map((m) => spend(`${m}-03`, 60_000, { categoryId: 'c-fam', author: 'minji@x' })),
      spend('2026-09-03', 60_000, { categoryId: 'c-fam', author: 'junho@x' }),
      spend('2026-10-03', 30_000, { categoryId: 'c-gift', author: 'junho@x' }),
    ]);
    const junho = usualBreakdown(data, eventAcc.id, TODAY, 'junho@x');
    expect(junho.rows.map((r) => [r.name, r.count, r.monthly])).toEqual([
      ['경조사', 1, 10_000],
      ['선물', 1, 5_000],
    ]);
    expect(junho.monthlyTotal).toBe(15_000);
    expect(usualBreakdown(data, eventAcc.id, TODAY, 'minji@x').rows.map((r) => r.count)).toEqual([6]);
    expect(usualBreakdown(data, eventAcc.id, TODAY, null).rows[0]!.count).toBe(7);
  });

  it('다 지난 기록 달이 없으면 빈 결과', () => {
    const data = emptyLedger({ accounts: [account('event', { openingDate: '2026-11-01' })], expenses: [] });
    expect(usualBreakdown(data, 'acc-event', TODAY)).toEqual({ months: [], monthlyTotal: 0, rows: [] });
  });

  it('화살표: 지난달과 월 평균을 천 원 단위로 견줘요', () => {
    expect(usualTrend(120_400, 120_000)).toBe('same');
    expect(usualTrend(121_000, 120_000)).toBe('up');
    expect(usualTrend(0, 10_000)).toBe('down');
  });

  it('사람 선택지는 가계부의 사람 (실제로 쓴 사람 키 = 이메일 소문자)', () => {
    expect(usualSpenderOptions(ledger([]))).toEqual([
      { key: 'minji@x', name: '민지' },
      { key: 'junho@x', name: '준호' },
    ]);
  });
});

describe('도넛 조각', () => {
  const row = (name: string, monthly: number): UsualBreakdownRow => ({
    categoryId: `c-${name}`, name, monthly, sum: monthly, count: 1, perItem: monthly, lastMonth: 0, trend: 'same', items: [],
  });

  it('큰 항목 5개는 색, 나머지는 회색 기타 하나. 몫의 합은 1', () => {
    const rows = [row('a', 60), row('b', 50), row('c', 40), row('d', 30), row('e', 20), row('f', 10), row('g', 5), row('z', 0)];
    const s = usualDonutSlices(rows);
    expect(s.map((x) => [x.name, x.amount, x.colorIndex])).toEqual([
      ['a', 60, 0], ['b', 50, 1], ['c', 40, 2], ['d', 30, 3], ['e', 20, 4], ['기타', 15, null],
    ]);
    expect(s.reduce((t, x) => t + x.share, 0)).toBeCloseTo(1);
  });

  it('5개 이하면 기타 없음, 합이 0이면 빈 목록', () => {
    expect(usualDonutSlices([row('a', 10), row('b', 5)]).map((x) => x.name)).toEqual(['a', 'b']);
    expect(usualDonutSlices([row('a', 0)])).toEqual([]);
  });
});

describe('적립 대비 막대', () => {
  it('지출이 적립보다 많으면 넘는 몫과 첫 모자라는 달', () => {
    const b = savingsBar(700_000, 1_545_000, [{ month: '2027-02', amount: 10 }, { month: '2027-03', amount: 20 }]);
    expect(b).toMatchObject({ kind: 'short', over: 845_000, left: 0, spendingRatio: 1, runOut: '2027-02' });
    expect(b.contributionRatio).toBeCloseTo(700 / 1545);
  });

  it('적립으로 충분하면 남는 몫 (바닥나는 달 없음)', () => {
    const b = savingsBar(800_000, 500_000, [{ month: '2027-02', amount: 10 }]);
    expect(b).toMatchObject({ kind: 'enough', over: 0, left: 300_000, contributionRatio: 1, runOut: null });
    expect(b.spendingRatio).toBeCloseTo(5 / 8);
  });

  it('천 원 단위로 같으면 충분, 둘 다 0이어도 나누지 않아요', () => {
    expect(savingsBar(500_000, 500_400)).toMatchObject({ kind: 'enough', left: 0 });
    expect(savingsBar(0, 0)).toMatchObject({ kind: 'enough', contributionRatio: 0, spendingRatio: 0 });
  });
});
