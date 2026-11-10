import { describe, expect, it } from 'vitest';
import { account, emptyLedger, event, expense, rule, transfer } from './_fixtures';
import { accountBalance, allBalances } from './balances';
import { claimLoanTransferId, claimMessageFor, claimTransferId, isClaimPaidFromReservoir, pendingClaims } from './claims';
import { autoTransferId } from './ids';
import { projectEventAccount } from './events';
import {
  allocateClaims, balanceWithScheduled, checkSettlementSelection, isCarriedOverClaim, selectionLimitText, settleExplanation, settleRefusal, shortfallText, claimsBySource, computeSettlement, defaultSettlementSelection, expenseLoanTransferId, followLoanTransfers,
  loanCandidates, loanRepayId, loanStatus, planSettlement, settledReservoirEventClaims, settlementSummary, settleRoster,
} from './settlement';
import { usualHistory } from './usual';
import type { Category, Expense, LedgerData, PendingClaim, Transfer } from './types';

const TODAY = '2026-11-10';

const incomeA = account('income', { id: 'inc-a', name: '가람 수입통장', ownerName: '가람', order: 0 });
const incomeB = account('income', { id: 'inc-b', name: '나래 수입통장', ownerName: '나래', order: 1 });
const fixedAcc = account('fixed', { id: 'fixed', openingBalance: 1_000_000, order: 2 });
const eventAcc = account('event', { id: 'event', openingBalance: 100_000, order: 3 });
const reservoirAcc = account('reservoir', { id: 'res', openingBalance: 5_000_000, order: 4 });
const contribution = rule({ id: 'r-event', fromAccountId: 'inc-a', toAccountId: 'event', amount: 500_000, dayOfMonth: 21, startMonth: '2026-11' });
const giftCat: Category = { id: 'cat-gift', name: '경조사', icon: 'gift', defaultAccountRole: 'event', order: 0, deleted: false };
const foodCat: Category = { id: 'cat-food', name: '식비', icon: 'food', defaultAccountRole: 'fixed', order: 1, deleted: false };

function claim(id: string, p: Partial<Expense> & Pick<Expense, 'amount' | 'date'>): Expense {
  const payer = p.paidBy ?? '가람';
  return expense({
    id,
    accountId: 'event',
    paidBy: payer,
    claimAccountId: payer === '가람' ? 'inc-a' : 'inc-b',
    claimDue: '2026-11-21',
    memo: id,
    ...p,
  });
}

/** 가람 · 나래 두 사람, 이벤트통장 매달 21일 50만 적립 */
function ledger(p: Partial<LedgerData> = {}): LedgerData {
  return emptyLedger({
    accounts: [incomeA, incomeB, fixedAcc, eventAcc, reservoirAcc],
    rules: [contribution],
    categories: [giftCat, foodCat],
    ...p,
  });
}

/** 정산 예시: 지급할 수 있는 돈 50만 (잔액 10만 + 21일 적립 50만 − 이번 달 일정 10만) */
function scenario(p: Partial<LedgerData> = {}): LedgerData {
  return ledger({
    events: [event({ id: 'ev-nov', date: '2026-11-28', amount: 100_000, accountId: 'event', name: '돌잔치' })],
    expenses: [
      claim('c1', { amount: 200_000, date: '2026-09-05', claimDue: '2026-11-05' }),
      claim('c2', { amount: 350_000, date: '2026-10-02', claimDue: '2026-11-05', paidBy: '나래' }),
      claim('c3', { amount: 120_000, date: '2026-10-15' }),
      claim('c4', { amount: 50_000, date: '2026-11-08', claimDue: '2026-12-21', paidBy: '나래' }),
      claim('f1', { amount: 30_000, date: '2026-10-20', accountId: 'fixed', paidBy: '나래' }),
      claim('r1', { amount: 80_000, date: '2026-08-01', accountId: 'res', claimDue: '2026-08-01' }),
      claim('r2', { amount: 40_000, date: '2026-08-03', accountId: 'res', claimDue: '2026-08-03' }),
    ],
    ...p,
  });
}

const ids = (list: { claims: PendingClaim[] }[]) => list.flatMap((g) => g.claims.map((c) => c.expense.id));

/** [지급했어요] / [저수지에서 빌려 지급]이 남기는 이체 (상태 계층과 같은 모양) */
function settleRows(d: LedgerData, expenseIds: string[], opts: { borrow?: boolean; date?: string } = {}): Transfer[] {
  const date = opts.date ?? TODAY;
  const rows: Transfer[] = [];
  for (const c of pendingClaims(d, date).filter((x) => expenseIds.includes(x.expense.id))) {
    if (opts.borrow) {
      rows.push(transfer({ id: claimLoanTransferId(c.expense.id), date, amount: c.amount, fromAccountId: 'res', toAccountId: c.accountId }));
    }
    rows.push(transfer({ id: claimTransferId(c.expense.id), date, amount: c.amount, fromAccountId: c.accountId, toAccountId: c.claimAccountId }));
  }
  return rows;
}

const withTransfers = (d: LedgerData, rows: Transfer[]): LedgerData => ({ ...d, transfers: [...d.transfers, ...rows] });

