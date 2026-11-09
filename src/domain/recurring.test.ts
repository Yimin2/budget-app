import { account, emptyLedger, fixed, rule, transfer } from './_fixtures';
import { autoFixedExpenseId, autoTransferId } from './ids';
import { pendingAutoRecords } from './recurring';

const income = account('income');
const fixedAcc = account('fixed', { order: 1 });
const eventAcc = account('event', { order: 2 });
const NOW = '2026-11-10T09:00:00.000Z';

describe('pendingAutoRecords', () => {
  it('creates due rule transfers and fixed expenses from start month to today', () => {
    const r = rule({ id: 'r1', fromAccountId: income.id, toAccountId: eventAcc.id, amount: 300_000, dayOfMonth: 25, startMonth: '2026-09' });
    const f = fixed({ id: 'f1', name: '월세', kind: 'bill', amount: 800_000, accountId: fixedAcc.id, dayOfMonth: 10, startMonth: '2026-10', categoryId: 'c' });
    const data = emptyLedger({ accounts: [income, fixedAcc, eventAcc], rules: [r], fixedExpenses: [f] });
    const out = pendingAutoRecords(data, '2026-11-10', 'me@x', NOW);
    expect(out.transfers.map((t) => t.id)).toEqual([autoTransferId('r1', '2026-09'), autoTransferId('r1', '2026-10')]);
    expect(out.transfers[0]).toMatchObject({
      date: '2026-09-25', kind: 'transfer', status: 'done', ruleId: 'r1', amount: 300_000,
      fromAccountId: income.id, toAccountId: eventAcc.id, author: 'me@x', createdAt: NOW, deleted: false,
    });
    expect(out.expenses.map((e) => e.date)).toEqual(['2026-10-10', '2026-11-10']);
    expect(out.expenses[1]).toMatchObject({
      id: autoFixedExpenseId('f1', '2026-11'), fixedExpenseId: 'f1', amount: 800_000, accountId: fixedAcc.id,
      categoryId: 'c', memo: '월세', eventId: null,
    });
  });

  it('is idempotent: existing ids (including deleted) are skipped', () => {
    const r = rule({ id: 'r1', fromAccountId: income.id, toAccountId: eventAcc.id, amount: 1, startMonth: '2026-10' });
    const data = emptyLedger({
      rules: [r],
      transfers: [transfer({ id: autoTransferId('r1', '2026-10'), date: '2026-10-01', amount: 1, deleted: true })],
    });
    const first = pendingAutoRecords(data, '2026-11-10', 'a', NOW);
    expect(first.transfers.map((t) => t.id)).toEqual([autoTransferId('r1', '2026-11')]);
    const again = pendingAutoRecords({ ...data, transfers: [...data.transfers, ...first.transfers] }, '2026-11-10', 'b', NOW);
    expect(again.transfers).toEqual([]);
  });

  it('dayOfMonth 31 in February → Feb 28; not before the day', () => {
    const r = rule({ id: 'r', fromAccountId: 'a', toAccountId: 'b', amount: 1, dayOfMonth: 31, startMonth: '2027-02' });
    expect(pendingAutoRecords(emptyLedger({ rules: [r] }), '2027-02-27', 'a', NOW).transfers).toEqual([]);
    expect(pendingAutoRecords(emptyLedger({ rules: [r] }), '2027-02-28', 'a', NOW).transfers[0]!.date).toBe('2027-02-28');
  });

  it('skips ended / deleted rules, living fixed, and is not replaced by planned transfers', () => {
    const ended = rule({ id: 'e', fromAccountId: 'a', toAccountId: 'b', amount: 1, startMonth: '2026-10', endMonth: '2026-10' });
    const deleted = rule({ id: 'd', fromAccountId: 'a', toAccountId: 'b', amount: 1, deleted: true });
    const live = rule({ id: 'l', fromAccountId: 'a', toAccountId: 'b', amount: 1, startMonth: '2026-11' });
    const data = emptyLedger({
      rules: [ended, deleted, live],
      transfers: [transfer({ date: '2026-11-20', amount: 1, ruleId: 'l', status: 'planned' })],
      fixedExpenses: [
        fixed({ kind: 'living', amount: 600_000, accountId: 'x' }),
        fixed({ kind: 'bill', amount: 1, accountId: 'x', deleted: true }),
        fixed({ kind: 'allowance', amount: 150_000, accountId: 'x', dayOfMonth: 1, startMonth: '2026-11', targetEmail: 'm@x' }),
      ],
    });
    const out = pendingAutoRecords(data, '2026-11-10', 'a', NOW);
    expect(out.transfers.map((t) => t.id)).toEqual([autoTransferId('e', '2026-10'), autoTransferId('l', '2026-11')]);
    expect(out.expenses).toHaveLength(1);
    expect(out.expenses[0]!.amount).toBe(150_000);
  });
});
