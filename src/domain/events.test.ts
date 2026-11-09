import { account, emptyLedger, event, expense, rule, transfer } from './_fixtures';
import { expandOccurrences, projectEventAccount, suggestShortageFixes } from './events';
import { autoTransferId } from './ids';
import type { LedgerData } from './types';

const TODAY = '2026-11-10';
const income = account('income', { order: 0, openingDate: '2026-11-01' });
const eventAcc = account('event', { order: 2, openingBalance: 300_000, openingDate: '2026-11-01' });
const reservoir = account('reservoir', { order: 3, openingBalance: 5_200_000, openingDate: '2026-11-01' });

/** PLAN 예시: 잔액 60만(11월 적립 반영됨), 매달 30만 적립, 1월 40만 · 2월 90만 · 5월 140만 */
function planExample(): LedgerData {
  const r = rule({ id: 'r-event', fromAccountId: income.id, toAccountId: eventAcc.id, amount: 300_000, startMonth: '2026-11' });
  return emptyLedger({
    accounts: [income, eventAcc, reservoir],
    rules: [r],
    transfers: [
      transfer({ id: autoTransferId(r.id, '2026-11'), date: '2026-11-01', amount: 300_000, fromAccountId: income.id, toAccountId: eventAcc.id, ruleId: r.id }),
    ],
    events: [
      event({ id: 'jan', name: '설날', date: '2027-01-28', amount: 400_000, accountId: eventAcc.id }),
      event({ id: 'feb', name: '제주 여행', date: '2027-02-20', amount: 900_000, accountId: eventAcc.id }),
      event({ id: 'may1', name: '결혼식', date: '2027-05-09', amount: 600_000, accountId: eventAcc.id }),
      event({ id: 'may2', name: '어버이날', date: '2027-05-08', amount: 800_000, accountId: eventAcc.id }),
    ],
  });
}

