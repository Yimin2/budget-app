import { account, emptyLedger, fixed, transfer } from './_fixtures';
import { allowanceFor, pendingAllowanceIncome } from './allowance';
import { allowanceIncomeId } from './ids';
import { computeLiving } from './living';

const NOW = '2026-11-10T09:00:00.000Z';
const shared = emptyLedger({
  settings: { name: '우리집', kind: 'shared', sharedLedgerId: null, schemaVersion: 1, createdAt: '2026-01-01T00:00:00Z' },
  fixedExpenses: [
    fixed({ id: 'a-minji', kind: 'allowance', amount: 150_000, accountId: 'f', dayOfMonth: 5, targetEmail: 'Minji@Demo', startMonth: '2026-08' }),
    fixed({ id: 'a-old', kind: 'allowance', amount: 50_000, accountId: 'f', dayOfMonth: 5, targetEmail: 'minji@demo', startMonth: '2026-01', endMonth: '2026-09' }),
    fixed({ id: 'a-junho', kind: 'allowance', amount: 150_000, accountId: 'f', dayOfMonth: 1, targetEmail: 'junho@demo' }),
    fixed({ id: 'a-del', kind: 'allowance', amount: 99_000, accountId: 'f', dayOfMonth: 1, targetEmail: 'minji@demo', deleted: true }),
    fixed({ id: 'rent', kind: 'bill', amount: 800_000, accountId: 'f', dayOfMonth: 1 }),
  ],
});
const wallet = account('allowance', { id: 'wallet', openingDate: '2026-10-01' });
const personal = emptyLedger({
  settings: { name: '민지', kind: 'personal', sharedLedgerId: 'S', schemaVersion: 1, createdAt: '2026-10-03T00:00:00Z' },
  accounts: [wallet],
});

describe('allowanceFor', () => {
  it('sums active allowance for email, case-insensitive', () => {
    expect(allowanceFor(shared, 'minji@demo', '2026-09')).toBe(200_000);
    expect(allowanceFor(shared, 'MINJI@demo', '2026-11')).toBe(150_000);
    expect(allowanceFor(shared, 'nobody@x', '2026-11')).toBe(0);
  });
});

describe('pendingAllowanceIncome', () => {
  it('creates income from the later of startMonth and personal creation month, only past due days', () => {
    const out = pendingAllowanceIncome(personal, shared, 'S', 'minji@demo', '2026-11-04', NOW);
    // 10월만 (11월 5일은 아직), a-old 는 9월에 끝남
    expect(out.map((t) => t.id)).toEqual([allowanceIncomeId('S', 'a-minji', '2026-10')]);
    expect(out[0]).toMatchObject({ kind: 'income', fromAccountId: null, toAccountId: 'wallet', amount: 150_000, status: 'done', date: '2026-10-05' });
    const later = pendingAllowanceIncome(personal, shared, 'S', 'minji@demo', '2026-11-05', NOW);
    expect(later).toHaveLength(2);
  });

  it('idempotent and needs an allowance account', () => {
    const existing = { ...personal, transfers: [transfer({ id: allowanceIncomeId('S', 'a-minji', '2026-10'), date: '2026-10-05', amount: 1, deleted: true })] };
    expect(pendingAllowanceIncome(existing, shared, 'S', 'minji@demo', '2026-11-04', NOW)).toEqual([]);
    expect(pendingAllowanceIncome({ ...personal, accounts: [] }, shared, 'S', 'minji@demo', '2026-11-30', NOW)).toEqual([]);
  });

  it('income does not count as living spending in personal ledger', () => {
    const inc = pendingAllowanceIncome(personal, shared, 'S', 'minji@demo', '2026-11-10', NOW);
    const s = computeLiving({ ...personal, transfers: inc }, '2026-11-10');
    expect(s.spent).toBe(0);
  });
});
