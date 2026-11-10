import { describe, expect, it } from 'vitest';
import { account, emptyLedger, event, expense, rule, transfer } from './_fixtures';
import { accountBalance } from './balances';
import {
  DEFAULT_SETTLE_DAY, claimAccountFor, claimMessage, claimMessageFor, claimPayers, claimTransferId, computeClaimDue,
  isClaimSettled, nextSettleDate, pendingClaims, settleDayOf, summarizeClaims, withSubject,
} from './claims';
import { projectEventAccount } from './events';
import { computeLiving } from './living';
import type { Expense, LedgerData } from './types';

const TODAY = '2026-11-09';

const incomeGaram = account('income', { id: 'inc-g', name: '가람 수입통장', ownerName: '가람', order: 0 });
const incomeNarae = account('income', { id: 'inc-m', name: '나래 수입통장', ownerName: '나래', order: 1 });
const fixedAcc = account('fixed', { id: 'fixed', openingBalance: 1_000_000, order: 2 });
const eventAcc = account('event', { id: 'event', openingBalance: 100_000, order: 3 });

function ledger(p: Partial<LedgerData> = {}): LedgerData {
  return emptyLedger({ accounts: [incomeGaram, incomeNarae, fixedAcc, eventAcc], ...p });
}

function claim(p: Partial<Expense> & Pick<Expense, 'amount' | 'accountId'>): Expense {
  return expense({ date: TODAY, paidBy: '가람', claimAccountId: 'inc-g', claimDue: null, ...p });
}

describe('정산일 (다음 월급날)', () => {
  it('규칙이 없으면 21일', () => {
    expect(settleDayOf(ledger())).toBe(DEFAULT_SETTLE_DAY);
    expect(nextSettleDate(ledger(), TODAY)).toBe('2026-11-21');
  });

  it('수입통장 → 이벤트통장 매달 배분이 있으면 그 이체일', () => {
    const d = ledger({ rules: [rule({ fromAccountId: 'inc-g', toAccountId: 'event', amount: 300_000, dayOfMonth: 25 })] });
    expect(settleDayOf(d, '2026-11')).toBe(25);
    expect(nextSettleDate(d, TODAY)).toBe('2026-11-25');
  });

  it('설정의 정산일이 가장 먼저', () => {
    const d = ledger({
      settings: { ...emptyLedger().settings, settleDay: 10 },
      rules: [rule({ fromAccountId: 'inc-g', toAccountId: 'event', amount: 300_000, dayOfMonth: 25 })],
    });
    expect(settleDayOf(d)).toBe(10);
  });

  it('그날이 지났으면 다음 달, 같은 날은 sameDay 에 따라', () => {
    const d = ledger();
    expect(nextSettleDate(d, '2026-11-21')).toBe('2026-11-21');
    expect(nextSettleDate(d, '2026-11-21', false)).toBe('2026-12-21');
    expect(nextSettleDate(d, '2026-11-25')).toBe('2026-12-21');
  });

  it('말일보다 큰 날은 말일', () => {
    const d = ledger({ settings: { ...emptyLedger().settings, settleDay: 31 } });
    expect(nextSettleDate(d, '2027-02-03')).toBe('2027-02-28');
  });
});

describe('새 청구의 정산일', () => {
  it('이벤트통장 잔액 − 다른 청구가 감당하면 오늘', () => {
    const d = ledger({ expenses: [claim({ id: 'c1', amount: 40_000, accountId: 'event' })] });
    expect(computeClaimDue(d, { accountId: 'event', amount: 60_000 }, TODAY)).toBe(TODAY);
  });

  it('감당하지 못하면 다음 월급날', () => {
    const d = ledger({ expenses: [claim({ id: 'c1', amount: 60_000, accountId: 'event' })] });
    expect(computeClaimDue(d, { accountId: 'event', amount: 50_000 }, TODAY)).toBe('2026-11-21');
  });

  it('고칠 때는 자기 자신을 다른 청구로 세지 않는다', () => {
    const d = ledger({ expenses: [claim({ id: 'c1', amount: 90_000, accountId: 'event' })] });
    expect(computeClaimDue(d, { accountId: 'event', amount: 90_000, expenseId: 'c1' }, TODAY)).toBe(TODAY);
  });

  it('보통 지출을 청구로 바꿀 때 그 지출이 잔액에서 빠진 채로 세지 않는다', () => {
    // 시작 100,000 − 보통 지출 60,000 = 40,000 이지만, 청구가 되면 이 지출은 잔액을 줄이지 않는다 → 100,000 으로 감당
    const d = ledger({ expenses: [expense({ id: 'x1', date: TODAY, amount: 60_000, accountId: 'event' })] });
    expect(accountBalance(d, 'event', TODAY)).toBe(40_000);
    expect(computeClaimDue(d, { accountId: 'event', amount: 60_000, expenseId: 'x1' }, TODAY)).toBe(TODAY);
  });

  it('고정지출통장(생활비) 지출은 잔액과 상관없이 다음 월급날', () => {
    expect(computeClaimDue(ledger(), { accountId: 'fixed', amount: 10_000 }, TODAY)).toBe('2026-11-21');
  });
});

