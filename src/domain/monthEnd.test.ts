import { account, emptyLedger, expense, fixed } from './_fixtures';
import { allowanceTargets, autoMonthEnds, decideMonthEnd, pendingMonthEnd } from './monthEnd';
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
      month: '2026-10', leftover: 63_000, over: 0, items: [{ categoryId: null, leftover: 63_000, name: '고정', icon: 'wallet' }],
    });
  });
  it('null when decided, pending row still asks', () => {
    const d = base();
    d.monthEnds.push({ month: '2026-10', leftover: 63_000, choice: 'pending', decidedBy: null, decidedAt: null, items: null });
    expect(pendingMonthEnd(d, '2026-11-02')).not.toBeNull();
    d.monthEnds[0]!.choice = 'reservoir';
    expect(pendingMonthEnd(d, '2026-11-02')).toBeNull();
  });
  it('nothing to ask when only overspent (auto-recorded), null when ledger created this month', () => {
    const d = base();
    d.expenses.push(expense({ date: '2026-10-20', amount: 100_000, accountId: fixedAcc.id }));
    expect(pendingMonthEnd(d, '2026-11-02')).toMatchObject({ month: '2026-10', leftover: 0, over: -37_000 });
    const auto = autoMonthEnds(d, '2026-11-02', 'NOW');
    expect(auto).toEqual([
      { month: '2026-10', leftover: 0, choice: 'carryover', decidedBy: null, decidedAt: 'NOW', overCarried: true, items: [{ categoryId: null, leftover: -37_000 }] },
    ]);
    d.monthEnds.push(...auto);
    expect(pendingMonthEnd(d, '2026-11-02')).toBeNull();
    // 넘친 37,000원은 이번 달 생활비에서 빠져요
    expect(computeLiving(d, '2026-11-01').monthBudget).toBe(563_000);
    const fresh = { ...base(), settings: { ...base().settings, createdAt: '2026-11-01T00:00:00Z' } };
    expect(pendingMonthEnd(fresh, '2026-11-02')).toBeNull();
  });
});

describe('decideMonthEnd', () => {
  it('reservoir → transfer on next month 1st', () => {
    const r = decideMonthEnd(base(), '2026-12', 63_000, 'reservoir', 'minji@demo', 'NOW');
    expect(r.monthEnd).toEqual({ month: '2026-12', leftover: 63_000, choice: 'reservoir', decidedBy: 'minji@demo', decidedAt: 'NOW', items: null, overCarried: true });
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

  it('pending month end: leftover is the left items only, over is the overspent items', () => {
    const p = pendingMonthEnd(itemsLedger(), '2026-11-02')!;
    expect(p.leftover).toBe(50_000);
    expect(p.over).toBe(-20_000);
    expect(p.items.map((i) => [i.name, i.leftover])).toEqual([
      ['식비', 50_000],
      ['쇼핑', -20_000],
    ]);
  });

  it('carryover adds each item leftover to the same item next month; reservoir sends only left items and still deducts overspent ones', () => {
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

    const d2 = itemsLedger();
    const res = decideMonthEnd(d2, p.month, p.leftover, 'reservoir', 'a', 'NOW', p.items);
    expect(res.transfer).toMatchObject({ amount: 50_000, fromAccountId: fixedAcc.id, toAccountId: reservoir.id });
    expect(res.monthEnd.items).toHaveLength(2);
    d2.monthEnds.push(res.monthEnd);
    d2.transfers.push(...res.transfers);
    const nov2 = computeLiving(d2, '2026-11-02');
    expect(nov2.items.map((i) => [i.categoryId, i.carryIn])).toEqual([
      ['food', 0],
      ['shop', -20_000],
    ]);
  });

  it('old reservoir records (no overCarried) do not deduct next month', () => {
    const d = itemsLedger();
    d.monthEnds.push({ month: '2026-10', leftover: 30_000, choice: 'reservoir', decidedBy: 'a', decidedAt: 'x', items: [{ categoryId: 'shop', leftover: -20_000 }, { categoryId: 'food', leftover: 50_000 }] });
    expect(computeLiving(d, '2026-11-02').items.every((i) => i.carryIn === 0)).toBe(true);
  });
});

describe('개인 지출용 (용돈 통장으로)', () => {
  const garam = account('fixed', { id: 'liv-g', name: '생활비(가람)', ownerName: '가람' });
  const narae = account('fixed', { id: 'liv-n', name: '생활비(나래)', order: 1, ownerName: '나래' });
  const alG = account('allowance', { id: 'al-g', name: '가람 용돈', order: 4, ownerName: '가람' });
  const alN = account('allowance', { id: 'al-n', name: '나래 용돈', order: 5, ownerName: '나래' });
  const cat = { id: 'food', name: '식비', icon: 'utensils', defaultAccountRole: 'fixed' as const, order: 0, deleted: false };
  const make = (accounts = [garam, narae, alG, alN, reservoir]): LedgerData =>
    emptyLedger({
      settings: { name: '테스트', kind: 'shared', sharedLedgerId: null, schemaVersion: 1, createdAt: '2026-10-01T00:00:00.000Z' },
      accounts,
      categories: [cat],
      fixedExpenses: [
        fixed({ kind: 'living', amount: 100_000, accountId: garam.id, categoryId: 'food', startMonth: '2026-10' }),
        fixed({ kind: 'living', amount: 100_000, accountId: narae.id, categoryId: 'food', startMonth: '2026-10' }),
      ],
      expenses: [
        expense({ date: '2026-10-05', amount: 70_000, accountId: garam.id, categoryId: 'food' }),
        expense({ date: '2026-10-06', amount: 80_000, accountId: narae.id, categoryId: 'food' }),
      ],
    });

  it('남은 돈을 통장 주인의 용돈 통장으로 한 건씩 보내요', () => {
    const d = make();
    const p = pendingMonthEnd(d, '2026-11-02')!;
    expect(allowanceTargets(d, p.month, p.items)?.map((t) => [t.from, t.to.id, t.amount])).toEqual([
      ['liv-g', 'al-g', 30_000],
      ['liv-n', 'al-n', 20_000],
    ]);
    const r = decideMonthEnd(d, p.month, p.leftover, 'allowance', 'a', 'NOW', p.items);
    expect(r.monthEnd.choice).toBe('allowance');
    expect(r.transfers.map((t) => [t.fromAccountId, t.toAccountId, t.amount, t.date])).toEqual([
      ['liv-g', 'al-g', 30_000, '2026-11-01'],
      ['liv-n', 'al-n', 20_000, '2026-11-01'],
    ]);
  });

  it('용돈 통장이 없는 사람이 있으면 고를 수 없어요', () => {
    const d = make([garam, narae, alG, reservoir]);
    const p = pendingMonthEnd(d, '2026-11-02')!;
    expect(allowanceTargets(d, p.month, p.items)).toBeNull();
  });
});
