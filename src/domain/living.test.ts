import { account, emptyLedger, expense, fixed } from './_fixtures';
import { computeLiving, defaultSpreadFor, findLivingItem, hasLegacyLivingRow, hasLivingBudget, LIVING_ETC_NAME, livingLeftover, livingLeftoverItems } from './living';
import type { Category, Expense, LedgerData } from './types';

const fixedAcc = account('fixed');
const eventAcc = account('event', { order: 1 });

/** PLAN 예시: 30일 달(11월), 생활비 600,000, 1~9일에 150,000 */
function planExample(extra: Expense[] = []): LedgerData {
  const expenses: Expense[] = [];
  for (let d = 1; d <= 9; d++) {
    expenses.push(expense({ date: `2026-11-0${d}`, amount: d === 9 ? 150_000 - 8 * 16_000 : 16_000, accountId: fixedAcc.id }));
  }
  return emptyLedger({
    accounts: [fixedAcc, eventAcc],
    fixedExpenses: [fixed({ kind: 'living', amount: 600_000, accountId: fixedAcc.id })],
    expenses: [...expenses, ...extra],
  });
}

describe('computeLiving', () => {
  it('PLAN example: day 10 → remaining 450,000, 21 days, daily 21,400', () => {
    const s = computeLiving(planExample(), '2026-11-10');
    expect(s.monthBudget).toBe(600_000);
    expect(s.spent).toBe(150_000);
    expect(s.remaining).toBe(450_000);
    expect(s.daysLeft).toBe(21);
    expect(s.dailyBudget).toBe(21_400);
    expect(s.spentToday).toBe(0);
    expect(s.todayAvailable).toBe(21_400);
    expect(s.livingAccountId).toBe(fixedAcc.id);
  });

  it('daily budget stays fixed during the day; today spending reduces todayAvailable', () => {
    const s = computeLiving(planExample([expense({ date: '2026-11-10', amount: 5_000, accountId: fixedAcc.id })]), '2026-11-10');
    expect(s.remaining).toBe(445_000);
    expect(s.dailyBudget).toBe(21_400);
    expect(s.spentToday).toBe(5_000);
    expect(s.todayAvailable).toBe(16_400);
  });

  it('ignores deleted, fixed auto records, event spending and other accounts', () => {
    const s = computeLiving(
      planExample([
        expense({ date: '2026-11-05', amount: 1_000, accountId: fixedAcc.id, deleted: true }),
        expense({ date: '2026-11-05', amount: 800_000, accountId: fixedAcc.id, fixedExpenseId: 'rent' }),
        expense({ date: '2026-11-05', amount: 2_000, accountId: fixedAcc.id, eventId: 'ev' }),
        expense({ date: '2026-11-05', amount: 3_000, accountId: eventAcc.id }),
        expense({ date: '2026-10-31', amount: 4_000, accountId: fixedAcc.id }),
      ]),
      '2026-11-10',
    );
    expect(s.spent).toBe(150_000);
  });

  it('last day of month: daysLeft 1, daily = all remaining', () => {
    const s = computeLiving(planExample(), '2026-11-30');
    expect(s.daysLeft).toBe(1);
    expect(s.dailyBudget).toBe(450_000);
  });

  it('no living budget → 0, never NaN/Infinity', () => {
    const s = computeLiving(emptyLedger({ accounts: [fixedAcc] }), '2026-11-10');
    expect(s.monthBudget).toBe(0);
    expect(s.dailyBudget).toBe(0);
    expect(s.todayAvailable).toBe(0);
    expect(Number.isFinite(s.dailyBudget)).toBe(true);
    const none = computeLiving(emptyLedger(), '2026-11-10');
    expect(none.livingAccountId).toBeNull();
    expect(none.dailyBudget).toBe(0);
  });

  it('overspent month → dailyBudget 0, todayAvailable negative when spent today', () => {
    const s = computeLiving(
      planExample([
        expense({ date: '2026-11-09', amount: 500_000, accountId: fixedAcc.id }),
        expense({ date: '2026-11-10', amount: 3_000, accountId: fixedAcc.id }),
      ]),
      '2026-11-10',
    );
    expect(s.remaining).toBe(-53_000);
    expect(s.dailyBudget).toBe(0);
    expect(s.todayAvailable).toBe(-3_000);
  });

  it('carryover from last month is added to budget', () => {
    const data = planExample();
    data.monthEnds.push({ month: '2026-10', leftover: 63_000, choice: 'carryover', decidedBy: 'a', decidedAt: 'x', items: null });
    data.monthEnds.push({ month: '2026-09', leftover: 99_000, choice: 'carryover', decidedBy: 'a', decidedAt: 'x', items: null });
    const s = computeLiving(data, '2026-11-10');
    expect(s.carryIn).toBe(63_000);
    expect(s.monthBudget).toBe(663_000);
    expect(s.remaining).toBe(513_000);
    const r = computeLiving({ ...data, monthEnds: [{ ...data.monthEnds[0]!, choice: 'reservoir' }] }, '2026-11-10');
    expect(r.carryIn).toBe(0);
  });

  it('respects living start/end month and uses living account', () => {
    const other = account('other', { id: 'card', order: 5 });
    const data = emptyLedger({
      accounts: [fixedAcc, other],
      fixedExpenses: [
        fixed({ kind: 'living', amount: 500_000, accountId: other.id, startMonth: '2026-01', endMonth: '2026-10' }),
        fixed({ kind: 'living', amount: 700_000, accountId: other.id, startMonth: '2026-11' }),
      ],
      expenses: [expense({ date: '2026-11-02', amount: 10_000, accountId: other.id })],
    });
    const s = computeLiving(data, '2026-11-02');
    expect(s.monthBudget).toBe(700_000);
    expect(s.livingAccountId).toBe('card');
    expect(s.spent).toBe(10_000);
  });
});

