import { describe, expect, it } from 'vitest';
import { account, emptyLedger, expense, rule, transfer } from './_fixtures';
import { accountBalance } from './balances';
import { projectEventAccount } from './events';
import { autoTransferId } from './ids';
import {
  conflictingRemainderRule, duplicateAutoIncome, incomePlanSuggestion, incomeRecordId, incomeRecorded, paydayPlans, plannedIncome, projectRemainders, recordedIncomeAmount, remainderAmount,
} from './income';
import { pendingAutoRecords } from './recurring';
import type { AllocationRule, IncomePlan, LedgerData } from './types';

const NOW = '2026-11-01T00:00:00.000Z';
const salary = account('income', { id: 'salary', name: '월급통장', openingDate: '2026-11-01' });
const livA = account('fixed', { id: 'liv-a', name: '생활비(가람)', ownerName: '가람', order: 1, openingDate: '2026-11-01' });
const livB = account('fixed', { id: 'liv-b', name: '생활비(나래)', ownerName: '나래', order: 2, openingDate: '2026-11-01' });
const allowA = account('allowance', { id: 'allow-a', name: '용돈(가람)', ownerName: '가람', order: 3, openingDate: '2026-11-01' });
const allowB = account('allowance', { id: 'allow-b', name: '용돈(나래)', ownerName: '나래', order: 4, openingDate: '2026-11-01' });
const eventAcc = account('event', { id: 'event', name: '이벤트통장', order: 5, openingDate: '2026-11-01' });
const reservoir = account('reservoir', { id: 'res', name: '저수지통장', order: 6, openingDate: '2026-11-01' });
const savings = account('savings', { id: 'sav', name: '주식통장', order: 7, openingDate: '2026-11-01' });

function plan(p: Partial<IncomePlan> & Pick<IncomePlan, 'id' | 'personName' | 'amount' | 'dayOfMonth'>): IncomePlan {
  return { personEmail: null, accountId: salary.id, startMonth: '2026-11', endMonth: null, memo: '', deleted: false, ...p };
}

const r = (id: string, to: string, amount: number, day: number, kind: AllocationRule['kind'] = 'fixed') =>
  rule({ id, fromAccountId: salary.id, toAccountId: to, amount, dayOfMonth: day, startMonth: '2026-11', kind });

/** 예시 (이름은 지어낸 것): 가람 297만 21일 · 나래 300만 25일, 21일 · 25일에 정한 금액을 보내고 나머지는 저수지로 */
function household(extra: Partial<LedgerData> = {}): LedgerData {
  return emptyLedger({
    accounts: [salary, livA, livB, allowA, allowB, eventAcc, reservoir, savings],
    incomePlans: [
      plan({ id: 'garam', personName: '가람', amount: 2_970_000, dayOfMonth: 21 }),
      plan({ id: 'narae', personName: '나래', amount: 3_000_000, dayOfMonth: 25 }),
    ],
    rules: [
      // 나머지 규칙의 id 를 앞에 두어도 정한 금액이 먼저 나가는지 본다
      r('a-rest-21', reservoir.id, 0, 21, 'remainder'),
      r('r21-a', livA.id, 828_000, 21),
      r('r21-b', livB.id, 1_272_600, 21),
      r('r21-ev', eventAcc.id, 500_000, 21),
      r('a-rest-25', reservoir.id, 0, 25, 'remainder'),
      r('r25-a', allowA.id, 400_000, 25),
      r('r25-b', allowB.id, 400_000, 25),
      r('r25-sav', savings.id, 0, 25),
    ],
    ...extra,
  });
}

/** 직접 기록한 월급 (계획 날짜 · 금액 그대로) */
const in21 = transfer({ id: 'in-21', date: '2026-11-21', kind: 'income', toAccountId: salary.id, amount: 2_970_000 });
const in25 = transfer({ id: 'in-25', date: '2026-11-25', kind: 'income', toAccountId: salary.id, amount: 3_000_000 });

