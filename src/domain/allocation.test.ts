import { account, emptyLedger, fixed, rule, transfer } from './_fixtures';
import { AUTO_KIND_NOTICE, ruleAmountIn, ruleChangeText, ruleKindLabel, ruleNext, rulesToAutoKind, windowNeed } from './allocation';
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

describe('규칙마다 다음 배분 금액 · 지난달과 달라진 까닭', () => {
  const autoRule = rule({ id: 'r-auto', fromAccountId: salary.id, toAccountId: liv.id, amount: 0, kind: 'auto', dayOfMonth: 21, startMonth: '2026-11' });

  it('알아서 맞추기는 다음 배분 기간의 필요한 금액, 바뀌었으면 가장 크게 바뀐 까닭 (넷플릭스 시작)', () => {
    const n = ruleNext(ledger({ rules: [autoRule] }), autoRule, '2026-11-12')!;
    expect(n.date).toBe('2026-11-21');
    expect(n.amount).toBe(595_000);
    // 10/21 기간: 보험 50,000 + 운동 30,000(11/5) + 생활비 500,000 = 580,000 → +15,000 넷플릭스
    expect(n.diff).toBe(15_000);
    expect(n.reason).toBe('넷플릭스 시작');
    expect(ruleChangeText(n)).toBe('지난달보다 +1.5만 · 넷플릭스 시작');
  });

  it('바뀐 게 없으면 문구가 없고, 이번 달 회차가 기록됐으면 다음 달 배분을 봐요', () => {
    const d = ledger({ rules: [autoRule], transfers: [transfer({ id: autoTransferId('r-auto', '2026-11'), date: '2026-11-21', amount: 595_000 })] });
    const n = ruleNext(d, autoRule, '2026-11-21')!;
    expect(n.date).toBe('2026-12-21');
    expect(n.amount).toBe(595_000);
    expect(ruleChangeText(n)).toBeNull();
  });

  it('세부 항목이 붙거나 금액이 줄면 그 항목 이름으로 (−는 끝)', () => {
    const subs = bill({ id: 'subs', name: '구독', dayOfMonth: 1, subItems: [{ name: '유튜브', amount: 14_900 }, { name: '넷플릭스', amount: 17_000, startDate: '2027-01-01' }] });
    const d = ledger({ rules: [autoRule], fixedExpenses: [...bills(), subs] });
    const n = ruleNext(d, autoRule, '2026-12-12')!;
    expect(n.date).toBe('2026-12-21');
    expect(ruleChangeText(n)).toBe('지난달보다 +1.7만 · 넷플릭스 시작');
    const ended = ledger({ rules: [autoRule], fixedExpenses: bills().map((f) => (f.id === 'ins' ? normalizeBill({ ...f, endDate: '2026-12-31' }) : f)) });
    const e = ruleNext(ended, autoRule, '2026-12-22')!;
    expect(ruleChangeText(e)).toBe('지난달보다 −5만 · 보험 끝');
  });

  it('매달 같은 금액은 금액 그대로 · 바뀜 없음, 남는 돈 전부는 null', () => {
    const fixedLiv = rule({ id: 'r-fx', fromAccountId: salary.id, toAccountId: liv.id, amount: 600_000, dayOfMonth: 21, startMonth: '2026-11' });
    const rest = rule({ id: 'r-rest', fromAccountId: salary.id, toAccountId: res.id, amount: 0, kind: 'remainder', dayOfMonth: 21, startMonth: '2026-11' });
    const d = ledger({ rules: [fixedLiv, rest] });
    expect(ruleNext(d, fixedLiv, '2026-11-12')).toMatchObject({ amount: 600_000, auto: false, diff: 0, reason: null });
    expect(ruleNext(d, rest, '2026-11-12')).toBeNull();
    expect([fixedLiv, autoRule, rest].map(ruleKindLabel)).toEqual(['매달 같은 금액', '알아서 맞추기', '남는 돈 전부']);
  });
});