describe('지급할 수 있는 돈', () => {
  it('정산일 잔액(그날 적립 포함) − 이번 달 남은 일정, 0 아래로는 안 내려가요', () => {
    const s = computeSettlement(scenario(), TODAY);
    expect(s.date).toBe('2026-11-21');
    expect(s.balance).toBe(600_000);
    expect(s.reserved).toBe(100_000);
    expect(s.payable).toBe(500_000);

    const tight = scenario({ events: [event({ date: '2026-11-28', amount: 900_000, accountId: 'event' })] });
    expect(computeSettlement(tight, TODAY).payable).toBe(0);
  });

  it('적립이 이미 기록됐으면 한 번만 세요 (정산일이 지난 뒤에도 같은 돈)', () => {
    const before = balanceWithScheduled(ledger(), 'event', TODAY, '2026-11-21');
    const recorded = ledger({
      transfers: [transfer({ id: autoTransferId('r-event', '2026-11'), date: '2026-11-21', amount: 500_000, fromAccountId: 'inc-a', toAccountId: 'event', ruleId: 'r-event' })],
    });
    expect(before).toBe(600_000);
    expect(balanceWithScheduled(recorded, 'event', '2026-11-25', '2026-11-25')).toBe(600_000);
    const after = computeSettlement({ ...scenario(), transfers: recorded.transfers }, '2026-11-25');
    expect(after.asOf).toBe('2026-11-25');
    expect(after.payable).toBe(500_000);
  });

  it('적립일 전 날짜면 그날 적립은 아직 없어요', () => {
    expect(balanceWithScheduled(ledger(), 'event', TODAY, '2026-11-20')).toBe(100_000);
  });

  it('이미 쓴 일정(썼어요)은 남은 일정에서 빠져요', () => {
    const d = scenario({
      events: [event({ id: 'ev-nov', date: '2026-11-28', amount: 100_000, accountId: 'event', status: 'done' })],
    });
    expect(computeSettlement(d, TODAY).reserved).toBe(0);
  });
});

describe('나누기 (오래된 순 · first-fit · 쪼개지 않음)', () => {
  const pc = (id: string, amount: number, date: string, payer = '가람'): PendingClaim => ({
    expense: expense({ id, date, amount, accountId: 'event' }),
    payer,
    amount,
    accountId: 'event',
    claimAccountId: null,
    due: '2026-11-21',
    dueNow: false,
  });

  it('오래된 것부터, 안 들어가면 건너뛰고 더 작은 뒤 청구를 넣어요', () => {
    const r = allocateClaims([pc('b', 350_000, '2026-10-02'), pc('c', 120_000, '2026-10-15'), pc('a', 200_000, '2026-09-05')], 500_000);
    expect(r.paid.map((c) => c.expense.id)).toEqual(['a', 'c']);
    expect(r.carried.map((c) => c.expense.id)).toEqual(['b']);
    expect(r.left).toBe(180_000);
  });

  it('지급할 수 있는 돈이 0 이면 모두 넘어가요', () => {
    const r = allocateClaims([pc('a', 1, '2026-10-01')], 0);
    expect(r.paid).toEqual([]);
    expect(r.carried).toHaveLength(1);
  });
});

