import { describe, expect, it } from 'vitest';
import { accountBalance } from './balances';
import { createDemoLedger } from './defaults';
import { accountFlow, accountStartMonth, pastMonthBars, pastMonthEnds, preStartSpentMonths, spentSoFarThisMonth } from './pastBalances';
import { account, emptyLedger, expense, transfer } from './_fixtures';

const EV = 'acc-event';

function ledger() {
  return emptyLedger({
    accounts: [account('event', { openingBalance: 100_000, openingDate: '2026-08-10' }), account('income')],
    transfers: [
      transfer({ date: '2026-08-15', amount: 300_000, fromAccountId: 'acc-income', toAccountId: EV }),
      transfer({ date: '2026-09-01', amount: 300_000, fromAccountId: 'acc-income', toAccountId: EV }),
      // 예정(planned) · 지운 이체는 세지 않아요
      transfer({ date: '2026-09-02', amount: 999_000, toAccountId: EV, status: 'planned' }),
      transfer({ date: '2026-09-03', amount: 999_000, toAccountId: EV, deleted: true }),
      transfer({ date: '2026-10-05', amount: 50_000, fromAccountId: EV, toAccountId: 'acc-income' }),
      // 시작일 앞 기록은 세지 않아요
      transfer({ date: '2026-07-01', amount: 777_000, toAccountId: EV }),
    ],
    expenses: [
      expense({ date: '2026-09-20', amount: 200_000, accountId: EV }),
      expense({ date: '2026-10-11', amount: 80_000, accountId: EV }),
      expense({ date: '2026-10-12', amount: 70_000, accountId: EV, deleted: true }),
      // 청구 지출은 낸 사람 통장에서 빠져요 (이벤트통장 잔액은 그대로)
      expense({ date: '2026-10-13', amount: 40_000, accountId: EV, paidBy: '민지', claimAccountId: 'acc-income' }),
      expense({ date: '2026-11-03', amount: 30_000, accountId: EV }),
    ],
  });
}

describe('지난 달 실제 달 말 잔액', () => {
  it('통장 시작 달부터, 이번 달 앞까지 (오래된 순) · 시작 + 들어온 돈 − 나간 돈 = 끝', () => {
    const data = ledger();
    const past = pastMonthEnds(data, EV, '2026-11-20');
    expect(past).toEqual([
      { month: '2026-08', startBalance: 100_000, inflow: 300_000, outflow: 0, endBalance: 400_000 },
      { month: '2026-09', startBalance: 400_000, inflow: 300_000, outflow: 200_000, endBalance: 500_000 },
      { month: '2026-10', startBalance: 500_000, inflow: 0, outflow: 130_000, endBalance: 370_000 },
    ]);
    for (const p of past) expect(p.startBalance + p.inflow - p.outflow).toBe(p.endBalance);
    expect(past.at(-1)!.endBalance).toBe(accountBalance(data, EV, '2026-10-31'));
  });

  it('최근 count 개월만, 시작 달이 이번 달이면 빈 배열', () => {
    expect(pastMonthEnds(ledger(), EV, '2026-11-20', 2).map((p) => p.month)).toEqual(['2026-09', '2026-10']);
    expect(pastMonthEnds(ledger(), EV, '2026-08-20')).toEqual([]);
    expect(pastMonthEnds(ledger(), 'nope', '2026-11-20')).toEqual([]);
  });

  it('시작일이 비었으면 첫 기록의 달부터', () => {
    const data = ledger();
    data.accounts[0] = { ...data.accounts[0]!, openingDate: '' };
    expect(accountStartMonth(data, EV)).toBe('2026-07');
  });

  it('이번 달 이미 나간 돈 · 기간 흐름', () => {
    expect(spentSoFarThisMonth(ledger(), EV, '2026-11-20')).toBe(30_000);
    expect(spentSoFarThisMonth(ledger(), EV, '2026-11-02')).toBe(0);
    expect(accountFlow(ledger(), EV, '2026-09-01', '2026-10-31')).toEqual({ inflow: 300_000, outflow: 330_000 });
  });

  it('체험 가계부(지난 기록 켬): 12개월 막대, 이번 달 1일 잔액은 시작 잔액 그대로', () => {
    const plain = createDemoLedger('2026-11-20', '2026-11-20T01:00:00.000Z', { claims: true, trips: true });
    const d = createDemoLedger('2026-11-20', '2026-11-20T01:00:00.000Z', { claims: true, trips: true, history: true });
    const past = pastMonthEnds(d, 'demo-acc-event', '2026-11-20');
    expect(past).toHaveLength(12);
    expect(past[0]!.month).toBe('2025-11');
    expect(past.at(-1)!.endBalance).toBe(600_000);
    expect(past.every((p) => p.endBalance > 0)).toBe(true);
    expect(accountBalance(d, 'demo-acc-event', '2026-11-20')).toBe(accountBalance(plain, 'demo-acc-event', '2026-11-20'));
    expect(d.forecasts).toHaveLength(6);
    expect(d.forecasts.every((f) => f.outflow! >= 0)).toBe(true);
  });
});