describe('기존 시트 자동 고치기: 생활비 · 용돈 배분 → 알아서 맞추기', () => {
  const allow = account('allowance', { id: 'allow', name: '용돈(가람)', order: 4, openingDate: OPEN });
  const sav = account('savings', { id: 'sav', name: '저축투자', order: 5, openingDate: OPEN });
  const base = [
    rule({ id: 'r-liv', fromAccountId: salary.id, toAccountId: liv.id, amount: 600_000, dayOfMonth: 21, startMonth: '2026-01' }),
    rule({ id: 'r-allow', fromAccountId: salary.id, toAccountId: allow.id, amount: 300_000, dayOfMonth: 25, startMonth: '2026-01' }),
    rule({ id: 'r-ev', fromAccountId: salary.id, toAccountId: ev.id, amount: 300_000, dayOfMonth: 21, startMonth: '2026-01' }),
    rule({ id: 'r-sav', fromAccountId: salary.id, toAccountId: sav.id, amount: 1_000_000, dayOfMonth: 25, startMonth: '2026-01' }),
    rule({ id: 'r-res', fromAccountId: salary.id, toAccountId: res.id, amount: 0, kind: 'remainder', dayOfMonth: 21, startMonth: '2026-01' }),
    // 이미 끝난 예전 생활비 규칙은 그대로
    rule({ id: 'r-old', fromAccountId: salary.id, toAccountId: liv.id, amount: 500_000, dayOfMonth: 21, startMonth: '2025-01', endMonth: '2025-12' }),
  ];
  const d = () => emptyLedger({ accounts: [salary, liv, ev, res, allow, sav], rules: base });

  it('생활비 · 용돈으로 가는 매달 같은 금액만 알아서 맞추기(금액 0)로 바꿔요', () => {
    const out = rulesToAutoKind(d(), '2026-11-12');
    expect(out.map((r) => [r.id, r.kind, r.amount])).toEqual([
      ['r-liv', 'auto', 0],
      ['r-allow', 'auto', 0],
    ]);
    expect(AUTO_KIND_NOTICE).toBe("생활비 · 용돈 배분을 '알아서 맞추기'로 바꿨어요");
  });

  it('다시 해도 같아요 (바꾼 뒤에는 바꿀 게 없음)', () => {
    const data = d();
    const changed = rulesToAutoKind(data, '2026-11-12');
    const byId = new Map(changed.map((r) => [r.id, r]));
    const after = { ...data, rules: data.rules.map((r) => byId.get(r.id) ?? r) };
    expect(rulesToAutoKind(after, '2026-11-12')).toEqual([]);
  });

  it('같은 통장으로 겹쳐 들어오는 규칙이 여럿이거나 이미 알아서 맞추기가 있으면 그 통장은 그대로', () => {
    const two = emptyLedger({
      accounts: [salary, liv, ev, res, allow, sav],
      rules: [
        ...base,
        rule({ id: 'r-liv2', fromAccountId: ev.id, toAccountId: liv.id, amount: 50_000, dayOfMonth: 1, startMonth: '2026-06' }),
        rule({ id: 'r-allow-auto', fromAccountId: salary.id, toAccountId: allow.id, amount: 0, kind: 'auto', dayOfMonth: 1, startMonth: '2026-06' }),
      ],
    });
    expect(rulesToAutoKind(two, '2026-11-12')).toEqual([]);
  });
});

describe('알아서 맞추기 (자동) 배분', () => {
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
});

describe('나머지 예상 문구와 수입 변경', () => {
  const fixedLiv = rule({ id: 'r-liv', fromAccountId: salary.id, toAccountId: liv.id, amount: 600_000, dayOfMonth: 21, startMonth: '2026-11' });
  const restRule = rule({ id: 'r-rest', fromAccountId: salary.id, toAccountId: res.id, amount: 0, kind: 'remainder', dayOfMonth: 21, startMonth: '2026-11' });

  it('shows the next payday estimate and the monthly total', () => {
    const [v] = remainderViews(ledger({ rules: [fixedLiv, restRule], incomePlans: [plan(3_050_000)] }), '2026-11-12');
    expect(v!.text).toBe('남는 돈 전부 → 저수지 · 다음 21일 예상 2,450,000원');
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
    expect(v!.text).toBe('남는 돈 전부 → 저수지');
    expect(v!.nextText).toBeNull();
  });
});
