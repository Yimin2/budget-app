import { account, emptyLedger, expense, fixed } from './_fixtures';
import {
  computeLiving, defaultSpreadFor, findLivingItem, hasLegacyLivingRow, hasLivingBudget, LIVING_ETC_NAME, livingDayNote, livingLeftover,
  livingLeftoverItems, previewLivingItem, schedulePreviewText,
} from './living';
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

describe('쓰는 날 (평일 · 공휴일 빼기 · 주 N회)', () => {
  const cats: Category[] = [
    { id: 'lunch', name: '직장식비', icon: 'utensils', defaultAccountRole: 'fixed', order: 0, deleted: false },
    { id: 'dine', name: '외식', icon: 'utensils', defaultAccountRole: 'fixed', order: 1, deleted: false },
    { id: 'cafe', name: '카페', icon: 'coffee', defaultAccountRole: 'fixed', order: 2, deleted: false },
  ];
  const ledger = (extra: Expense[] = [], daysOff?: string[]): LedgerData => {
    const d = emptyLedger({
      accounts: [fixedAcc, eventAcc],
      categories: cats,
      fixedExpenses: [
        fixed({ kind: 'living', name: '직장식비', amount: 250_000, accountId: fixedAcc.id, categoryId: 'lunch', useDays: [1, 2, 3, 4, 5], skipHolidays: true }),
        fixed({ kind: 'living', name: '외식', amount: 160_000, accountId: fixedAcc.id, categoryId: 'dine', perWeek: 2 }),
        fixed({ kind: 'living', name: '카페', amount: 60_000, accountId: fixedAcc.id, categoryId: 'cafe' }),
      ],
      expenses: [
        expense({ date: '2026-11-03', amount: 31_000, accountId: fixedAcc.id, categoryId: 'lunch' }),
        expense({ date: '2026-11-04', amount: 20_000, accountId: fixedAcc.id, categoryId: 'dine' }),
        ...extra,
      ],
    });
    return daysOff ? { ...d, settings: { ...d.settings, daysOff } } : d;
  };

  it('평일 · 공휴일 빼기: 남은 219,000원 ÷ 남은 평일 15일 = 하루 14,600원', () => {
    const s = computeLiving(ledger(), '2026-11-10');
    const lunch = findLivingItem(s, 'lunch')!;
    expect(lunch.remaining).toBe(219_000);
    expect(lunch.useDay).toEqual({ today: true, daysLeft: 15, daysAfterToday: 14, next: null });
    expect(lunch.dailyBudget).toBe(14_600);
    expect(lunch.todayAvailable).toBe(14_600);
    expect(lunch.schedule).toEqual({ days: [1, 2, 3, 4, 5], skipHolidays: true, perWeek: null });
  });

  it("예전에 넣어 둔 쉬는 날(설정 '쉬는날')은 지우지 않지만 셈에는 쓰지 않아요 (공휴일만 빼요)", () => {
    const lunch = findLivingItem(computeLiving(ledger([], ['2026-11-13']), '2026-11-10'), 'lunch')!;
    expect(lunch.useDay!.daysLeft).toBe(15);
    expect(lunch.dailyBudget).toBe(14_600);
  });

  it('토요일: 직장식비는 오늘 0원이고 다음 쓰는 날을 알려요. 주말에 쓴 돈도 이번 달 남은 돈에서 빠져요', () => {
    const s = computeLiving(ledger([expense({ date: '2026-11-14', amount: 9_000, accountId: fixedAcc.id, categoryId: 'lunch' })]), '2026-11-14');
    const lunch = findLivingItem(s, 'lunch')!;
    expect(lunch.remaining).toBe(210_000);
    expect(lunch.dailyBudget).toBe(0);
    expect(lunch.todayAvailable).toBe(0);
    expect(lunch.useDay).toEqual({ today: false, daysLeft: 11, daysAfterToday: 11, next: { date: '2026-11-16', amount: 19_000 } });
    expect(livingDayNote(lunch, '2026-11-14')).toBe('오늘은 쓰는 날이 아니에요 · 다음: 월요일 19,000원');
    // 전체 오늘 써도 되는 돈에는 직장식비 0원
    const cafe = findLivingItem(s, 'cafe')!;
    const dine = findLivingItem(s, 'dine')!;
    expect(s.todayAvailable).toBe(cafe.todayAvailable! + dine.todayAvailable!);
  });

  it('이번 달에 쓰는 날이 더 없으면 남은 돈은 한 달 한도만처럼 봐요', () => {
    // 토요일만 쓰는 항목, 11/29(일)에는 이번 달 토요일이 더 없어요
    const base = ledger();
    const data = { ...base, fixedExpenses: base.fixedExpenses.map((f) => (f.categoryId === 'lunch' ? { ...f, useDays: [6] } : f)) };
    const lunch = findLivingItem(computeLiving(data, '2026-11-29'), 'lunch')!;
    expect(lunch.spread).toBe('monthly');
    expect(lunch.noDaysLeft).toBe(true);
    expect(lunch.dailyBudget).toBeNull();
    expect(lunch.todayAvailable).toBeNull();
    expect(lunch.remaining).toBe(219_000);
    expect(livingDayNote(lunch, '2026-11-29')).toBe('이번 달은 쓰는 날이 끝났어요');
  });

  it('주 2회: 이번 주 남은 2회 · 앞으로 5회 → 한 번에 20,000원', () => {
    const s = computeLiving(ledger(), '2026-11-10');
    const dine = findLivingItem(s, 'dine')!;
    expect(dine.remaining).toBe(140_000);
    expect(dine.weekly).toEqual({ perWeek: 2, usedThisWeek: 0, usedToday: false, leftThisWeek: 2, usesLeft: 7, perUse: 20_000 });
    expect(dine.todayAvailable).toBe(20_000);
    expect(livingDayNote(dine, '2026-11-10')).toBe('이번 주 남은 2회 · 한 번에 20,000원');
  });

  it('주 2회를 이번 주에 다 쓰면 오늘 0원, 같은 날 두 번 쓴 건 한 번으로 세요', () => {
    const s = computeLiving(
      ledger([
        expense({ date: '2026-11-09', amount: 10_000, accountId: fixedAcc.id, categoryId: 'dine' }),
        expense({ date: '2026-11-09', amount: 5_000, accountId: fixedAcc.id, categoryId: 'dine' }),
        expense({ date: '2026-11-11', amount: 25_000, accountId: fixedAcc.id, categoryId: 'dine' }),
      ]),
      '2026-11-12',
    );
    const dine = findLivingItem(s, 'dine')!;
    expect(dine.weekly).toMatchObject({ usedThisWeek: 2, leftThisWeek: 0, usesLeft: 5, perUse: 20_000 });
    expect(dine.todayAvailable).toBe(0);
    expect(livingDayNote(dine, '2026-11-12')).toBe('이번 주는 다 썼어요');
  });

  it('미리 보기 글: 쓰는 날 · 주 N회 · 매일', () => {
    const s = computeLiving(ledger(), '2026-11-10');
    expect(schedulePreviewText(findLivingItem(s, 'lunch')!, '2026-11-10')).toBe('11월 남은 쓰는 날 15일 → 하루 14,600원');
    expect(schedulePreviewText(findLivingItem(s, 'dine')!, '2026-11-10')).toBe('이번 주 남은 2회 · 한 번에 20,000원');
    expect(schedulePreviewText(findLivingItem(s, 'cafe')!, '2026-11-10')).toBe('11월 남은 21일 → 하루 2,800원');
    const d = ledger();
    const row = { ...d.fixedExpenses[2]!, useDays: [1, 3, 5] };
    expect(schedulePreviewText(previewLivingItem(d, '2026-11-10', row)!, '2026-11-10')).toBe('11월 남은 쓰는 날 9일 → 하루 6,600원');
  });

  it('예전 행(쓰는 날 칸 없음 · 매일로 적힘)은 예전과 똑같이 계산해요', () => {
    const before = computeLiving(planExample(), '2026-11-10');
    const explicit = planExample();
    explicit.fixedExpenses = explicit.fixedExpenses.map((f) => ({ ...f, useDays: null, skipHolidays: false, perWeek: null }));
    const after = computeLiving(explicit, '2026-11-10');
    expect(after).toEqual(before);
    expect(after.items[0]!.useDay).toBeUndefined();
    expect(after.items[0]!.schedule).toBeUndefined();
    // 한 달 한도만 항목은 쓰는 날 칸이 있어도 보지 않아요
    const monthly = planExample();
    monthly.fixedExpenses = monthly.fixedExpenses.map((f) => ({ ...f, spread: 'monthly' as const, perWeek: 2 }));
    expect(computeLiving(monthly, '2026-11-10').items[0]!.weekly).toBeUndefined();
  });
});
