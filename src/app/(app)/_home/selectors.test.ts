import { describe, expect, it } from 'vitest';
import { createDemoLedger, projectEventAccount } from '@/domain';
import type { Account, AccountRole, Category, EventProjection, Expense, ProjectionMonth } from '@/domain';
import {
  accountIdForCategory, accountIdForSource, chartGeometry, errorMessage, expenseTitle, parseAmountParam, recentExpenses,
  shortageBannerText, sourceForCategory, summarizeEventNames, upcomingEvents,
} from './selectors';

const TODAY = '2026-11-20';

function month(m: string, endBalance: number, events: ProjectionMonth['events'] = []): ProjectionMonth {
  return { month: m, startBalance: 0, contributions: 0, transfersIn: 0, transfersOut: 0, planned: 0, extra: 0, endBalance, events };
}

function projection(months: ProjectionMonth[]): EventProjection {
  return {
    accountId: 'ev',
    currentBalance: 600_000,
    monthlyContribution: 300_000,
    months,
    shortages: months.filter((m) => m.endBalance < 0).map((m) => ({ month: m.month, amount: -m.endBalance })),
  };
}

describe('summarizeEventNames', () => {
  it('끝 낱말이 같은 일정은 묶어요', () => {
    expect(summarizeEventNames(['지수 결혼식', '민수 결혼식', '회사 동기 결혼식', '사촌 결혼식', '어버이날'])).toBe('결혼식 4건 · 어버이날');
  });
  it('묶음이 많으면 나머지는 건수로', () => {
    expect(summarizeEventNames(['설날', '제주 여행', '생일', '추석'])).toBe('설날 · 제주 여행 외 2건');
  });
  it('빈 목록은 빈 문자열', () => {
    expect(summarizeEventNames([])).toBe('');
  });
});

