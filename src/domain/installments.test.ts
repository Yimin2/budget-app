import { account, emptyLedger, event as plannedEvent } from './_fixtures';
import { projectEventAccount } from './events';
import { autoFixedExpenseId } from './ids';
import {
  buildInstallmentRows, installmentPayments, installmentPlan, installmentPlans, installmentPrepayId, prepaidAmounts,
  remainingAmountsFrom, replanInstallment, revisedAmounts, splitTotal, validateInstallment, type InstallmentInput,
} from './installments';
import { pendingAutoRecords } from './recurring';
import type { FixedExpense, LedgerData } from './types';

const NOW = '2026-11-09T09:00:00.000Z';
const fixedAcc = account('fixed', { openingDate: '2025-01-01' });
const eventAcc = account('event', { order: 1, openingDate: '2025-01-01', openingBalance: 1_000_000 });

function tvInput(p: Partial<InstallmentInput> = {}): InstallmentInput {
  return {
    name: 'TV 할부',
    amount: 2_400_000,
    amountKind: 'total',
    months: 24,
    firstMonth: '2026-11',
    dayOfMonth: 15,
    accountId: fixedAcc.id,
    categoryId: 'cat-big',
    ...p,
  };
}

function ledgerWith(rows: FixedExpense[], extra: Partial<LedgerData> = {}): LedgerData {
  return emptyLedger({ accounts: [fixedAcc, eventAcc], fixedExpenses: rows, ...extra });
}

/** 오늘까지의 자동 기록을 붙인 데이터 */
function synced(data: LedgerData, today: string): LedgerData {
  const auto = pendingAutoRecords(data, today, 'me@x', NOW);
  return { ...data, expenses: [...data.expenses, ...auto.expenses] };
}

/** 쓸 행을 데이터에 반영 (같은 id 는 교체) */
function applyRows(data: LedgerData, rows: FixedExpense[]): LedgerData {
  const list = data.fixedExpenses.slice();
  for (const r of rows) {
    const i = list.findIndex((x) => x.id === r.id);
    if (i < 0) list.push(r);
    else list[i] = r;
  }
  return { ...data, fixedExpenses: list };
}

describe('splitTotal', () => {
  it('puts the remainder on the first installment', () => {
    expect(splitTotal(1_000_000, 3)).toEqual([333_334, 333_333, 333_333]);
    expect(splitTotal(2_400_000, 24).every((a) => a === 100_000)).toBe(true);
    expect(splitTotal(1_000, 0)).toEqual([]);
  });
});

describe('buildInstallmentRows', () => {
  it('makes one row for an even split: 24 months, ends after the last installment', () => {
    const rows = buildInstallmentRows(tvInput(), 'tv', '2026-11-09');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'tv', kind: 'installment', amount: 100_000, startMonth: '2026-11', endMonth: '2028-10',
      installmentNo: 1, installmentCount: 24, dayOfMonth: 15,
    });
  });

  it('splits off the first installment when the total does not divide evenly', () => {
    const rows = buildInstallmentRows(tvInput({ amount: 1_000_000, months: 3 }), 'p', '2026-11-09');
    expect(rows.map((r) => [r.id, r.amount, r.startMonth, r.endMonth, r.installmentNo])).toEqual([
      ['p', 333_334, '2026-11', '2026-11', 1],
      ['p@2026-12', 333_333, '2026-12', '2027-01', 2],
    ]);
  });

  it('a first month in the past counts earlier installments as paid without recording them', () => {
    // 2025-08 첫 회차, 24개월, 15일 결제 → 오늘(2026-11-20) 기준 16회차(2026-11-15)까지 냄
    const rows = buildInstallmentRows(tvInput({ firstMonth: '2025-08' }), 'tv', '2026-11-20');
    expect(rows[0]).toMatchObject({ startMonth: '2026-12', endMonth: '2027-07', installmentNo: 17, installmentCount: 24 });
    const data = ledgerWith(rows);
    expect(pendingAutoRecords(data, '2026-11-20', 'me@x', NOW).expenses).toEqual([]);
    const plan = installmentPlan(data, 'tv', '2026-11-20')!;
    expect(plan).toMatchObject({ firstMonth: '2025-08', count: 24, paidCount: 16, remainingCount: 8, remainingAmount: 800_000 });
  });

  it('a payment due today is still to be recorded', () => {
    const rows = buildInstallmentRows(tvInput({ firstMonth: '2025-08' }), 'tv', '2026-11-15');
    expect(rows[0]).toMatchObject({ startMonth: '2026-11', installmentNo: 16 });
  });

  it('rejects bad input', () => {
    expect(validateInstallment(tvInput({ months: 1 }), '2026-11-09')).toMatch(/개월/);
    expect(validateInstallment(tvInput({ name: ' ' }), '2026-11-09')).toMatch(/이름/);
    expect(validateInstallment(tvInput({ firstMonth: '2020-01' }), '2026-11-09')).toBe('이미 다 낸 할부예요');
    expect(() => buildInstallmentRows(tvInput({ amount: 0 }), 'x', '2026-11-09')).toThrow('금액을 입력해 주세요');
  });
});

