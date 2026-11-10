import { account, emptyLedger, fixed, rule } from './_fixtures';
import { allocationNeeds, needLineText, ruleAmountIn, uncoveredText, windowNeed } from './allocation';
import { normalizeBill } from './bills';
import { autoTransferId } from './ids';
import { paydayPlans, projectRemainders, remainderViews } from './income';
import { pendingAutoRecords } from './recurring';
import { buildInstallmentRows } from './installments';
import type { FixedExpense, IncomePlan, LedgerData } from './types';

const OPEN = '2026-11-01';
const salary = account('income', { id: 'salary', name: '월급통장', openingDate: OPEN });
const liv = account('fixed', { id: 'liv', name: '생활비(가람)', order: 1, ownerName: '가람', openingDate: OPEN });
const ev = account('event', { id: 'ev', name: '이벤트통장', order: 2, openingDate: OPEN });
const res = account('reservoir', { id: 'res', name: '저수지통장', order: 3, openingDate: OPEN });
const NOW = '2026-11-21T00:00:00.000Z';

const bill = (p: Partial<FixedExpense>): FixedExpense =>
  normalizeBill(fixed({ kind: 'bill', amount: 0, accountId: liv.id, startMonth: '2026-01', ...p }));

/** 보험(매달 25일) · 운동(11/5 시작, 5일) · 넷플릭스(11/28 시작, 28일) · 생활비 예산 50만 */
function bills(): FixedExpense[] {
  return [
    bill({ id: 'ins', name: '보험', amount: 50_000, dayOfMonth: 25 }),
    bill({ id: 'gym', name: '운동', amount: 30_000, dayOfMonth: 5, startDate: '2026-11-05' }),
    bill({ id: 'nf', name: '넷플릭스', amount: 15_000, dayOfMonth: 28, startDate: '2026-11-28' }),
    fixed({ id: 'food', name: '식비', kind: 'living', amount: 500_000, accountId: liv.id, startMonth: '2026-01' }),
  ];
}

const plan = (amount: number): IncomePlan => ({
  id: 'p1', personName: '가람', personEmail: null, amount, dayOfMonth: 21, accountId: salary.id, startMonth: '2026-11', endMonth: null, memo: '', deleted: false,
});

function ledger(p: Partial<LedgerData> = {}): LedgerData {
  return emptyLedger({ accounts: [salary, liv, ev, res], fixedExpenses: bills(), ...p });
}

describe('window need (allocation on D funds [D, next D))', () => {
  it('sums charges dated in the window plus the living budget of the month the window mostly covers', () => {
    const n = windowNeed(ledger(), liv.id, '2026-11-21', 21);
    expect(n.charges.map((c) => [c.date, c.name, c.amount])).toEqual([
      ['2026-11-25', '보험', 50_000],
      ['2026-11-28', '넷플릭스', 15_000],
      ['2026-12-05', '운동', 30_000],
    ]);
    expect(n.livingMonth).toBe('2026-12');
    expect(n.total).toBe(595_000);
  });

  it('includes installments and sub-items with their own dates', () => {
    const inst = buildInstallmentRows(
      { name: 'TV', amount: 60_000, amountKind: 'monthly', months: 10, firstMonth: '2026-11', dayOfMonth: 23, accountId: liv.id, categoryId: null },
      'tv',
      '2026-11-01',
    );
    const dues = bill({ id: 'dues', name: '회비', dayOfMonth: 1, subItems: [{ name: '목장', amount: 40_000 }, { name: '환갑', amount: 100_000, startDate: '2027-01-01' }] });
    const d = ledger({ fixedExpenses: [...bills(), ...inst, dues] });
    const n = windowNeed(d, liv.id, '2026-11-21', 21);
    expect(n.installments).toBe(60_000);
    expect(n.charges.find((c) => c.name === '회비')!.amount).toBe(40_000);
    expect(windowNeed(d, liv.id, '2026-12-21', 21).charges.find((c) => c.name === '회비')!.amount).toBe(140_000);
  });
});

