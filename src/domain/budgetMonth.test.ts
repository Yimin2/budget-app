/* 예산 달별 보기 (작업정리 13): 달 고르기 · 지난 달 · 이번 달 · 다음 달(준비함 / 안 함) · [전달 복사] · [초기화] */
import { describe, expect, it } from 'vitest';
import { account, emptyLedger, fixed, rule } from './_fixtures';
import { livingBudgetOf, ruleAmountIn } from './allocation';
import { billChargeDate } from './bills';
import {
  budgetMonthView, clampBudgetMonth, earliestBudgetMonth, hasBudgetWrites, isNextMonthRow, nextMonthCopy, nextMonthNewId, nextMonthReset,
  type NextMonthWrites,
} from './budgetMonth';
import { activeIncomePlans } from './income';
import { livingItemChanges, livingOverrideRow } from './living';
import type { IncomePlan, LedgerData } from './types';

const TODAY = '2026-11-20';
const income = account('income', { id: 'acc-income' });
const living = account('fixed', { id: 'acc-living', order: 1 });

const plan: IncomePlan = {
  id: 'plan-1', personName: '민지', personEmail: null, amount: 3_000_000, dayOfMonth: 21, accountId: income.id,
  startMonth: '2026-01', endMonth: null, memo: '', deleted: false,
};

function base(extra: Partial<LedgerData> = {}): LedgerData {
  return emptyLedger({
    accounts: [income, living],
    incomePlans: [plan],
    rules: [
      // 10월까지 80만, 11월부터 90만 (지난 달엔 그때 금액)
      rule({ id: 'r-living', fromAccountId: income.id, toAccountId: living.id, amount: 800_000, dayOfMonth: 21, startMonth: '2026-01', endMonth: '2026-10' }),
      rule({ id: 'r-living@2026-11', fromAccountId: income.id, toAccountId: living.id, amount: 900_000, dayOfMonth: 21, startMonth: '2026-11' }),
      rule({ id: 'r-save', fromAccountId: income.id, toAccountId: 'acc-savings', amount: 300_000, dayOfMonth: 25, startMonth: '2026-03', endMonth: '2027-03' }),
    ],
    fixedExpenses: [
      fixed({ id: 'food', name: '식비', kind: 'living', amount: 400_000, accountId: living.id, categoryId: 'food', startMonth: '2026-06', endMonth: '2026-10' }),
      fixed({ id: 'food@2026-11', name: '식비', kind: 'living', amount: 500_000, accountId: living.id, categoryId: 'food', startMonth: '2026-11' }),
      fixed({ id: 'netflix', name: '넷플릭스', kind: 'bill', amount: 17_000, accountId: living.id, dayOfMonth: 10, startMonth: '2026-03', startDate: '2026-03-10' }),
      fixed({ id: 'tv', name: 'TV 할부', kind: 'installment', amount: 50_000, accountId: living.id, dayOfMonth: 15, startMonth: '2026-05', endMonth: '2027-04' }),
    ],
    ...extra,
  });
}

/** 쓸 행을 차례로 넣은 가계부 (같은 id 는 바꿔 넣기) */
function apply(data: LedgerData, w: NextMonthWrites): LedgerData {
  let out = data;
  for (const step of [w.first, w.then]) {
    for (const t of ['rules', 'incomePlans', 'fixedExpenses'] as const) {
      const list = [...(out[t] as { id: string }[])];
      for (const r of step[t] as { id: string }[]) {
        const i = list.findIndex((x) => x.id === r.id);
        if (i < 0) list.push(r);
        else list[i] = r;
      }
      out = { ...out, [t]: list };
    }
  }
  return out;
}

const prepared = (d: LedgerData): LedgerData => ({ ...d, settings: { ...d.settings, preparedMonth: '2026-12' } });