function withRecords(data: LedgerData, today: string): LedgerData {
  const auto = pendingAutoRecords(data, today, 'a@x', NOW);
  return { ...data, transfers: [...data.transfers, ...auto.transfers], expenses: [...data.expenses, ...auto.expenses] };
}

describe('수입 계획', () => {
  it('월급은 직접 기록해요: 받는 날이 지나도 수입을 자동으로 만들지 않아요', () => {
    const recs = pendingAutoRecords(household(), '2026-11-30', 'a@x', NOW);
    expect(recs.transfers.filter((t) => t.kind === 'income')).toEqual([]);
    expect(plannedIncome(household(), '2026-11', salary.id)).toBe(5_970_000);
  });

  it('지운 계획 · 끝난 계획은 기대 수입에 넣지 않아요', () => {
    const d = household({
      incomePlans: [
        plan({ id: 'garam', personName: '가람', amount: 2_970_000, dayOfMonth: 21 }),
        plan({ id: 'gone', personName: '가람', amount: 1, dayOfMonth: 1, deleted: true }),
        plan({ id: 'old', personName: '나래', amount: 1, dayOfMonth: 1, startMonth: '2026-01', endMonth: '2026-10' }),
      ],
    });
    expect(plannedIncome(d, '2026-11')).toBe(2_970_000);
  });

  it('직접 기록한 월급은 가장 가까운 계획 몫으로 받은 것으로 봐요 (예측이 두 번 세지 않게)', () => {
    const d = household({ transfers: [transfer({ id: 'in-19', date: '2026-11-19', kind: 'income', toAccountId: salary.id, amount: 2_950_000 })] });
    const [garam, narae] = d.incomePlans;
    expect(incomeRecorded(d, garam!, '2026-11')).toBe(true);
    expect(incomeRecorded(d, narae!, '2026-11')).toBe(false);
  });

  it('예전에 자동으로 만든 월급 기록이 직접 기록한 월급과 겹치면 겹친 것만 지워요 (다시 해도 같아요)', () => {
    const auto = transfer({ id: incomeRecordId('garam', '2026-11'), date: '2026-11-21', kind: 'income', toAccountId: salary.id, amount: 2_970_000 });
    const autoNarae = transfer({ id: incomeRecordId('narae', '2026-11'), date: '2026-11-25', kind: 'income', toAccountId: salary.id, amount: 3_000_000 });
    const mine = transfer({ id: 'in-19', date: '2026-11-19', kind: 'income', toAccountId: salary.id, amount: 2_950_000 });
    const d = household({ transfers: [auto, autoNarae, mine] });
    const gone = duplicateAutoIncome(d, NOW);
    expect(gone.map((t) => [t.id, t.deleted])).toEqual([[auto.id, true]]);
    const after = { ...d, transfers: d.transfers.map((t) => gone.find((g) => g.id === t.id) ?? t) };
    expect(duplicateAutoIncome(after, NOW)).toEqual([]);
  });
});

