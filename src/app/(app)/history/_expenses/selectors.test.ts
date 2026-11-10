import { describe, expect, it } from 'vitest';
import { createDemoLedger, createDefaultLedger } from '@/domain';
import type { Expense, LedgerData } from '@/domain/types';
import {
  accountForCategory, activeFilterCount, applyFilter, authorOptions, EMPTY_FILTER, groupByDate, isISODate, linkableEvents,
  livingAccountIdFor, monthBounds, monthExpenses, monthLabel, parseMonthParam, splitTotals,
} from './selectors';

const TODAY = '2026-11-20';
const NOW = '2026-11-20T01:00:00.000Z';

function demo(): LedgerData {
  return createDemoLedger(TODAY, NOW);
}

function expense(over: Partial<Expense>): Expense {
  return {
    id: 'x',
    date: TODAY,
    amount: 1000,
    accountId: 'demo-acc-fixed',
    categoryId: null,
    memo: '',
    eventId: null,
    fixedExpenseId: null,
    author: 'minji@demo',
    createdAt: NOW,
    updatedAt: NOW,
    deleted: false,
    ...over,
  };
}

describe('monthExpenses · groupByDate', () => {
  it('그달 지출만, 최신순, 날짜별 합계', () => {
    const data = demo();
    data.expenses.push(expense({ id: 'gone', deleted: true }), expense({ id: 'oct', date: '2026-10-31' }));
    const list = monthExpenses(data, '2026-11');
    expect(list.every((e) => e.date.startsWith('2026-11') && !e.deleted)).toBe(true);
    expect(list.some((e) => e.id === 'gone' || e.id === 'oct')).toBe(false);
    for (let i = 1; i < list.length; i++) expect(list[i - 1]!.date >= list[i]!.date).toBe(true);

    const groups = groupByDate(list);
    expect(groups[0]!.date).toBe('2026-11-20');
    expect(groups[groups.length - 1]!.date).toBe('2026-11-01');
    for (const g of groups) expect(g.total).toBe(g.items.reduce((s, e) => s + e.amount, 0));
    expect(groups.reduce((s, g) => s + g.items.length, 0)).toBe(list.length);
  });

  it('같은 날은 나중에 기록한 것이 위', () => {
    const list = monthExpenses(
      { ...demo(), expenses: [expense({ id: 'a', createdAt: '2026-11-20T01:00:00Z' }), expense({ id: 'b', createdAt: '2026-11-20T05:00:00Z' })] },
      '2026-11',
    );
    expect(list.map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('splitTotals', () => {
  it('체험 가계부: 고정비 = 자동 기록, 나머지 생활비', () => {
    const data = demo();
    const list = monthExpenses(data, '2026-11');
    const t = splitTotals(data, list, '2026-11');
    const fixed = list.filter((e) => e.fixedExpenseId).reduce((s, e) => s + e.amount, 0);
    // 월세 80만 + 통신비 12만 + 보험 18만 + 용돈 2건 30만
    expect(fixed).toBe(1_400_000);
    expect(t.fixed).toBe(fixed);
    expect(t.living).toBe(t.total - fixed);
    expect(t.event).toBe(0);
    expect(t.other).toBe(0);
    expect(t.count).toBe(list.length);
  });

  it('일정 연결 · 이벤트통장 → 이벤트, 저수지 → 기타', () => {
    const data = demo();
    const list = [
      expense({ id: '1', eventId: 'demo-event-jeju', amount: 100 }),
      expense({ id: '2', accountId: 'demo-acc-event', amount: 200 }),
      expense({ id: '3', accountId: 'demo-acc-reservoir', amount: 400 }),
      expense({ id: '4', amount: 800 }),
    ];
    expect(splitTotals(data, list, '2026-11')).toMatchObject({ event: 300, other: 400, living: 800, fixed: 0, total: 1500 });
  });

  it('개인 가계부: 용돈 통장 지출은 생활비', () => {
    const data = createDefaultLedger('personal', '내 가계부', TODAY, NOW, 'me@x.com', '나');
    const acc = data.accounts[0]!;
    const t = splitTotals(data, [expense({ accountId: acc.id, amount: 5000 })], '2026-11');
    expect(t.living).toBe(5000);
  });
});

describe('livingAccountIdFor · accountForCategory', () => {
  it('생활비 고정지출의 통장', () => {
    expect(livingAccountIdFor(demo(), '2026-11')).toBe('demo-acc-fixed');
  });

  it('카테고리 역할로 통장을 골라요', () => {
    const data = demo();
    const cat = (key: string) => data.categories.find((c) => c.id === `demo-cat-${key}`)!;
    expect(accountForCategory(cat('food'), data.accounts, 'demo-acc-fixed')).toBe('demo-acc-fixed');
    expect(accountForCategory(cat('travel'), data.accounts, 'demo-acc-fixed')).toBe('demo-acc-event');
    expect(accountForCategory(null, data.accounts, 'demo-acc-fixed')).toBe('demo-acc-fixed');
    // 이벤트 통장이 없으면 기본(생활비) 통장
    const noEvent = data.accounts.map((a) => (a.role === 'event' ? { ...a, deleted: true } : a));
    expect(accountForCategory(cat('travel'), noEvent, 'demo-acc-fixed')).toBe('demo-acc-fixed');
  });

  it('개인 가계부: 용돈 통장', () => {
    const data = createDefaultLedger('personal', '내 가계부', TODAY, NOW, 'me@x.com', '나');
    expect(accountForCategory(data.categories[0], data.accounts, null)).toBe(data.accounts[0]!.id);
    expect(accountForCategory(null, data.accounts, null)).toBe(data.accounts[0]!.id);
  });
});

describe('필터', () => {
  it('통장 · 카테고리 · 작성자 · 카테고리 없음', () => {
    const list = [
      expense({ id: '1', categoryId: 'c1', author: 'minji@demo' }),
      expense({ id: '2', categoryId: null, author: 'junho@demo' }),
      expense({ id: '3', categoryId: 'c1', accountId: 'demo-acc-event', author: 'JUNHO@demo' }),
    ];
    const ids = (f: Partial<typeof EMPTY_FILTER>) => applyFilter(list, { ...EMPTY_FILTER, ...f }).map((e) => e.id);
    expect(ids({})).toEqual(['1', '2', '3']);
    expect(ids({ categoryId: 'c1' })).toEqual(['1', '3']);
    expect(ids({ categoryId: 'none' })).toEqual(['2']);
    expect(ids({ author: 'junho@demo' })).toEqual(['2', '3']);
    expect(ids({ accountId: 'demo-acc-event', author: 'junho@demo' })).toEqual(['3']);
    expect(activeFilterCount({ accountId: 'a', categoryId: 'none', author: null })).toBe(2);
  });

  it('작성자 목록: 멤버 먼저, 그다음 멤버가 아닌 작성자', () => {
    const data = demo();
    const opts = authorOptions(data, [expense({ author: 'guest@x.com' }), expense({ author: 'MINJI@demo' })]);
    expect(opts).toEqual([
      { email: 'minji@demo', name: '민지' },
      { email: 'junho@demo', name: '준호' },
      { email: 'guest@x.com', name: 'guest' },
    ]);
  });
});

describe('달 고르기', () => {
  it('범위는 지출이 있는 달과 이번 달', () => {
    const data = demo();
    expect(monthBounds(data, TODAY)).toEqual({ min: '2026-11', max: '2026-11' });
    data.expenses.push(expense({ id: 'a', date: '2026-08-02' }), expense({ id: 'b', date: '2027-01-02' }), expense({ id: 'c', date: '2025-01-01', deleted: true }));
    expect(monthBounds(data, TODAY)).toEqual({ min: '2026-08', max: '2027-01' });
  });

  it('문구 · 주소 값', () => {
    expect(monthLabel('2026-03')).toBe('2026년 3월');
    expect(parseMonthParam('2026-03')).toBe('2026-03');
    expect(parseMonthParam('2026-13')).toBeNull();
    expect(parseMonthParam(null)).toBeNull();
  });
});

describe('기타', () => {
  it('연결할 수 있는 일정: 예정 + 지금 연결된 일정, 날짜순', () => {
    const data = demo();
    data.events[0] = { ...data.events[0]!, status: 'done' };
    expect(linkableEvents(data, null).some((e) => e.id === data.events[0]!.id)).toBe(false);
    const withCurrent = linkableEvents(data, data.events[0]!.id);
    expect(withCurrent[0]!.id).toBe(data.events[0]!.id);
    for (let i = 1; i < withCurrent.length; i++) expect(withCurrent[i - 1]!.date <= withCurrent[i]!.date).toBe(true);
  });

  it('날짜 확인', () => {
    expect(isISODate('2026-02-28')).toBe(true);
    expect(isISODate('2026-02-30')).toBe(false);
    expect(isISODate('2026-2-3')).toBe(false);
    expect(isISODate('')).toBe(false);
  });
});