describe('livingLeftover', () => {
  it('uses whole month spending', () => {
    expect(livingLeftover(planExample(), '2026-11')).toBe(450_000);
    expect(livingLeftover(planExample(), '2026-10')).toBe(600_000);
  });
});

describe('legacy single 생활비 row (migration)', () => {
  it('becomes one daily item named 생활비 with categoryId null; categorized spending still counts', () => {
    const data = planExample([expense({ date: '2026-11-05', amount: 7_000, accountId: fixedAcc.id, categoryId: 'cafe' })]);
    const s = computeLiving(data, '2026-11-10');
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ categoryId: null, name: '고정', spread: 'daily', base: 600_000, spent: 157_000, unbudgeted: false });
    expect(s.todayAvailable).toBe(s.items[0]!.todayAvailable);
    expect(hasLegacyLivingRow(data, '2026-11')).toBe(true);
    expect(hasLivingBudget(s)).toBe(true);
  });
});

describe('per-item living', () => {
  const cats: Category[] = [
    { id: 'food', name: '식비', icon: 'utensils', defaultAccountRole: 'fixed', order: 0, deleted: false },
    { id: 'cafe', name: '카페', icon: 'coffee', defaultAccountRole: 'fixed', order: 1, deleted: false },
    { id: 'shop', name: '쇼핑', icon: 'bag', defaultAccountRole: 'fixed', order: 4, deleted: false },
    { id: 'gift', name: '선물', icon: 'gift', defaultAccountRole: 'event', order: 9, deleted: false },
  ];
  const items = (extra: Expense[] = []): LedgerData =>
    emptyLedger({
      accounts: [fixedAcc, eventAcc],
      categories: cats,
      fixedExpenses: [
        fixed({ kind: 'living', name: '식비', amount: 300_000, accountId: fixedAcc.id, categoryId: 'food', spread: 'daily' }),
        fixed({ kind: 'living', name: '카페', amount: 60_000, accountId: fixedAcc.id, categoryId: 'cafe', spread: 'daily' }),
        fixed({ kind: 'living', name: '쇼핑', amount: 100_000, accountId: fixedAcc.id, categoryId: 'shop', spread: 'monthly' }),
      ],
      expenses: [
        expense({ date: '2026-11-03', amount: 90_000, accountId: fixedAcc.id, categoryId: 'food' }),
        expense({ date: '2026-11-04', amount: 15_000, accountId: fixedAcc.id, categoryId: 'cafe' }),
        expense({ date: '2026-11-05', amount: 20_000, accountId: fixedAcc.id, categoryId: 'shop' }),
        ...extra,
      ],
    });

  it('daily items get their own daily budget; monthly items only remaining', () => {
    const s = computeLiving(items([expense({ date: '2026-11-10', amount: 4_000, accountId: fixedAcc.id, categoryId: 'cafe' })]), '2026-11-10');
    const food = findLivingItem(s, 'food')!;
    const cafe = findLivingItem(s, 'cafe')!;
    const shop = findLivingItem(s, 'shop')!;
    expect(food).toMatchObject({ remaining: 210_000, dailyBudget: 10_000, todayAvailable: 10_000, spread: 'daily' });
    // 카페: (60,000 − 19,000 + 4,000) ÷ 21 = 2,142 → 2,100
    expect(cafe).toMatchObject({ remaining: 41_000, spentToday: 4_000, dailyBudget: 2_100, todayAvailable: -1_900 });
    expect(shop).toMatchObject({ remaining: 80_000, dailyBudget: null, todayAvailable: null, spread: 'monthly' });
    // 전체 = 항목 합, 큰 숫자 = daily 항목 todayAvailable 합
    expect(s.monthBudget).toBe(460_000);
    expect(s.spent).toBe(129_000);
    expect(s.remaining).toBe(331_000);
    expect(s.todayAvailable).toBe(10_000 - 1_900);
    expect(s.dailyBudget).toBe(12_100);
    expect(s.items.map((i) => i.name)).toEqual(['식비', '카페', '쇼핑']);
  });

  it('spending without a budgeted category goes to a 기타(예산 없음) bucket with budget 0', () => {
    const s = computeLiving(
      items([
        expense({ date: '2026-11-06', amount: 5_000, accountId: fixedAcc.id, categoryId: 'gift' }),
        expense({ date: '2026-11-06', amount: 3_000, accountId: fixedAcc.id }),
      ]),
      '2026-11-10',
    );
    const etc = s.items[s.items.length - 1]!;
    expect(etc).toMatchObject({ categoryId: null, name: LIVING_ETC_NAME, base: 0, spent: 8_000, remaining: -8_000, unbudgeted: true, spread: 'monthly' });
    expect(s.remaining).toBe(s.items.reduce((sum, i) => sum + i.remaining, 0));
    expect(findLivingItem(s, 'gift')).toBe(etc);
    // 지출이 없으면 기타 묶음은 없어요
    expect(computeLiving(items(), '2026-11-10').items.some((i) => i.unbudgeted)).toBe(false);
  });

  it('per-item carryover from last month (negative too); unknown items and old totals go to the null bucket', () => {
    const data = items();
    data.monthEnds.push({
      month: '2026-10', leftover: 30_000, choice: 'carryover', decidedBy: 'a', decidedAt: 'x',
      items: [{ categoryId: 'food', leftover: 40_000 }, { categoryId: 'cafe', leftover: -5_000 }, { categoryId: 'gone', leftover: -5_000 }],
    });
    const s = computeLiving(data, '2026-11-10');
    expect(findLivingItem(s, 'food')).toMatchObject({ carryIn: 40_000, monthBudget: 340_000 });
    expect(findLivingItem(s, 'cafe')).toMatchObject({ carryIn: -5_000, monthBudget: 55_000 });
    expect(s.items.find((i) => i.unbudgeted)).toMatchObject({ carryIn: -5_000 });
    expect(s.carryIn).toBe(30_000);
  });

  it('livingLeftoverItems lists each non-zero item at month end', () => {
    const left = livingLeftoverItems(items(), '2026-11');
    expect(left.map((i) => [i.categoryId, i.leftover])).toEqual([
      ['food', 210_000],
      ['cafe', 45_000],
      ['shop', 80_000],
    ]);
    expect(livingLeftover(items(), '2026-11')).toBe(335_000);
  });

  it('defaultSpreadFor: 식비·카페·교통 daily, others monthly', () => {
    expect(['식비', '카페', '교통', '쇼핑', '의료'].map(defaultSpreadFor)).toEqual(['daily', 'daily', 'daily', 'monthly', 'monthly']);
  });
});
