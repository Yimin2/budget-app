import { describe, expect, it } from 'vitest';
import { account, emptyLedger, expense, rule, transfer } from './_fixtures';
import { accountBalance } from './balances';
import { projectEventAccount } from './events';
import { autoTransferId } from './ids';
import {
  conflictingRemainderRule, incomeRecordId, paydayPlans, pendingIncomeRecords, plannedIncome, projectRemainders, remainderAmount,
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

function withRecords(data: LedgerData, today: string): LedgerData {
  const auto = pendingAutoRecords(data, today, 'a@x', NOW);
  return { ...data, transfers: [...data.transfers, ...auto.transfers], expenses: [...data.expenses, ...auto.expenses] };
}

describe('수입 계획', () => {
  it('받는 날이 지난 회차만 수입으로 기록하고 id 는 계획과 월로 정해요', () => {
    const d = household();
    expect(pendingIncomeRecords(d, '2026-11-20', 'a@x', NOW)).toEqual([]);
    const recs = pendingIncomeRecords(d, '2026-11-21', 'a@x', NOW);
    expect(recs.map((t) => [t.id, t.kind, t.toAccountId, t.amount, t.date, t.memo])).toEqual([
      [incomeRecordId('garam', '2026-11'), 'income', salary.id, 2_970_000, '2026-11-21', '가람 월급'],
    ]);
    // 이미 있으면(지운 것도) 다시 만들지 않아요
    expect(pendingIncomeRecords({ ...d, transfers: [{ ...recs[0]!, deleted: true }] }, '2026-11-21', 'a@x', NOW)).toEqual([]);
  });

  it('받는 통장 시작일 전 · 지운 계획 · 끝난 계획은 기록하지 않아요', () => {
    const d = household({
      accounts: [{ ...salary, openingDate: '2026-11-22' }, livA, livB, allowA, allowB, eventAcc, reservoir, savings],
      incomePlans: [
        plan({ id: 'garam', personName: '가람', amount: 2_970_000, dayOfMonth: 21 }),
        plan({ id: 'gone', personName: '가람', amount: 1, dayOfMonth: 1, deleted: true }),
        plan({ id: 'old', personName: '나래', amount: 1, dayOfMonth: 1, startMonth: '2026-01', endMonth: '2026-10' }),
      ],
    });
    expect(pendingIncomeRecords(d, '2026-11-30', 'a@x', NOW)).toEqual([]);
    expect(plannedIncome(d, '2026-11')).toBe(2_970_000);
    expect(plannedIncome(household(), '2026-11', salary.id)).toBe(5_970_000);
  });
});

describe('나머지 전부 보내기', () => {
  it('같은 날 정한 금액을 먼저 보내고 남은 돈을 모두 보내요 (예: 297만 − 260.06만 = 36.94만)', () => {
    const recs = pendingAutoRecords(household(), '2026-11-21', 'a@x', NOW);
    const rest = recs.transfers.find((t) => t.id === autoTransferId('a-rest-21', '2026-11'))!;
    expect(rest).toMatchObject({ fromAccountId: salary.id, toAccountId: reservoir.id, amount: 369_400, ruleId: 'a-rest-21', date: '2026-11-21' });
    expect(accountBalance(withRecords(household(), '2026-11-21'), salary.id, '2026-11-21')).toBe(0);
    // 25일 규칙은 아직
    expect(recs.transfers.some((t) => t.id === autoTransferId('a-rest-25', '2026-11'))).toBe(false);
  });

  it('늦게 열어 두 월급날이 함께 밀려 있어도 날짜 순으로 각자 그날 남은 돈만 보내요', () => {
    const recs = pendingAutoRecords(household(), '2026-11-26', 'a@x', NOW);
    const amount = (id: string) => recs.transfers.find((t) => t.id === autoTransferId(id, '2026-11'))?.amount;
    expect(amount('a-rest-21')).toBe(369_400);
    expect(amount('a-rest-25')).toBe(2_200_000);
    // 금액 0 인 정한 금액 배분(주식)은 기록하지 않아요
    expect(recs.transfers.some((t) => t.ruleId === 'r25-sav')).toBe(false);
    const after = withRecords(household(), '2026-11-26');
    expect(accountBalance(after, salary.id, '2026-11-26')).toBe(0);
    expect(accountBalance(after, reservoir.id, '2026-11-26')).toBe(2_569_400);
  });

  it('다시 계산해도 같은 기록이 또 생기지 않고, 한 번 기록된 금액은 그대로예요', () => {
    const d = withRecords(household(), '2026-11-21');
    expect(pendingAutoRecords(d, '2026-11-21', 'a@x', NOW)).toEqual({ transfers: [], expenses: [] });
    // 21일 날짜로 돈이 더 들어와도 21일 나머지는 그대로, 25일 나머지 때 함께 나가요
    const late = { ...d, transfers: [...d.transfers, transfer({ date: '2026-11-21', kind: 'income', toAccountId: salary.id, amount: 100_000 })] };
    expect(pendingAutoRecords(late, '2026-11-22', 'a@x', NOW).transfers).toEqual([]);
    const rest25 = pendingAutoRecords(late, '2026-11-25', 'a@x', NOW).transfers.find((t) => t.id === autoTransferId('a-rest-25', '2026-11'));
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
    const est2 = projectRemainders(withRecords(household(), '2026-11-21'), '2026-11-21', 2);
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