describe('나머지 전부 보내기', () => {
  it('같은 날 정한 금액을 먼저 보내고 남은 돈을 모두 보내요 (예: 297만 − 260.06만 = 36.94만)', () => {
    const recs = pendingAutoRecords(household({ transfers: [in21] }), '2026-11-21', 'a@x', NOW);
    const rest = recs.transfers.find((t) => t.id === autoTransferId('a-rest-21', '2026-11'))!;
    expect(rest).toMatchObject({ fromAccountId: salary.id, toAccountId: reservoir.id, amount: 369_400, ruleId: 'a-rest-21', date: '2026-11-21' });
    expect(accountBalance(withRecords(household({ transfers: [in21] }), '2026-11-21'), salary.id, '2026-11-21')).toBe(0);
    // 25일 규칙은 아직
    expect(recs.transfers.some((t) => t.id === autoTransferId('a-rest-25', '2026-11'))).toBe(false);
  });

  it('늦게 열어 두 월급날이 함께 밀려 있어도 날짜 순으로 각자 그날 남은 돈만 보내요', () => {
    const recs = pendingAutoRecords(household({ transfers: [in21, in25] }), '2026-11-26', 'a@x', NOW);
    const amount = (id: string) => recs.transfers.find((t) => t.id === autoTransferId(id, '2026-11'))?.amount;
    expect(amount('a-rest-21')).toBe(369_400);
    expect(amount('a-rest-25')).toBe(2_200_000);
    // 금액 0 인 정한 금액 배분(주식)은 기록하지 않아요
    expect(recs.transfers.some((t) => t.ruleId === 'r25-sav')).toBe(false);
    const after = withRecords(household({ transfers: [in21, in25] }), '2026-11-26');
    expect(accountBalance(after, salary.id, '2026-11-26')).toBe(0);
    expect(accountBalance(after, reservoir.id, '2026-11-26')).toBe(2_569_400);
  });

  it('다시 계산해도 같은 기록이 또 생기지 않고, 한 번 기록된 금액은 그대로예요', () => {
    const d = withRecords(household({ transfers: [in21] }), '2026-11-21');
    expect(pendingAutoRecords(d, '2026-11-21', 'a@x', NOW)).toEqual({ transfers: [], expenses: [] });
    // 21일 날짜로 돈이 더 들어와도 21일 나머지는 그대로, 25일 나머지 때 함께 나가요
    const late = { ...d, transfers: [...d.transfers, transfer({ date: '2026-11-21', kind: 'income', toAccountId: salary.id, amount: 100_000 })] };
    expect(pendingAutoRecords(late, '2026-11-22', 'a@x', NOW).transfers).toEqual([]);
    const late25 = { ...late, transfers: [...late.transfers, in25] };
    const rest25 = pendingAutoRecords(late25, '2026-11-25', 'a@x', NOW).transfers.find((t) => t.id === autoTransferId('a-rest-25', '2026-11'));
    expect(rest25?.amount).toBe(2_300_000);
  });

  it('남은 돈이 없으면 0 아래로 보내지 않고 기록도 만들지 않다가, 그날 수입이 들어오면 다시 계산해요', () => {
    const d = emptyLedger({
      accounts: [salary, reservoir, livA],
      rules: [r('fix', livA.id, 50_000, 21), r('rest', reservoir.id, 0, 21, 'remainder')],
    });
    const first = pendingAutoRecords(d, '2026-11-21', 'a@x', NOW);
    expect(first.transfers.map((t) => t.id)).toEqual([autoTransferId('fix', '2026-11')]);
    const applied = { ...d, transfers: first.transfers };
    expect(accountBalance(applied, salary.id, '2026-11-21')).toBe(-50_000);
    // 월급을 손으로 21일 날짜로 기록하면 다음에 열 때 나머지를 보내요
    const paid = { ...applied, transfers: [...applied.transfers, transfer({ date: '2026-11-21', kind: 'income', toAccountId: salary.id, amount: 300_000 })] };
    const again = pendingAutoRecords(paid, '2026-11-22', 'a@x', NOW).transfers;
    expect(again.map((t) => [t.id, t.amount])).toEqual([[autoTransferId('rest', '2026-11'), 250_000]]);
  });

  it('그날 뒤에 이미 나간 돈이 있으면 그만큼 덜 보내서 보내는 통장이 0 아래로 내려가지 않아요', () => {
    const d = emptyLedger({
      accounts: [{ ...salary, openingBalance: 500_000 }, reservoir, livA],
      rules: [r('rest', reservoir.id, 0, 21, 'remainder')],
      transfers: [transfer({ date: '2026-11-23', fromAccountId: salary.id, toAccountId: livA.id, amount: 300_000 })],
    });
    expect(remainderAmount(d, d.rules[0]!, '2026-11-21', '2026-11-24')).toBe(200_000);
    const after = withRecords(d, '2026-11-24');
    expect(accountBalance(after, salary.id, '2026-11-24')).toBe(0);
    // 그날 잔액만 보면(오늘이 그날이면) 그날 잔액 그대로
    expect(remainderAmount(d, d.rules[0]!, '2026-11-21', '2026-11-21')).toBe(500_000);
  });

  it('같은 통장 · 같은 날의 나머지 규칙은 하나만 둘 수 있어요', () => {
    const d = household();
    expect(conflictingRemainderRule(d, { fromAccountId: salary.id, dayOfMonth: 21, startMonth: '2026-12', endMonth: null })?.id).toBe('a-rest-21');
    expect(conflictingRemainderRule(d, { id: 'a-rest-21', fromAccountId: salary.id, dayOfMonth: 21, startMonth: '2026-11', endMonth: null })).toBeNull();
    expect(conflictingRemainderRule(d, { fromAccountId: salary.id, dayOfMonth: 10, startMonth: '2026-11', endMonth: null })).toBeNull();
  });
});

