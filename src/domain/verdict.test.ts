import { account, emptyLedger, event, rule } from './_fixtures';
import { judgeEvent, judgeLiving } from './verdict';
import type { LedgerData, LivingStatus } from './types';

const living = (p: Partial<LivingStatus> = {}): LivingStatus => ({
  month: '2026-11',
  monthBudget: 600_000,
  carryIn: 0,
  spent: 150_000,
  spentToday: 0,
  remaining: 450_000,
  daysLeft: 21,
  dailyBudget: 21_400,
  todayAvailable: 21_400,
  livingAccountId: 'acc-fixed',
  ...p,
});

describe('judgeLiving', () => {
  it('ok within today', () => {
    const v = judgeLiving(living(), 21_400);
    expect(v.signal).toBe('ok');
    expect(v.title).toBe('괜찮아요');
    expect(v.message).toBe('오늘 생활비 안이에요');
    expect(v.when).toBeNull();
    expect(v.projectionAfter).toBeNull();
  });

  it('PLAN example: 80,000 → warn, X = 18,500 over 20 days', () => {
    const v = judgeLiving(living(), 80_000);
    expect(v.signal).toBe('warn');
    expect(v.title).toBe('가능하지만');
    expect(v.message).toBe('사면 남은 날 하루 생활비가 18,500원이 돼요');
    // N = ceil((80,000 − 21,400) ÷ 6,420) = 10 ≤ 20
    expect(v.when).toBe('하루 14,900원씩만 쓰면 10일 뒤에 살 수 있어요');
  });

  it('warn on last day of month', () => {
    const v = judgeLiving(living({ daysLeft: 1, remaining: 50_000, dailyBudget: 50_000, todayAvailable: 20_000, spentToday: 30_000 }), 40_000);
    expect(v.signal).toBe('warn');
    expect(v.message).toBe('이번 달 마지막 날이에요');
    expect(v.when).toContain('이번 달 생활비로는 어려워요');
  });

  it('bad over remaining', () => {
    const v = judgeLiving(living(), 500_000);
    expect(v.signal).toBe('bad');
    expect(v.title).toBe('비추천');
    expect(v.message).toBe('이번 달 생활비를 50,000원 넘어요');
    expect(v.when).toContain('이번 달 생활비로는 어려워요');
  });

  it('zero budget does not produce NaN', () => {
    const v = judgeLiving(living({ monthBudget: 0, spent: 0, remaining: 0, dailyBudget: 0, todayAvailable: 0 }), 1_000);
    expect(v.signal).toBe('bad');
    expect(v.when).not.toContain('NaN');
    expect(v.details.every((d) => !d.value.includes('NaN'))).toBe(true);
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
