import { account, emptyLedger, expense, fixed, rule } from './_fixtures';
import { autoRuleAmount, livingBudgetOf } from './allocation';
import {
  activeLivingRows, computeLiving, isLivingOverride, livingItemChanges, livingLeftoverItems, livingOverrideId, livingOverrideRow,
  livingOverridesOf, livingSegmentId, livingSeriesId, splitLivingRow,
} from './living';
import type { Category, FixedExpense, LedgerData } from './types';

const liv = account('fixed');
const salary = account('income', { order: 1 });
const food: Category = { id: 'food', name: '식비', icon: 'food', defaultAccountRole: 'fixed', order: 0, deleted: false };

function foodRow(p: Partial<FixedExpense> = {}): FixedExpense {
  return fixed({ id: 'food-row', name: '식비', kind: 'living', amount: 500_000, accountId: liv.id, categoryId: 'food', startMonth: '2026-06', ...p });
}

function ledger(rows: FixedExpense[], extra: Partial<LedgerData> = {}): LedgerData {
  return emptyLedger({ accounts: [liv, salary], categories: [food], fixedExpenses: rows, ...extra });
}

/** 저장할 행을 넣은 가계부 (같은 id 는 바꿔 넣기) */
function apply(data: LedgerData, rows: FixedExpense[]): LedgerData {
  const list = [...data.fixedExpenses];
  for (const r of rows) {
    const i = list.findIndex((f) => f.id === r.id);
    if (i < 0) list.push(r);
    else list[i] = r;
  }
  return { ...data, fixedExpenses: list };
}

describe('ids', () => {
  it('segment · override ids are deterministic and share the item id', () => {
    expect(livingSegmentId('food-row', '2026-11')).toBe('food-row@2026-11');
    expect(livingOverrideId('food-row', '2026-12')).toBe('food-row@once-2026-12');
    expect(livingSeriesId('food-row@2026-11')).toBe('food-row');
    expect(livingSeriesId('food-row@once-2026-12')).toBe('food-row');
  });
});

describe('splitLivingRow — from this month only', () => {
  it('amount change on an older row: ends it last month and starts a new row this month; past months unchanged', () => {
    const prev = foodRow();
    const data = ledger([prev]);
    const out = splitLivingRow(prev, { ...prev, amount: 600_000 }, '2026-11');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'food-row@2026-11', amount: 600_000, startMonth: '2026-11', endMonth: null });
    expect(out[1]).toMatchObject({ id: 'food-row', amount: 500_000, endMonth: '2026-10' });
    const next = apply(data, out);
    expect(computeLiving(next, '2026-10-31').monthBudget).toBe(500_000);
    expect(computeLiving(next, '2026-11-10').monthBudget).toBe(600_000);
    expect(computeLiving(next, '2027-03-10').monthBudget).toBe(600_000);
    // 다시 해도 같은 행 (결정적 id)
    expect(apply(next, out).fixedExpenses).toHaveLength(2);
  });

  it('spread or schedule change also splits; end month is inherited', () => {
    const prev = foodRow({ endMonth: '2027-05' });
    const bySpread = splitLivingRow(prev, { ...prev, spread: 'monthly' }, '2026-11');
    expect(bySpread[0]).toMatchObject({ id: 'food-row@2026-11', spread: 'monthly', endMonth: '2027-05' });
    const bySchedule = splitLivingRow(prev, { ...prev, perWeek: 2 }, '2026-11');
    expect(bySchedule).toHaveLength(2);
  });

  it('edits in place when the row started this month, or nothing that matters changed', () => {
    const thisMonth = foodRow({ id: 'food-row@2026-11', startMonth: '2026-11' });
    const out = splitLivingRow(thisMonth, { ...thisMonth, amount: 700_000 }, '2026-11');
    expect(out).toEqual([{ ...thisMonth, amount: 700_000 }]);
    const prev = foodRow();
    // 쓰는 날 칸이 비었는지 · false 인지는 같은 값
    expect(splitLivingRow({ ...prev, skipHolidays: false, useDays: null }, { ...prev, skipHolidays: undefined, useDays: undefined }, '2026-11')).toHaveLength(1);
  });
});