describe('이번 달 정산', () => {
  it('사람별 이번 달 지급 · 다음 달로 넘어가요 · 저수지 몫 · 정산일이 안 된 돈', () => {
    const s = computeSettlement(scenario(), TODAY);
    // 이벤트통장 몫 50만: 가람 20만(9월) → 나래 35만(안 들어감) → 가람 12만. 고정지출통장 몫(나래 3만)은 한도 없이
    expect(s.pay.map((g) => [g.name, g.amount])).toEqual([
      ['가람', 320_000],
      ['나래', 30_000],
    ]);
    expect(ids(s.pay)).toEqual(['c1', 'c3', 'f1']);
    expect(s.eventPayTotal).toBe(320_000);
    expect(s.payTotal).toBe(350_000);
    expect(s.carry.map((g) => [g.name, g.amount])).toEqual([['나래', 350_000]]);
    expect(s.carryTotal).toBe(350_000);
    expect(s.reservoir.map((g) => [g.name, g.amount, g.claims.length])).toEqual([['가람', 120_000, 2]]);
    expect(s.upcoming.map((g) => [g.name, g.amount, g.due])).toEqual([['나래', 50_000, '2026-12-21']]);
    expect(s.spare).toBe(180_000);
    expect(s.dueNow).toBe(true);
  });

  it('넘어가는 돈은 평소 쓰는 돈까지 넣은 예측으로 지급 예상 달을 알려 줘요', () => {
    const s = computeSettlement(scenario(), TODAY);
    // 11월 말 예상 (넘어가는 돈 빼고) = 60만 − 일정 10만 − 이번 달 청구 35만 = 15만 → 12월 적립 뒤 65만 − 12월 청구 5만 = 60만 ≥ 35만
    expect(s.carry[0]!.estimate).toBe('2026-12');

    // 평소 쓰는 돈이 크면 늦어져요: 지난 6개월 동안 매달 이벤트통장에서 45만씩 썼다면
    const usual = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m, i) =>
      expense({ id: `u${i}`, date: `${m}-10`, amount: 450_000, accountId: 'event', categoryId: 'cat-gift' }),
    );
    const heavy = scenario();
    heavy.expenses = [...heavy.expenses, ...usual];
    heavy.accounts = heavy.accounts.map((a) => (a.id === 'event' ? { ...a, openingBalance: 100_000 + 2_700_000 } : a));
    const later = computeSettlement(heavy, TODAY).carry[0]!.estimate;
    expect(later === null || later > '2026-12').toBe(true);
  });

  it('[지급했어요] 사람별 · [모두 지급했어요]: claim:<지출id> 이체라 다시 해도 하나, 잔액이 맞아요', () => {
    const d = scenario();
    const s = computeSettlement(d, TODAY);
    const garam = s.pay.find((g) => g.name === '가람')!;
    const once = withTransfers(d, settleRows(d, ids([garam])));
    const after = computeSettlement(once, TODAY);
    expect(after.pay.map((g) => g.name)).toEqual(['나래']);
    // 다시 눌러도(같은 키를 덮어써도) 하나만
    const ids2 = settleRows(once, ids([garam]));
    expect(ids2).toEqual([]);
    // 가람이 낸 돈(−32만)이 돌아와 제자리. 남은 건 아직 안 받은 저수지 몫 12만
    expect(accountBalance(d, 'inc-a', TODAY)).toBe(-440_000);
    expect(accountBalance(once, 'inc-a', TODAY)).toBe(-120_000);
    expect(accountBalance(once, 'event', TODAY)).toBe(100_000 - 320_000);
    // 지급한 만큼 지급할 수 있는 돈이 줄고, 넘어가는 돈은 그대로
    expect(after.payable).toBe(500_000 - 320_000);
    expect(after.carry.map((g) => g.amount)).toEqual([350_000]);

    const all = withTransfers(once, settleRows(once, ids(after.pay)));
    const done = computeSettlement(all, TODAY);
    expect(done.pay).toEqual([]);
    expect(done.carryTotal).toBe(350_000);
    expect(done.spare).toBe(180_000);
  });

  it('[저수지에서 빌려 지급]: 저수지 −, 낸 사람 +, 이벤트통장 그대로, 저수지에 갚을 돈이 생겨요', () => {
    const d = scenario();
    const s = computeSettlement(d, TODAY);
    const before = allBalances(d, TODAY);
    const borrowed = withTransfers(d, settleRows(d, ids(s.carry), { borrow: true }));
    const after = allBalances(borrowed, TODAY);
    expect(after.res).toBe(before.res! - 350_000);
    expect(after['inc-b']).toBe(before['inc-b']! + 350_000);
    expect(after.event).toBe(before.event);
    const s2 = computeSettlement(borrowed, TODAY);
    expect(s2.carry).toEqual([]);
    expect(s2.loan.balance).toBe(350_000);
    expect(s2.loan.entries.map((e) => [e.kind, e.expenseId])).toEqual([['claim', 'c2']]);
    expect(isClaimPaidFromReservoir(borrowed, 'c2')).toBe(true);
    expect(claimMessageFor(borrowed, borrowed.expenses.find((e) => e.id === 'c2')!, TODAY)).toBe('나래에게 저수지에서 돌려줬어요');
    // 예측: 돌려준 청구가 빠지고, 빌린 돈은 이체로 한 번만
    const p1 = projectEventAccount(d, TODAY).months[0]!;
    const p2 = projectEventAccount(borrowed, TODAY).months[0]!;
    expect(p2.claims ?? 0).toBe((p1.claims ?? 0) - 350_000);
    expect(p2.endBalance).toBe(p1.endBalance + 350_000);
  });

  it('저수지통장 청구는 저수지 몫: 이벤트통장 한도와 상관없고, 저수지에서 돌려줘도 빌린 돈이 아니에요', () => {
    const d = scenario();
    const s = computeSettlement(d, TODAY);
    expect(ids(s.reservoir)).toEqual(['r1', 'r2']);
    const paid = withTransfers(d, settleRows(d, ids(s.reservoir)));
    expect(paid.transfers.every((t) => t.fromAccountId === 'res')).toBe(true);
    const s2 = computeSettlement(paid, TODAY);
    expect(s2.reservoir).toEqual([]);
    expect(s2.loan.balance).toBe(0);
    expect(s2.payable).toBe(s.payable);
    expect(isClaimPaidFromReservoir(paid, 'r1')).toBe(true);
    expect(accountBalance(paid, 'res', TODAY)).toBe(5_000_000 - 120_000);
  });

  it('가져온 저수지 청구 13건(낸 사람 한 명)은 저수지 그룹 한 줄로 모여요', () => {
    const rows = Array.from({ length: 13 }, (_, i) =>
      claim(`imp:x:exp:${i}`, { amount: 10_000 * (i + 1), date: `2026-0${(i % 9) + 1}-0${(i % 9) + 1}`, accountId: 'res', paidBy: '다온', claimAccountId: null, claimDue: '2026-10-01' }),
    );
    const d = ledger({ expenses: rows });
    const s = computeSettlement(d, TODAY);
    expect(s.reservoir).toHaveLength(1);
    expect(s.reservoir[0]).toMatchObject({ name: '다온', amount: 910_000 });
    expect(s.reservoir[0]!.claims).toHaveLength(13);
    expect(s.pay).toEqual([]);
    expect(s.carry).toEqual([]);
    const groups = claimsBySource(d, pendingClaims(d, TODAY));
    expect(groups.shared).toEqual([]);
    expect(groups.reservoir.map((g) => [g.name, g.amount])).toEqual([['다온', 910_000]]);
  });

  it('돌려줄 날이 된 청구가 없으면 홈에 보이지 않아요 (dueNow)', () => {
    const d = ledger({ expenses: [claim('later', { amount: 10_000, date: '2026-11-09', claimDue: '2026-12-21' })] });
    const s = computeSettlement(d, TODAY);
    expect(s.dueNow).toBe(false);
    expect(s.upcoming).toHaveLength(1);
  });
});

