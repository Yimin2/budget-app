import { account, emptyLedger, expense, fixed, rule, transfer } from './_fixtures';
import { rulesToAutoKind } from './allocation';
import { ALLOWANCE_MOVE_NOTICE, allowanceAccountOf, allowanceFor, migrateAllowanceRows, pendingAllowanceIncome } from './allowance';
import { allowanceIncomeId, allowanceRuleId } from './ids';
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

describe('migrateAllowanceRows (8-2: 용돈 항목 → 배분 · 고정비)', () => {
  const members = [
    { email: 'minji@demo', displayName: '민지' },
    { email: 'junho@demo', displayName: '준호' },
    { email: 'gippeun@demo', displayName: '기쁜' },
  ];
  const income = account('income', { id: 'inc', name: '월급통장' });
  const living = account('fixed', { id: 'f', name: '생활비(민지)', ownerName: '민지', ownerEmail: 'minji@demo' });
  const walletMinji = account('allowance', { id: 'w-minji', name: '용돈(민지)', ownerName: '민지', ownerEmail: 'minji@demo', order: 3 });
  // 주인 이메일 없이 이름만 있는 용돈 통장 (ledgerPeople 이름으로 이어요)
  const walletJunho = account('allowance', { id: 'w-junho', name: '용돈(준호)', ownerName: '준호', order: 4 });
  const base = () =>
    emptyLedger({
      members,
      accounts: [income, living, walletMinji, walletJunho],
      fixedExpenses: [
        fixed({ id: 'al-minji', name: '용돈(민지)', kind: 'allowance', amount: 300_000, accountId: 'f', dayOfMonth: 25, targetEmail: 'minji@demo', startMonth: '2026-08' }),
        fixed({ id: 'al-junho', name: '용돈(준호)', kind: 'allowance', amount: 250_000, accountId: 'inc', dayOfMonth: 25, targetEmail: 'Junho@Demo', startMonth: '2026-11', endMonth: '2027-06' }),
        fixed({ id: 'al-gippeun', name: '용돈', kind: 'allowance', amount: 100_000, accountId: 'f', dayOfMonth: 1, targetEmail: 'gippeun@demo', startMonth: '2026-09' }),
        fixed({ id: 'rent', kind: 'bill', amount: 800_000, accountId: 'f', dayOfMonth: 1 }),
      ],
      expenses: [
        // 이미 자동 기록된 용돈 (8 · 9 · 10월) — 그대로 두고 배분은 11월부터
        ...['2026-08', '2026-09', '2026-10'].map((m) =>
          expense({ id: `fixed:al-minji:${m}`, date: `${m}-25`, amount: 300_000, accountId: 'f', fixedExpenseId: 'al-minji' }),
        ),
      ],
    });

  it('용돈 통장이 있고 배분이 없으면 수입통장 → 용돈 통장 매달 같은 금액 배분 + 용돈 행 지움 표시', () => {
    const out = migrateAllowanceRows(base());
    expect(out.rules).toEqual([
      { id: allowanceRuleId('al-minji'), fromAccountId: 'inc', toAccountId: 'w-minji', amount: 300_000, dayOfMonth: 25, startMonth: '2026-11', endMonth: null, kind: 'fixed', deleted: false },
      // 이름으로 이은 통장 · 수입통장에서 나가던 용돈, 끝도 같게
      { id: allowanceRuleId('al-junho'), fromAccountId: 'inc', toAccountId: 'w-junho', amount: 250_000, dayOfMonth: 25, startMonth: '2026-11', endMonth: '2027-06', kind: 'fixed', deleted: false },
    ]);
    const byId = new Map(out.fixedExpenses.map((f) => [f.id, f]));
    expect(byId.get('al-minji')).toMatchObject({ kind: 'allowance', deleted: true });
    expect(byId.get('al-junho')).toMatchObject({ kind: 'allowance', deleted: true });
    expect(byId.has('rent')).toBe(false);
    expect(out.notice).toBe(ALLOWANCE_MOVE_NOTICE);
  });

  it('용돈 통장이 없으면 그 통장의 일반 고정비 "용돈(이름)"으로 (같은 id 라 지난 자동 기록과 겹치지 않아요)', () => {
    const out = migrateAllowanceRows(base());
    const g = out.fixedExpenses.find((f) => f.id === 'al-gippeun')!;
    expect(g).toMatchObject({ kind: 'bill', name: '용돈(기쁜)', targetEmail: null, accountId: 'f', amount: 100_000, dayOfMonth: 1, deleted: false });
  });

  it('그 용돈 통장으로 들어오는 배분이 이미 있으면 용돈 행만 지우고 금액을 알려요', () => {
    const d = base();
    d.rules = [rule({ id: 'r-minji', fromAccountId: 'inc', toAccountId: 'w-minji', amount: 0, kind: 'auto', dayOfMonth: 25 })];
    const out = migrateAllowanceRows(d);
    expect(out.rules.map((r) => r.toAccountId)).toEqual(['w-junho']);
    expect(out.fixedExpenses.find((f) => f.id === 'al-minji')).toMatchObject({ deleted: true });
    expect(out.notice).toBe(`${ALLOWANCE_MOVE_NOTICE} · 배분이 이미 있어 뺀 용돈: 용돈(민지) 30만`);
  });

  it('금액 변경으로 나뉜 행은 각각 옮겨요 (앞 행의 배분을 이미 있는 배분으로 치지 않아요)', () => {
    const d = base();
    d.fixedExpenses = [
      fixed({ id: 'al-minji', name: '용돈(민지)', kind: 'allowance', amount: 300_000, accountId: 'f', dayOfMonth: 25, targetEmail: 'minji@demo', startMonth: '2026-08', endMonth: '2026-11' }),
      fixed({ id: 'al-minji@2026-12-25', name: '용돈(민지)', kind: 'allowance', amount: 350_000, accountId: 'f', dayOfMonth: 25, targetEmail: 'minji@demo', startMonth: '2026-12' }),
    ];
    const out = migrateAllowanceRows(d);
    expect(out.rules.map((r) => [r.id, r.amount, r.startMonth, r.endMonth])).toEqual([
      [allowanceRuleId('al-minji'), 300_000, '2026-11', '2026-11'],
      [allowanceRuleId('al-minji@2026-12-25'), 350_000, '2026-12', null],
    ]);
    expect(out.notice).toBe(ALLOWANCE_MOVE_NOTICE);
  });

  it('다시 해도 같아요: 옮긴 뒤에는 바꿀 게 없고, 옮긴 배분은 알아서 맞추기로 바뀌지 않아요', () => {
    const d = base();
    const out = migrateAllowanceRows(d);
    const byId = new Map(out.fixedExpenses.map((f) => [f.id, f]));
    const after = { ...d, rules: [...d.rules, ...out.rules], fixedExpenses: d.fixedExpenses.map((f) => byId.get(f.id) ?? f) };
    expect(migrateAllowanceRows(after)).toEqual({ rules: [], fixedExpenses: [], notice: null });
    expect(after.fixedExpenses.some((f) => !f.deleted && f.kind === 'allowance')).toBe(false);
    // 지난 자동 기록은 그대로
    expect(after.expenses.filter((e) => e.fixedExpenseId === 'al-minji')).toHaveLength(3);
    expect(rulesToAutoKind(after, '2026-11-12')).toEqual([]);
  });

  it('배분은 썼는데 고정지출을 못 쓴 채로 다시 열어도 같은 배분 id 로 다시 써요 (두 번 생기지 않음)', () => {
    const d = base();
    const first = migrateAllowanceRows(d);
    const half = { ...d, rules: [...first.rules] };
    const again = migrateAllowanceRows(half);
    expect(again.rules.map((r) => r.id)).toEqual(first.rules.map((r) => r.id));
    expect(again.notice).toBe(ALLOWANCE_MOVE_NOTICE);
  });

  it('allowanceAccountOf: 주인 이메일 → 이름이 맞는 통장 하나 → 없음', () => {
    const d = base();
    expect(allowanceAccountOf(d, 'MINJI@demo')?.id).toBe('w-minji');
    expect(allowanceAccountOf(d, 'junho@demo')?.id).toBe('w-junho');
    expect(allowanceAccountOf(d, 'gippeun@demo')).toBeNull();
    expect(allowanceAccountOf(d, '')).toBeNull();
  });
});
