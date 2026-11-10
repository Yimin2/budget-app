import { describe, expect, it } from 'vitest';
import { account, emptyLedger, expense, transfer } from './_fixtures';
import { claimLoanTransferId, claimTransferId } from './claims';
import { computeSettlement, filterSettleList, loanPayoff, pendingOnly, settleList, settlePeopleDue } from './settlement';
import type { Category, LedgerData } from './types';

const TODAY = '2026-11-20';
const income = account('income', { order: 0, openingDate: '2026-01-01' });
const fixedAcc = account('fixed', { order: 1, openingBalance: 1_000_000, openingDate: '2026-01-01' });
const eventAcc = account('event', { order: 2, openingBalance: 500_000, openingDate: '2026-01-01' });
const reservoir = account('reservoir', { order: 3, openingBalance: 9_000_000, openingDate: '2026-01-01' });
const CATS: Category[] = [
  { id: 'c-fam', name: '경조사', icon: 'gift', defaultAccountRole: 'event', order: 0, deleted: false },
  { id: 'c-food', name: '식비', icon: 'gift', defaultAccountRole: 'fixed', order: 1, deleted: false },
];

function ledger(p: Partial<LedgerData> = {}): LedgerData {
  return emptyLedger({
    accounts: [income, fixedAcc, eventAcc, reservoir],
    categories: CATS,
    members: [
      { email: 'Minji@x', displayName: '민지' },
      { email: 'junho@x', displayName: '준호' },
    ],
    ...p,
  });
}

/** 줄 돈(이벤트 · 생활비 · 저수지 이벤트) · 지급함 · 빌려 지급 · 그냥 지출이 섞인 가계부 */
function mixed(): LedgerData {
  return ledger({
    expenses: [
      expense({ id: 'plain', date: '2026-11-02', amount: 100_000, accountId: eventAcc.id, categoryId: 'c-fam', author: 'junho@x' }),
      expense({ id: 'pend', date: '2026-11-05', amount: 100_000, accountId: eventAcc.id, categoryId: 'c-fam', paidBy: '민지', claimDue: '2026-11-21' }),
      expense({ id: 'food', date: '2026-11-06', amount: 24_000, accountId: fixedAcc.id, categoryId: 'c-food', paidBy: '준호', claimDue: '2026-11-21' }),
      expense({ id: 'paid', date: '2026-10-01', amount: 100_000, accountId: eventAcc.id, categoryId: 'c-fam', paidBy: '민지' }),
      expense({ id: 'borrowed', date: '2026-10-04', amount: 200_000, accountId: eventAcc.id, categoryId: 'c-fam', paidBy: '민지' }),
      expense({ id: 'old', date: '2026-10-18', amount: 50_000, accountId: eventAcc.id, categoryId: 'c-fam', paidBy: '준호', claimDue: '2026-10-21' }),
      expense({ id: 'res', date: '2026-09-10', amount: 70_000, accountId: reservoir.id, categoryId: 'c-fam', paidBy: '준호', claimDue: '2026-10-21' }),
      expense({ id: 'gone', date: '2026-11-03', amount: 1, accountId: eventAcc.id, deleted: true }),
    ],
    transfers: [
      transfer({ id: claimTransferId('paid'), date: '2026-11-10', amount: 100_000, fromAccountId: eventAcc.id, toAccountId: income.id }),
      transfer({ id: claimTransferId('borrowed'), date: '2026-11-10', amount: 200_000, fromAccountId: eventAcc.id, toAccountId: income.id }),
      transfer({ id: claimLoanTransferId('borrowed'), date: '2026-11-10', amount: 200_000, fromAccountId: reservoir.id, toAccountId: eventAcc.id }),
    ],
  });
}

