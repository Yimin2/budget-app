import { account, emptyLedger, event, rule } from './_fixtures';
import { judgeEvent, judgeInstallment, judgeLiving, monthlyReserve } from './verdict';
import type { LedgerData, LivingItem, LivingStatus } from './types';

/** 예전 방식 '생활비' 한 줄(daily) 하나만 있는 상태 */
const living = (p: Partial<LivingItem> & { daysLeft?: number } = {}): LivingStatus => {
  const { daysLeft = 21, ...itemPatch } = p;
  const item: LivingItem = {
    categoryId: null,
    name: '생활비',
    icon: 'wallet',
    spread: 'daily',
    base: 600_000,
    monthBudget: 600_000,
    carryIn: 0,
    spent: 150_000,
    spentToday: 0,
    remaining: 450_000,
    dailyBudget: 21_400,
    todayAvailable: 21_400,
    unbudgeted: false,
    ...itemPatch,
  };
  return withItems([item], daysLeft);
};

function withItems(items: LivingItem[], daysLeft = 21, month = '2026-11'): LivingStatus {
  const sum = (f: (i: LivingItem) => number | null) => items.reduce((s, i) => s + (f(i) ?? 0), 0);
  return {
    month,
    monthBudget: sum((i) => i.monthBudget),
    carryIn: sum((i) => i.carryIn),
    spent: sum((i) => i.spent),
    spentToday: sum((i) => i.spentToday),
    remaining: sum((i) => i.remaining),
    daysLeft,
    dailyBudget: sum((i) => i.dailyBudget),
    todayAvailable: sum((i) => i.todayAvailable),
    livingAccountId: 'acc-fixed',
    items,
  };
}

describe('judgeLiving (daily, 예전 생활비 한 줄)', () => {
  it('ok within today', () => {
    const v = judgeLiving(living(), null, 21_400);
    expect(v.signal).toBe('ok');
    expect(v.title).toBe('괜찮아요');
    expect(v.message).toBe('오늘 생활비 예산 안이에요');
    expect(v.when).toBeNull();
    expect(v.projectionAfter).toBeNull();
  });

  it('PLAN example: 80,000 → warn, X = 18,500 over 20 days', () => {
    const v = judgeLiving(living(), null, 80_000);
    expect(v.signal).toBe('warn');
    expect(v.title).toBe('가능하지만');
    expect(v.message).toBe('사면 내일부터 생활비에 하루 18,500원씩 쓸 수 있어요');
    // N = ceil((80,000 − 21,400) ÷ 6,420) = 10 ≤ 20
    expect(v.when).toBe('하루 14,900원씩만 쓰면 10일 뒤에 살 수 있어요');
  });

  it('warn on last day of month', () => {
    const v = judgeLiving(
      living({ daysLeft: 1, remaining: 50_000, dailyBudget: 50_000, todayAvailable: 20_000, spentToday: 30_000 }),
      null,
      40_000,
    );
    expect(v.signal).toBe('warn');
    expect(v.message).toBe('이번 달 마지막 날이에요');
    expect(v.when).toContain('이번 달 생활비 예산으로는 어려워요');
  });

  it('bad over remaining', () => {
    const v = judgeLiving(living(), null, 500_000);
    expect(v.signal).toBe('bad');
    expect(v.title).toBe('비추천');
    expect(v.message).toBe('이번 달 생활비 예산을 50,000원 넘어요');
    expect(v.when).toContain('이번 달 생활비 예산으로는 어려워요');
  });

  it('zero budget does not produce NaN', () => {
    const v = judgeLiving(living({ base: 0, monthBudget: 0, spent: 0, remaining: 0, dailyBudget: 0, todayAvailable: 0 }), null, 1_000);
    expect(v.signal).toBe('bad');
    expect(v.when).not.toContain('NaN');
    expect(v.details.every((d) => !d.value.includes('NaN'))).toBe(true);
  });

  it('a category without its own budget is judged by the null bucket (where its spending goes)', () => {
    const v = judgeLiving(living(), 'cat-unknown', 21_400);
    expect(v.signal).toBe('ok');
    expect(v.message).toBe('오늘 생활비 예산 안이에요');
  });
});