describe('통장 시작 전 달: 쓴 돈만', () => {
  // 통장은 11월에 시작, 노션에서 가져온 지난 이벤트 지출은 그 전부터
  function imported() {
    return emptyLedger({
      accounts: [account('event', { openingBalance: 500_000, openingDate: '2026-11-01' }), account('income'), account('reservoir')],
      categories: [
        { id: 'c-occ', name: '경조사', group: 'event', budget: 0, deleted: false } as never,
        { id: 'c-gift', name: '선물', group: 'event', budget: 0, deleted: false } as never,
      ],
      expenses: [
        // 12개월 창 밖 (2025-11 전)
        expense({ date: '2025-10-30', amount: 999_000, accountId: EV, categoryId: 'c-occ' }),
        expense({ date: '2026-05-03', amount: 100_000, accountId: EV, categoryId: 'c-occ' }),
        expense({ date: '2026-05-20', amount: 50_000, accountId: EV, categoryId: 'c-occ' }),
        expense({ date: '2026-05-21', amount: 30_000, accountId: EV, categoryId: 'c-gift' }),
        // 지운 지출 · 다른 통장 지출은 세지 않아요
        expense({ date: '2026-06-01', amount: 70_000, accountId: EV, deleted: true }),
        expense({ date: '2026-06-02', amount: 70_000, accountId: 'acc-income' }),
        // 청구(개인 돈으로 냄)도 쓴 날의 달에 세요
        expense({ date: '2026-09-09', amount: 40_000, accountId: EV, categoryId: 'c-gift', paidBy: '민지', claimAccountId: 'acc-income' }),
        // 시작 달부터는 잔액 막대
        expense({ date: '2026-11-03', amount: 30_000, accountId: EV }),
      ],
    });
  }

  it('시작 달 전 · 12개월 창 안 · 기록이 있는 달만, 쓴 날 기준 합과 eventRecordGroup 줄', () => {
    const data = imported();
    const pre = preStartSpentMonths(data, EV, '2026-11-20');
    expect(pre.map((m) => [m.month, m.kind, m.spent, m.count])).toEqual([
      ['2026-05', 'spentOnly', 180_000, 3],
      ['2026-09', 'spentOnly', 40_000, 1],
    ]);
    expect(pre[0]!.items.map((i) => [i.label, i.amount, i.expenseIds.length])).toEqual([
      ['경조사', 150_000, 2],
      ['선물', 30_000, 1],
    ]);
    // 시작 달이 이번 달이니 잔액 막대는 없고, 합친 막대는 쓴 돈 달만
    expect(pastMonthEnds(data, EV, '2026-11-20')).toEqual([]);
    expect(pastMonthBars(data, EV, '2026-11-20').map((b) => [b.month, b.kind])).toEqual([
      ['2026-05', 'spentOnly'],
      ['2026-09', 'spentOnly'],
    ]);
  });

  it('시작 달이 창 안에 있으면 그 전은 쓴 돈, 시작 달부터는 잔액 · count 를 따라요', () => {
    const data = imported();
    data.accounts[0] = { ...data.accounts[0]!, openingDate: '2026-08-01' };
    const bars = pastMonthBars(data, EV, '2026-11-20');
    expect(bars.map((b) => [b.month, b.kind])).toEqual([
      ['2026-05', 'spentOnly'],
      ['2026-08', 'balance'],
      ['2026-09', 'balance'],
      ['2026-10', 'balance'],
    ]);
    expect(preStartSpentMonths(data, EV, '2026-11-20', 4)).toEqual([]);
    // 시작일이 비면 첫 기록의 달이 시작이라 그 전 기록은 없어요
    data.accounts[0] = { ...data.accounts[0]!, openingDate: '' };
    expect(preStartSpentMonths(data, EV, '2026-11-20')).toEqual([]);
    expect(preStartSpentMonths(data, 'nope', '2026-11-20')).toEqual([]);
  });
});