describe('upcomingEvents', () => {
  it('날짜순 앞 3개, 지난 예정 일정은 overdue', () => {
    const p = projection([
      month('2026-11', 100, [
        { id: 'a', name: '지난 일정', date: '2026-11-03', amount: 10 },
        { id: 'b', name: '이번 달', date: '2026-11-25', amount: 20 },
      ]),
      month('2026-12', 100, [{ id: 'c', name: '다음 달', date: '2026-12-01', amount: 30 }]),
      month('2027-01', 100, [{ id: 'd', name: '그다음', date: '2027-01-01', amount: 40 }]),
    ]);
    const list = upcomingEvents(p, TODAY, 3);
    expect(list.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(list[0]!.overdue).toBe(true);
    expect(list[1]!.overdue).toBe(false);
  });
  it('반복 일정의 같은 id 다른 회차는 따로 세요', () => {
    const p = projection([
      month('2026-12', 100, [{ id: 'r', name: '월 모임', date: '2026-12-05', amount: 10 }]),
      month('2027-01', 100, [{ id: 'r', name: '월 모임', date: '2027-01-05', amount: 10 }]),
    ]);
    expect(upcomingEvents(p, TODAY).map((e) => e.date)).toEqual(['2026-12-05', '2027-01-05']);
  });
  it('예측이 없으면 빈 목록', () => {
    expect(upcomingEvents(null, TODAY)).toEqual([]);
  });
});

describe('shortageBannerText', () => {
  it('첫 부족 달 · 금액 · 일정 요약', () => {
    const p = projection([
      month('2026-11', 100),
      month('2027-05', -300_000, [
        { id: 'w1', name: '지수 결혼식', date: '2027-05-02', amount: 1 },
        { id: 'w2', name: '민수 결혼식', date: '2027-05-09', amount: 1 },
        { id: 'p', name: '어버이날', date: '2027-05-08', amount: 1 },
      ]),
      month('2027-06', -10_000),
    ]);
    expect(shortageBannerText(p, TODAY)).toEqual({
      title: '2027년 5월에 이벤트통장이 300,000원 모자라요',
      description: '결혼식 2건 · 어버이날 · 다른 1개월도 모자라요',
    });
  });
  it('부족이 없으면 null', () => {
    expect(shortageBannerText(projection([month('2026-11', 0)]), TODAY)).toBeNull();
  });
  it('체험 가계부: 5개월 뒤 300,000원 부족', () => {
    const data = createDemoLedger(TODAY, `${TODAY}T01:00:00.000Z`);
    const text = shortageBannerText(projectEventAccount(data, TODAY), TODAY);
    expect(text?.title).toBe('2027년 4월에 이벤트통장이 300,000원 모자라요');
    expect(text?.description).toContain('결혼식 4건');
  });
});

describe('recentExpenses · expenseTitle', () => {
  const base = { accountId: 'a', categoryId: null, memo: '', eventId: null, fixedExpenseId: null, author: 'x', updatedAt: '', deleted: false };
  const rows: Expense[] = [
    { ...base, id: '1', date: '2026-11-19', amount: 1, createdAt: '2026-11-19T10:00:00Z' },
    { ...base, id: '2', date: '2026-11-20', amount: 2, createdAt: '2026-11-20T09:00:00Z' },
    { ...base, id: '3', date: '2026-11-20', amount: 3, createdAt: '2026-11-20T11:00:00Z' },
    { ...base, id: '4', date: '2026-11-21', amount: 4, createdAt: '2026-11-18T11:00:00Z', deleted: true },
  ];
  it('날짜 → 기록 시각 내림차순, 지운 것 빼고', () => {
    const data = { ...createDemoLedger(TODAY, `${TODAY}T01:00:00.000Z`), expenses: rows };
    expect(recentExpenses(data, 5).map((e) => e.id)).toEqual(['3', '2', '1']);
    expect(recentExpenses(data, 2).map((e) => e.id)).toEqual(['3', '2']);
    expect(recentExpenses(null)).toEqual([]);
  });
  it('제목은 내용 → 카테고리 → 지출', () => {
    const cats: Category[] = [{ id: 'c', name: '카페', icon: 'coffee', defaultAccountRole: 'fixed', order: 0, deleted: false }];
    expect(expenseTitle({ ...rows[0]!, memo: ' 라테 ' }, cats)).toBe('라테');
    expect(expenseTitle({ ...rows[0]!, categoryId: 'c' }, cats)).toBe('카페');
    expect(expenseTitle(rows[0]!, cats)).toBe('지출');
  });
});

describe('통장 고르기', () => {
  const accounts: Partial<Record<AccountRole, Account>> = {
    fixed: { id: 'fixed', name: '고정지출통장', role: 'fixed', openingBalance: 0, openingDate: TODAY, order: 0, ownerName: null, ownerEmail: null, deleted: false },
    event: { id: 'event', name: '이벤트통장', role: 'event', openingBalance: 0, openingDate: TODAY, order: 1, ownerName: null, ownerEmail: null, deleted: false },
  };
  const byRole = (role: AccountRole) => accounts[role] ?? null;
  const cat = (role: AccountRole): Category => ({ id: role, name: role, icon: 'dots', defaultAccountRole: role, order: 0, deleted: false });

  it('어느 돈인지에 따라', () => {
    expect(accountIdForSource('living', 'living-acc', byRole)).toBe('living-acc');
    expect(accountIdForSource('living', null, byRole)).toBe('fixed');
    expect(accountIdForSource('event', null, byRole)).toBe('event');
    expect(accountIdForSource('event', null, () => null)).toBeNull();
  });
  it('카테고리 기본 통장 역할에 따라', () => {
    expect(accountIdForCategory(cat('event'), 'living-acc', byRole)).toBe('event');
    expect(accountIdForCategory(cat('fixed'), 'living-acc', byRole)).toBe('living-acc');
    expect(accountIdForCategory(cat('savings'), null, byRole)).toBeNull();
    expect(sourceForCategory(cat('event'))).toBe('event');
    expect(sourceForCategory(cat('allowance'))).toBe('living');
  });
});

describe('parseAmountParam', () => {
  it('숫자 · 쉼표 · 만 단위', () => {
    expect(parseAmountParam('12000')).toBe(12_000);
    expect(parseAmountParam('12,000원')).toBe(12_000);
    expect(parseAmountParam('2만')).toBe(20_000);
  });
  it('비었거나 0 이하거나 해석 불가면 null', () => {
    expect(parseAmountParam(null)).toBeNull();
    expect(parseAmountParam('')).toBeNull();
    expect(parseAmountParam('0')).toBeNull();
    expect(parseAmountParam('abc')).toBeNull();
  });
});

describe('chartGeometry', () => {
  it('모두 0 이상이면 아래 칸 없이 가장 큰 값이 꽉 차요', () => {
    const g = chartGeometry([month('a', 100), month('b', 50), month('c', 0)], { height: 80 });
    expect(g.negArea).toBe(0);
    expect(g.posArea).toBe(80);
    expect(g.bars.map((b) => b.pos)).toEqual([80, 40, 0]);
    expect(g.bars.every((b) => b.neg === 0)).toBe(true);
  });
  it('음수가 있으면 위·아래를 같은 배율로 나눠요', () => {
    const g = chartGeometry([month('a', 600_000), month('b', -300_000)], { height: 90 });
    expect(g.posArea + g.negArea).toBe(90);
    expect(g.posArea).toBe(60);
    expect(g.bars[0]!.pos).toBe(60);
    expect(g.bars[1]!.neg).toBe(30);
  });
  it('작은 값도 2px 은 보이고, 칸 최소 높이를 지켜요', () => {
    const g = chartGeometry([month('a', 1_000_000), month('b', -1)], { height: 88, minNeg: 20 });
    expect(g.negArea).toBe(20);
    expect(g.bars[1]!.neg).toBe(2);
    const allNeg = chartGeometry([month('a', -5), month('b', -10)], { height: 88, minPos: 24 });
    expect(allNeg.posArea).toBe(24);
    expect(allNeg.bars[1]!.neg).toBe(64);
  });
});

describe('errorMessage', () => {
  it('Error 문구 → 문자열 → 기본 문구', () => {
    expect(errorMessage(new Error('저장하지 못했어요'), 'x')).toBe('저장하지 못했어요');
    expect(errorMessage('문자열', 'x')).toBe('문자열');
    expect(errorMessage(undefined, '기본')).toBe('기본');
  });
});
