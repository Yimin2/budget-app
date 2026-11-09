import { account, emptyLedger, expense, fixed } from './_fixtures';
import { computeLiving, livingLeftover } from './living';
import type { Expense, LedgerData } from './types';

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
    data.monthEnds.push({ month: '2026-10', leftover: 63_000, choice: 'carryover', decidedBy: 'a', decidedAt: 'x' });
    data.monthEnds.push({ month: '2026-09', leftover: 99_000, choice: 'carryover', decidedBy: 'a', decidedAt: 'x' });
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