describe('installment status and auto-records', () => {
  const rows = buildInstallmentRows(tvInput({ firstMonth: '2025-08' }), 'tv', '2025-08-01');

  it('shows 16/24 with 8 left and the remaining amount', () => {
    const data = synced(ledgerWith(rows), '2026-11-20');
    const plan = installmentPlans(data, '2026-11-20')[0]!;
    expect(plan).toMatchObject({
      id: 'tv', name: 'TV 할부', count: 24, paidCount: 16, remainingCount: 8, remainingAmount: 800_000, monthly: 100_000, ended: false,
    });
    expect(plan.next).toMatchObject({ month: '2026-12', number: 17, date: '2026-12-15' });
  });

  it('records each installment once with its number, and stops after the last one', () => {
    const data = ledgerWith(rows);
    const out = pendingAutoRecords(data, '2028-01-31', 'me@x', NOW).expenses;
    expect(out).toHaveLength(24);
    expect(out[0]).toMatchObject({ id: autoFixedExpenseId('tv', '2025-08'), memo: 'TV 할부 1/24회차', amount: 100_000, fixedExpenseId: 'tv' });
    expect(out[23]).toMatchObject({ id: autoFixedExpenseId('tv', '2027-07'), memo: 'TV 할부 24/24회차' });
    const done = installmentPlan({ ...data, expenses: out }, 'tv', '2028-01-31')!;
    expect(done).toMatchObject({ ended: true, remainingCount: 0, remainingAmount: 0, paidCount: 24, next: null });
  });

  it('a blank 결제일 counts and records on the 1st, so nothing piles up in the projection', () => {
    const blank = buildInstallmentRows(tvInput({ accountId: eventAcc.id, months: 3, amount: 300_000, firstMonth: '2026-09' }), 'tv', '2026-09-01')
      .map((r) => ({ ...r, dayOfMonth: null }));
    const d = synced(ledgerWith(blank), '2026-11-20');
    expect(d.expenses.map((e) => e.date)).toEqual(['2026-09-01', '2026-10-01', '2026-11-01']);
    expect(installmentPlan(d, 'tv', '2026-11-20')).toMatchObject({ paidCount: 3, ended: true, dayOfMonth: 1 });
    expect(projectEventAccount(d, '2026-11-20').months.every((m) => !m.installments)).toBe(true);
  });

  it('a blank 종료월 still ends by 전체 회차', () => {
    const blank = rows.map((r) => ({ ...r, endMonth: null }));
    expect(pendingAutoRecords(ledgerWith(blank), '2028-01-31', 'me@x', NOW).expenses).toHaveLength(24);
  });

  it('blank 할부회차 · 할부개월 cells read as installment 1 and end by 종료월', () => {
    const plain = rows.map((r) => ({ ...r, installmentNo: null, installmentCount: undefined }));
    const plan = installmentPlan(ledgerWith(plain), 'tv', '2025-08-01')!;
    expect(plan.count).toBe(24);
    expect(plan.payments[0]!.number).toBe(1);
  });
});