describe('expandOccurrences', () => {
  const base = event({ id: 'e', date: '2026-01-31', amount: 10_000, accountId: 'x' });
  it('none: only in range', () => {
    expect(expandOccurrences(base, '2026-01', '2026-12')).toHaveLength(1);
    expect(expandOccurrences(base, '2026-02', '2026-12')).toHaveLength(0);
  });
  it('monthly: clamps day 31 to month end, starts at original month', () => {
    const occ = expandOccurrences({ ...base, repeat: 'monthly' }, '2025-11', '2026-04');
    expect(occ.map((o) => o.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(occ.every((o) => o.id === 'e')).toBe(true);
  });
  it('yearly: same date each year in range, Feb 29 → Feb 28', () => {
    const leap = { ...base, date: '2028-02-29', repeat: 'yearly' as const };
    expect(expandOccurrences(leap, '2028-01', '2030-12').map((o) => o.date)).toEqual(['2028-02-29', '2029-02-28', '2030-02-28']);
    expect(expandOccurrences({ ...base, repeat: 'yearly' }, '2026-11', '2027-10').map((o) => o.date)).toEqual(['2027-01-31']);
  });
});

describe('projectEventAccount', () => {
  it('PLAN example → May shortage 300,000', () => {
    const p = projectEventAccount(planExample(), TODAY);
    expect(p.accountId).toBe(eventAcc.id);
    expect(p.currentBalance).toBe(600_000);
    expect(p.monthlyContribution).toBe(300_000);
    expect(p.months).toHaveLength(12);
    expect(p.months.map((m) => [m.month, m.endBalance])).toEqual([
      ['2026-11', 600_000],
      ['2026-12', 900_000],
      ['2027-01', 800_000],
      ['2027-02', 200_000],
      ['2027-03', 500_000],
      ['2027-04', 800_000],
      ['2027-05', -300_000],
      ['2027-06', 0],
      ['2027-07', 300_000],
      ['2027-08', 600_000],
      ['2027-09', 900_000],
      ['2027-10', 1_200_000],
    ]);
    expect(p.months[0]!.contributions).toBe(0); // 이미 기록됨
    expect(p.months[1]!.contributions).toBe(300_000);
    expect(p.months[6]!.planned).toBe(1_400_000);
    expect(p.months[6]!.events.map((e) => e.id)).toEqual(['may2', 'may1']); // 날짜순
    expect(p.shortages).toEqual([{ month: '2027-05', amount: 300_000 }]);
  });

  it('counts this month contribution when not yet recorded', () => {
    const data = planExample();
    data.transfers = [];
    const p = projectEventAccount(data, TODAY);
    expect(p.currentBalance).toBe(300_000);
    expect(p.months[0]!.contributions).toBe(300_000);
    expect(p.months[0]!.endBalance).toBe(600_000);
  });

  it('this month: planned events including overdue; done/canceled/deleted ignored', () => {
    const data = planExample();
    data.events.push(
      event({ date: '2026-11-03', amount: 50_000, accountId: eventAcc.id }), // 지난 날짜지만 예정
      event({ date: '2026-10-20', amount: 20_000, accountId: eventAcc.id }), // 지난달인데 아직 예정
      event({ date: '2026-11-25', amount: 30_000, accountId: eventAcc.id }),
      event({ date: '2026-11-26', amount: 99_000, accountId: eventAcc.id, status: 'done' }),
      event({ date: '2026-11-26', amount: 99_000, accountId: eventAcc.id, status: 'canceled' }),
      event({ date: '2026-11-26', amount: 99_000, accountId: eventAcc.id, deleted: true }),
      event({ date: '2026-11-26', amount: 99_000, accountId: reservoir.id }),
    );
    const p = projectEventAccount(data, TODAY);
    expect(p.months[0]!.planned).toBe(100_000);
    expect(p.months[0]!.endBalance).toBe(500_000);
  });

  it('includes planned transfers and repeat expansion; extra spending', () => {
    const data = planExample();
    data.transfers.push(
      transfer({ date: '2027-05-01', amount: 300_000, fromAccountId: reservoir.id, toAccountId: eventAcc.id, status: 'planned' }),
    );
    data.events.push(event({ date: '2026-12-05', amount: 10_000, accountId: eventAcc.id, repeat: 'monthly' }));
    const p = projectEventAccount(data, TODAY, { extra: { month: '2026-11', amount: 100_000 } });
    expect(p.months[0]!.extra).toBe(100_000);
    expect(p.months[0]!.endBalance).toBe(500_000);
    expect(p.months[1]!.planned).toBe(10_000);
    const may = p.months.find((m) => m.month === '2027-05')!;
    expect(may.transfersIn).toBe(300_000);
    // 원래 -300,000 − 11월 extra 100,000 − 12~5월 매월 10,000×6 + 30만 이체
    expect(may.endBalance).toBe(-300_000 - 100_000 - 60_000 + 300_000);
  });

  it('respects rule end month and deleted rules', () => {
    const data = planExample();
    data.rules[0]!.endMonth = '2026-12';
    data.rules.push(rule({ fromAccountId: income.id, toAccountId: eventAcc.id, amount: 1_000_000, deleted: true }));
    const p = projectEventAccount(data, TODAY);
    expect(p.months[1]!.contributions).toBe(300_000);
    expect(p.months[2]!.contributions).toBe(0);
  });

  it('no event account → empty projection', () => {
    const p = projectEventAccount(emptyLedger(), TODAY);
    expect(p).toEqual({ accountId: null, currentBalance: 0, monthlyContribution: 0, months: [], shortages: [] });
  });

  it('horizon option', () => {
    expect(projectEventAccount(planExample(), TODAY, { horizonMonths: 3 }).months).toHaveLength(3);
  });

  it('balance reflects event expenses', () => {
    const data = planExample();
    data.expenses.push(expense({ date: '2026-11-05', amount: 100_000, accountId: eventAcc.id, eventId: 'x' }));
    expect(projectEventAccount(data, TODAY).currentBalance).toBe(500_000);
  });
});

describe('suggestShortageFixes', () => {
  it('PLAN example: ① +50,000 for Dec–May (6), ② 300,000 from reservoir in May', () => {
    const data = planExample();
    const fix = suggestShortageFixes(data, TODAY, projectEventAccount(data, TODAY));
    expect(fix.increaseMonthly).toEqual({ amount: 50_000, fromMonth: '2026-12', toMonth: '2027-05', times: 6 });
    expect(fix.fromReservoir).toEqual({
      month: '2027-05',
      amount: 300_000,
      reservoirAccountId: reservoir.id,
      reservoirProjected: 5_200_000,
    });
  });

  it('applying fix ② removes the shortage', () => {
    const data = planExample();
    data.transfers.push(
      transfer({ date: '2027-05-01', amount: 300_000, fromAccountId: reservoir.id, toAccountId: eventAcc.id, status: 'planned' }),
    );
    expect(projectEventAccount(data, TODAY).shortages).toEqual([]);
  });

  it('applying fix ① removes the shortage', () => {
    const data = planExample();
    data.rules[0]!.endMonth = '2026-11';
    data.rules.push(rule({ fromAccountId: income.id, toAccountId: eventAcc.id, amount: 350_000, startMonth: '2026-12' }));
    expect(projectEventAccount(data, TODAY).shortages).toEqual([]);
  });

  it('max over multiple shortage months, ceil to 1000; reservoir projection includes rules', () => {
    const data = planExample();
    data.events.push(event({ date: '2027-01-02', amount: 1_000_000, accountId: eventAcc.id }));
    data.rules.push(rule({ fromAccountId: income.id, toAccountId: reservoir.id, amount: 100_000, startMonth: '2026-12' }));
    const p = projectEventAccount(data, TODAY);
    // 1월 -200,000 (2회 적립 → 100,000), 2월 -800,000 (3회 → 266,667), 5월 -1,300,000 (6회 → 216,667)
    expect(p.shortages[0]).toEqual({ month: '2027-01', amount: 200_000 });
    const fix = suggestShortageFixes(data, TODAY, p);
    expect(fix.increaseMonthly!.amount).toBe(267_000);
    // 금액을 정한 달(2월)까지 3번에 나눠 채운다
    expect(fix.increaseMonthly!.toMonth).toBe('2027-02');
    expect(fix.increaseMonthly!.times).toBe(3);
    expect(fix.fromReservoir!.month).toBe('2027-01');
    expect(fix.fromReservoir!.amount).toBe(200_000);
    expect(fix.fromReservoir!.reservoirProjected).toBe(5_200_000 + 200_000);
  });

  it('this-month-only shortage: no ①, ② still offered; no reservoir → null', () => {
    const data = planExample();
    data.events.push(event({ date: '2026-11-20', amount: 700_000, accountId: eventAcc.id }));
    data.events = data.events.filter((e) => e.date < '2027-01-01');
    const p = projectEventAccount(data, TODAY);
    expect(p.shortages).toEqual([{ month: '2026-11', amount: 100_000 }]);
    const fix = suggestShortageFixes(data, TODAY, p);
    expect(fix.increaseMonthly).toBeNull();
    expect(fix.fromReservoir!.month).toBe('2026-11');
    const noRes = { ...data, accounts: data.accounts.filter((a) => a.role !== 'reservoir') };
    expect(suggestShortageFixes(noRes, TODAY, p).fromReservoir).toBeNull();
  });

  it('no shortage → both null', () => {
    const data = planExample();
    data.events = [];
    expect(suggestShortageFixes(data, TODAY, projectEventAccount(data, TODAY))).toEqual({ increaseMonthly: null, fromReservoir: null });
  });
});
