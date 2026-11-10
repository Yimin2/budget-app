import { describe, expect, it } from 'vitest';
import { account, emptyLedger, expense, rule } from './_fixtures';
import { highOnlyShortage, highOnlyShortageMessage, projectEventAccount } from './events';
import type { Expense, LedgerData } from './types';
import { percentile, usualHistory, usualSpread } from './usual';

const TODAY = '2026-11-10';
const income = account('income', { order: 0, openingDate: '2026-11-01' });
const eventAcc = account('event', { order: 1, openingBalance: 1_000_000, openingDate: '2026-11-01' });
const spend = (date: string, amount: number, p: Partial<Expense> = {}) => expense({ date, amount, accountId: eventAcc.id, ...p });
const ledger = (p: Partial<LedgerData> = {}) => emptyLedger({ accounts: [income, eventAcc], ...p });

describe('범위 폭 (아끼면 / 많이 쓰면)', () => {
  it('백분위는 선형 보간', () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([10, 20, 30, 40], 0.25)).toBe(17.5);
    expect(percentile([], 0.5)).toBe(0);
  });

  it('기록 달이 6개월 이상이면 P25 · P75 (기록 없는 달은 0원으로 센다)', () => {
    // 2026-05 ~ 2026-10: 100, 0, 300, 200, 100, 500 (천원)
    const amounts = [100, 0, 300, 200, 100, 500];
    const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
    const data = ledger({ expenses: months.flatMap((m, i) => (amounts[i]! > 0 ? [spend(`${m}-10`, amounts[i]! * 1000)] : [])) });
    // 기록 시작은 첫 지출 달(2026-05)
    const s = usualSpread(usualHistory(data, eventAcc.id), '2026-11');
    // 정렬: 0 100 100 200 300 500 → P25 = 100, 중앙값 = 150, P75 = 275
    expect(s).toEqual({ method: 'percentile', points: 6, low: 50_000, high: 125_000 });
  });

  it('2~5개월이면 표준편차 하나를 위아래로', () => {
    const data = ledger({ expenses: [spend('2026-09-01', 100_000), spend('2026-10-01', 300_000)] });
    expect(usualSpread(usualHistory(data, eventAcc.id), '2026-11')).toEqual({ method: 'stddev', points: 2, low: 100_000, high: 100_000 });
  });

  it('기록이 없거나 한 달뿐이면 폭 0 — 범위가 보통 선과 같아요', () => {
    const none = projectEventAccount(ledger(), TODAY);
    expect(none.range!.method).toBe('none');
    for (const [i, m] of none.months.entries()) {
      expect(none.range!.months[i]).toMatchObject({ endLow: m.endBalance, endHigh: m.endBalance, usualLow: 0, usualHigh: 0 });
    }
    const one = projectEventAccount(ledger({ expenses: [spend('2026-10-03', 50_000)] }), TODAY);
    expect(one.range!.points).toBe(1);
    expect(one.range!.months.every((m, i) => m.endLow === one.months[i]!.endBalance && m.endHigh === one.months[i]!.endBalance)).toBe(true);
  });

  it('아끼면은 0 아래로 내려가지 않고, 차이는 다음 달로 쌓여요', () => {
    // 평균 200, σ 100 → 아끼면 100, 많이 쓰면 300 (천원)
    const data = ledger({ expenses: [spend('2026-09-01', 100_000), spend('2026-10-01', 300_000)] });
    const p = projectEventAccount(data, TODAY);
    const r = p.range!;
    expect(p.months[1]!.usual).toBe(200_000);
    expect(r.months[1]).toMatchObject({ usualLow: 100_000, usualHigh: 300_000 });
    expect(r.months[1]!.endLow - p.months[1]!.endBalance).toBe(200_000);
    expect(p.months[1]!.endBalance - r.months[1]!.endHigh).toBe(200_000);

    // 폭이 평소 쓰는 돈보다 크면 아끼면은 0
    const wide = ledger({ expenses: [spend('2026-08-01', 600_000)] }); // 600 · 0 · 0 → 평균 200, σ 283
    const w = projectEventAccount(wide, TODAY);
    expect(w.range!.spreadLow).toBeGreaterThan(w.months[1]!.usual);
    expect(w.range!.months[1]!.usualLow).toBe(0);
  });

  it('보통이면 괜찮지만 많이 쓰면 모자라는 달을 따로 알려 줘요', () => {
    // 잔액 100만, 적립 없음, 평소 평균 7.5만(σ 2.5만): 보통 12개월 90만 < 100만, 많이 쓰면 12개월 120만 > 100만
    const data = ledger({ expenses: [spend('2026-09-01', 50_000), spend('2026-10-01', 100_000)] });
    const p = projectEventAccount(data, TODAY);
    expect(p.shortages).toEqual([]);
    const hs = highOnlyShortage(p)!;
    expect(hs).not.toBeNull();
    expect(p.range!.months.find((m) => m.month === hs.month)!.endHigh).toBe(-hs.amount);
    expect(highOnlyShortageMessage(p, TODAY)).toMatch(/^보통이면 괜찮지만, 많이 쓰면 (\d{4}년 )?\d+월에 .+원 모자라요$/);

    // 보통에도 모자라면 따로 알리지 않아요 (부족 알림이 먼저)
    const short = ledger({ expenses: [spend('2026-09-01', 150_000), spend('2026-10-01', 250_000)] });
    const ps = projectEventAccount(short, TODAY);
    expect(ps.shortages.length).toBeGreaterThan(0);
    expect(highOnlyShortageMessage(ps, TODAY)).toBeNull();

    // 적립이 넉넉하면 많이 쓰더라도 괜찮아요
    const rich = ledger({
      expenses: data.expenses,
      rules: [rule({ fromAccountId: income.id, toAccountId: eventAcc.id, amount: 300_000, startMonth: '2026-11' })],
    });
    expect(highOnlyShortageMessage(projectEventAccount(rich, TODAY), TODAY)).toBeNull();
  });

  it('메시지의 금액은 만원 단위', () => {
    const p = {
      accountId: 'e', currentBalance: 0, monthlyContribution: 0, months: [], shortages: [],
      range: { method: 'stddev' as const, points: 2, spreadLow: 0, spreadHigh: 0, months: [], highShortages: [{ month: '2027-05', amount: 230_000 }] },
    };
    expect(highOnlyShortageMessage(p, TODAY)).toBe('보통이면 괜찮지만, 많이 쓰면 2027년 5월에 23만원 모자라요');
  });
});