describe('저수지에서 빌린 돈 · 갚기', () => {
  it('갚을 돈 = 빌린 이체(loan:) − 갚은 이체(loanpay:), 지운 이체는 세지 않아요', () => {
    const d = ledger({
      transfers: [
        transfer({ id: claimLoanTransferId('x'), date: '2026-10-21', amount: 300_000, fromAccountId: 'res', toAccountId: 'event' }),
        transfer({ id: expenseLoanTransferId('y'), date: '2026-09-01', amount: 200_000, fromAccountId: 'res', toAccountId: 'event' }),
        transfer({ id: loanRepayId('2026-10'), date: '2026-10-25', amount: 100_000, fromAccountId: 'event', toAccountId: 'res' }),
        transfer({ id: loanRepayId('2026-09'), date: '2026-09-25', amount: 999_000, fromAccountId: 'event', toAccountId: 'res', deleted: true }),
      ],
    });
    const l = loanStatus(d, TODAY);
    expect(l.borrowed).toBe(500_000);
    expect(l.repaid).toBe(100_000);
    expect(l.balance).toBe(400_000);
    expect(l.repaidThisMonth).toBeNull();
  });

  it('넘어가는 청구가 없고 남는 돈이 있으면 갚기 제안: min(갚을 돈, 남는 돈, 3개월 예상 잔액), 천 원 내림', () => {
    const loanRow = transfer({ id: claimLoanTransferId('old'), date: '2026-10-21', amount: 1_000_000, fromAccountId: 'res', toAccountId: 'event' });
    // 청구 없이: 잔액 110만(빌린 돈 포함) → 정산일 160만, 일정 10만 → 남는 돈 150만
    const d = ledger({
      accounts: [incomeA, incomeB, fixedAcc, { ...eventAcc, openingBalance: 100_000 }, reservoirAcc],
      events: [event({ date: '2026-11-28', amount: 100_000, accountId: 'event' })],
      transfers: [loanRow],
    });
    const s = computeSettlement(d, TODAY);
    expect(s.spare).toBe(1_500_000);
    const safe = Math.min(...projectEventAccount(d, TODAY).months.slice(0, 4).map((m) => m.endBalance));
    const expected = Math.min(1_000_000, 1_500_000, safe);
    expect(s.repay).toEqual({ amount: expected >= 1_000_000 ? 1_000_000 : Math.floor(expected / 1000) * 1000, month: '2026-11' });

    // 갚으면 갚을 돈이 줄고 이번 달은 더 묻지 않아요. 다시 기록해도 loanpay:<월> 하나
    const repaid = withTransfers(d, [
      transfer({ id: loanRepayId('2026-11'), date: TODAY, amount: s.repay!.amount, fromAccountId: 'event', toAccountId: 'res' }),
    ]);
    const s2 = computeSettlement(repaid, TODAY);
    expect(s2.loan.balance).toBe(1_000_000 - s.repay!.amount);
    expect(s2.loan.repaidThisMonth?.amount).toBe(s.repay!.amount);
    expect(s2.repay).toBeNull();
    expect(accountBalance(repaid, 'res', TODAY)).toBe(accountBalance(d, 'res', TODAY) + s.repay!.amount);
    // 갚은 뒤 3개월 예상 잔액이 0 아래로 내려가지 않아요
    expect(projectEventAccount(repaid, TODAY).months.slice(0, 4).every((m) => m.endBalance >= 0)).toBe(true);
  });

  it('넘어가는 청구가 있거나 예측이 모자라면 갚기 제안이 없어요', () => {
    const loanRow = transfer({ id: claimLoanTransferId('old'), date: '2026-10-21', amount: 100_000, fromAccountId: 'res', toAccountId: 'event' });
    expect(computeSettlement(scenario({ transfers: [loanRow] }), TODAY).repay).toBeNull();
    const short = ledger({
      transfers: [loanRow],
      events: [event({ date: '2027-01-10', amount: 5_000_000, accountId: 'event' })],
    });
    expect(computeSettlement(short, TODAY).repay).toBeNull();
  });

  it('갚을 돈으로 바꿀 수 있는 지출: 저수지에서 나간 이벤트 카테고리 · 일정 · 여행 지출 (청구 · 다른 카테고리 제외)', () => {
    const d = ledger({
      expenses: [
        expense({ id: 'gift', date: '2026-07-01', amount: 300_000, accountId: 'res', categoryId: 'cat-gift' }),
        expense({ id: 'food', date: '2026-07-02', amount: 20_000, accountId: 'res', categoryId: 'cat-food' }),
        expense({ id: 'linked', date: '2026-06-01', amount: 50_000, accountId: 'res', eventId: 'ev-x' }),
        claim('claimed', { amount: 70_000, date: '2026-07-03', accountId: 'res', categoryId: 'cat-gift' }),
        expense({ id: 'ev', date: '2026-07-04', amount: 10_000, accountId: 'event', categoryId: 'cat-gift' }),
      ],
    });
    expect(loanCandidates(d).map((e) => e.id)).toEqual(['linked', 'gift']);
  });

  it('바꾸기: 지출을 이벤트통장으로 옮기고 loan:<지출id> 이체 → 잔액은 그대로, 갚을 돈 +금액, 평소 쓰는 돈 기록에 들어가요', () => {
    const gift = expense({ id: 'gift', date: '2026-07-01', amount: 300_000, accountId: 'res', categoryId: 'cat-gift' });
    const d = ledger({ expenses: [gift] });
    const converted: LedgerData = {
      ...d,
      expenses: [{ ...gift, accountId: 'event' }],
      transfers: [transfer({ id: expenseLoanTransferId('gift'), date: gift.date, amount: 300_000, fromAccountId: 'res', toAccountId: 'event' })],
    };
    expect(allBalances(converted, TODAY)).toEqual(allBalances(d, TODAY));
    expect(loanStatus(converted, TODAY).balance).toBe(300_000);
    expect(loanCandidates(converted)).toEqual([]);
    expect(projectEventAccount(converted, TODAY).months.some((m) => m.usual > 0)).toBe(true);
  });

  it('지출을 고치면 빌린 이체가 따라가요: 금액 · 날짜, 이벤트통장 밖으로 옮기거나 지우면 지워요', () => {
    const gift = expense({ id: 'gift', date: '2026-07-01', amount: 300_000, accountId: 'event' });
    const loanRow = transfer({ id: expenseLoanTransferId('gift'), date: gift.date, amount: 300_000, fromAccountId: 'res', toAccountId: 'event' });
    const d = ledger({ expenses: [gift], transfers: [loanRow] });
    const at = '2026-11-10T00:00:00.000Z';
    expect(followLoanTransfers(d, { ...gift, amount: 250_000, updatedAt: at })[0]).toMatchObject({ amount: 250_000, deleted: false });
    expect(followLoanTransfers(d, { ...gift, accountId: 'res', updatedAt: at })[0]).toMatchObject({ deleted: true, updatedAt: at });
    expect(followLoanTransfers(d, { ...gift, deleted: true, updatedAt: at })[0]).toMatchObject({ deleted: true });
    expect(followLoanTransfers(d, { ...gift, memo: '바뀜', updatedAt: at })).toEqual([]);

    const c = claim('c', { amount: 100_000, date: '2026-10-01' });
    const viaClaim = transfer({ id: claimLoanTransferId('c'), date: TODAY, amount: 100_000, fromAccountId: 'res', toAccountId: 'event' });
    const d2 = ledger({ expenses: [c], transfers: [viaClaim] });
    expect(followLoanTransfers(d2, { ...c, amount: 90_000, updatedAt: at })[0]).toMatchObject({ amount: 90_000 });
  });
});