describe('아직 안 돌려준 청구', () => {
  const base = () =>
    ledger({
      expenses: [
        claim({ id: 'c1', amount: 50_000, accountId: 'event', claimDue: '2026-11-09' }),
        claim({ id: 'c2', amount: 30_000, accountId: 'fixed', claimDue: '2026-11-21', paidBy: '나래', claimAccountId: 'inc-m' }),
        claim({ id: 'c3', amount: 20_000, accountId: 'fixed', claimDue: '2026-11-21' }),
        claim({ id: 'gone', amount: 99_000, accountId: 'fixed', deleted: true }),
        expense({ id: 'plain', date: TODAY, amount: 7_000, accountId: 'fixed' }),
      ],
    });

  it('사람별 합 · 다음 정산일 · 오늘 돌려줄 것', () => {
    const s = summarizeClaims(base(), TODAY);
    expect(s.total).toBe(100_000);
    expect(s.byPayer).toEqual([
      { name: '가람', amount: 70_000 },
      { name: '나래', amount: 30_000 },
    ]);
    expect(s.nextDue).toBe('2026-11-09');
    expect(s.dueNow.map((c) => c.expense.id)).toEqual(['c1']);
  });

  it('claim:<지출id> 이체가 있으면 돌려준 것, 지우면 다시 남는다', () => {
    const settle = transfer({ id: claimTransferId('c1'), date: TODAY, amount: 50_000, fromAccountId: 'event', toAccountId: 'inc-g' });
    const d = base();
    d.transfers.push(settle);
    expect(isClaimSettled(d, 'c1')).toBe(true);
    expect(pendingClaims(d, TODAY).map((c) => c.expense.id)).toEqual(['c2', 'c3']);
    settle.deleted = true;
    expect(pendingClaims(d, TODAY).map((c) => c.expense.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('정산일 칸이 비면 지출 날짜 기준 다음 정산일', () => {
    const d = ledger({ expenses: [claim({ id: 'c', amount: 1_000, accountId: 'fixed', date: '2026-11-22' })] });
    expect(pendingClaims(d, TODAY)[0]!.due).toBe('2026-12-21');
  });
});

describe('잔액과 예측 — 두 번 빠지지 않게', () => {
  it('돌려주기 전: 함께 쓰는 통장 잔액은 그대로, 낸 사람 통장에서 빠진다', () => {
    const d = ledger({ expenses: [claim({ id: 'c1', amount: 50_000, accountId: 'event' })] });
    expect(accountBalance(d, 'event', TODAY)).toBe(100_000);
    expect(accountBalance(d, 'inc-g', TODAY)).toBe(-50_000);
  });

  it('돌려준 뒤: 이벤트통장에서 빠지고 낸 사람은 제자리', () => {
    const d = ledger({
      expenses: [claim({ id: 'c1', amount: 50_000, accountId: 'event' })],
      transfers: [transfer({ id: claimTransferId('c1'), date: TODAY, amount: 50_000, fromAccountId: 'event', toAccountId: 'inc-g' })],
    });
    expect(accountBalance(d, 'event', TODAY)).toBe(50_000);
    expect(accountBalance(d, 'inc-g', TODAY)).toBe(0);
  });

  it('낸 사람 통장이 없으면 어느 통장 잔액도 줄지 않는다', () => {
    const d = ledger({ expenses: [claim({ id: 'c1', amount: 50_000, accountId: 'event', paidBy: '손님', claimAccountId: null })] });
    expect(accountBalance(d, 'event', TODAY)).toBe(100_000);
    expect(accountBalance(d, 'inc-g', TODAY)).toBe(0);
  });

  it('예측: 정산일 달에 나갈 돈으로 잡고, 돌려준 뒤에도 그달 말 잔액은 같다', () => {
    const pending = ledger({ expenses: [claim({ id: 'c1', amount: 50_000, accountId: 'event', claimDue: '2026-12-21' })] });
    const p1 = projectEventAccount(pending, TODAY);
    expect(p1.currentBalance).toBe(100_000);
    expect(p1.months[0]!.claims).toBeUndefined();
    expect(p1.months[1]!.claims).toBe(50_000);
    expect(p1.months[1]!.endBalance).toBe(50_000);

    const settled: LedgerData = {
      ...pending,
      transfers: [transfer({ id: claimTransferId('c1'), date: TODAY, amount: 50_000, fromAccountId: 'event', toAccountId: 'inc-g' })],
    };
    const p2 = projectEventAccount(settled, TODAY);
    expect(p2.currentBalance).toBe(50_000);
    expect(p2.months[1]!.claims).toBeUndefined();
    expect(p2.months[1]!.endBalance).toBe(50_000);
  });

  it('지난 정산일의 청구는 이번 달에 나갈 돈', () => {
    const d = ledger({ expenses: [claim({ id: 'c1', amount: 30_000, accountId: 'event', claimDue: '2026-10-21', date: '2026-10-01' })] });
    expect(projectEventAccount(d, TODAY).months[0]!.claims).toBe(30_000);
  });

  it('일정에 연결한 청구: 일정 남은 금액 + 청구 = 예상 금액 (한 번만)', () => {
    const ev = event({ id: 'ev1', date: '2026-12-10', amount: 200_000, accountId: 'event' });
    const d = ledger({
      events: [ev],
      expenses: [claim({ id: 'c1', amount: 80_000, accountId: 'event', eventId: 'ev1', claimDue: '2026-12-21' })],
    });
    const dec = projectEventAccount(d, TODAY).months[1]!;
    expect(dec.planned).toBe(120_000);
    expect(dec.claims).toBe(80_000);
    expect(dec.endBalance).toBe(100_000 - 200_000);
  });

  it('생활비 청구는 바로 항목 예산에 잡힌다 (돌려주기 전에도)', () => {
    const d = ledger({
      fixedExpenses: [
        {
          id: 'food', name: '식비', amount: 300_000, accountId: 'fixed', categoryId: 'cat-food', dayOfMonth: null, kind: 'living',
          targetEmail: null, spread: 'monthly', startMonth: '2026-01', endMonth: null, deleted: false,
        },
      ],
      expenses: [claim({ id: 'c1', amount: 40_000, accountId: 'fixed', categoryId: 'cat-food' })],
    });
    expect(computeLiving(d, TODAY).spent).toBe(40_000);
    expect(accountBalance(d, 'fixed', TODAY)).toBe(1_000_000);
  });
});

describe('낸 사람과 안내 문구', () => {
  it('낸 사람 목록과 돌려받을 통장', () => {
    const d = ledger({ members: [{ email: 'g@x', displayName: '가람' }, { email: 'k@x', displayName: '친구' }] });
    expect(claimPayers(d)).toEqual(['가람', '나래', '친구']);
    expect(claimAccountFor(d, '나래')).toBe('inc-m');
    expect(claimAccountFor(d, '친구')).toBeNull();
  });

  it('오늘 돌려줄 때와 나중에 돌려받을 때', () => {
    expect(claimMessage({ payer: '가람', amount: 50_000, due: TODAY }, TODAY)).toBe('가람에게 50,000원, 오늘 돌려주세요');
    expect(claimMessage({ payer: '가람', amount: 50_000, due: '2026-11-21' }, TODAY)).toBe('가람이 11월 21일에 50,000원 돌려받아요');
    expect(withSubject('나래')).toBe('나래가');
  });

  it('돌려준 청구는 돌려줬다고 알려 준다', () => {
    const e = claim({ id: 'c1', amount: 10_000, accountId: 'fixed' });
    const d = ledger({
      expenses: [e],
      transfers: [transfer({ id: claimTransferId('c1'), date: TODAY, amount: 10_000, fromAccountId: 'fixed', toAccountId: 'inc-g' })],
    });
    expect(claimMessageFor(d, e, TODAY)).toBe('가람에게 돌려줬어요');
    expect(claimMessageFor(d, { ...e, paidBy: null }, TODAY)).toBeNull();
  });
});