describe('mid-way edits apply from the next installment only', () => {
  const today = '2026-11-20';
  const base = buildInstallmentRows(tvInput({ firstMonth: '2025-08' }), 'tv', '2025-08-01');
  const before = synced(ledgerWith(base), today);
  const pastRecords = before.expenses.map((e) => ({ id: e.id, amount: e.amount, memo: e.memo }));

  it('prepayment cuts 8 remaining installments to 4 without touching past ones', () => {
    const plan = installmentPlan(before, 'tv', today)!;
    const from = plan.next!.month;
    expect(from).toBe('2026-12');
    const amounts = revisedAmounts(plan, from, { remaining: 4 });
    expect(amounts).toEqual([100_000, 100_000, 100_000, 100_000]);
    const writes = replanInstallment(plan, from, amounts);
    expect(writes.map((r) => [r.id, r.startMonth, r.endMonth, r.amount, r.installmentNo, r.installmentCount, r.deleted])).toEqual([
      ['tv@2026-12', '2026-12', '2027-03', 100_000, 17, 20, false],
      ['tv', '2025-08', '2026-11', 100_000, 1, 20, false],
    ]);
    const after = synced(applyRows(before, writes), '2027-12-31');
    // 지난 기록은 그대로, 새 회차는 새 행 id 로
    for (const p of pastRecords) expect(after.expenses.find((e) => e.id === p.id)).toMatchObject(p);
    const fresh = after.expenses.filter((e) => !pastRecords.some((p) => p.id === e.id));
    expect(fresh.map((e) => e.memo)).toEqual(['TV 할부 17/20회차', 'TV 할부 18/20회차', 'TV 할부 19/20회차', 'TV 할부 20/20회차']);
    expect(installmentPlan(after, 'tv', '2027-12-31')).toMatchObject({ count: 20, ended: true });
  });

  it('changing the monthly amount recalculates from the chosen month', () => {
    const plan = installmentPlan(before, 'tv', today)!;
    const writes = replanInstallment(plan, '2027-02', revisedAmounts(plan, '2027-02', { monthly: 150_000 }));
    const next = installmentPlan(applyRows(before, writes), 'tv', today)!;
    expect(next.payments.filter((p) => !p.paid).map((p) => [p.month, p.amount])).toEqual([
      ['2026-12', 100_000], ['2027-01', 100_000], ['2027-02', 150_000], ['2027-03', 150_000],
      ['2027-04', 150_000], ['2027-05', 150_000], ['2027-06', 150_000], ['2027-07', 150_000],
    ]);
    expect(next.count).toBe(24);
  });

  it('is safe to retry: the same edit on the edited plan writes the same rows', () => {
    const plan = installmentPlan(before, 'tv', today)!;
    const writes = replanInstallment(plan, '2026-12', [100_000, 100_000, 100_000, 100_000]);
    const once = applyRows(before, writes);
    const again = replanInstallment(installmentPlan(once, 'tv', today)!, '2026-12', [100_000, 100_000, 100_000, 100_000]);
    expect(applyRows(once, again).fixedExpenses).toEqual(once.fixedExpenses);
  });

  it('a write cut off half-way (new row saved, old row not ended) never records a month twice', () => {
    const plan = installmentPlan(before, 'tv', today)!;
    const [created] = replanInstallment(plan, '2026-12', [100_000, 100_000, 100_000, 100_000]);
    const partial = applyRows(before, [created!]);
    const out = pendingAutoRecords(partial, '2027-12-31', 'me@x', NOW).expenses;
    const months = out.map((e) => e.date.slice(0, 7));
    expect(new Set(months).size).toBe(months.length);
    // 새 행이 시작월부터 옛 행을 끊는다: 옛 행을 끝내는 쓰기가 끊겨도 줄인 회차(2027-04 ~ 07)는 기록되지 않는다
    expect(out.filter((e) => e.fixedExpenseId === 'tv@2026-12').map((e) => e.date.slice(0, 7))).toEqual(['2026-12', '2027-01', '2027-02', '2027-03']);
    expect(out.filter((e) => e.fixedExpenseId === 'tv')).toEqual([]);
    expect(installmentPlan(partial, 'tv', today)).toMatchObject({ count: 20, remainingCount: 4, remainingAmount: 400_000 });
  });

  it('a prepay cut off after the new row (12 months from 2026-10) does not keep charging the old tail', () => {
    const rows12 = buildInstallmentRows(tvInput({ amount: 100_000, amountKind: 'monthly', months: 12, firstMonth: '2026-10' }), 'tv', '2026-10-01');
    const d = synced(ledgerWith(rows12), '2026-11-10');
    const plan = installmentPlan(d, 'tv', '2026-11-10')!;
    expect(plan).toMatchObject({ count: 12, remainingCount: 11, remainingAmount: 1_100_000 });
    const writes = replanInstallment(plan, '2026-11', prepaidAmounts(plan, '2026-11', 600_000, 'monthly'));
    expect(writes.map((r) => [r.id, r.startMonth, r.endMonth])).toEqual([
      ['tv@2026-11', '2026-11', '2027-03'],
      ['tv', '2026-10', '2026-10'],
    ]);
    const partial = applyRows(d, [writes[0]!]);
    expect(installmentPlan(partial, 'tv', '2026-11-10')).toMatchObject({ count: 6, remainingCount: 5, remainingAmount: 500_000 });
    const out = pendingAutoRecords(partial, '2027-09-30', 'me@x', NOW).expenses;
    expect(out.map((e) => e.id)).not.toContain(autoFixedExpenseId('tv', '2027-04'));
    expect(out.map((e) => e.date.slice(0, 7))).toEqual(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
  });

  it('later rows past the new end are removed first, rows inside it are overwritten in place', () => {
    // 2027-02 부터 금액을 바꿔 둔 할부 (tv · tv@2027-02) 를 2026-12 부터 4회로 줄이기
    const plan0 = installmentPlan(before, 'tv', today)!;
    const split = applyRows(before, replanInstallment(plan0, '2027-02', revisedAmounts(plan0, '2027-02', { monthly: 150_000 })));
    const plan = installmentPlan(split, 'tv', today)!;
    const writes = replanInstallment(plan, '2026-12', [100_000, 100_000]);
    expect(writes.map((r) => [r.id, r.deleted])).toEqual([
      ['tv@2027-02', true],
      ['tv@2026-12', false],
      ['tv', false],
    ]);
    // 지우기만 저장되고 끊겨도 2027-02 뒤 회차는 생기지 않는다
    const cut = applyRows(split, [writes[0]!]);
    const months = pendingAutoRecords(cut, '2027-12-31', 'me@x', NOW).expenses.map((e) => e.date.slice(0, 7));
    expect(months.filter((m) => m >= '2026-12')).toEqual(['2026-12', '2027-01']);
    // 새 일정이 옛 행의 시작월을 지나면 그 행을 같은 id 로 덮어쓴다
    const longer = replanInstallment(plan, '2026-12', Array.from({ length: 5 }, () => 90_000));
    expect(longer.map((r) => [r.id, r.startMonth, r.endMonth, r.deleted])).toEqual([
      ['tv@2026-12', '2026-12', '2027-01', false],
      ['tv@2027-02', '2027-02', '2027-04', false],
      ['tv', '2025-08', '2026-11', false],
    ]);
  });

  it('refuses to change installments that are already paid', () => {
    const plan = installmentPlan(before, 'tv', today)!;
    expect(() => replanInstallment(plan, '2026-11', [100_000])).toThrow('이미 낸 회차는 바꿀 수 없어요');
  });

  it('ending (empty schedule) closes the plan after the last paid installment', () => {
    const plan = installmentPlan(before, 'tv', today)!;
    const writes = replanInstallment(plan, '2026-12', []);
    expect(writes).toEqual([
      { ...base[0]!, id: 'tv@2026-12', startMonth: '2026-12', endMonth: '2026-11', installmentNo: 17, installmentCount: 16 },
      { ...base[0]!, endMonth: '2026-11', installmentCount: 16 },
    ]);
    const after = synced(applyRows(before, writes), '2027-12-31');
    expect(after.expenses).toHaveLength(before.expenses.length);
    expect(installmentPlan(after, 'tv', today)).toMatchObject({ ended: true, count: 16, endMonth: '2026-11' });
    // 끊는 행만 저장돼도 그 뒤는 기록되지 않는다
    expect(synced(applyRows(before, [writes[0]!]), '2027-12-31').expenses).toHaveLength(before.expenses.length);
  });

  it('ending or fully prepaying before the first installment keeps the plan as ended (not deleted)', () => {
    const fresh = buildInstallmentRows(tvInput({ firstMonth: '2026-12' }), 'tv', today);
    const d = ledgerWith(fresh);
    const plan = installmentPlan(d, 'tv', today)!;
    for (const amounts of [[], prepaidAmounts(plan, '2026-12', plan.remainingAmount, 'monthly')]) {
      const writes = replanInstallment(plan, '2026-12', amounts);
      expect(writes.every((r) => !r.deleted)).toBe(true);
      const after = applyRows(d, writes);
      const plans = installmentPlans(after, today);
      expect(plans).toHaveLength(1);
      expect(plans[0]).toMatchObject({ id: 'tv', ended: true, count: 0, remainingAmount: 0, last: null, endMonth: '2026-11' });
      expect(pendingAutoRecords(after, '2029-01-31', 'me@x', NOW).expenses).toEqual([]);
    }
  });

  it('an edit before the first installment rewrites the plan in place', () => {
    const fresh = buildInstallmentRows(tvInput({ firstMonth: '2026-12' }), 'tv', today);
    const plan = installmentPlan(ledgerWith(fresh), 'tv', today)!;
    const writes = replanInstallment(plan, '2026-12', [200_000, 200_000], { accountId: eventAcc.id, name: '새 TV' });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ id: 'tv', amount: 200_000, endMonth: '2027-01', accountId: eventAcc.id, name: '새 TV', installmentCount: 2 });
  });
});

