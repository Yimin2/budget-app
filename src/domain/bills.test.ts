import { account, emptyLedger, expense, fixed, rule } from './_fixtures';
import { allocationAfter, allocationOnOrBefore, billTimeline, billTimelineHint } from './allocation';
import {
  billAmountOn, billChargeDate, billCharges, billMemo, billSeriesRows, endBillSeries, firstChargeDate, lastChargeDate, normalizeBill,
  splitBillAmount,
} from './bills';
import { autoFixedExpenseId } from './ids';
import { pendingAutoRecords } from './recurring';
import type { FixedExpense } from './types';

const income = account('income', { id: 'salary', name: '월급통장' });
const living = account('fixed', { id: 'liv-a', name: '생활비(가람)', order: 1, ownerName: '가람' });
const NOW = '2026-11-10T00:00:00.000Z';

function bill(p: Partial<FixedExpense>): FixedExpense {
  return normalizeBill(fixed({ id: 'netflix', name: '넷플릭스', kind: 'bill', amount: 15_000, accountId: living.id, dayOfMonth: 10, ...p }));
}

describe('billing dates (PLAN 4-15)', () => {
  it('first charge on or after the start date; startMonth follows it', () => {
    expect(firstChargeDate(bill({ startDate: '2026-11-10' }))).toBe('2026-11-10');
    const late = bill({ startDate: '2026-11-15' });
    expect(late.startMonth).toBe('2026-12');
    expect(firstChargeDate(late)).toBe('2026-12-10');
  });

  it('last charge on or before the end date (ending before the billing day = no charge that month)', () => {
    const a = bill({ startDate: '2026-11-10', endDate: '2026-12-05' });
    expect(lastChargeDate(a)).toBe('2026-11-10');
    expect(a.endMonth).toBe('2026-11');
    expect(billChargeDate(a, '2026-12')).toBeNull();
    const b = bill({ startDate: '2026-11-10', endDate: '2026-12-15' });
    expect(lastChargeDate(b)).toBe('2026-12-10');
    expect(b.endMonth).toBe('2026-12');
  });

  it('ended before the first billing date → no charges', () => {
    const f = bill({ startDate: '2026-11-11', endDate: '2026-12-01' });
    expect(firstChargeDate(f)).toBeNull();
    expect(billCharges(f, '2026-01-01', '2027-12-31')).toEqual([]);
  });

  it('billing day defaults to the start day; 31st is clamped to month end', () => {
    const f = bill({ dayOfMonth: null, startDate: '2026-01-31' });
    expect(f.dayOfMonth).toBe(31);
    expect(billCharges(f, '2026-01-01', '2026-05-01').map((c) => c.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    // 윤년
    expect(billChargeDate(bill({ dayOfMonth: 31, startDate: '2028-01-01' }), '2028-02')).toBe('2028-02-29');
  });

  it('billing day can be overridden', () => {
    const f = bill({ dayOfMonth: 25, startDate: '2026-11-03' });
    expect(firstChargeDate(f)).toBe('2026-11-25');
  });

  it('legacy rows without dates behave as before', () => {
    const f = fixed({ id: 'old', kind: 'bill', amount: 50_000, accountId: living.id, dayOfMonth: 5, startMonth: '2026-10', endMonth: '2026-12' });
    expect(normalizeBill(f)).toEqual(f);
    expect(billCharges(f, '2026-01-01', '2027-06-01').map((c) => c.date)).toEqual(['2026-10-05', '2026-11-05', '2026-12-05']);
  });
});

describe('sub-items', () => {
  const dues = bill({
    id: 'dues',
    name: '회비',
    amount: 0,
    dayOfMonth: 21,
    startMonth: '2026-11',
    subItems: [
      { name: '목장', amount: 40_000 },
      { name: '초원', amount: 30_000, startDate: '2026-12-01' },
      { name: '환갑', amount: 100_000, endDate: '2026-12-31' },
    ],
  });

  it('the charge is the sum of the items alive on the billing date', () => {
    expect(billAmountOn(dues, '2026-11-21')).toBe(140_000);
    expect(billAmountOn(dues, '2026-12-21')).toBe(170_000);
    expect(billAmountOn(dues, '2027-01-21')).toBe(70_000);
  });

  it('memo lists the items of that charge', () => {
    expect(billMemo(dues, '2026-12-21')).toBe('회비 (목장 40,000원 · 초원 30,000원 · 환갑 100,000원)');
    expect(billMemo(bill({}), '2026-12-10')).toBe('넷플릭스');
  });

  it('normalize keeps amount as the total of the next charge', () => {
    expect(normalizeBill(dues, '2026-12-01').amount).toBe(170_000);
  });
});

describe('auto-records follow the dates', () => {
  it('records each charge once with the sub-item total and memo', () => {
    const f = bill({ id: 'dues', name: '회비', startDate: '2026-09-15', endDate: '2026-11-09', subItems: [{ name: '목장', amount: 40_000 }, { name: '초원', amount: 30_000, startDate: '2026-10-01' }] });
    const data = emptyLedger({ accounts: [income, living], fixedExpenses: [f] });
    const out = pendingAutoRecords(data, '2026-11-20', 'me', NOW);
    expect(out.expenses.map((e) => [e.id, e.date, e.amount])).toEqual([
      [autoFixedExpenseId('dues', '2026-10'), '2026-10-10', 70_000],
    ]);
    // 09-10 은 시작일 전, 11-10 은 해지일 뒤
    const again = pendingAutoRecords({ ...data, expenses: out.expenses }, '2026-11-20', 'me', NOW);
    expect(again.expenses).toEqual([]);
  });
});

describe('amount segments (금액 변경 언제부터)', () => {
  const base = bill({ startDate: '2026-09-10' });
  const rec = (m: string) => autoFixedExpenseId('netflix', m);

  it('splits the row at the effective date; past records stay with the old row', () => {
    const recorded = new Set([rec('2026-09'), rec('2026-10'), rec('2026-11')]);
    const res = splitBillAmount([base], 'netflix', 17_000, '2027-01-15', recorded);
    if (!res.ok) throw new Error(res.error);
    const [created, ended] = res.rows;
    expect(created!.id).toBe('netflix@2027-01-15');
    expect(created!.startMonth).toBe('2027-02');
    expect(ended!.endDate).toBe('2027-01-14');
    expect(ended!.endMonth).toBe('2027-01');
    const all = [created!, ended!];
    const data = emptyLedger({
      accounts: [income, living],
      fixedExpenses: all,
      expenses: [...recorded].map((id) => expense({ id, date: '2026-09-10', amount: 15_000, accountId: living.id })),
    });
    const out = pendingAutoRecords(data, '2027-03-10', 'me', NOW);
    expect(out.expenses.map((e) => [e.date, e.amount, e.id]).sort()).toEqual([
      ['2026-12-10', 15_000, rec('2026-12')],
      ['2027-01-10', 15_000, rec('2027-01')],
      ['2027-02-10', 17_000, autoFixedExpenseId('netflix@2027-01-15', '2027-02')],
      ['2027-03-10', 17_000, autoFixedExpenseId('netflix@2027-01-15', '2027-03')],
    ]);
  });

  it('refuses a date whose charge is already recorded', () => {
    const res = splitBillAmount([base], 'netflix', 17_000, '2026-10-01', new Set([rec('2026-10')]));
    expect(res.ok).toBe(false);
  });

  it('before the first charge → in place', () => {
    const f = bill({ startDate: '2026-12-01' });
    const res = splitBillAmount([f], 'netflix', 20_000, '2026-11-20', new Set());
    expect(res.ok && res.rows.map((r) => [r.id, r.amount])).toEqual([['netflix', 20_000]]);
  });

  it('end of series ends the right row and deletes later ones', () => {
    const later = bill({ id: 'netflix@2027-01-15', startDate: '2027-01-15', amount: 17_000 });
    const first = bill({ startDate: '2026-09-10', endDate: '2027-01-14' });
    const out = endBillSeries([first, later], 'netflix', '2026-12-20');
    expect(out.map((r) => [r.id, r.endDate ?? null, r.deleted])).toEqual([
      ['netflix', '2026-12-20', false],
      ['netflix@2027-01-15', null, true],
    ]);
    expect(billSeriesRows([first, later], 'netflix').map((r) => r.id)).toEqual(['netflix', 'netflix@2027-01-15']);
  });
});

describe('allocation windows and timeline copy', () => {
  const r = rule({ id: 'r-liv', fromAccountId: income.id, toAccountId: living.id, amount: 800_000, dayOfMonth: 21, startMonth: '2026-01' });

  it('window boundaries: an allocation on D funds [D, next D)', () => {
    expect(allocationOnOrBefore('2026-11-10', 21)).toBe('2026-10-21');
    expect(allocationOnOrBefore('2026-11-21', 21)).toBe('2026-11-21');
    expect(allocationAfter('2026-11-21', 21)).toBe('2026-12-21');
    expect(allocationOnOrBefore('2026-03-01', 31)).toBe('2026-02-28');
  });

  it('first charge in the current window: paid from living now, covered from the next allocation', () => {
    const f = bill({ startDate: '2026-11-10' });
    const data = emptyLedger({ accounts: [income, living], rules: [r], fixedExpenses: [f] });
    const lines = billTimeline(data, [f], '2026-11-12');
    expect(lines[0]!.text).toBe('첫 결제 11/10 · 11/21 배분 전이라 지금 생활비에서 나가요 · 11/21 배분부터 포함해요');
    expect(billTimelineHint(data, [f], '2026-11-12')).toBe(lines[0]!.text);
  });

  it('future first charge: covered by the allocation before it', () => {
    const f = bill({ startDate: '2026-12-10' });
    const data = emptyLedger({ accounts: [income, living], rules: [r], fixedExpenses: [f] });
    expect(billTimeline(data, [f], '2026-11-12')[0]!.text).toBe('첫 결제 12/10 · 11/21 배분부터 포함해요');
  });

  it('last charge and amount change lines', () => {
    const first = bill({ startDate: '2026-11-10', endDate: '2027-01-14' });
    const next = bill({ id: 'netflix@2027-01-15', startDate: '2027-01-15', endDate: '2027-03-15', amount: 17_000 });
    const data = emptyLedger({ accounts: [income, living], rules: [r], fixedExpenses: [first, next] });
    const texts = billTimeline(data, [first, next], '2026-12-01').map((l) => l.text);
    expect(texts).toContain('1/15부터 금액 변경 · 1/21 배분부터 새 금액 17,000원');
    expect(texts).toContain('마지막 결제 3/10 · 3/21 배분부터 빠져요');
  });

  it('end example: ended 12/15 → last charge 12/10, leaves from the 12/21 allocation', () => {
    const f = bill({ startDate: '2026-11-10', endDate: '2026-12-15' });
    const data = emptyLedger({ accounts: [income, living], rules: [r], fixedExpenses: [f] });
    expect(billTimeline(data, [f], '2026-11-12').map((l) => l.text)).toContain('마지막 결제 12/10 · 12/21 배분부터 빠져요');
  });

  it('without an allocation rule only dates are shown', () => {
    const f = bill({ startDate: '2026-11-10', endDate: '2026-12-05' });
    const data = emptyLedger({ accounts: [income, living], fixedExpenses: [f] });
    expect(billTimeline(data, [f], '2026-11-12').map((l) => l.text)).toEqual(['첫 결제 11/10', '마지막 결제 11/10']);
  });
});