describe('judgeLiving per item', () => {
  const food: LivingItem = {
    categoryId: 'food', name: '식비', icon: 'utensils', spread: 'daily', base: 300_000, monthBudget: 300_000, carryIn: 0,
    spent: 90_000, spentToday: 0, remaining: 210_000, dailyBudget: 10_000, todayAvailable: 10_000, unbudgeted: false,
  };
  // 11월(30일) 10일, 남은 일수 21 · 내일부터 20일
  const shopping: LivingItem = {
    categoryId: 'shop', name: '쇼핑', icon: 'bag', spread: 'monthly', base: 100_000, monthBudget: 100_000, carryIn: 0,
    spent: 20_000, spentToday: 0, remaining: 80_000, dailyBudget: null, todayAvailable: null, unbudgeted: false,
  };
  const status = withItems([food, shopping]);

  it('daily item uses its own numbers', () => {
    expect(judgeLiving(status, 'food', 10_000).signal).toBe('ok');
    const warn = judgeLiving(status, 'food', 50_000);
    expect(warn.signal).toBe('warn');
    expect(warn.message).toBe('사면 내일부터 식비에 하루 8,000원씩 쓸 수 있어요');
    expect(judgeLiving(status, 'food', 250_000).message).toBe('이번 달 식비 예산을 40,000원 넘어요');
  });

  it('monthly item: ok while half of the rest-of-month share stays, warn up to remaining, bad over', () => {
    // 남겨 둘 돈 = floor100(100,000 × 20 ÷ 30 × 0.5) = 33,300 → ok ≤ 46,700
    expect(monthlyReserve(100_000, 20, 30)).toBe(33_300);
    const ok = judgeLiving(status, 'shop', 46_700);
    expect(ok.signal).toBe('ok');
    expect(ok.message).toBe('이번 달 쇼핑 한도 안이에요');
    expect(ok.when).toBeNull();

    const warn = judgeLiving(status, 'shop', 60_000);
    expect(warn.signal).toBe('warn');
    expect(warn.message).toBe('사면 이번 달 쇼핑 한도가 20,000원 남아요');
    expect(warn.details).toContainEqual({ label: '남은 20일을 위해 남겨 둘 돈', value: '33,300원' });
    // 12월 1일 기준 남겨 둘 돈 = floor100(100,000 × 30 ÷ 31 × 0.5) = 48,300 → 51,700 이하만 ok. 60,000 은 한도를 대부분 써요
    expect(warn.when).toBe('12월에 사도 쇼핑 한도를 대부분 써요. 이벤트통장으로 살 수 있는지 확인해 보세요');

    const bad = judgeLiving(status, 'shop', 90_000);
    expect(bad.signal).toBe('bad');
    expect(bad.message).toBe('이번 달 쇼핑 한도를 10,000원 넘어요');
    expect(judgeLiving(status, 'shop', 150_000).when).toBe('한 달 쇼핑 한도보다 커요. 이벤트통장으로 살 수 있는지 확인해 보세요');
  });

  it('monthly item when: next month 1st is fine for a smaller purchase', () => {
    const tight = withItems([{ ...shopping, spent: 70_000, remaining: 30_000 }]);
    const v = judgeLiving(tight, 'shop', 40_000);
    expect(v.signal).toBe('bad');
    expect(v.when).toBe('12월 1일에 사면 쇼핑 한도 안이에요');
  });

  it('monthly item on the last day: no reserve, anything up to remaining is ok', () => {
    const last = withItems([shopping], 1);
    expect(judgeLiving(last, 'shop', 80_000).signal).toBe('ok');
  });

  it('a category with no budget and no null bucket → bad, asks to set a budget', () => {
    const v = judgeLiving(status, 'gift', 1_000);
    expect(v.signal).toBe('bad');
    expect(v.message).toBe('이 항목은 이번 달 예산이 없어요');
    expect(v.when).toContain('예산을 정하면');
  });
});