describe('하나씩 고르기 (정산 카드 항목 목록)', () => {
  it('처음 골라 둔 것 = 이번 달 지급으로 나눈 청구 + 돌려줄 날이 된 저수지 청구', () => {
    const s = computeSettlement(scenario(), TODAY);
    expect([...defaultSettlementSelection(s)].sort()).toEqual(['c1', 'c3', 'f1', 'r1', 'r2']);
    const check = checkSettlementSelection(scenario(), s, defaultSettlementSelection(s));
    expect(check).toMatchObject({ eventTotal: 320_000, excess: 0, fits: true, over: [] });
    expect(check.total).toBe(200_000 + 120_000 + 30_000 + 80_000 + 40_000);
  });

  it('넘어가는 청구까지 고르면 지급할 수 있는 돈보다 많아 넘는 금액과 빌려 줄 청구를 알려 줘요', () => {
    const d = scenario();
    const s = computeSettlement(d, TODAY);
    const check = checkSettlementSelection(d, s, ['c1', 'c2', 'c3']);
    expect(check.eventTotal).toBe(670_000);
    expect(check.excess).toBe(350_000);
    expect(check.fits).toBe(false);
    expect(check.over).toEqual(['c2']);
    expect(check.within).toEqual(['c1', 'c3']);
    // 고른 것을 바꾸면 다시 맞아요 (고정지출 · 저수지 청구는 한도와 견주지 않아요)
    expect(checkSettlementSelection(d, s, ['c2', 'c3', 'f1', 'r1']).fits).toBe(true);
  });

  it('한 건만 지급하면 그 청구만 빠지고 같은 사람의 다른 청구는 남아요 (claim:<id> 이체 하나, 다시 넣어도 하나)', () => {
    const d = scenario();
    const rows = settleRows(d, ['c3']);
    expect(rows.map((r) => r.id)).toEqual([claimTransferId('c3')]);
    const after = computeSettlement(withTransfers(d, rows), TODAY);
    expect(ids(after.pay)).toEqual(['c1', 'f1']);
    expect(after.pay.find((g) => g.name === '가람')!.amount).toBe(200_000);
    // 같은 키로 다시 써도(upsert) 한 번만 빠져요
    const twice = computeSettlement(withTransfers(d, rows), TODAY);
    expect(twice.payTotal).toBe(after.payTotal);
  });
});