describe('prepaidAmounts', () => {
  const rows = buildInstallmentRows(tvInput({ firstMonth: '2025-08' }), 'tv', '2025-08-01');
  const plan = installmentPlan(ledgerWith(rows), 'tv', '2026-11-20')!;

  it('keeps the monthly amount and shortens (last installment takes the rest)', () => {
    expect(prepaidAmounts(plan, '2026-12', 400_000, 'monthly')).toEqual([100_000, 100_000, 100_000, 100_000]);
    expect(prepaidAmounts(plan, '2026-12', 350_000, 'monthly')).toEqual([100_000, 100_000, 100_000, 100_000, 50_000]);
  });

  it('keeps the months and lowers the monthly amount', () => {
    expect(prepaidAmounts(plan, '2026-12', 400_000, 'months')).toEqual(Array.from({ length: 8 }, () => 50_000));
  });

  it('paying everything ends it, paying more is refused', () => {
    expect(prepaidAmounts(plan, '2026-12', 800_000, 'monthly')).toEqual([]);
    expect(() => prepaidAmounts(plan, '2026-12', 800_001, 'monthly')).toThrow(/보다 많아요/);
  });

  it('prepay ids change once the remaining amount changes', () => {
    const r = remainingAmountsFrom(plan, '2026-12').reduce((s, a) => s + a, 0);
    expect(installmentPrepayId('tv', '2026-12', r, 400_000)).toBe('prepay:tv:2026-12:800000:400000');
    // 금액을 고쳐 다시 하면 다른 id (처음 금액의 기록에 묻히지 않게)
    expect(installmentPrepayId('tv', '2026-12', r, 500_000)).not.toBe(installmentPrepayId('tv', '2026-12', r, 400_000));
  });
});