describe('예측과 미리보기', () => {
  it('앞으로의 나머지는 수입 계획과 정한 금액을 흘려 본 금액으로 예상해요', () => {
    const est = projectRemainders(household(), '2026-11-10', 3);
    for (const m of ['2026-11', '2026-12', '2027-01']) {
      expect(est.get(`a-rest-21:${m}`)).toBe(369_400);
      expect(est.get(`a-rest-25:${m}`)).toBe(2_200_000);
    }
    // 이미 기록된 회차는 빼요
    const est2 = projectRemainders(withRecords(household({ transfers: [in21] }), '2026-11-21'), '2026-11-21', 2);
    expect(est2.has('a-rest-21:2026-11')).toBe(false);
    expect(est2.get('a-rest-25:2026-11')).toBe(2_200_000);
  });

  it('이벤트통장으로 나머지를 보내면 이벤트 예측이 그 예상 금액을 적립으로 넣어요', () => {
    const d = emptyLedger({
      accounts: [salary, eventAcc],
      incomePlans: [plan({ id: 'p', personName: '가람', amount: 1_000_000, dayOfMonth: 21 })],
      rules: [r('fix', eventAcc.id, 0, 21), r('rest', eventAcc.id, 0, 21, 'remainder')],
      events: [],
    });
    const p = projectEventAccount(d, '2026-11-10', { horizonMonths: 3 });
    expect(p.months.map((m) => m.contributions)).toEqual([1_000_000, 1_000_000, 1_000_000]);
    expect(p.monthlyContribution).toBe(1_000_000);
    // 수입 계획이 없으면 앞으로 남을 돈을 몰라서 0 으로 봐요
    const none = projectEventAccount({ ...d, incomePlans: [] }, '2026-11-10', { horizonMonths: 2 });
    expect(none.months.map((m) => m.contributions)).toEqual([0, 0]);
  });

  it('받는 통장의 예측에는 아직 기록되지 않은 수입 계획이 들어와요', () => {
    const d = emptyLedger({ accounts: [{ ...eventAcc, role: 'event' }], incomePlans: [plan({ id: 'p', personName: '가람', amount: 10_000, dayOfMonth: 21, accountId: eventAcc.id })] });
    const p = projectEventAccount(d, '2026-11-10', { horizonMonths: 2 });
    expect(p.months.map((m) => [m.income, m.endBalance])).toEqual([
      [10_000, 10_000],
      [10_000, 20_000],
    ]);
  });

  it('월급날마다: 그날 수입 · 정한 금액 · 나머지 예상 · 모자라는 돈', () => {
    const plans = paydayPlans(household(), '2026-11', salary.id);
    expect(plans.map((p) => [p.day, p.income, p.fixed.map((l) => l.amount), p.remainder?.amount ?? null, p.short])).toEqual([
      [21, 2_970_000, [828_000, 1_272_600, 500_000], 369_400, 0],
      [25, 3_000_000, [400_000, 400_000, 0], 2_200_000, 0],
    ]);
    const over = household({ rules: [r('big', livA.id, 3_000_000, 21), r('rest', reservoir.id, 0, 21, 'remainder')] });
    const [day21] = paydayPlans(over, '2026-11', salary.id);
    expect(day21).toMatchObject({ short: 30_000 });
    expect(day21!.remainder!.amount).toBe(0);
  });
});