describe('저수지통장 이벤트 청구 = 저수지에서 빌린 돈', () => {
  // 이벤트통장에 돈이 없어 저수지 돈으로 낸 경조사 청구 (다온) + 저수지에서 지급할 청구(이벤트 아닌 카테고리)
  const resEvent = (id: string, amount: number, date: string) =>
    claim(id, { amount, date, accountId: 'res', categoryId: 'cat-gift', paidBy: '나래', claimDue: date });
  const data = () =>
    ledger({
      expenses: [
        resEvent('re1', 300_000, '2026-08-01'),
        resEvent('re2', 150_000, '2026-09-01'),
        claim('rn1', { amount: 40_000, date: '2026-08-05', accountId: 'res', categoryId: 'cat-food', claimDue: '2026-08-05' }),
      ],
    });

  it('이벤트 카테고리 청구는 저수지에서 빌려 지급, 나머지는 저수지에서 지급으로 나눠요', () => {
    const d = data();
    const s = computeSettlement(d, TODAY);
    expect(s.reservoirLoan.map((g) => [g.name, g.amount, g.claims.length])).toEqual([['나래', 450_000, 2]]);
    expect(s.reservoirLoanTotal).toBe(450_000);
    expect(s.reservoir.map((g) => [g.name, g.amount])).toEqual([['가람', 40_000]]);
    expect(s.dueNow).toBe(true);
    expect([...defaultSettlementSelection(s)].sort()).toEqual(['re1', 're2', 'rn1']);
    // 빌려 지급할 청구는 지급할 수 있는 돈과 견주지 않아요
    expect(checkSettlementSelection(d, s, ['re1', 're2']).fits).toBe(true);
    const groups = claimsBySource(d, pendingClaims(d, TODAY));
    expect(groups.reservoirLoan.map((g) => g.name)).toEqual(['나래']);
    expect(groups.reservoir.map((g) => g.name)).toEqual(['가람']);
  });

  it('평소 쓰는 돈 기록에 이벤트통장 지출로 들어가요', () => {
    const h = usualHistory(data(), 'event');
    expect(h.byMonth.get('2026-08')?.get('cat-gift')).toBe(300_000);
    expect(h.byMonth.get('2026-09')?.get('cat-gift')).toBe(150_000);
    expect(h.byMonth.get('2026-08')?.get('cat-food')).toBeUndefined();
  });

  it('지급: 지출을 이벤트통장으로 옮기고 빌린 이체 + 돌려준 이체 → 저수지에 갚을 돈이 늘고 이벤트통장 잔액은 그대로', () => {
    const d = data();
    const before = allBalances(d, TODAY);
    const moved: LedgerData = {
      ...d,
      expenses: d.expenses.map((e) => (e.id === 're1' ? { ...e, accountId: 'event' } : e)),
    };
    const paid = withTransfers(moved, settleRows(moved, ['re1'], { borrow: true }));
    const after = allBalances(paid, TODAY);
    expect(after.res).toBe(before.res! - 300_000);
    expect(after.event).toBe(before.event);
    expect(after['inc-b']).toBe(before['inc-b']! + 300_000);
    expect(loanStatus(paid, TODAY).balance).toBe(300_000);
    const s = computeSettlement(paid, TODAY);
    expect(s.reservoirLoanTotal).toBe(150_000);
  });

  it('저수지에서 이미 돌려준 이벤트 청구를 찾아 갚을 돈으로 바꿀 수 있어요 (바꾼 뒤엔 다시 안 나와요, 잔액 그대로)', () => {
    const d0 = data();
    const settled = withTransfers(d0, settleRows(d0, ['re1', 're2', 'rn1'], { date: '2026-09-21' }));
    expect(settledReservoirEventClaims(settled).map((e) => e.id)).toEqual(['re1', 're2']);
    const before = allBalances(settled, TODAY);
    // 바꾸기 (상태 계층과 같은 모양): 지출 → 이벤트통장, 돌려준 이체 → 이벤트통장에서, 빌린 이체 추가
    const converted: LedgerData = {
      ...settled,
      expenses: settled.expenses.map((e) => (e.id === 're1' || e.id === 're2' ? { ...e, accountId: 'event' } : e)),
      transfers: [
        ...settled.transfers.map((t) => (t.id === claimTransferId('re1') || t.id === claimTransferId('re2') ? { ...t, fromAccountId: 'event' } : t)),
        transfer({ id: claimLoanTransferId('re1'), date: '2026-09-21', amount: 300_000, fromAccountId: 'res', toAccountId: 'event' }),
        transfer({ id: claimLoanTransferId('re2'), date: '2026-09-21', amount: 150_000, fromAccountId: 'res', toAccountId: 'event' }),
      ],
    };
    expect(allBalances(converted, TODAY)).toEqual(before);
    expect(loanStatus(converted, TODAY).balance).toBe(450_000);
    expect(settledReservoirEventClaims(converted)).toEqual([]);
  });
});

