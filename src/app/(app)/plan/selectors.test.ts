import { describe, expect, it } from 'vitest';
import { createDemoLedger, projectEventAccount } from '@/domain';
import type { Category, EventProjection, Expense, PlannedEvent, ProjectionMonth, SettlementSummary } from '@/domain';
import {
  settleTileText,
  worstShortMonth,
  usualCategoriesText,
  barsGeometry,
  compactWon,
  dateLabel,
  defaultCompleteDate,
  eventCategories,
  initialMonth,
  aheadInflowText,
  compromiseHeadline,
  aheadMonthItems,
  aheadMonthLine,
  aheadMonthSummary,
  aheadOutflow,
  aheadTotalLines,
  aheadTotals,
  repaySummary,
  repayPayersLine,
  repayByMonth,
  capList,
  monthLabel,
  nextContribution,
  nextOccurrence,
  sectionEvents,
  monthShortLine,
  spentByEvent,
  summarizeEventNames,
  weekdayShort,
} from './selectors';

const TODAY = '2026-11-20';
const NOW = '2026-11-20T01:00:00.000Z';

let seq = 0;
function ev(p: Partial<PlannedEvent> & Pick<PlannedEvent, 'date'>): PlannedEvent {
  seq += 1;
  return {
    id: `ev-${seq}`,
    name: `일정 ${seq}`,
    amount: 10_000,
    accountId: 'acc-event',
    categoryId: null,
    status: 'planned',
    repeat: 'none',
    memo: '',
    author: 'a@x',
    createdAt: NOW,
    updatedAt: NOW,
    deleted: false,
    ...p,
  };
}

function cat(p: Partial<Category> & Pick<Category, 'id' | 'name'>): Category {
  return { icon: 'dots', defaultAccountRole: 'fixed', order: 0, deleted: false, ...p };
}

describe('sectionEvents', () => {
  it('지난 예정 · 다가오는 일정(달별) · 지난 일정으로 나누고 지운 일정은 빼요', () => {
    const list = [
      ev({ date: '2026-12-05', name: '나' }),
      ev({ date: '2026-11-03', name: '지난 예정' }),
      ev({ date: '2026-11-20', name: '오늘' }),
      ev({ date: '2026-12-01', name: '가' }),
      ev({ date: '2027-01-14', name: '설날', amount: 400_000 }),
      ev({ date: '2026-10-01', name: '완료', status: 'done' }),
      ev({ date: '2026-11-01', name: '취소', status: 'canceled' }),
      ev({ date: '2026-12-24', name: '지운 일정', deleted: true }),
    ];
    const s = sectionEvents(list, TODAY);
    expect(s.total).toBe(7);
    expect(s.overdue.map((e) => e.name)).toEqual(['지난 예정']);
    expect(s.upcoming.map((g) => g.month)).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(s.upcoming[0]!.events.map((e) => e.name)).toEqual(['오늘']);
    expect(s.upcoming[1]!.events.map((e) => e.name)).toEqual(['가', '나']);
    expect(s.upcoming[1]!.total).toBe(20_000);
    expect(s.upcoming[2]!.total).toBe(400_000);
    expect(s.past.map((e) => e.name)).toEqual(['취소', '완료']);
  });

  it('일정이 없으면 모두 비어 있어요', () => {
    expect(sectionEvents([], TODAY)).toEqual({ overdue: [], upcoming: [], past: [], total: 0 });
  });
});

describe('spentByEvent', () => {
  it('일정으로 기록한 지출을 일정별로 더해요 (지운 지출 빼고)', () => {
    const base = {
      date: TODAY,
      accountId: 'a',
      categoryId: null,
      memo: '',
      fixedExpenseId: null,
      author: 'a@x',
      createdAt: NOW,
      updatedAt: NOW,
      deleted: false,
    };
    const xs: Expense[] = [
      { ...base, id: 'x1', amount: 100, eventId: 'e1' },
      { ...base, id: 'x2', amount: 50, eventId: 'e1' },
      { ...base, id: 'x3', amount: 70, eventId: 'e1', deleted: true },
      { ...base, id: 'x4', amount: 30, eventId: null },
    ];
    const m = spentByEvent(xs);
    expect(m.get('e1')).toBe(150);
    expect(m.size).toBe(1);
  });
});