describe('예전 가계부', () => {
  it('방식이 없는 배분은 정한 금액으로, 수입 계획이 없으면 수입 기록도 만들지 않아요', () => {
    const inc = account('income', { id: 'inc', ownerName: '가람', openingDate: '2026-11-01' });
    const fix = account('fixed', { id: 'fix', openingDate: '2026-11-01' });
    const legacy: LedgerData = emptyLedger({
      accounts: [inc, fix],
      rules: [rule({ id: 'old', fromAccountId: inc.id, toAccountId: fix.id, amount: 100_000, dayOfMonth: 1, startMonth: '2026-11' })],
      expenses: [expense({ date: '2026-11-02', amount: 1, accountId: fix.id })],
    });
    delete (legacy as Partial<LedgerData>).incomePlans;
    const recs = pendingAutoRecords(legacy, '2026-11-02', 'a@x', NOW);
    expect(recs.transfers.map((t) => [t.id, t.amount, t.kind])).toEqual([[autoTransferId('old', '2026-11'), 100_000, 'transfer']]);
    expect(plannedIncome(legacy, '2026-11')).toBe(0);
  });
});

describe('월급이 들어온 날 배분하기', () => {
  /** 수입 계획 없이 월급을 손으로 기록하는 가계부 */
  const manual = (extra: Partial<LedgerData> = {}) => household({ incomePlans: [], ...extra });
  const income = (date: string, amount: number) => transfer({ id: `in-${date}`, date, kind: 'income', toAccountId: salary.id, amount });

  it('월급이 배분일보다 일찍 들어오면 그날 바로 정한 금액과 나머지를 보내요 (예: 11/19 에 295만 → 21일 배분을 19일에)', () => {
    const data = manual({ transfers: [income('2026-11-19', 2_950_000)] });
    const recs = pendingAutoRecords(data, '2026-11-19', 'a@x', NOW);
    const at = (id: string) => recs.transfers.find((t) => t.id === autoTransferId(id, '2026-11'));
    expect(at('r21-a')).toMatchObject({ date: '2026-11-19', amount: 828_000 });
    expect(at('r21-b')).toMatchObject({ date: '2026-11-19', amount: 1_272_600 });
    expect(at('r21-ev')).toMatchObject({ date: '2026-11-19', amount: 500_000 });
    // 295만 − 260.06만 = 34.94만이 저수지로
    expect(at('a-rest-21')).toMatchObject({ date: '2026-11-19', amount: 349_400 });
    // 25일 몫은 아직 (그 몫의 수입이 없어요)
    expect(at('r25-a')).toBeUndefined();
    expect(accountBalance(withRecords(data, '2026-11-19'), salary.id, '2026-11-19')).toBe(0);
  });

  it('월급이 배분일보다 늦게 들어오면, 배분일에 0원이라 못 보낸 나머지를 들어온 날 보내요', () => {
    // 21일에 열었을 때는 수입이 없어 정한 금액만 나가고 나머지는 0 → 기록 안 됨
    const before = withRecords(manual(), '2026-11-21');
    expect(before.transfers.some((t) => t.id === autoTransferId('a-rest-21', '2026-11'))).toBe(false);
    // 22일에 월급 297만을 기록하면 그날 남은 돈 36.94만을 보내요
    const data = { ...before, transfers: [...before.transfers, income('2026-11-22', 2_970_000)] };
    const rest = pendingAutoRecords(data, '2026-11-22', 'a@x', NOW).transfers.find((t) => t.id === autoTransferId('a-rest-21', '2026-11'));
    expect(rest).toMatchObject({ date: '2026-11-22', amount: 369_400 });
  });

  it('두 사람 월급이 한 통장으로 들어오면 가장 가까운 월급날 몫으로 나눠요', () => {
    const data = manual({ transfers: [income('2026-11-20', 2_970_000), income('2026-11-24', 3_000_000)] });
    const recs = pendingAutoRecords(data, '2026-11-24', 'a@x', NOW);
    const at = (id: string) => recs.transfers.find((t) => t.id === autoTransferId(id, '2026-11'));
    expect(at('r21-a')?.date).toBe('2026-11-20');
    expect(at('r25-a')?.date).toBe('2026-11-24');
    expect(at('a-rest-21')).toMatchObject({ date: '2026-11-20', amount: 369_400 });
    expect(at('a-rest-25')).toMatchObject({ date: '2026-11-24', amount: 2_200_000 });
  });

  it('수입 계획이 있어도 수입은 만들지 않고, 손으로 넣은 295만으로 21일 몫을 배분해요', () => {
    const data = household({ transfers: [income('2026-11-19', 2_950_000)] });
    const auto = pendingAutoRecords(data, '2026-11-21', 'a@x', NOW);
    expect(auto.transfers.some((t) => t.kind === 'income')).toBe(false);
    expect(auto.transfers.find((t) => t.id === autoTransferId('a-rest-21', '2026-11'))).toMatchObject({ date: '2026-11-19', amount: 349_400 });
  });

  it('수입이 없으면 예전처럼 정해 둔 날에 배분해요', () => {
    const recs = pendingAutoRecords(household(), '2026-11-21', 'a@x', NOW);
    expect(recs.transfers.find((t) => t.id === autoTransferId('r21-a', '2026-11'))?.date).toBe('2026-11-21');
  });
});