describe('정산 화면 · 한 줄 요약 (settleRoster · settlementSummary · planSettlement)', () => {
  // 가람: 이벤트통장 청구 2건(하나는 넘어가요) · 나래: 저수지 돈으로 낸 이벤트 청구 · 생활비 청구(정산일 전)
  const data = () =>
    ledger({
      expenses: [
        claim('e1', { amount: 300_000, date: '2026-10-01' }),
        claim('e2', { amount: 900_000, date: '2026-10-02' }),
        claim('re1', { amount: 24_000, date: '2026-10-03', accountId: 'res', categoryId: 'cat-gift', paidBy: '나래', claimDue: '2026-10-03' }),
        claim('f1', { amount: 10_000, date: '2026-11-09', accountId: 'fixed', categoryId: 'cat-food', paidBy: '나래', claimDue: '2026-12-21' }),
      ],
    });

  it('사람마다 한 목록으로 묶고 항목마다 종류를 붙여요 (저수지는 받는 사람이 아니에요)', () => {
    const s = computeSettlement(data(), TODAY);
    const roster = settleRoster(s);
    expect(roster.map((p) => p.name)).toEqual(['가람', '나래']);
    expect(roster[0]!.items.map((i) => [i.claim.expense.id, i.kind])).toEqual([['e1', 'pay'], ['e2', 'carry']]);
    expect(roster[1]!.items.map((i) => [i.claim.expense.id, i.kind])).toEqual([['re1', 'borrow'], ['f1', 'upcoming']]);
    expect(roster[1]!.amount).toBe(34_000);
  });

  it('한 줄 요약: 이번 달 줄 돈 = 처음 골라 둔 것, 사람은 많은 순 · 넘어가는 돈과 지급 예상 달', () => {
    const s = computeSettlement(data(), TODAY);
    const sum = settlementSummary(s);
    expect(sum.total).toBe(324_000);
    expect(sum.people).toEqual([{ name: '가람', amount: 300_000 }, { name: '나래', amount: 24_000 }]);
    expect(sum.date).toBe('2026-11-21');
    expect(sum.carry?.amount).toBe(900_000);
    expect(sum.next).toEqual({ date: '2026-12-21', amount: 10_000 });
    expect(sum.hasClaims).toBe(true);
  });

  it('줄 돈이 없으면 total 0 과 다음 정산일, 청구가 없으면 hasClaims false', () => {
    const only = ledger({ expenses: [claim('f1', { amount: 10_000, date: '2026-11-09', accountId: 'fixed', categoryId: 'cat-food', claimDue: '2026-12-21' })] });
    const sum = settlementSummary(computeSettlement(only, TODAY));
    expect(sum.total).toBe(0);
    expect(sum.next).toEqual({ date: '2026-12-21', amount: 10_000 });
    expect(settlementSummary(computeSettlement(ledger(), TODAY)).hasClaims).toBe(false);
  });

  it('고른 것 나누기: 저수지 이벤트 청구는 늘 빌려 지급, 한도를 넘는 이벤트통장 청구는 over', () => {
    const d = data();
    const s = computeSettlement(d, TODAY);
    const fit = planSettlement(d, s, ['e1', 're1']);
    expect(fit).toMatchObject({ settle: ['e1'], over: [], borrow: ['re1'], total: 324_000, fits: true });
    const over = planSettlement(d, s, ['e1', 'e2', 're1', 'f1']);
    expect(over.fits).toBe(false);
    expect(over.excess).toBe(900_000);
    expect(over.over).toEqual(['e2']);
    expect([...over.settle].sort()).toEqual(['e1', 'f1']);
    expect(over.borrow).toEqual(['re1']);
    expect(over.claims.map((c) => c.expense.id)).toEqual(['e1', 'e2', 're1', 'f1']);
  });
});

describe('이벤트통장이 모자라거나 줄 수 있는 돈보다 많이 고를 때', () => {
  /** 이벤트통장 시작 잔액만 바꾼 정산 예시 (21일 50만 적립 · 28일 일정 10만) */
  function withOpening(opening: number, expenses: Expense[]): LedgerData {
    return ledger({
      accounts: [incomeA, incomeB, fixedAcc, { ...eventAcc, openingBalance: opening }, reservoirAcc],
      events: [event({ id: 'ev-nov', date: '2026-11-28', amount: 100_000, accountId: 'event', name: '돌잔치' })],
      expenses,
    });
  }

  it('잔액이 음수면 들어올 돈이 먼저 메우고, 지급할 수 있는 돈이 0 이면 [지급했어요]는 막고 빌려 지급만 돼요', () => {
    const d = withOpening(-450_000, [claim('n1', { amount: 50_000, date: '2026-11-01', claimDue: '2026-11-05' })]);
    const s = computeSettlement(d, TODAY);
    expect(s.recorded).toBe(-450_000);
    expect(s.incoming).toBe(500_000);
    expect(s.incomingOn).toBe('2026-11-21');
    expect(s.available).toBe(50_000);
    expect(s.payable).toBe(0);
    expect(s.shortfall).toBe(450_000);
    expect(shortfallText(s)).toBe('이벤트통장이 450,000원 모자라요');
    expect(settleExplanation(s)).toBe(
      '지갑(이벤트통장)이 45만 모자라고, 21일에 50만 들어와요. 이번 달 일정 10만을 빼면 줄 수 있는 돈은 0원이에요.',
    );
    expect(ids(s.pay)).toEqual([]);
    expect(ids(s.carry)).toEqual(['n1']);

    const plan = planSettlement(d, s, ['n1']);
    expect(plan).toMatchObject({ settle: [], over: ['n1'], fits: false, excess: 50_000 });
    expect(selectionLimitText(s, plan, true)).toBe('이벤트통장에서 줄 수 있는 돈이 없어요 · 나머지 5만은 저수지에서 빌려 줄 수 있어요');
    expect(settleRefusal(d, s, ['n1'])).toBe('이벤트통장에서 줄 수 있는 돈이 없어요. 50,000원은 저수지에서 빌려 지급해 주세요');
  });

  it('일부만 들어가면 들어가는 것만 [지급했어요], 나머지는 저수지에서 빌려서만 줄 수 있어요', () => {
    const d = withOpening(-300_000, [
      claim('a', { amount: 100_000, date: '2026-11-01', claimDue: '2026-11-05' }),
      claim('b', { amount: 250_000, date: '2026-11-02', claimDue: '2026-11-05' }),
    ]);
    const s = computeSettlement(d, TODAY);
    expect(s.payable).toBe(100_000);
    expect(s.shortfall).toBe(300_000);
    const check = checkSettlementSelection(d, s, ['a', 'b']);
    expect(check).toMatchObject({ within: ['a'], over: ['b'], excess: 250_000, withinEventTotal: 100_000, fits: false });
    expect(selectionLimitText(s, check, true)).toBe('이벤트통장에서 줄 수 있는 돈은 10만이에요 · 나머지 25만은 저수지에서 빌려 줄 수 있어요');
    expect(selectionLimitText(s, check, false)).toBe('이벤트통장에서 줄 수 있는 돈은 10만이에요');
    expect(settleRefusal(d, s, ['a'])).toBeNull();
    expect(settleRefusal(d, s, ['a', 'b'])).toBe('이벤트통장에서 줄 수 있는 돈은 100,000원이에요. 넘는 250,000원은 저수지에서 빌려 지급해 주세요');
    // 쉬운 설명
    expect(settleExplanation(s)).toBe(
      '지갑(이벤트통장)이 30만 모자라고, 21일에 50만 들어와요. 이번 달 일정 10만을 빼면 줄 수 있는 돈은 10만이에요.',
    );
    // 잔액이 음수가 아니면 모자란 돈 안내가 없어요
    const ok = computeSettlement(scenario(), TODAY);
    expect(shortfallText(ok)).toBeNull();
    expect(settleExplanation(ok)).toBe('지갑(이벤트통장)에 10만 있고, 21일에 50만 들어와요. 이번 달 일정 10만을 빼면 줄 수 있는 돈은 50만이에요.');
  });
});

