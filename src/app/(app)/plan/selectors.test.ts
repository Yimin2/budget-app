import { describe, expect, it } from 'vitest';
import type { Category, Expense, PlannedEvent, ProjectionMonth, SettlementSummary } from '@/domain';
import {
  settleTileText,
  dateLabel,
  defaultCompleteDate,
  eventCategories,
  aheadMonthItems,
  claimBadges,
  monthLabel,
  sectionEvents,
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

  it('청구 정산 상태 배지: 한 상태면 글자만 · 섞이면 금액도 · 청구가 없으면 없음', () => {
    expect(claimBadges(null, 10_000)).toEqual([]);
    expect(claimBadges({ pending: 50_000, paid: 0, paidOn: null, borrowed: 0 }, 50_000)).toEqual([{ text: '줄 돈', tone: 'warning' }]);
    expect(claimBadges({ pending: 0, paid: 175_000, paidOn: '2026-11-10', borrowed: 0 }, 175_000)).toEqual([{ text: '11/10 지급', tone: 'success' }]);
    expect(claimBadges({ pending: 0, paid: 0, paidOn: null, borrowed: 30_000 }, 30_000)).toEqual([{ text: '저수지에서 빌려 줌', tone: 'info' }]);
    // 그냥 지출이 섞인 줄 · 여러 상태
    expect(claimBadges({ pending: 0, paid: 175_000, paidOn: '2026-11-10', borrowed: 0 }, 205_000)).toEqual([{ text: '11/10 지급 17.5만', tone: 'success' }]);
    expect(claimBadges({ pending: 50_000, paid: 20_000, paidOn: null, borrowed: 0 }, 70_000)).toEqual([
      { text: '줄 돈 5만', tone: 'warning' },
      { text: '지급함 2만', tone: 'success' },
    ]);
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

});