describe('실제 들어온 월급 · 수입 계획 바꾸기 권장', () => {
  const pay = (date: string, amount: number) => transfer({ id: `pay-${date}`, date, kind: 'income', toAccountId: salary.id, amount });
  const garam = (d: LedgerData) => d.incomePlans.find((p) => p.id === 'garam')!;

  it('그달 월급을 기록했으면 월급날 미리보기는 실제 금액(295만), 계획(297만)은 따로', () => {
    const d = household({ transfers: [pay('2026-11-20', 2_950_000)] });
    expect(recordedIncomeAmount(d, garam(d), '2026-11')).toBe(2_950_000);
    const p21 = paydayPlans(d, '2026-11', salary.id).find((p) => p.day === 21)!;
    expect(p21).toMatchObject({ income: 2_950_000, planned: 2_970_000, actual: true });
    // 25일은 아직 기록 전이라 계획 그대로
    expect(paydayPlans(d, '2026-11', salary.id).find((p) => p.day === 25)).toMatchObject({ income: 3_000_000, actual: false });
  });

  it('한 달만 다르면 권장하지 않고, 최근 기록된 달 2~3개 중 2개 이상 다르면 평균(1,000원 반올림)으로 권장해요', () => {
    const early = (d: LedgerData) => ({
      ...d,
      accounts: d.accounts.map((a) => ({ ...a, openingDate: '2026-08-01' })),
      incomePlans: d.incomePlans.map((p) => ({ ...p, startMonth: '2026-08' })),
    });
    const one = early(household({ transfers: [pay('2026-11-20', 2_950_000), pay('2026-10-21', 2_970_000)] }));
    expect(incomePlanSuggestion(one, garam(one), '2026-11-21')).toBeNull();
    const two = early(household({ transfers: [pay('2026-11-20', 2_950_000), pay('2026-10-21', 2_951_000), pay('2026-09-21', 2_970_000)] }));
    expect(incomePlanSuggestion(two, garam(two), '2026-11-21')).toMatchObject({ average: 2_957_000, months: ['2026-11', '2026-10', '2026-09'] });
    // 평균이 계획과 같으면 없음
    const same = early(household({ transfers: [pay('2026-11-20', 2_960_000), pay('2026-10-21', 2_980_000)] }));
    expect(incomePlanSuggestion(same, garam(same), '2026-11-21')).toBeNull();
  });
});