describe('정산 화면 한 목록 (settleList)', () => {
  it('최근 달 먼저, 달 안에서는 최근 것 먼저. 정산 상태 · 고를 수 있는 항목 · 지급 · 빌린 기록을 붙여요', () => {
    const data = mixed();
    const s = computeSettlement(data, TODAY);
    const months = settleList(data, s);
    expect(months.map((m) => m.month)).toEqual(['2026-11', '2026-10', '2026-09']);
    const [nov, oct, sep] = months;
    // 생활비 통장 청구도 같은 목록에 (이벤트통장 기록에는 없어요)
    expect(nov!.rows.map((r) => [r.expense.id, r.status])).toEqual([
      ['food', 'claimPending'],
      ['pend', 'claimPending'],
      ['plain', 'plain'],
    ]);
    expect(nov!.total).toBe(224_000);
    expect(nov!.pendingTotal).toBe(124_000);
    expect(nov!.pendingCount).toBe(2);
    expect(nov!.rows[0]!.item?.kind).toBe('pay');

    expect(oct!.rows.map((r) => [r.expense.id, r.status])).toEqual([
      ['old', 'claimPending'],
      ['borrowed', 'borrowed'],
      ['paid', 'claimPaid'],
    ]);
    const borrowed = oct!.rows[1]!;
    expect(borrowed.item).toBeNull();
    expect(borrowed.paid?.date).toBe('2026-11-10');
    expect(borrowed.loan?.kind).toBe('claim');
    expect(oct!.rows[2]!.paid?.borrowed).toBe(false);
    expect(oct!.rows[2]!.loan).toBeNull();

    // 저수지 돈으로 낸 이벤트 청구는 '저수지에서 빌려 지급'할 줄 돈
    expect(sep!.rows.map((r) => [r.expense.id, r.status, r.item?.kind])).toEqual([['res', 'claimPending', 'borrow']]);
  });

  it('줄 돈만: 고를 수 있는 줄만, 줄 돈이 없는 달은 빼요 (합계는 그대로)', () => {
    const data = mixed();
    const s = computeSettlement(data, TODAY);
    const due = pendingOnly(settleList(data, s));
    expect(due.map((m) => [m.month, m.rows.map((r) => r.expense.id), m.total])).toEqual([
      ['2026-11', ['food', 'pend'], 224_000],
      ['2026-10', ['old'], 350_000],
      ['2026-09', ['res'], 70_000],
    ]);
    const settled = ledger({
      expenses: [expense({ id: 'p', date: '2026-08-02', amount: 10_000, accountId: eventAcc.id })],
    });
    expect(pendingOnly(settleList(settled, computeSettlement(settled, TODAY)))).toEqual([]);
  });

  it('사람 필터: 지출을 쓴 사람(청구는 낸 사람, 그 밖은 기록한 사람)으로 거르고 합계를 다시 세요', () => {
    const data = mixed();
    const s = computeSettlement(data, TODAY);
    const all = settleList(data, s);
    expect(filterSettleList(data, all, null)).toBe(all);
    const junho = filterSettleList(data, all, 'junho@x');
    expect(junho.map((m) => [m.month, m.rows.map((r) => r.expense.id), m.total, m.pendingTotal])).toEqual([
      ['2026-11', ['food', 'plain'], 124_000, 24_000],
      ['2026-10', ['old'], 50_000, 50_000],
      ['2026-09', ['res'], 70_000, 70_000],
    ]);
    // 이메일 대소문자는 가리지 않아요
    expect(filterSettleList(data, all, 'minji@x').flatMap((m) => m.rows.map((r) => r.expense.id))).toEqual(['pend', 'borrowed', 'paid']);
  });

  it('사람별 줄 돈: 지난달부터 못 준 돈과 그 달', () => {
    const data = mixed();
    const s = computeSettlement(data, TODAY);
    const people = settlePeopleDue(s);
    expect(people.find((p) => p.name === '민지')).toEqual({ name: '민지', amount: 100_000, overdue: 0, overdueMonth: null });
    expect(people.find((p) => p.name === '준호')).toEqual({ name: '준호', amount: 144_000, overdue: 120_000, overdueMonth: '2026-10' });
  });
});

describe('저수지 갚기 계획 (loanPayoff)', () => {
  it('한 달 갚을 돈 = 빚 ÷ 개월(천 원 단위 올림), 다음 달부터 갚아 끝나는 달', () => {
    expect(loanPayoff(4_200_000, 21, '2026-11')).toEqual({ monthly: 200_000, endMonth: '2028-08' });
    expect(loanPayoff(300_000, 24, '2026-11')).toEqual({ monthly: 13_000, endMonth: '2028-11' });
    expect(loanPayoff(0, 24, '2026-11')).toBeNull();
    expect(loanPayoff(100, 0, '2026-11')).toBeNull();
  });
});