describe('다음 배분에 필요한 금액', () => {
  const fixedRule = rule({ id: 'r-liv', fromAccountId: salary.id, toAccountId: liv.id, amount: 550_000, dayOfMonth: 21, startMonth: '2026-11' });

  it('compares with the fixed rule and explains the difference', () => {
    const [n] = allocationNeeds(ledger({ rules: [fixedRule] }), '2026-11-12');
    expect(n!.next).toBe('2026-11-21');
    expect(n!.need.total).toBe(595_000);
    expect(n!.diff).toBe(45_000);
    expect(n!.reasons).toEqual(['넷플릭스 시작']);
    expect(needLineText(n!)).toBe('생활비(가람): 550,000원 → 595,000원 (+45,000원 · 넷플릭스 시작)');
    expect(n!.adjustTo).toBe(595_000);
  });

  it('notes a mid-window start that the last allocation did not cover', () => {
    const [n] = allocationNeeds(ledger({ rules: [fixedRule] }), '2026-11-12');
    expect(n!.uncovered).toBe(30_000);
    expect(uncoveredText(n!)).toBe('이번 달은 30,000원이 배분에 없어요 · 생활비에서 나가요');
  });

  it('after this month’s allocation is recorded, looks at next month', () => {
    const d = ledger({ rules: [fixedRule], transfers: pendingAutoRecords(ledger({ rules: [fixedRule] }), '2026-11-21', 'a', NOW).transfers });
    const [n] = allocationNeeds(d, '2026-11-21');
    expect(n!.next).toBe('2026-12-21');
  });

  it('matching amounts: no diff, nothing to adjust', () => {
    const [n] = allocationNeeds(ledger({ rules: [{ ...fixedRule, amount: 595_000 }] }), '2026-11-12');
    expect(n!.diff).toBe(0);
    expect(n!.adjustTo).toBeNull();
    expect(needLineText(n!)).toBe('생활비(가람): 595,000원 그대로예요');
  });

  it('event accounts and accounts without a rule are not listed', () => {
    const d = ledger({ rules: [rule({ fromAccountId: salary.id, toAccountId: ev.id, amount: 300_000, dayOfMonth: 21 })] });
    expect(allocationNeeds(d, '2026-11-12')).toEqual([]);
  });
});

describe('필요한 만큼 (자동) 배분', () => {
  const autoRule = rule({ id: 'r-auto', fromAccountId: salary.id, toAccountId: liv.id, amount: 0, kind: 'auto', dayOfMonth: 21, startMonth: '2026-11' });
  const eventRule = rule({ id: 'r-ev', fromAccountId: salary.id, toAccountId: ev.id, amount: 100_000, dayOfMonth: 21, startMonth: '2026-11' });
  const restRule = rule({ id: 'r-rest', fromAccountId: salary.id, toAccountId: res.id, amount: 0, kind: 'remainder', dayOfMonth: 21, startMonth: '2026-11' });

  it('records the required amount on the allocation day: income → fixed → auto → remainder', () => {
    const d = ledger({ rules: [autoRule, eventRule, restRule], incomePlans: [plan(1_000_000)] });
    const out = pendingAutoRecords(d, '2026-11-21', 'a', NOW);
    const byRule = Object.fromEntries(out.transfers.map((t) => [t.ruleId ?? t.id, t.amount]));
    expect(byRule['r-auto']).toBe(595_000);
    expect(byRule['r-ev']).toBe(100_000);
    expect(byRule['r-rest']).toBe(305_000);
    expect(out.transfers.find((t) => t.ruleId === 'r-auto')!.id).toBe(autoTransferId('r-auto', '2026-11'));
  });

  it('is idempotent and keeps the recorded amount when bills change later', () => {
    const d = ledger({ rules: [autoRule], incomePlans: [plan(1_000_000)] });
    const first = pendingAutoRecords(d, '2026-11-21', 'a', NOW);
    const changed: LedgerData = {
      ...d,
      transfers: first.transfers,
      expenses: first.expenses,
      fixedExpenses: [...d.fixedExpenses, bill({ id: 'new', name: '새 구독', amount: 9_900, dayOfMonth: 1, startDate: '2026-12-01' })],
    };
    expect(pendingAutoRecords(changed, '2026-11-25', 'a', NOW).transfers).toEqual([]);
    expect(changed.transfers.find((t) => t.ruleId === 'r-auto')!.amount).toBe(595_000);
  });

  it('follows a bill change into the next window without touching the rule', () => {
    const d = ledger({ rules: [autoRule] });
    const before = ruleAmountIn(d, autoRule, '2026-12');
    const changed = ledger({ rules: [autoRule], fixedExpenses: [...bills().filter((f) => f.id !== 'nf'), bill({ id: 'nf', name: '넷플릭스', amount: 17_000, dayOfMonth: 28, startDate: '2026-11-28' })] });
    expect(ruleAmountIn(changed, autoRule, '2026-12') - before).toBe(2_000);
  });

  it('projection and payday preview use the auto amount', () => {
    const d = ledger({ rules: [autoRule, eventRule, restRule], incomePlans: [plan(1_000_000)] });
    const proj = projectRemainders(d, '2026-11-12', 2);
    expect(proj.get('r-auto:2026-11')).toBe(595_000);
    expect(proj.get('r-rest:2026-11')).toBe(305_000);
    const [p] = paydayPlans(d, '2026-11', salary.id);
    expect(p!.auto.map((l) => l.amount)).toEqual([595_000]);
    expect(p!.auto[0]!.need!.living).toBe(500_000);
    expect(p!.remainder!.amount).toBe(305_000);
  });

  it('warns when fixed + auto exceed that payday’s income', () => {
    const d = ledger({ rules: [autoRule, eventRule], incomePlans: [plan(600_000)] });
    expect(paydayPlans(d, '2026-11', salary.id)[0]!.short).toBe(95_000);
  });

  it('an auto rule is listed as auto in the needs card (no adjust button)', () => {
    const [n] = allocationNeeds(ledger({ rules: [autoRule] }), '2026-11-12');
    expect(n!.auto).toBe(true);
    expect(n!.adjustTo).toBeNull();
    expect(needLineText(n!)).toBe('생활비(가람): 595,000원 (자동)');
  });
});

