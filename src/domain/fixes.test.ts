/** 검증된 결함 회귀 테스트 (도메인) */
import { account, emptyLedger, event, expense, fixed, rule, transfer } from './_fixtures';
import { pendingAllowanceIncome } from './allowance';
import { accountBalance } from './balances';
import { isMonthActive, localDateOf, monthRange } from './dates';
import {
  expandOccurrences, nextOccurrenceDate, nextOccurrenceId, projectEventAccount, seriesAnchorDay, suggestShortageFixes,
} from './events';
import { autoTransferId, monthEndTransferId } from './ids';
import { decideMonthEnd, pendingMonthEnd } from './monthEnd';
import { pendingAutoRecords } from './recurring';
import { judgeEvent } from './verdict';
import type { LedgerData } from './types';

const TODAY = '2026-11-09';
const NOW = '2026-11-09T00:00:00.000Z';
const inc = account('income', { openingBalance: 1_000_000, openingDate: '2026-09-01' });
const evt = account('event', { order: 1, openingBalance: 500_000, openingDate: '2026-09-01' });

describe('projection: done records dated after today', () => {
  it('future done expense lowers the month it falls in (no false ok)', () => {
    const data = emptyLedger({
      accounts: [inc, evt],
      expenses: [expense({ date: '2026-11-20', amount: 400_000, accountId: evt.id })],
      events: [event({ date: '2026-12-10', amount: 300_000, accountId: evt.id })],
    });
    const p = projectEventAccount(data, TODAY);
    expect(p.months[0]!.endBalance).toBe(100_000);
    expect(p.months[0]!.scheduledSpending).toBe(400_000);
    expect(p.months[1]!.endBalance).toBe(-200_000);
    expect(p.shortages[0]).toEqual({ month: '2026-12', amount: 200_000 });
    expect(judgeEvent(data, TODAY, 100_000).signal).not.toBe('ok');
  });
  it('future done transfer in is counted (no false shortage)', () => {
    const data = emptyLedger({
      accounts: [inc, evt],
      transfers: [transfer({ date: '2026-11-25', amount: 400_000, fromAccountId: inc.id, toAccountId: evt.id })],
      events: [event({ date: '2026-11-28', amount: 800_000, accountId: evt.id })],
    });
    const p = projectEventAccount(data, TODAY);
    expect(p.months[0]!.transfersIn).toBe(400_000);
    expect(p.months[0]!.endBalance).toBe(100_000);
    expect(p.shortages).toEqual([]);
  });
});

describe('projection: expenses linked to a still-planned event', () => {
  it('subtracts only the remaining amount for that row', () => {
    const data = emptyLedger({
      accounts: [inc, evt],
      events: [event({ id: 'jeju', date: '2027-02-20', amount: 900_000, accountId: evt.id })],
      expenses: [expense({ date: '2026-11-05', amount: 300_000, accountId: evt.id, eventId: 'jeju' })],
    });
    const p = projectEventAccount(data, TODAY);
    expect(p.currentBalance).toBe(200_000);
    const feb = p.months.find((m) => m.month === '2027-02')!;
    expect(feb.planned).toBe(600_000);
    expect(feb.endBalance).toBe(-400_000);
  });
  it('repeat expansions still count in full', () => {
    const data = emptyLedger({
      accounts: [inc, evt],
      events: [event({ id: 'm', date: '2026-11-20', amount: 100_000, accountId: evt.id, repeat: 'monthly' })],
      expenses: [expense({ date: '2026-11-05', amount: 100_000, accountId: evt.id, eventId: 'm' })],
    });
    const p = projectEventAccount(data, TODAY);
    expect(p.months[0]!.planned).toBe(0);
    expect(p.months[1]!.planned).toBe(100_000);
  });
});

