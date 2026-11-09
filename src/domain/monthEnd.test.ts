import { account, emptyLedger, expense, fixed } from './_fixtures';
import { decideMonthEnd, pendingMonthEnd } from './monthEnd';
import { computeLiving } from './living';
import type { LedgerData } from './types';

const fixedAcc = account('fixed');
const reservoir = account('reservoir', { order: 1 });
const base = (): LedgerData =>
  emptyLedger({
    settings: { name: '테스트', kind: 'shared', sharedLedgerId: null, schemaVersion: 1, createdAt: '2026-10-01T00:00:00.000Z' },
    accounts: [fixedAcc, reservoir],
    fixedExpenses: [fixed({ kind: 'living', amount: 600_000, accountId: fixedAcc.id })],
    expenses: [expense({ date: '2026-10-15', amount: 537_000, accountId: fixedAcc.id })],
  });

describe('pendingMonthEnd', () => {
  it('asks about last month leftover', () => {
    expect(pendingMonthEnd(base(), '2026-11-02')).toEqual({
      month: '2026-10', leftover: 63_000, items: [{ categoryId: null, leftover: 63_000, name: '고정', icon: 'wallet' }],
    });
  });
  it('null when decided, pending row still asks', () => {
    const d = base();
    d.monthEnds.push({ month: '2026-10', leftover: 63_000, choice: 'pending', decidedBy: null, decidedAt: null, items: null });
    expect(pendingMonthEnd(d, '2026-11-02')).not.toBeNull();
    d.monthEnds[0]!.choice = 'reservoir';
    expect(pendingMonthEnd(d, '2026-11-02')).toBeNull();
  });
  it('null when nothing left or ledger created this month', () => {
    const d = base();
    d.expenses.push(expense({ date: '2026-10-20', amount: 100_000, accountId: fixedAcc.id }));
    expect(pendingMonthEnd(d, '2026-11-02')).toBeNull();
    const fresh = { ...base(), settings: { ...base().settings, createdAt: '2026-11-01T00:00:00Z' } };
    expect(pendingMonthEnd(fresh, '2026-11-02')).toBeNull();
  });
});

describe('decideMonthEnd', () => {
  it('reservoir → transfer on next month 1st', () => {
    const r = decideMonthEnd(base(), '2026-12', 63_000, 'reservoir', 'minji@demo', 'NOW');
    expect(r.monthEnd).toEqual({ month: '2026-12', leftover: 63_000, choice: 'reservoir', decidedBy: 'minji@demo', decidedAt: 'NOW', items: null });
    expect(r.transfer).toMatchObject({
      date: '2027-01-01', kind: 'transfer', status: 'done', fromAccountId: fixedAcc.id, toAccountId: reservoir.id, amount: 63_000,
    });
  });
  it('carryover → no transfer, next month budget increases', () => {
    const d = base();
    const r = decideMonthEnd(d, '2026-10', 63_000, 'carryover', 'a', 'NOW');
    expect(r.transfer).toBeNull();
    d.monthEnds.push(r.monthEnd);
    expect(computeLiving(d, '2026-11-01').monthBudget).toBe(663_000);
    expect(pendingMonthEnd(d, '2026-11-02')).toBeNull();
  });
  it('no reservoir account → no transfer', () => {
    const d = { ...base(), accounts: [fixedAcc] };
    expect(decideMonthEnd(d, '2026-10', 63_000, 'reservoir', 'a', 'NOW').transfer).toBeNull();
  });
});

describe('per-item month end', () => {
  const cats = [
    { id: 'food', name: '식비', icon: 'utensils', defaultAccountRole: 'fixed' as const, order: 0, deleted: false },
    { id: 'shop', name: '쇼핑', icon: 'bag', defaultAccountRole: 'fixed' as const, order: 1, deleted: false },
  ];
  const itemsLedger = (): LedgerData =>
    emptyLedger({
      settings: { name: '테스트', kind: 'shared', sharedLedgerId: null, schemaVersion: 1, createdAt: '2026-10-01T00:00:00.000Z' },
      accounts: [fixedAcc, reservoir],
      categories: cats,
      fixedExpenses: [
        fixed({ kind: 'living', name: '식비', amount: 300_000, accountId: fixedAcc.id, categoryId: 'food', startMonth: '2026-10' }),
        fixed({ kind: 'living', name: '쇼핑', amount: 100_000, accountId: fixedAcc.id, categoryId: 'shop', spread: 'monthly', startMonth: '2026-10' }),
      ],
      expenses: [
        expense({ date: '2026-10-10', amount: 250_000, accountId: fixedAcc.id, categoryId: 'food' }),
        expense({ date: '2026-10-12', amount: 120_000, accountId: fixedAcc.id, categoryId: 'shop' }),
      ],
    });

  it('pending month end has per-item leftovers (negative included) that sum to the total', () => {
    const p = pendingMonthEnd(itemsLedger(), '2026-11-02')!;
    expect(p.leftover).toBe(30_000);
    expect(p.items.map((i) => [i.name, i.leftover])).toEqual([
      ['식비', 50_000],
      ['쇼핑', -20_000],
    ]);
  });

  it('carryover adds each item leftover to the same item next month; reservoir sends the total once', () => {
    const d = itemsLedger();
    const p = pendingMonthEnd(d, '2026-11-02')!;
    const carry = decideMonthEnd(d, p.month, p.leftover, 'carryover', 'a', 'NOW', p.items);
    expect(carry.monthEnd.items).toEqual([
      { categoryId: 'food', leftover: 50_000 },
      { categoryId: 'shop', leftover: -20_000 },
    ]);
    d.monthEnds.push(carry.monthEnd);
    const nov = computeLiving(d, '2026-11-02');
    expect(nov.items.map((i) => [i.categoryId, i.carryIn, i.monthBudget])).toEqual([
      ['food', 50_000, 350_000],
      ['shop', -20_000, 80_000],
    ]);
    expect(nov.monthBudget).toBe(430_000);

    const res = decideMonthEnd(itemsLedger(), p.month, p.leftover, 'reservoir', 'a', 'NOW', p.items);
    expect(res.transfer).toMatchObject({ amount: 30_000, fromAccountId: fixedAcc.id, toAccountId: reservoir.id });
    expect(res.monthEnd.items).toHaveLength(2);
  });
});