describe('eventCategories', () => {
  it('이벤트통장 카테고리만, 없으면 전부 (순서대로)', () => {
    const cats = [
      cat({ id: 'c3', name: '여행', defaultAccountRole: 'event', order: 2 }),
      cat({ id: 'c1', name: '식비', order: 0 }),
      cat({ id: 'c2', name: '경조사', defaultAccountRole: 'event', order: 1 }),
      cat({ id: 'c4', name: '지운 것', defaultAccountRole: 'event', order: 3, deleted: true }),
    ];
    expect(eventCategories(cats).map((c) => c.name)).toEqual(['경조사', '여행']);
    const personal = [cat({ id: 'p2', name: '카페', order: 1 }), cat({ id: 'p1', name: '식비', order: 0 })];
    expect(eventCategories(personal).map((c) => c.name)).toEqual(['식비', '카페']);
  });
});

describe('날짜 도우미', () => {
  it('요일 · 다른 해 표시 · 이번 달 낱말', () => {
    expect(weekdayShort('2026-11-14')).toBe('토');
    expect(dateLabel('2026-12-24', TODAY)).toBe('12월 24일 목요일');
    expect(dateLabel('2027-01-14', TODAY, false)).toBe('2027년 1월 14일');
    expect(monthLabel('2027-04', TODAY)).toBe('2027년 4월');
    expect(monthLabel('2026-11', TODAY, '이번 달')).toBe('이번 달');
    expect(monthLabel('2026-12', TODAY, '이번 달')).toBe('12월');
  });

  it('다음 회차는 말일을 넘지 않아요', () => {
    expect(nextOccurrence('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(nextOccurrence('2028-02-29', 'yearly')).toBe('2029-02-28');
    expect(nextOccurrence('2026-11-14', 'none')).toBeNull();
  });

  it('완료 기본 날짜: 지났으면 일정 날짜, 아니면 오늘', () => {
    expect(defaultCompleteDate(ev({ date: '2026-11-03' }), TODAY)).toBe('2026-11-03');
    expect(defaultCompleteDate(ev({ date: '2026-12-03' }), TODAY)).toBe(TODAY);
  });
});

describe('summarizeEventNames', () => {
  it('끝 낱말이 같은 일정을 묶어요', () => {
    expect(summarizeEventNames(['지수 결혼식', '민수 결혼식', '회사 동기 결혼식', '사촌 결혼식', '어버이날'])).toBe(
      '결혼식 4건 · 어버이날',
    );
    expect(summarizeEventNames(['설날', '제주 여행', '어버이날'])).toBe('설날 · 제주 여행 외 1건');
    expect(summarizeEventNames([])).toBe('');
  });
});

describe('체험 가계부 모자라는 달', () => {
  const data = createDemoLedger(TODAY, NOW);
  const projection = projectEventAccount(data, TODAY);

  it('고른 달 맨 위 한 줄: 그달 · 모자라는 금액(만 단위) · 그달 일정 요약, 모자라지 않으면 null', () => {
    const april = projection.months.find((m) => m.month === '2027-04')!;
    expect(monthShortLine(april, TODAY)).toBe('2027년 4월에 30만 모자라요 · 결혼식 4건 · 어버이날');
    expect(monthShortLine({ ...april, events: [] }, TODAY)).toBe('2027년 4월에 30만 모자라요');
    expect(monthShortLine({ ...april, month: '2026-11' }, TODAY)).toMatch(/^이번 달에 30만 모자라요/);
    expect(monthShortLine(projection.months[0]!, TODAY)).toBeNull();
  });

  it('처음 고르는 달은 모자라는 달이 있어도 이번 달 · 다음 달 적립 변화 없음', () => {
    expect(projection.shortages.length).toBeGreaterThan(0);
    expect(initialMonth(projection, TODAY)).toBe('2026-11');
    expect(nextContribution(projection)).toBeNull();
  });
});

describe('compactWon', () => {
  it('막대 아래 짧은 금액', () => {
    expect(compactWon(-300_000)).toEqual({ sign: '-', num: '30', unit: '만' });
    expect(compactWon(-35_000)).toEqual({ sign: '-', num: '3.5', unit: '만' });
    expect(compactWon(-1_250_000)).toEqual({ sign: '-', num: '125', unit: '만' });
    expect(compactWon(-5_000)).toEqual({ sign: '-', num: '5', unit: '천' });
    expect(compactWon(150_000_000)).toEqual({ sign: '', num: '1.5', unit: '억' });
    expect(compactWon(-999)).toEqual({ sign: '-', num: '999', unit: '원' });
  });
});

describe('barsGeometry', () => {
  const m = (month: string, endBalance: number) => ({ month, endBalance });

  it('음수가 없으면 아래 칸이 없고 가장 큰 막대가 칸을 채워요', () => {
    const g = barsGeometry([m('2026-11', 100), m('2026-12', 50), m('2027-01', 0)], { height: 100 });
    expect(g.negArea).toBe(0);
    expect(g.posArea).toBe(100);
    expect(g.bars.map((b) => b.pos)).toEqual([100, 50, 0]);
    expect(g.bars.every((b) => b.neg === 0)).toBe(true);
  });

  it('음수가 있으면 기준선 아래에 막대 + 글자 자리를 남겨요', () => {
    const g = barsGeometry([m('a', 900), m('b', -300), m('c', 1)], { height: 144, labelRoom: 22 });
    expect(g.posArea + g.negArea).toBe(144);
    const neg = g.bars[1]!.neg;
    expect(neg).toBeGreaterThan(0);
    expect(neg).toBeLessThanOrEqual(g.negArea - 22);
    expect(g.bars[0]!.pos).toBeLessThanOrEqual(g.posArea);
    // 아주 작은 값도 2px 는 보여요
    expect(g.bars[2]!.pos).toBe(2);
  });

  it('모두 음수여도 위 칸 최소 높이를 지켜요', () => {
    const g = barsGeometry([m('a', -100), m('b', -50)], { height: 120, labelRoom: 20, minPos: 20 });
    expect(g.posArea).toBe(20);
    expect(g.bars[0]!.neg).toBe(80);
    expect(g.bars[1]!.neg).toBe(40);
  });
});

describe('앞으로 12개월: 고른 달 항목', () => {
  const month: ProjectionMonth = {
    month: '2027-04',
    startBalance: 1_100_000,
    contributions: 300_000,
    transfersIn: 300_000,
    transfersOut: 0,
    planned: 1_400_000,
    usual: 0,
    extra: 0,
    endBalance: 300_000,
    events: [
      { id: 'a', name: '지수 결혼식', date: '2027-04-02', amount: 900_000 },
      { id: 'b', name: '어버이날', date: '2027-04-08', amount: 500_000 },
    ],
  };
  it('새로 나갈 돈(일정 → 여행 남은 예산 → 할부 → 미리 기록 → 평소 쓰는 돈) 뒤에 지난 지출 돌려주기', () => {
    const items = aheadMonthItems(
      {
        ...month,
        tripList: [{ id: 't1', name: '제주 여행', amount: 450_000 }],
        trips: 450_000,
        installments: 100_000,
        scheduledSpending: 20_000,
        claims: 30_000,
        usual: 120_000,
        usualBasis: 'lastYear',
      },
      [{ key: 'fixed:tv', label: 'TV 할부', amount: 100_000 }],
    );
    expect(items.map((i) => [i.kind, i.label, i.amount, i.note])).toEqual([
      ['event', '지수 결혼식', 900_000, undefined],
      ['event', '어버이날', 500_000, undefined],
      ['trip', '제주 여행', 450_000, '여행 남은 예산'],
      ['installment', 'TV 할부', 100_000, '할부'],
      ['scheduled', '미리 기록한 지출', 20_000, undefined],
      ['usual', '평소 쓰는 돈', 120_000, '작년 30% + 평균 70%, 일정 뺀 뒤'],
      ['claims', '지난 지출 돌려주기', 30_000, undefined],
    ]);
    expect(items[2]!.tripId).toBe('t1');
    expect(items[0]!.date).toBe('2027-04-02');
  });
  it('할부 이름 합이 예측과 다르면 할부 한 줄, 평소 쓰는 돈 근거는 최근 평균', () => {
    const items = aheadMonthItems({ ...month, events: [], installments: 100_000, usual: 80_000, usualBasis: 'recent' }, [
      { key: 'x', label: 'TV 할부', amount: 50_000 },
    ]);
    expect(items).toEqual([
      { key: 'inst', kind: 'installment', label: '할부', amount: 100_000 },
      { key: 'usual', kind: 'usual', label: '평소 쓰는 돈', amount: 80_000, note: '최근 평균, 일정 뺀 뒤' },
    ]);
    expect(aheadOutflow({ ...month, events: [], installments: 100_000, usual: 80_000 })).toBe(180_000);
  });
  it('들어오는 쪽 한 줄 (이번 달은 지금 잔액 · 아직 안 들어온 적립)', () => {
    expect(aheadInflowText(month, false)).toBe('달 시작 잔액 110만 · 적립 +30만 · 옮겨 올 돈 +30만');
    expect(aheadInflowText({ ...month, transfersIn: 0 }, true)).toBe('지금 잔액 110만 · 아직 안 들어온 적립 +30만');
    expect(aheadInflowText({ ...month, transfersIn: 0, contributions: 0 }, true)).toBe('지금 잔액 110만');
  });
  it("다가오는 달 한 줄: 합계 먼저 '12월 · 30만 · 결혼식 2건'", () => {
    expect(aheadMonthLine({ ...month, month: '2026-12' }, TODAY)).toBe('12월 · 140만 · 지수 결혼식 · 어버이날');
    const weddings = {
      ...month,
      events: [
        { id: 'a', name: '지수 결혼식', date: '2027-04-02', amount: 100_000 },
        { id: 'b', name: '민호 결혼식', date: '2027-04-09', amount: 200_000 },
      ],
    };
    expect(aheadMonthLine(weddings, TODAY)).toBe('2027년 4월 · 30만 · 결혼식 2건');
    expect(aheadMonthLine({ ...month, events: [], usual: 52_400 }, TODAY)).toBe('2027년 4월 · 5.2만');
    expect(aheadMonthLine({ ...month, events: [], installments: 50_000 }, TODAY)).toBe('2027년 4월 · 5만 · 할부');
    // 돌려주기는 나갈 돈 이름에 섞지 않고 '돌려주기 ○'로 뒤에 (합계에는 들어가요)
    expect(aheadMonthSummary({ ...month, events: [], usual: 20_000, claims: 300_000 }, TODAY)).toEqual({
      head: '2027년 4월 · 32만',
      tail: '돌려주기 30만',
    });
  });

  const claimMonth: ProjectionMonth = {
    ...month,
    month: '2026-11',
    events: [{ id: 'a', name: '지수 결혼식', date: '2026-11-22', amount: 206_000 }],
    planned: 206_000,
    claims: 672_000,
    claimList: [
      { expenseId: 'x1', payer: '민구', amount: 550_000, spentDate: '2026-10-03' },
      { expenseId: 'x2', payer: '민지', amount: 100_000, spentDate: '2026-09-12' },
      { expenseId: 'x3', payer: '민지', amount: 22_000, spentDate: '2026-10-28' },
    ],
  };

  it("지난 지출 돌려주기: 한 건씩 '10월에 쓴 것 · 민구', 묶음 한 줄 '· 3건 (9~10월에 쓴 것)'", () => {
    const items = aheadMonthItems(claimMonth);
    expect(items.map((i) => [i.kind, i.label, i.amount])).toEqual([
      ['event', '지수 결혼식', 206_000],
      ['claims', '10월에 쓴 것 · 민구', 550_000],
      ['claims', '9월에 쓴 것 · 민지', 100_000],
      ['claims', '10월에 쓴 것 · 민지', 22_000],
    ]);
    expect(repaySummary(claimMonth)).toBe('지난 지출 돌려주기 67.2만 · 3건 (9~10월에 쓴 것)');
    expect(repaySummary({ ...claimMonth, claimList: [claimMonth.claimList![0]!] , claims: 550_000 })).toBe('지난 지출 돌려주기 55만 · 1건 (10월에 쓴 것)');
    expect(repaySummary(month)).toBeNull();
    expect(aheadTotals(claimMonth)).toEqual({ spend: 206_000, repay: 672_000, total: 878_000 });
    expect(aheadOutflow(claimMonth)).toBe(878_000);
  });

  it('돌려주기: 낸 사람별 합(많은 순) · 쓴 달로 묶기(오래된 달 먼저) · 긴 목록 줄이기', () => {
    expect(repayPayersLine(claimMonth)).toBe('민구 55만 · 민지 12.2만');
    expect(repayPayersLine(month)).toBeNull();
    const many: ProjectionMonth = {
      ...claimMonth,
      claimList: ['가', '나', '다', '라'].map((p, i) => ({ expenseId: `p${i}`, payer: p, amount: (i + 1) * 10_000, spentDate: '2026-10-01' })),
      claims: 100_000,
    };
    expect(repayPayersLine(many)).toBe('라 4만 · 다 3만 · 나 2만 · 외 1명');
    const groups = repayByMonth(aheadMonthItems(claimMonth), claimMonth);
    expect(groups.map((g) => [g.month, g.label, g.count, g.amount])).toEqual([
      ['2026-09', '9월', 1, 100_000],
      ['2026-10', '10월', 2, 572_000],
    ]);
    expect(groups[1]!.items.map((i) => i.date)).toEqual(['2026-10-03', '2026-10-28']);
    expect(groups.reduce((s, g) => s + g.amount, 0)).toBe(claimMonth.claims);
    expect(capList([1, 2, 3, 4, 5, 6], 6, 5)).toEqual({ shown: [1, 2, 3, 4, 5, 6], more: 0 });
    expect(capList([1, 2, 3, 4, 5, 6, 7], 6, 5)).toEqual({ shown: [1, 2, 3, 4, 5], more: 2 });
  });

  it("고른 달 합계 줄: '12월 나갈 돈 합계 87.8만' · 이번 달은 '이미 나간 돈 10만 + 앞으로 77.8만'", () => {
    expect(aheadTotalLines({ ...claimMonth, month: '2026-12' }, TODAY, 100_000)).toEqual({
      title: '12월 나갈 돈 합계 87.8만',
      split: null,
      parts: '새로 나갈 돈 20.6만 · 지난 지출 돌려주기 67.2만',
    });
    const now = { ...claimMonth, events: [{ id: 'a', name: '지수 결혼식', date: '2026-11-22', amount: 106_000 }], planned: 106_000 };
    expect(aheadTotalLines(now, TODAY, 100_000)).toEqual({
      title: '이번 달 나갈 돈 87.8만',
      split: '이미 나간 돈 10만 + 앞으로 77.8만',
      parts: '새로 나갈 돈 10.6만 · 지난 지출 돌려주기 67.2만',
    });
    expect(aheadTotalLines(month, TODAY, null).parts).toBeNull();
  });
  it('평소 쓰는 돈 카테고리 줄', () => {
    expect(
      usualCategoriesText([
        { name: '경조사', amount: 350_000 },
        { name: '선물', amount: 150_000 },
        { name: '여행', amount: 124_400 },
      ]),
    ).toBe('경조사 35만 · 선물 15만 · 여행 12.4만');
  });
});

describe('compromiseHeadline', () => {
  it("'적립 70만 + 선물 −5만' (가장 크게 줄일 카테고리, 여럿이면 '외 N개')", () => {
    expect(compromiseHeadline({ recommended: 700_000, cut: { cuts: [{ name: '선물', amount: 50_000 }] } })).toBe('적립 70만 + 선물 −5만');
    expect(
      compromiseHeadline({
        recommended: 550_000,
        cut: {
          cuts: [
            { name: '외식', amount: 12_000 },
            { name: '경조사', amount: 30_000 },
            { name: '선물', amount: 0 },
          ],
        },
      }),
    ).toBe('적립 55만 + 경조사 −3만 외 1개');
    expect(compromiseHeadline({ recommended: 300_000, cut: { cuts: [] } })).toBe('적립 30만');
  });
});

describe('숫자 띠', () => {
  const sum = (o: Partial<SettlementSummary>): SettlementSummary => ({
    total: 0,
    people: [],
    date: '2026-11-21',
    fromEvent: 0,
    fromFixed: 0,
    fromReservoir: 0,
    borrow: 0,
    rest: 0,
    payable: 0,
    next: null,
    carry: null,
    hasClaims: true,
    ...o,
  });

  it('settleTileText: 줄 돈 합 · 이벤트통장 밖에서 나가는 돈 · 넘어가는 돈, 없으면 다음 정산', () => {
    expect(settleTileText(null, sum({ total: 324_000, fromFixed: 24_000 }), '2026-11-20')).toEqual({
      label: '11/21 정산',
      value: '32.4만',
      note: '생활비 통장에서 2.4만',
      carry: null,
    });
    const u = { unpaid: 550_000, unpaidPeople: [{ name: '민구', amount: 550_000 }] };
    expect(settleTileText(u, sum({ total: 850_000 }), '2026-11-20').carry).toBe('못 준 돈 55만 → 다음 달 (민구)');
    expect(settleTileText(null, sum({ next: { date: '2026-12-01', amount: 24_000 } }), '2026-11-20')).toEqual({
      label: '11/21 정산',
      value: null,
      note: '다음 정산 12/1 2.4만',
      carry: null,
    });
    expect(settleTileText(null, null, '2026-11-21').value).toBeNull();
  });

  it('worstShortMonth: 가장 많이 모자라는 달, 없으면 null', () => {
    const m = (month: string, endBalance: number) => ({ month, endBalance }) as ProjectionMonth;
    const p = (months: ProjectionMonth[]) => ({ months }) as EventProjection;
    expect(worstShortMonth(p([m('2026-11', 10), m('2027-02', -100), m('2027-04', -300), m('2027-05', -200)]))!.month).toBe('2027-04');
    expect(worstShortMonth(p([m('2026-11', 0), m('2026-12', 5)]))).toBeNull();
  });
});