describe('auto records before the account opening date', () => {
  it('a new rule whose day passed before the destination opened is not booked', () => {
    const trip = account('savings', { id: 'trip', order: 2, openingBalance: 0, openingDate: TODAY });
    const r = rule({ id: 'r-new', fromAccountId: inc.id, toAccountId: trip.id, amount: 300_000, dayOfMonth: 1, startMonth: '2026-11' });
    const data = emptyLedger({ accounts: [inc, trip], rules: [r] });
    expect(pendingAutoRecords(data, TODAY, 'a', NOW).transfers).toEqual([]);
  });
  it('blank or implausible start months do not backfill', () => {
    const bad = rule({ id: 'blank', fromAccountId: inc.id, toAccountId: evt.id, amount: 1, dayOfMonth: 1, startMonth: '' });
    const old = rule({ id: 'old', fromAccountId: inc.id, toAccountId: evt.id, amount: 1, dayOfMonth: 1, startMonth: '1900-01' });
    const fx = fixed({ id: 'f', kind: 'bill', amount: 1, accountId: inc.id, dayOfMonth: 5, startMonth: '' });
    const data = emptyLedger({ accounts: [inc, evt], rules: [bad, old], fixedExpenses: [fx] });
    const out = pendingAutoRecords(data, TODAY, 'a', NOW);
    // 'old' 는 통장 시작일(9월)부터만
    expect(out.transfers.map((t) => t.id)).toEqual(['auto:old:2026-09', 'auto:old:2026-10', 'auto:old:2026-11']);
    expect(out.expenses).toEqual([]);
    expect(monthRange('', '2026-11')).toEqual([]);
    expect(isMonthActive('2026-11', '', null)).toBe(false);
  });
});

describe('first-month contribution matches what sync will record', () => {
  it('does not flip after the auto record is created', () => {
    const a = account('income', { openingDate: TODAY });
    const e = account('event', { order: 1, openingBalance: 1_000_000, openingDate: TODAY });
    const r = rule({ id: 'rule-1', fromAccountId: a.id, toAccountId: e.id, amount: 300_000, dayOfMonth: 1, startMonth: '2026-11' });
    const data = emptyLedger({ accounts: [a, e], rules: [r] });
    const before = projectEventAccount(data, TODAY).months.map((m) => m.endBalance);
    const auto = pendingAutoRecords(data, TODAY, 'a', NOW);
    const after = projectEventAccount({ ...data, transfers: auto.transfers }, TODAY).months.map((m) => m.endBalance);
    expect(after).toEqual(before);
    expect(before.slice(0, 2)).toEqual([1_000_000, 1_300_000]);
  });
});

describe('shortage fix ① period', () => {
  it('ends at the month that sets the amount (PLAN example)', () => {
    const e = account('event', { openingBalance: 0, openingDate: '2026-11-01' });
    const data = emptyLedger({ accounts: [e], events: [event({ date: '2027-05-16', amount: 400_000, accountId: e.id })] });
    const p = projectEventAccount(data, TODAY);
    expect(suggestShortageFixes(data, TODAY, p).increaseMonthly).toEqual({
      amount: 67_000, fromMonth: '2026-12', toMonth: '2027-05', times: 6,
    });
  });
});

describe('month-end: every undecided month is asked, oldest first', () => {
  const fixedAcc = account('fixed', { openingDate: '2026-09-01' });
  const reservoir = account('reservoir', { order: 1, openingDate: '2026-09-01' });
  const base = (): LedgerData =>
    emptyLedger({
      settings: { name: 't', kind: 'shared', sharedLedgerId: null, schemaVersion: 1, createdAt: '2026-10-01T00:00:00.000Z' },
      accounts: [fixedAcc, reservoir],
      fixedExpenses: [fixed({ kind: 'living', amount: 600_000, accountId: fixedAcc.id, startMonth: '2026-10' })],
      expenses: [
        expense({ date: '2026-10-10', amount: 600_000, accountId: fixedAcc.id }),
        expense({ date: '2026-11-10', amount: 500_000, accountId: fixedAcc.id }),
        expense({ date: '2026-12-10', amount: 550_000, accountId: fixedAcc.id }),
      ],
    });
  it('skipped November is still offered in January, then December with the carryover', () => {
    const d = base();
    expect(pendingMonthEnd(d, '2027-01-03')).toMatchObject({ month: '2026-11', leftover: 100_000 });
    d.monthEnds.push(decideMonthEnd(d, '2026-11', 100_000, 'carryover', 'a', NOW).monthEnd);
    expect(pendingMonthEnd(d, '2027-01-03')).toMatchObject({ month: '2026-12', leftover: 150_000 });
    d.monthEnds.push(decideMonthEnd(d, '2026-12', 150_000, 'reservoir', 'a', NOW).monthEnd);
    expect(pendingMonthEnd(d, '2027-01-03')).toBeNull();
  });
  it('a month-end transfer counts only when that month chose reservoir', () => {
    const d = base();
    const { transfer: t } = decideMonthEnd(d, '2026-11', 100_000, 'reservoir', 'a', NOW);
    d.transfers.push(t!);
    expect(t!.id).toBe(monthEndTransferId('2026-11'));
    expect(accountBalance(d, reservoir.id, '2027-01-03')).toBe(0);
    d.monthEnds.push({ month: '2026-11', leftover: 100_000, choice: 'carryover', decidedBy: 'b', decidedAt: NOW, items: null });
    expect(accountBalance(d, reservoir.id, '2027-01-03')).toBe(0);
    d.monthEnds[0]!.choice = 'reservoir';
    expect(accountBalance(d, reservoir.id, '2027-01-03')).toBe(100_000);
  });
});