describe('예산 달 고르기', () => {
  it('지난 달은 보기만 · 이번 달은 지금처럼 · 다음 달은 준비해야 고쳐요', () => {
    const d = base();
    expect(budgetMonthView(d, TODAY, '2026-10')).toEqual({ month: '2026-10', kind: 'past', prepared: false, editable: false, empty: false, asOf: '2026-10-01' });
    expect(budgetMonthView(d, TODAY, '2026-11')).toEqual({ month: '2026-11', kind: 'current', prepared: false, editable: true, empty: false, asOf: TODAY });
    expect(budgetMonthView(d, TODAY, '2026-12')).toMatchObject({ kind: 'next', prepared: false, editable: false, empty: true, asOf: '2026-12-01' });
    expect(budgetMonthView(prepared(d), TODAY, '2026-12')).toMatchObject({ kind: 'next', prepared: true, editable: true, empty: false });
  });

  it('다음 달까지만 갈 수 있고, 가장 앞 달은 가계부를 만든 달 · 예산 행이 시작한 달이에요', () => {
    const d = base();
    expect(earliestBudgetMonth(d, TODAY)).toBe('2026-01');
    expect(clampBudgetMonth(d, TODAY, '2027-02')).toBe('2026-12');
    expect(clampBudgetMonth(d, TODAY, '2025-05')).toBe('2026-01');
    expect(budgetMonthView(d, TODAY, '2027-05').month).toBe('2026-12');
    // 지난달 값이 남은 '준비한달'은 준비한 것이 아니에요
    const stale = { ...d, settings: { ...d.settings, preparedMonth: '2026-11' } };
    expect(budgetMonthView(stale, TODAY, '2026-12').prepared).toBe(false);
  });

  it('지난 달은 그달에 적용된 예산 그대로예요', () => {
    const d = base();
    expect(livingBudgetOf(d, living.id, '2026-10')).toBe(400_000);
    expect(ruleAmountIn(d, d.rules.find((r) => r.id === 'r-living')!, '2026-10')).toBe(800_000);
    expect(livingBudgetOf(d, living.id, '2026-11')).toBe(500_000);
  });

  it('다음 달을 준비하지 않으면 이번 달 예산이 그대로 이어져요 (0이 되지 않아요)', () => {
    const d = base();
    expect(livingBudgetOf(d, living.id, '2026-12')).toBe(500_000);
    expect(activeIncomePlans(d, '2026-12')).toHaveLength(1);
    expect(billChargeDate(d.fixedExpenses.find((f) => f.id === 'netflix')!, '2026-12')).toBe('2026-12-10');
  });
});

describe('[전달 복사]', () => {
  it('이번 달 예산 중 다음 달에도 이어지는 행을 나눠 다음 달 행을 만들어요 (할부는 그대로)', () => {
    const d = base();
    const w = nextMonthCopy(d, TODAY);
    expect(w.first.rules.map((r) => r.id).sort()).toEqual(['r-living@2026-12', 'r-save@2026-12']);
    expect(w.then.rules.map((r) => [r.id, r.endMonth])).toEqual([
      ['r-living@2026-11', '2026-11'],
      ['r-save', '2026-11'],
    ]);
    expect(w.first.rules.find((r) => r.id === 'r-save@2026-12')).toMatchObject({ startMonth: '2026-12', endMonth: '2027-03', amount: 300_000 });
    expect(w.first.incomePlans.map((p) => p.id)).toEqual(['plan-1@2026-12']);
    expect(w.first.fixedExpenses.map((f) => f.id).sort()).toEqual(['food@2026-12', 'netflix@2026-12-01']);
    expect(w.then.fixedExpenses.map((f) => f.id).sort()).toEqual(['food@2026-11', 'netflix']);

    const after = apply(d, w);
    const netflix = after.fixedExpenses.find((f) => f.id === 'netflix')!;
    const netflixNext = after.fixedExpenses.find((f) => f.id === 'netflix@2026-12-01')!;
    expect(netflix).toMatchObject({ endDate: '2026-11-30', endMonth: '2026-11' });
    expect(billChargeDate(netflix, '2026-11')).toBe('2026-11-10');
    expect(billChargeDate(netflix, '2026-12')).toBeNull();
    expect(billChargeDate(netflixNext, '2026-12')).toBe('2026-12-10');
    // 두 달 모두 금액은 그대로
    expect(livingBudgetOf(after, living.id, '2026-11')).toBe(500_000);
    expect(livingBudgetOf(after, living.id, '2026-12')).toBe(500_000);
    expect(activeIncomePlans(after, '2026-11').map((p) => p.id)).toEqual(['plan-1']);
    expect(activeIncomePlans(after, '2026-12').map((p) => p.id)).toEqual(['plan-1@2026-12']);
    // 다시 해도 같아요
    expect(hasBudgetWrites(nextMonthCopy(after, TODAY))).toBe(false);
  });

  it('준비한 뒤에는 두 달을 따로 고쳐요', () => {
    const after = apply(base(), nextMonthCopy(base(), TODAY));
    const nextRow = after.fixedExpenses.find((f) => f.id === 'food@2026-12')!;
    const curRow = after.fixedExpenses.find((f) => f.id === 'food@2026-11')!;
    // 다음 달 행 고치기 (다음 달에 시작한 행이라 그 자리에서)
    let d = after;
    for (const r of livingItemChanges(d.fixedExpenses, nextRow, { ...nextRow, amount: 600_000 }, '2026-11')) {
      d = { ...d, fixedExpenses: d.fixedExpenses.map((f) => (f.id === r.id ? r : f)).concat(d.fixedExpenses.some((f) => f.id === r.id) ? [] : [r]) };
    }
    expect(livingBudgetOf(d, living.id, '2026-11')).toBe(500_000);
    expect(livingBudgetOf(d, living.id, '2026-12')).toBe(600_000);
    // 이번 달 행 고치기는 이번 달까지만 (앞 행이 이번 달에 끝나서)
    for (const r of livingItemChanges(d.fixedExpenses, curRow, { ...curRow, amount: 450_000 }, '2026-11')) {
      d = { ...d, fixedExpenses: d.fixedExpenses.map((f) => (f.id === r.id ? r : f)).concat(d.fixedExpenses.some((f) => f.id === r.id) ? [] : [r]) };
    }
    expect(livingBudgetOf(d, living.id, '2026-11')).toBe(450_000);
    expect(livingBudgetOf(d, living.id, '2026-12')).toBe(600_000);
  });
});

