import { describe, expect, it } from 'vitest';
import { createDemoLedger, projectEventAccount, suggestShortageFixes } from '@/domain';
import type { Category, Expense, PlannedEvent, ProjectionMonth } from '@/domain';
import {
  usualCategoriesText,
  barsGeometry,
  compactWon,
  dateLabel,
  defaultCompleteDate,
  eventCategories,
  increaseChoiceText,
  initialMonth,
  monthDetailRows,
  monthLabel,
  nextContribution,
  nextOccurrence,
  projectionTotals,
  reservoirChoiceText,
  sectionEvents,
  shortageSummary,
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

describe('체험 가계부 부족 알림 문구', () => {
  const data = createDemoLedger(TODAY, NOW);
  const projection = projectEventAccount(data, TODAY);
  const fix = suggestShortageFixes(data, TODAY, projection);

  it('첫 부족 달 · 금액 · 그달 일정 요약', () => {
    const s = shortageSummary(projection, TODAY)!;
    expect(s.title).toBe('2027년 4월에 300,000원 모자라요');
    expect(s.names).toBe('결혼식 4건 · 어버이날');
    expect(s.others).toBe(0);
    expect(s.isThisMonth).toBe(false);
  });

  it('① 매달 적립액 늘리기 문구', () => {
    const t = increaseChoiceText(fix.increaseMonthly!, TODAY, projection.monthlyContribution);
    expect(t.title).toBe('지금부터 매달 적립액 +60,000원');
    expect(t.description).toBe('12월부터 2027년 4월까지 5번에 나눠 채워요');
    expect(t.note).toBe('매달 300,000원 → 360,000원');
    expect(t.blocked).toBeNull();
  });

  it('② 저수지에서 옮기기 문구 · 저수지가 모자라면 고를 수 없어요', () => {
    const r = fix.fromReservoir!;
    const t = reservoirChoiceText(r, TODAY);
    expect(t.title).toBe('2027년 4월에 저수지에서 300,000원 옮기기');
    expect(t.description).toContain('저수지 예상 잔액');
    expect(t.blocked).toBeNull();
    const poor = reservoirChoiceText({ ...r, reservoirProjected: 100_000 }, TODAY);
    expect(poor.blocked).toBe('저수지 예상 잔액이 200,000원 모자라서 고를 수 없어요');
    expect(poor.note).toBeNull();
  });

  it('처음 고르는 달은 첫 부족 달 · 12개월 일정 합 · 다음 달 적립 변화 없음', () => {
    expect(initialMonth(projection, TODAY)).toBe('2027-04');
    const totals = projectionTotals(projection);
    expect(totals.count).toBe(8);
    expect(totals.amount).toBe(400_000 + 900_000 + 1_400_000 + 100_000);
    expect(nextContribution(projection)).toBeNull();
  });

  it('부족이 없으면 이번 달을 골라요', () => {
    const ok = { ...projection, shortages: [] };
    expect(shortageSummary(ok, TODAY)).toBeNull();
    expect(initialMonth(ok, TODAY)).toBe('2026-11');
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

describe('monthDetailRows', () => {
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
    events: [{ id: 'a', name: 'A', date: '2027-04-02', amount: 1_400_000 }],
  };
  it('다음 달부터는 시작 잔액 · 적립 · 옮겨 올 돈 · 예정 일정', () => {
    expect(monthDetailRows(month, false)).toEqual([
      { label: '달 시작 잔액', amount: 1_100_000, sign: '' },
      { label: '적립', amount: 300_000, sign: '+' },
      { label: '옮겨 올 돈', amount: 300_000, sign: '+' },
      { label: '예정 일정 1건', amount: 1_400_000, sign: '-' },
    ]);
  });
  it('이번 달은 지금 잔액 · 아직 안 들어온 적립', () => {
    const rows = monthDetailRows({ ...month, transfersIn: 0, contributions: 0, planned: 0, events: [] }, true);
    expect(rows).toEqual([
      { label: '지금 잔액', amount: 1_100_000, sign: '' },
      { label: '예정 일정 0건', amount: 0, sign: '' },
    ]);
  });
  it('평소 쓰는 돈은 흐린 줄로, 근거(작년 같은 달 · 최근 평균)와 함께 빼요', () => {
    const rows = monthDetailRows({ ...month, usual: 120_000, usualBasis: 'lastYear' }, false);
    expect(rows).toContainEqual({ label: '평소 쓰는 돈 (작년 같은 달)', amount: 120_000, sign: '-', muted: true });
    const recent = monthDetailRows({ ...month, usual: 80_000, usualBasis: 'recent' }, false);
    expect(recent).toContainEqual({ label: '평소 쓰는 돈 (최근 평균)', amount: 80_000, sign: '-', muted: true });
    expect(monthDetailRows(month, false).some((r) => r.label.startsWith('평소'))).toBe(false);
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
  it('이벤트통장 할부는 할부 줄로 빼요', () => {
    const rows = monthDetailRows({ ...month, installments: 100_000, endBalance: 200_000 }, false);
    expect(rows[rows.length - 1]).toEqual({ label: '할부', amount: 100_000, sign: '-' });
  });
});