describe('installments in the event projection', () => {
  it('counts unrecorded installments on the event account once, in their month', () => {
    const rows = buildInstallmentRows(tvInput({ accountId: eventAcc.id, months: 3, amount: 300_000, firstMonth: '2026-11' }), 'tv', '2026-11-09');
    const data = ledgerWith(rows);
    const p = projectEventAccount(data, '2026-11-20');
    // 11월 15일 회차는 아직 자동 기록 전 → 이번 달에 나갈 돈
    expect(p.months.slice(0, 4).map((m) => m.installments ?? 0)).toEqual([100_000, 100_000, 100_000, 0]);
    const recorded = synced(data, '2026-11-20');
    const q = projectEventAccount(recorded, '2026-11-20');
    expect(q.currentBalance).toBe(900_000);
    expect(q.months.slice(0, 3).map((m) => m.installments ?? 0)).toEqual([0, 100_000, 100_000]);
    expect(q.months[2]!.endBalance).toBe(p.months[2]!.endBalance);
  });

  it('fixed-account installments do not touch the event projection', () => {
    const rows = buildInstallmentRows(tvInput(), 'tv', '2026-11-09');
    const data = ledgerWith(rows, { events: [plannedEvent({ date: '2027-01-10', amount: 50_000, accountId: eventAcc.id })] });
    expect(projectEventAccount(data, '2026-11-09').months.every((m) => !m.installments)).toBe(true);
  });

  it('installment payments line up with the plan rows (owner per month)', () => {
    const rows = buildInstallmentRows(tvInput({ amount: 1_000_000, months: 3 }), 'p', '2026-11-09');
    expect(installmentPayments(rows).map((p) => [p.month, p.rowId, p.number])).toEqual([
      ['2026-11', 'p', 1], ['2026-12', 'p@2026-12', 2], ['2027-01', 'p@2026-12', 3],
    ]);
  });
});