describe('[초기화]', () => {
  it('다음 달 행을 지우고 앞 행의 끝을 되돌려 다시 이번 달 예산이 이어져요', () => {
    let d = apply(base(), nextMonthCopy(base(), TODAY));
    // 다음 달에 고친 것 · 새로 넣은 것 · 이 달만 다른 금액
    d = {
      ...d,
      fixedExpenses: [
        ...d.fixedExpenses.map((f) => (f.id === 'food@2026-12' ? { ...f, amount: 700_000 } : f)),
        fixed({ id: nextMonthNewId('new-bill', 'fixedExpenses', 'bill', '2026-12'), name: '헬스장', kind: 'bill', amount: 50_000, accountId: living.id, dayOfMonth: 5, startMonth: '2026-12', startDate: '2026-12-01' }),
        livingOverrideRow(d.fixedExpenses, d.fixedExpenses.find((f) => f.id === 'food@2026-12')!, '2026-12', 800_000),
      ],
      rules: [...d.rules, rule({ id: nextMonthNewId('new-rule', 'rules', null, '2026-12'), fromAccountId: income.id, toAccountId: 'acc-event', amount: 100_000, startMonth: '2026-12' })],
    };
    expect(livingBudgetOf(d, living.id, '2026-12')).toBe(800_000);

    const w = nextMonthReset(d, TODAY);
    const removed = [...w.first.rules, ...w.first.incomePlans, ...w.first.fixedExpenses];
    expect(removed.every((r) => r.deleted)).toBe(true);
    expect(removed.map((r) => r.id).sort()).toEqual(
      ['food@2026-12', 'food@once-2026-12', 'netflix@2026-12-01', 'new-bill@2026-12-01', 'new-rule@2026-12', 'plan-1@2026-12', 'r-living@2026-12', 'r-save@2026-12'].sort(),
    );
    const after = apply(d, w);
    expect(after.rules.find((r) => r.id === 'r-living@2026-11')!.endMonth).toBeNull();
    expect(after.rules.find((r) => r.id === 'r-save')!.endMonth).toBe('2027-03');
    expect(after.incomePlans.find((p) => p.id === 'plan-1')!.endMonth).toBeNull();
    const netflix = after.fixedExpenses.find((f) => f.id === 'netflix')!;
    expect(netflix).toMatchObject({ endDate: null, endMonth: null });
    expect(billChargeDate(netflix, '2026-12')).toBe('2026-12-10');
    // 다시 이번 달 예산이 이어져요 · 할부는 그대로
    expect(livingBudgetOf(after, living.id, '2026-12')).toBe(500_000);
    expect(after.fixedExpenses.find((f) => f.id === 'tv')).toEqual(d.fixedExpenses.find((f) => f.id === 'tv'));
    // 다시 해도 같아요
    expect(hasBudgetWrites(nextMonthReset(after, TODAY))).toBe(false);
  });

  it('다음 달 표시: 다음 달 id 만 (이번 달 행 · 할부 · 다른 달은 아니에요)', () => {
    expect(isNextMonthRow('rules', { id: 'a@2026-12' }, '2026-12')).toBe(true);
    expect(isNextMonthRow('rules', { id: 'a@2026-11' }, '2026-12')).toBe(false);
    expect(isNextMonthRow('fixedExpenses', { id: 'n@2026-12-15', kind: 'bill' }, '2026-12')).toBe(true);
    expect(isNextMonthRow('fixedExpenses', { id: 'n@2027-01-01', kind: 'bill' }, '2026-12')).toBe(false);
    expect(isNextMonthRow('fixedExpenses', { id: 'tv@2026-12', kind: 'installment' }, '2026-12')).toBe(false);
    expect(isNextMonthRow('fixedExpenses', { id: 'food@once-2026-12', kind: 'living' }, '2026-12')).toBe(true);
  });
});
