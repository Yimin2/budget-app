import { describe, expect, it } from 'vitest';
import { claimTransferId } from './claims';
import { createDemoLedger } from './defaults';
import { projectEventAccount } from './events';
import { spentBasisView } from './spentBasis';
import { account, emptyLedger, expense, transfer } from './_fixtures';

const EV = 'acc-event';

describe('이벤트통장 달 말 잔액 (쓴 날 기준)', () => {
  it('8월에 쓰고 10/10 에 돌려준 청구는 8월 잔액에서 빠지고, 10월에는 다시 빠지지 않아요', () => {
    const paid = expense({ id: 'c-paid', date: '2026-08-05', amount: 100_000, accountId: EV, paidBy: '민지', claimAccountId: 'acc-fixed' });
    const data = emptyLedger({
      accounts: [account('event', { openingBalance: 500_000, openingDate: '2026-07-01' }), account('fixed')],
      expenses: [paid],
      transfers: [transfer({ id: claimTransferId(paid.id), date: '2026-10-10', amount: 100_000, fromAccountId: EV, toAccountId: 'acc-fixed' })],
    });
    const today = '2026-11-20';
    const view = spentBasisView(data, projectEventAccount(data, today), today)!;
    const past = view.months.filter((m) => m.kind === 'past');
    expect(past.map((m) => m.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    const [aug, sep, oct] = past;
    // 8월: 통장은 그대로 50만이지만 쓴 날 기준으로는 10만 썼어요
    expect(aug).toMatchObject({ bankEnd: 500_000, owed: 100_000, end: 400_000, spent: 100_000 });
    expect(sep).toMatchObject({ end: 400_000, spent: 0 });
    // 10월: 통장에서 10만이 빠졌지만 이미 8월에 셌으니 쓴 날 기준 잔액은 그대로
    expect(oct).toMatchObject({ bankEnd: 400_000, owed: 0, end: 400_000, spent: 0, repaid: 100_000, other: 0 });
  });

  it('아직 안 돌려준 청구는 지금 쓸 수 있는 돈에서 빠지고, 돌려주는 달에도 다시 빠지지 않아요', () => {
    const pending = expense({ id: 'c-pend', date: '2026-11-05', amount: 300_000, accountId: EV, paidBy: '민지', claimAccountId: 'acc-fixed' });
    const data = emptyLedger({
      accounts: [account('event', { openingBalance: 450_000, openingDate: '2026-07-01' }), account('fixed')],
      expenses: [pending],
    });
    const today = '2026-11-20';
    const projection = projectEventAccount(data, today);
    const view = spentBasisView(data, projection, today)!;
    expect(view.balance).toBe(450_000);
    expect(view.owedNow).toBe(300_000);
    expect(view.usable).toBe(150_000);
    // 매달 끝: 통장 잔액 − 그달 뒤에 돌려줄 청구. 마지막 달에는 돌려줄 돈이 남지 않아요
    const ahead = view.months.filter((m) => m.kind !== 'past');
    const last = ahead[ahead.length - 1]!;
    expect(last.owed).toBe(0);
    expect(last.end).toBe(last.bankEnd);
    for (const m of ahead) expect(m.end).toBe(m.bankEnd - m.owed);
    // 이번 달 쓴 돈에 11/5 청구 30만이 들어가요
    expect(view.thisMonth!.spent).toBe(300_000);
  });

  it('앞으로 달은 시작 + 들어올 돈 − 쓸 돈 − 옮겨 갈 돈 = 달 말 (그 밖에 0)', () => {
    const today = '2026-11-15';
    const data = createDemoLedger(today, '2026-11-15T01:00:00.000Z', { claims: true, trips: true, couple: true, installments: true });
    const view = spentBasisView(data, projectEventAccount(data, today), today)!;
    const future = view.months.filter((m) => m.kind === 'future');
    expect(future.length).toBeGreaterThan(0);
    for (const m of future) expect(m.other).toBe(0);
    for (let i = 1; i < view.months.length; i++) expect(view.months[i]!.start).toBe(view.months[i - 1]!.end);
    expect(view.shortages.every((m) => m.end < 0)).toBe(true);
  });

  it('이벤트통장이 없으면 null', () => {
    const data = emptyLedger({ accounts: [account('fixed')] });
    expect(spentBasisView(data, projectEventAccount(data, '2026-11-20'), '2026-11-20')).toBeNull();
  });

  it('통장 시작일 전 지난 달은 쓴 돈만 (잔액을 모름), 쓴 게 없는 달은 빼요', () => {
    const data = emptyLedger({
      accounts: [account('event', { openingBalance: 500_000, openingDate: '2026-11-01' }), account('fixed')],
      expenses: [
        expense({ id: 'old1', date: '2026-08-12', amount: 120_000, accountId: EV }),
        expense({ id: 'old2', date: '2026-10-03', amount: 50_000, accountId: EV }),
      ],
    });
    const today = '2026-11-20';
    const view = spentBasisView(data, projectEventAccount(data, today), today)!;
    const past = view.months.filter((m) => m.kind === 'past');
    expect(past.map((m) => [m.month, m.spentOnly, m.spent])).toEqual([
      ['2026-08', true, 120_000],
      ['2026-10', true, 50_000],
    ]);
    // 모자라는 달로 세지 않아요
    expect(view.shortages.every((m) => !m.spentOnly)).toBe(true);
  });
});
