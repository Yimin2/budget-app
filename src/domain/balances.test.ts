import { account, emptyLedger, expense, transfer } from './_fixtures';
import { accountBalance, adjustmentDelta, allBalances } from './balances';

describe('balances', () => {
  const fixedAcc = account('fixed', { openingBalance: 1_000_000, openingDate: '2026-11-01' });
  const event = account('event', { openingBalance: 100_000, openingDate: '2026-11-01' });
  const gone = account('other', { id: 'gone', deleted: true });
  const data = emptyLedger({
    accounts: [fixedAcc, event, gone],
    transfers: [
      transfer({ date: '2026-11-01', amount: 300_000, fromAccountId: fixedAcc.id, toAccountId: event.id }),
      transfer({ date: '2026-11-05', amount: 50_000, toAccountId: fixedAcc.id, kind: 'income' }),
      transfer({ date: '2026-11-06', amount: 1_000, toAccountId: fixedAcc.id, deleted: true }),
      transfer({ date: '2026-11-07', amount: 7_000, toAccountId: fixedAcc.id, status: 'planned' }),
      transfer({ date: '2026-10-31', amount: 9_999, toAccountId: fixedAcc.id }), // 시작일 이전
      transfer({ date: '2026-11-08', amount: 20_000, fromAccountId: fixedAcc.id, kind: 'adjustment' }),
    ],
    expenses: [
      expense({ date: '2026-11-03', amount: 10_000, accountId: fixedAcc.id }),
      expense({ date: '2026-11-03', amount: 5_000, accountId: fixedAcc.id, deleted: true }),
      expense({ date: '2026-11-20', amount: 70_000, accountId: fixedAcc.id }), // asOf 이후
    ],
  });

  it('computes balance with done, non-deleted rows in range', () => {
    expect(accountBalance(data, fixedAcc.id, '2026-11-10')).toBe(1_000_000 - 300_000 + 50_000 - 20_000 - 10_000);
    expect(accountBalance(data, event.id, '2026-11-10')).toBe(400_000);
    expect(accountBalance(data, fixedAcc.id, '2026-11-30')).toBe(720_000 - 70_000);
    expect(accountBalance(data, 'missing', '2026-11-10')).toBe(0);
  });
  it('allBalances skips deleted accounts', () => {
    const all = allBalances(data, '2026-11-10');
    expect(Object.keys(all).sort()).toEqual([event.id, fixedAcc.id].sort());
  });
  it('adjustmentDelta', () => {
    expect(adjustmentDelta(data, event.id, 450_000, '2026-11-10')).toBe(50_000);
    expect(adjustmentDelta(data, event.id, 380_000, '2026-11-10')).toBe(-20_000);
    expect(adjustmentDelta(data, event.id, 400_000, '2026-11-10')).toBe(0);
  });
});