describe('judgeEvent', () => {
  const income = account('income', { openingDate: '2026-11-01' });
  const eventAcc = account('event', { openingBalance: 600_000, openingDate: '2026-11-01', order: 1 });
  const reservoir = account('reservoir', { openingBalance: 5_200_000, openingDate: '2026-11-01', order: 2 });
  const base = (): LedgerData =>
    emptyLedger({
      accounts: [income, eventAcc, reservoir],
      rules: [rule({ fromAccountId: income.id, toAccountId: eventAcc.id, amount: 300_000, startMonth: '2026-12' })],
      events: [
        event({ name: '친구 생일', date: '2026-11-20', amount: 100_000, accountId: eventAcc.id }),
        event({ name: '설날', date: '2027-01-28', amount: 400_000, accountId: eventAcc.id }),
        event({ name: '제주 여행', date: '2027-02-20', amount: 900_000, accountId: eventAcc.id }),
        event({ name: '결혼식', date: '2027-05-09', amount: 1_000_000, accountId: eventAcc.id }),
      ],
    });
  // 끝 잔액: 11월 500 · 12월 800 · 1월 700 · 2월 100 · 3월 400 · 4월 700 · 5월 0

  it('ok when every month stays ≥ 0', () => {
    const v = judgeEvent(base(), '2026-11-10', 0);
    expect(v.signal).toBe('ok');
    expect(v.message).toBe('예정된 일정에도 문제없어요');
    expect(v.projectionAfter!.months[0]!.extra).toBe(0);
  });

  it('warn when a later month goes negative, with fixes and when', () => {
    const v = judgeEvent(base(), '2026-11-10', 150_000);
    expect(v.signal).toBe('warn');
    expect(v.message).toBe('사면 2027년 2월에 50,000원 모자라요');
    expect(v.projectionAfter!.months[0]!.endBalance).toBe(350_000);
    expect(v.details.some((d) => d.label.startsWith('①'))).toBe(true);
    expect(v.details.find((d) => d.label.startsWith('②'))!.value).toContain('5,200,000원');
    // 6월에 사야 이후 모든 달이 0 이상 (5월 끝 0, 6월 300k − 150k)
    expect(v.when).toBe('2027년 6월에 사면 일정에 문제없어요');
  });

  it('bad when this month goes negative', () => {
    const v = judgeEvent(base(), '2026-11-10', 600_000);
    expect(v.signal).toBe('bad');
    expect(v.message).toBe('이번 달 친구 생일 일정에 쓸 돈이 100,000원 모자라요');
  });

  it('existing shortage → warn even for small amount, fallback when', () => {
    const data = base();
    data.events.push(event({ name: '큰 일정', date: '2027-08-01', amount: 5_000_000, accountId: eventAcc.id }));
    const v = judgeEvent(data, '2026-11-10', 1_000);
    expect(v.signal).toBe('warn');
    expect(v.when).toContain('적립액을 늘리거나 저수지에서 옮기면');
  });

  it('no event account', () => {
    const v = judgeEvent(emptyLedger(), '2026-11-10', 1_000);
    expect(v.signal).toBe('bad');
    expect(v.projectionAfter!.accountId).toBeNull();
  });
});

describe('할부 안내 문구', () => {
  it('항목 이름에 맞춰 은/는 을 붙인다', () => {
    const food = withItems([{ ...living().items[0]!, categoryId: 'food', name: '식비', base: 0 }]);
    expect(judgeInstallment({ source: 'living', living: food, categoryId: 'food' }, 600_000)!.message).toBe(
      '12개월 할부면 매달 50,000원이에요. 식비는 한 달 예산이 없어요',
    );
    const shop = withItems([{ ...living().items[0]!, categoryId: 'shop', name: '쇼핑', base: 0 }]);
    expect(judgeInstallment({ source: 'living', living: shop, categoryId: 'shop' }, 600_000)!.message).toMatch(/쇼핑은 한 달/);
  });
});
