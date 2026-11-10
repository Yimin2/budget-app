import { describe, expect, it } from 'vitest';
import { allBalances, computeLiving, createDemoLedger, livingByAccount, projectEventAccount } from '@/domain';
import type { Expense, LedgerData } from '@/domain';
import { allowanceAccountsFor, hasMonthSpent, monthSpent } from './monthSpent';

const TODAY = '2026-11-20';
const NOW = '2026-11-20T01:00:00.000Z';
const MINJI = 'demo-acc-living-minji';
const JUNHO = 'demo-acc-living-junho';

/** 부부 체험 예시 (사람별 생활비 · 용돈 통장, 여행 숙소 예약금 · 제주 항공권 청구는 이벤트통장) */
function couple(): LedgerData {
  return createDemoLedger(TODAY, NOW, { claims: true, installments: true, trips: true, couple: true });
}

function expense(id: string, accountId: string, amount: number, categoryId: string | null, date = TODAY): Expense {
  return {
    id, date, amount, accountId, categoryId, memo: id, eventId: null, fixedExpenseId: null, author: 'minji@demo',
    createdAt: NOW, updatedAt: NOW, deleted: false,
  };
}

function summary(data: LedgerData, livingAccountId: string | null) {
  const views = livingByAccount(data, TODAY);
  const statuses = livingAccountId ? [views.find((v) => v.accountId === livingAccountId)!.status] : views.map((v) => v.status);
  return monthSpent(data, TODAY, {
    statuses,
    livingAccountId,
    balances: allBalances(data, TODAY),
    eventProjection: projectEventAccount(data, TODAY),
  });
}

describe('allowanceAccountsFor', () => {
  it('생활비 통장 주인의 용돈 통장, 모두 합쳐면 모든 용돈 통장', () => {
    const data = couple();
    expect(allowanceAccountsFor(data, MINJI).map((a) => a.id)).toEqual(['demo-acc-allowance-minji']);
    expect(allowanceAccountsFor(data, JUNHO).map((a) => a.id)).toEqual(['demo-acc-allowance-junho']);
    expect(allowanceAccountsFor(data, null).map((a) => a.id)).toEqual(['demo-acc-allowance-minji', 'demo-acc-allowance-junho']);
  });
  it('용돈 통장이 없으면 빈 목록', () => {
    const data = createDemoLedger(TODAY, NOW);
    expect(allowanceAccountsFor(data, 'demo-acc-fixed')).toEqual([]);
    expect(allowanceAccountsFor(data, null)).toEqual([]);
  });
});

describe('monthSpent', () => {
  it('부부 예시: 기타는 없고, 민지 용돈(청구로 잔액 0원이어도 줄은 보여요) · 이벤트통장(청구는 지출 금액으로)', () => {
    const data = couple();
    const balances = allBalances(data, TODAY);
    const s = summary(data, MINJI);
    expect(s.etc).toBeNull();
    expect(s.allowance).toEqual({
      spent: 0,
      balance: balances['demo-acc-allowance-minji'],
      accountIds: ['demo-acc-allowance-minji'],
      href: '/history?tab=accounts&id=demo-acc-allowance-minji',
    });
    // 숙소 예약금 150,000 + 제주 항공권 청구 300,000 (민지가 개인 돈으로 냈어도 지출 금액으로)
    expect(s.event).toEqual({ spent: 450_000, contribution: 300_000, balance: balances['demo-acc-event'], href: '/plan' });
    expect(hasMonthSpent(s)).toBe(true);
  });

  it('기타(예산 없음): 보이는 사람의 생활비 통장에서 예산 없는 카테고리 · 카테고리 없는 지출만, 고정 자동 기록 · 지난달은 빼요', () => {
    const data = couple();
    data.expenses.push(
      expense('x-gift', MINJI, 20_000, 'demo-cat-gift'),
      expense('x-none', MINJI, 3_400, null),
      expense('x-food', MINJI, 9_000, 'demo-cat-food'),
      expense('x-last', MINJI, 7_000, null, '2026-10-31'),
      { ...expense('x-fixed', MINJI, 5_000, null), fixedExpenseId: 'demo-fixed-minji-dues' },
      expense('x-junho', JUNHO, 1_000, null),
    );
    const mine = summary(data, MINJI);
    expect(mine.etc).toEqual({ amount: 23_400, count: 2, href: `/history?month=2026-11&account=${MINJI}` });
    // 생활비 계산의 기타 묶음과 같은 돈
    const etcItem = computeLiving(data, TODAY, MINJI).items.find((i) => i.unbudgeted)!;
    expect(etcItem.spent).toBe(23_400);
    // 모두 합쳐: 두 사람 합, 통장 필터 없이
    expect(summary(data, null).etc).toEqual({ amount: 24_400, count: 3, href: '/history?month=2026-11' });
  });

  it('용돈: 이번 달 그 통장 지출 합과 잔액, 모두 합쳐면 합', () => {
    const data = couple();
    data.expenses.push(
      expense('a1', 'demo-acc-allowance-minji', 30_000, 'demo-cat-shopping'),
      expense('a2', 'demo-acc-allowance-minji', 10_000, null),
      expense('a3', 'demo-acc-allowance-junho', 5_000, null),
      expense('a-old', 'demo-acc-allowance-minji', 99_000, null, '2026-10-05'),
    );
    const balances = allBalances(data, TODAY);
    expect(summary(data, MINJI).allowance!.spent).toBe(40_000);
    const both = summary(data, null).allowance!;
    expect(both.spent).toBe(45_000);
    expect(both.balance).toBe(balances['demo-acc-allowance-minji']! + balances['demo-acc-allowance-junho']!);
    expect(both.href).toBe('/history?tab=accounts');
  });

  it('통장이 없으면 줄이 없고, 줄이 모두 없거나 0원이면 카드를 숨겨요', () => {
    const data = couple();
    data.accounts = data.accounts.filter((a) => a.role !== 'allowance' && a.role !== 'event');
    const s = summary(data, MINJI);
    expect(s).toEqual({ etc: null, allowance: null, event: null });
    expect(hasMonthSpent(s)).toBe(false);
    const zero = {
      etc: null,
      allowance: { spent: 0, balance: 0, accountIds: ['a'], href: '/history?tab=accounts' },
      event: { spent: 0, contribution: 0, balance: 0, href: '/plan' },
    };
    expect(hasMonthSpent(zero)).toBe(false);
    expect(hasMonthSpent({ ...zero, event: { ...zero.event, balance: 1 } })).toBe(true);
  });
});
