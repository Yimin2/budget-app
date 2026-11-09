import { accountBalance } from './balances';
import { createDefaultLedger, createDemoLedger } from './defaults';
import { projectEventAccount, suggestShortageFixes } from './events';
import { computeLiving } from './living';
import { pendingMonthEnd } from './monthEnd';
import { pendingAutoRecords } from './recurring';
import type { LedgerData } from './types';

const NOW = '2026-11-09T10:00:00.000Z';
const byRole = (d: LedgerData, role: string) => d.accounts.find((a) => a.role === role)!;

describe('createDefaultLedger', () => {
  it('shared: 5 accounts and default categories', () => {
    const d = createDefaultLedger('shared', '우리집', '2026-11-09', NOW, 'a@x', '민지');
    expect(d.accounts.map((a) => a.role)).toEqual(['income', 'fixed', 'event', 'reservoir', 'savings']);
    expect(d.accounts.every((a) => a.openingBalance === 0 && a.openingDate === '2026-11-09')).toBe(true);
    expect(d.categories.map((c) => c.name)).toEqual([
      '식비', '카페', '교통', '생활', '쇼핑', '의료', '문화', '경조사', '여행', '명절', '선물', '큰 구매', '기타',
    ]);
    expect(d.categories.find((c) => c.name === '여행')!.defaultAccountRole).toBe('event');
    expect(d.categories.find((c) => c.name === '기타')!.defaultAccountRole).toBe('fixed');
    expect(d.members).toEqual([{ email: 'a@x', displayName: '민지' }]);
    expect(d.rules).toEqual([]);
    expect(new Set(d.accounts.map((a) => a.id)).size).toBe(5);
    expect(d.settings).toMatchObject({ name: '우리집', kind: 'shared', schemaVersion: 1, createdAt: NOW });
  });
  it('personal: one allowance account', () => {
    const d = createDefaultLedger('personal', '내 용돈', '2026-11-09', NOW, 'a@x', '민지');
    expect(d.accounts.map((a) => a.role)).toEqual(['allowance']);
    expect(d.categories.every((c) => c.defaultAccountRole === 'allowance')).toBe(true);
  });
});

describe('createDemoLedger', () => {
  for (const today of ['2026-11-09', '2026-11-30', '2027-02-01', '2027-02-28', '2026-12-31']) {
    it(`is consistent for ${today}`, () => {
      const d = createDemoLedger(today, NOW);
      // 자동 기록은 이미 다 만들어져 있다
      const pending = pendingAutoRecords(d, today, 'x', NOW);
      expect(pending.transfers).toEqual([]);
      expect(pending.expenses).toEqual([]);
      // id 중복 없음
      const ids = [...d.transfers, ...d.expenses, ...d.events].map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
      // 통장 잔액
      expect(accountBalance(d, byRole(d, 'income').id, today)).toBe(0);
      expect(accountBalance(d, byRole(d, 'event').id, today)).toBe(900_000);
      expect(accountBalance(d, byRole(d, 'reservoir').id, today)).toBe(6_400_000);
      expect(accountBalance(d, byRole(d, 'savings').id, today)).toBe(13_900_000);
      expect(accountBalance(d, byRole(d, 'fixed').id, today)).toBeGreaterThan(0);
      // 생활비
      const s = computeLiving(d, today);
      expect(s.monthBudget).toBe(600_000);
      expect(s.spent).toBeGreaterThan(0);
      expect(s.remaining).toBeGreaterThan(0);
      expect(s.dailyBudget).toBeGreaterThan(0);
      // 체험 첫 화면의 큰 숫자가 0원이 되지 않도록 오늘 기록은 가볍게
      expect(s.todayAvailable).toBeGreaterThan(0);
      // 약 5달 뒤 30만 부족
      const p = projectEventAccount(d, today);
      expect(p.shortages[0]!.amount).toBe(300_000);
      expect(p.months.findIndex((m) => m.month === p.shortages[0]!.month)).toBe(5);
      const fix = suggestShortageFixes(d, today, p);
      expect(fix.increaseMonthly!.amount).toBe(60_000);
      expect(fix.fromReservoir!.amount).toBe(300_000);
      expect(pendingMonthEnd(d, today)).toBeNull();
    });
  }

  it('has members, favorites and fixed bills', () => {
    const d = createDemoLedger('2026-11-09', NOW);
    expect(d.members).toEqual([
      { email: 'minji@demo', displayName: '민지' },
      { email: 'junho@demo', displayName: '준호' },
    ]);
    expect(d.favorites.map((f) => [f.name, f.amount])).toEqual([['커피', 4_500], ['점심', 9_000], ['버스', 1_500]]);
    const bills = d.fixedExpenses.filter((f) => f.kind === 'bill').map((f) => [f.name, f.amount]);
    expect(bills).toEqual([['월세', 800_000], ['통신비', 120_000], ['보험', 180_000]]);
    expect(d.fixedExpenses.filter((f) => f.kind === 'allowance').map((f) => f.amount)).toEqual([150_000, 150_000]);
    const authors = new Set(d.expenses.filter((e) => e.fixedExpenseId === null).map((e) => e.author));
    expect(authors).toEqual(new Set(['minji@demo', 'junho@demo']));
    expect(d.rules.map((r) => r.amount).reduce((a, b) => a + b, 0)).toBe(5_000_000);
    // 오늘 이후 날짜의 지출은 없다
    expect(d.expenses.every((e) => e.date <= '2026-11-09')).toBe(true);
  });
});