describe('나머지 예상 문구와 수입 변경', () => {
  const fixedLiv = rule({ id: 'r-liv', fromAccountId: salary.id, toAccountId: liv.id, amount: 600_000, dayOfMonth: 21, startMonth: '2026-11' });
  const restRule = rule({ id: 'r-rest', fromAccountId: salary.id, toAccountId: res.id, amount: 0, kind: 'remainder', dayOfMonth: 21, startMonth: '2026-11' });

  it('shows the next payday estimate and the monthly total', () => {
    const [v] = remainderViews(ledger({ rules: [fixedLiv, restRule], incomePlans: [plan(3_050_000)] }), '2026-11-12');
    expect(v!.text).toBe('나머지 전부 → 저수지 · 다음 21일 예상 2,450,000원');
    expect(v!.monthlyText).toBe('저수지로 매달 약 245만원');
    expect(v!.empty).toBe(false);
  });

  it('changing the income plan updates only the remainder', () => {
    const d = ledger({ rules: [fixedLiv, restRule], incomePlans: [plan(2_000_000)] });
    expect(remainderViews(d, '2026-11-12')[0]!.nextText).toBe('다음 21일 예상 1,400,000원');
    const raised = { ...d, incomePlans: [plan(2_500_000)] };
    expect(remainderViews(raised, '2026-11-12')[0]!.nextText).toBe('다음 21일 예상 1,900,000원');
    expect(paydayPlans(raised, '2026-11', salary.id)[0]!.fixed[0]!.amount).toBe(600_000);
  });

  it('zero or negative → 남는 돈이 없어요 (warning)', () => {
    const [v] = remainderViews(ledger({ rules: [fixedLiv, restRule], incomePlans: [plan(500_000)] }), '2026-11-12');
    expect(v!.nextText).toBe('남는 돈이 없어요');
    expect(v!.empty).toBe(true);
    expect(v!.monthlyText).toBeNull();
  });

  it('without income plans the estimate is unknown', () => {
    const [v] = remainderViews(ledger({ rules: [fixedLiv, restRule] }), '2026-11-12');
    expect(v!.text).toBe('나머지 전부 → 저수지');
    expect(v!.nextText).toBeNull();
  });
});
