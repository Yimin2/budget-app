import { describe, expect, it } from 'vitest';
import { allBalances, computeLiving, createDemoLedger, livingByAccount, projectEventAccount } from '@/domain';
import type { Expense, FixedExpense, LedgerData } from '@/domain';
import { allowanceAccountsFor, fixedThisMonth, hasMonthSpent, monthSpent, personAccountsFor } from './monthSpent';

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
    data.fixedExpenses = data.fixedExpenses.filter((f) => f.kind === 'living');
    const s = summary(data, MINJI);
    expect(s).toEqual({ fixed: null, etc: null, allowance: null, event: null });
    expect(hasMonthSpent(s)).toBe(false);
    const zero = {
      fixed: null,
      etc: null,
      allowance: { spent: 0, balance: 0, accountIds: ['a'], href: '/history?tab=accounts' },
      event: { spent: 0, contribution: 0, balance: 0, href: '/plan' },
    };
    expect(hasMonthSpent(zero)).toBe(false);
    expect(hasMonthSpent({ ...zero, event: { ...zero.event, balance: 1 } })).toBe(true);
  });
});

/** 고정비 한 줄 예시 행 */
function bill(id: string, accountId: string, amount: number, day: number, extra: Partial<FixedExpense> = {}): FixedExpense {
  return {
    id, name: id, amount, accountId, categoryId: null, dayOfMonth: day, kind: 'bill', targetEmail: null, spread: 'daily',
    startMonth: '2026-01', endMonth: null, deleted: false, ...extra,
  };
}

describe('fixedThisMonth (고정비 한 줄)', () => {
  // 부부 예시 11월 결제: 민지 회비 3만(5일) · 통신비 6만(15일) · 보험 12만(20일) = 21만
  // 준호 TV 할부 10만(5일) · 회비 3만(5일) · 월세 50만(10일) · 통신비 5.5만(15일) · 보험 15만(20일) = 83.5만
  it('오늘까지 결제가 모두 기록됐으면 낸 돈 = 전체, 남은 결제 0건 (사람별 · 모두 합쳐)', () => {
    const data = couple();
    expect(fixedThisMonth(data, TODAY, MINJI)).toEqual({ paid: 210_000, total: 210_000, remainingCount: 0, href: '/budget#st-fixed' });
    expect(fixedThisMonth(data, TODAY, JUNHO)).toMatchObject({ paid: 835_000, total: 835_000, remainingCount: 0 });
    expect(fixedThisMonth(data, TODAY, null)).toMatchObject({ paid: 1_045_000, total: 1_045_000, remainingCount: 0 });
    expect(summary(data, MINJI).fixed).toEqual(fixedThisMonth(data, TODAY, MINJI));
  });

  it('남은 결제: 결제일이 오늘 뒤인 것만 세고, 낸 돈은 이번 달 자동 기록(지난달 · 미리 갚기 · 직접 기록은 빼요)', () => {
    const data = couple();
    // 15일까지만 기록된 날로 보기: 20일 보험 자동 기록은 아직 없음
    data.expenses = data.expenses.filter((e) => !(e.fixedExpenseId && e.date === '2026-11-20'));
    data.expenses.push(
      { ...expense('prepay:demo-installment-tv:2026-11:0:50000', JUNHO, 50_000, null), fixedExpenseId: 'demo-installment-tv' },
      expense('x-manual', MINJI, 7_000, null),
    );
    const day = '2026-11-15';
    expect(fixedThisMonth(data, day, MINJI)).toMatchObject({ paid: 90_000, total: 210_000, remainingCount: 1 });
    expect(fixedThisMonth(data, day, JUNHO)).toMatchObject({ paid: 685_000, total: 835_000, remainingCount: 1 });
    // 모두 합쳐 = 두 사람 합
    expect(fixedThisMonth(data, day, null)).toMatchObject({ paid: 775_000, total: 1_045_000, remainingCount: 2 });
    // 달 초: 기록 전, 결제 8건 모두 남음 (모두 합쳐 10건)
    data.expenses = data.expenses.filter((e) => !(e.fixedExpenseId && e.date >= '2026-11-01'));
    expect(fixedThisMonth(data, '2026-11-01', JUNHO)).toMatchObject({ paid: 0, total: 835_000, remainingCount: 5 });
    expect(fixedThisMonth(data, '2026-11-01', null)).toMatchObject({ remainingCount: 8 });
  });

  it('세부 항목은 그 결제일에 살아 있는 항목 합, 끝난 할부 · 해지한 고정비 · 다른 사람 통장은 빼요', () => {
    const data = couple();
    data.fixedExpenses.push(
      bill('dues2', MINJI, 999_999, 25, {
        subItems: [
          { name: '목장', amount: 40_000, startDate: null, endDate: null },
          { name: '초원', amount: 30_000, startDate: null, endDate: '2026-11-10' },
        ],
      }),
      bill('gone', MINJI, 50_000, 28, { endDate: '2026-11-10', endMonth: '2026-10' }),
      bill('his', JUNHO, 20_000, 27),
    );
    const mine = fixedThisMonth(data, TODAY, MINJI)!;
    expect(mine).toMatchObject({ paid: 210_000, total: 250_000, remainingCount: 1 });
    expect(fixedThisMonth(data, TODAY, JUNHO)).toMatchObject({ total: 855_000, remainingCount: 1 });
    expect(fixedThisMonth(data, TODAY, null)).toMatchObject({ total: 1_105_000, remainingCount: 2 });
  });

  it('함께 쓰는 통장(주인 없음)의 고정비는 모두 합쳐에만 들어가요', () => {
    const data = couple();
    data.fixedExpenses.push(bill('loan', 'demo-acc-income', 300_000, 25));
    expect(fixedThisMonth(data, TODAY, MINJI)).toMatchObject({ total: 210_000 });
    expect(fixedThisMonth(data, TODAY, null)).toMatchObject({ total: 1_345_000, remainingCount: 1 });
    expect(personAccountsFor(data, MINJI).map((a) => a.id)).toEqual(['demo-acc-living-minji', 'demo-acc-allowance-minji']);
  });

  it('이번 달 결제가 없으면 null 이라 줄을 숨겨요', () => {
    const data = couple();
    data.fixedExpenses = data.fixedExpenses.filter((f) => f.kind === 'living');
    expect(fixedThisMonth(data, TODAY, MINJI)).toBeNull();
    expect(fixedThisMonth(data, TODAY, null)).toBeNull();
    expect(hasMonthSpent({ fixed: { paid: 0, total: 1, remainingCount: 1, href: '/budget#st-fixed' }, etc: null, allowance: null, event: null })).toBe(true);
  });
});