describe('지난달에 못 준 청구를 먼저', () => {
  /** 10월 정산일(10/21)에 못 준 청구 o1 · o2, 이번 달 청구 n1. 쓸 수 있는 돈 60만, 이번 달 일정 10만 */
  const d = ledger({
    events: [event({ id: 'ev-nov', date: '2026-11-28', amount: 100_000, accountId: 'event', name: '돌잔치' })],
    expenses: [
      claim('o1', { amount: 400_000, date: '2026-10-01', claimDue: '2026-10-21' }),
      claim('o2', { amount: 150_000, date: '2026-10-05', claimDue: '2026-10-21', paidBy: '나래' }),
      claim('n1', { amount: 50_000, date: '2026-11-01', claimDue: '2026-11-05' }),
    ],
  });

  it('이번 달 일정보다 먼저 쓸 수 있는 돈 전체에서 오래된 순으로 주고, 이번 달 청구는 남은 돈에서 일정을 뺀 만큼만', () => {
    const s = computeSettlement(d, TODAY);
    expect(s.available).toBe(600_000);
    expect(s.oldPay).toBe(550_000);
    expect(s.freshLimit).toBe(0);
    expect(s.payable).toBe(550_000);
    expect(ids(s.pay)).toEqual(['o1', 'o2']);
    expect(ids(s.carry)).toEqual(['n1']);
    // 일정은 막지 않고 모자라는 돈을 알려 줘요
    expect(s.plannedShort).toEqual({ month: '2026-11', amount: 50_000 });
    expect(settleExplanation(s)).toBe(
      '지갑(이벤트통장)에 10만 있고, 21일에 50만 들어와요. 지난달에 못 준 돈 55만을 먼저 돌려줘요. 이 돈을 먼저 돌려주면 11월 일정에 5만이 모자라요.',
    );
    // '지난달부터' 표시
    const all = [...s.pay, ...s.carry].flatMap((g) => g.claims);
    expect(all.filter((c) => isCarriedOverClaim(s, c)).map((c) => c.expense.id)).toEqual(['o1', 'o2']);
    // 예측도 이번 달에 지난달 청구까지 나가는 돈으로 빼서 모자람이 보여요
    const m0 = projectEventAccount(d, TODAY).months[0]!;
    expect(m0.claims).toBe(600_000);
    expect(m0.endBalance).toBe(600_000 - 100_000 - 600_000);
  });

  it('지난달 청구 몫으로 잡아 둔 돈은 이번 달 청구에 쓰지 않아요 (지난달 청구를 빼고 골라도)', () => {
    const s = computeSettlement(d, TODAY);
    expect(checkSettlementSelection(d, s, ['o1', 'o2', 'n1'])).toMatchObject({ within: ['o1', 'o2'], over: ['n1'] });
    expect(checkSettlementSelection(d, s, ['o2', 'n1'])).toMatchObject({ within: ['o2'], over: ['n1'] });
    expect(settleRefusal(d, s, ['n1'])).not.toBeNull();
    expect(settleRefusal(d, s, ['o1', 'o2'])).toBeNull();
  });

  it('지난달 청구를 주고도 일정이 남으면 모자람 없이 이번 달 청구까지 줘요', () => {
    const rich = { ...d, accounts: d.accounts.map((a) => (a.id === 'event' ? { ...a, openingBalance: 300_000 } : a)) };
    const s = computeSettlement(rich, TODAY);
    expect(s.oldPay).toBe(550_000);
    expect(s.freshLimit).toBe(800_000 - 550_000 - 100_000);
    expect(s.plannedShort).toBeNull();
    expect(ids(s.pay).sort()).toEqual(['n1', 'o1', 'o2']);
    expect(settleExplanation(s)).toBe(
      '지갑(이벤트통장)에 30만 있고, 21일에 50만 들어와요. 지난달에 못 준 돈 55만을 먼저 돌려줘요. 이번 달 일정 10만을 빼면 더 줄 수 있는 돈은 15만이에요.',
    );
  });
});