describe('createdAt is a UTC timestamp; months use the local date', () => {
  const tz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Asia/Seoul';
  });
  afterAll(() => {
    process.env.TZ = tz;
  });
  it('localDateOf converts to the local day', () => {
    expect(localDateOf('2026-11-30T23:30:00.000Z')).toBe('2026-12-01');
    expect(localDateOf('')).toBeNull();
  });
  it('allowance backfill starts at the local creation month and the account opening date', () => {
    const allowanceAcc = account('allowance', { openingDate: '2026-12-01' });
    const personal = emptyLedger({
      settings: { name: '내', kind: 'personal', sharedLedgerId: 's', schemaVersion: 1, createdAt: '2026-11-30T23:30:00.000Z' },
      accounts: [allowanceAcc],
    });
    const shared = emptyLedger({
      fixedExpenses: [fixed({ id: 'al', kind: 'allowance', amount: 150_000, accountId: 'x', dayOfMonth: 1, startMonth: '2026-01', targetEmail: 'me@x' })],
    });
    const rows = pendingAllowanceIncome(personal, shared, 's', 'me@x', '2026-12-01', NOW);
    expect(rows.map((r) => r.date)).toEqual(['2026-12-01']);
  });
});

describe('repeat events keep their anchor day', () => {
  it('31st → Feb 28 → Mar 31', () => {
    const first = event({ id: 'card', date: '2027-01-31', amount: 1, accountId: 'x', repeat: 'monthly' });
    const d2 = nextOccurrenceDate(first.date, 'monthly', seriesAnchorDay([first], first))!;
    expect(d2).toBe('2027-02-28');
    const second = { ...first, id: nextOccurrenceId(first, d2), date: d2 };
    expect(second.id).toBe('card@2027-02-28');
    const anchor = seriesAnchorDay([first, second], second);
    expect(anchor).toBe(31);
    expect(nextOccurrenceDate(second.date, 'monthly', anchor)).toBe('2027-03-31');
    expect(expandOccurrences(second, '2027-03', '2027-04', anchor).map((o) => o.date)).toEqual(['2027-03-31', '2027-04-30']);
    expect(nextOccurrenceId(second, '2027-03-31')).toBe('card@2027-03-31');
  });
  it('a date the user moved is respected', () => {
    const first = event({ id: 'a', date: '2027-01-31', amount: 1, accountId: 'x', repeat: 'monthly' });
    const moved = { ...first, id: 'a@2027-02-28', date: '2027-02-15' };
    expect(seriesAnchorDay([first, moved], moved)).toBe(15);
  });
  it('yearly Feb 29 returns to the 29th in a leap year', () => {
    const first = event({ id: 'y', date: '2028-02-29', amount: 1, accountId: 'x', repeat: 'yearly' });
    const second = { ...first, id: 'y@2029-02-28', date: '2029-02-28' };
    expect(nextOccurrenceDate('2031-02-28', 'yearly', seriesAnchorDay([first, { ...second, id: 'y@2031-02-28', date: '2031-02-28' }], { ...second, id: 'y@2031-02-28', date: '2031-02-28' }))).toBe('2032-02-29');
  });
});

describe('auto transfer id for first-month recorded rule', () => {
  it('recorded rule is not counted again this month', () => {
    const r = rule({ id: 'r', fromAccountId: inc.id, toAccountId: evt.id, amount: 100_000, dayOfMonth: 1, startMonth: '2026-11' });
    const data = emptyLedger({
      accounts: [inc, evt],
      rules: [r],
      transfers: [transfer({ id: autoTransferId('r', '2026-11'), date: '2026-11-01', amount: 100_000, fromAccountId: inc.id, toAccountId: evt.id })],
    });
    expect(projectEventAccount(data, TODAY).months[0]!.contributions).toBe(0);
  });
});