describe('이 달만 다른 금액', () => {
  const base = foodRow();
  const dec = livingOverrideRow([base], base, '2026-12', 700_000);

  it('override row: deterministic id, one month, same item', () => {
    expect(dec).toMatchObject({ id: 'food-row@once-2026-12', override: true, startMonth: '2026-12', endMonth: '2026-12', amount: 700_000, categoryId: 'food', kind: 'living' });
    expect(isLivingOverride(dec)).toBe(true);
    expect(isLivingOverride(base)).toBe(false);
    // 같은 달을 다시 넣으면 같은 행을 고친다
    expect(livingOverrideRow([base, dec], { ...base, id: 'food-row@2027-01' }, '2026-12', 650_000).id).toBe(dec.id);
  });

  it('replaces the normal amount for that month only', () => {
    const data = ledger([base, dec]);
    expect(computeLiving(data, '2026-11-10').monthBudget).toBe(500_000);
    expect(computeLiving(data, '2026-12-10').monthBudget).toBe(700_000);
    expect(computeLiving(data, '2027-01-10').monthBudget).toBe(500_000);
    expect(activeLivingRows(data, '2026-12')).toHaveLength(1);
    expect(computeLiving(data, '2026-12-10').items[0]).toMatchObject({ name: '식비', base: 700_000, spread: 'daily' });
  });

  it('a deleted override does nothing; blank = not an override', () => {
    const data = ledger([base, { ...dec, deleted: true }]);
    expect(computeLiving(data, '2026-12-10').monthBudget).toBe(500_000);
  });

  it('leftover and carryover use the override amount', () => {
    const data = ledger([base, dec], { expenses: [expense({ date: '2026-12-05', amount: 600_000, accountId: liv.id, categoryId: 'food' })] });
    const items = livingLeftoverItems(data, '2026-12');
    expect(items).toEqual([expect.objectContaining({ categoryId: 'food', leftover: 100_000 })]);
    const jan = computeLiving(
      { ...data, monthEnds: [{ month: '2026-12', leftover: 100_000, choice: 'carryover', decidedBy: 'a', decidedAt: 'x', items: [{ categoryId: 'food', leftover: 100_000 }] }] },
      '2027-01-10',
    );
    expect(jan.items[0]).toMatchObject({ base: 500_000, carryIn: 100_000, monthBudget: 600_000 });
  });

  it('auto allocation and the budget sum use the effective amount', () => {
    const autoRule = rule({ id: 'r-auto', fromAccountId: salary.id, toAccountId: liv.id, amount: 0, kind: 'auto', dayOfMonth: 21, startMonth: '2026-11' });
    const data = ledger([base, dec], { rules: [autoRule] });
    expect(livingBudgetOf(data, liv.id, '2026-12')).toBe(700_000);
    // 11/21 배분은 [11/21, 12/21) → 12월 생활비
    expect(autoRuleAmount(data, autoRule, '2026-11-21')).toBe(700_000);
    expect(autoRuleAmount(data, autoRule, '2026-12-21')).toBe(500_000);
  });

  it('upcoming overrides of the item, and ending/deleting the item clears overrides after its end', () => {
    const jan = livingOverrideRow([base], base, '2027-01', 0);
    const list = [base, dec, jan];
    expect(livingOverridesOf(list, base, '2026-11').map((o) => o.startMonth)).toEqual(['2026-12', '2027-01']);
    const ended = livingItemChanges(list, base, { ...base, endMonth: '2026-12' }, '2026-11');
    expect(ended).toEqual([{ ...base, endMonth: '2026-12' }, { ...jan, deleted: true }]);
    const removed = livingItemChanges(list, base, { ...base, deleted: true }, '2026-11');
    expect(removed.filter((r) => r.deleted).map((r) => r.id)).toEqual(['food-row', dec.id, jan.id]);
  });

  it('a split keeps the override working (it follows the item, not the row)', () => {
    const data = ledger([base, dec]);
    const next = apply(data, livingItemChanges(data.fixedExpenses, base, { ...base, amount: 550_000 }, '2026-11'));
    expect(computeLiving(next, '2026-11-10').monthBudget).toBe(550_000);
    expect(computeLiving(next, '2026-12-10').monthBudget).toBe(700_000);
    expect(computeLiving(next, '2027-01-10').monthBudget).toBe(550_000);
    expect(computeLiving(next, '2026-10-10').monthBudget).toBe(500_000);
  });
});
