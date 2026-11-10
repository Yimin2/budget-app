import { describe, expect, it } from 'vitest';
import { account, emptyLedger, event, expense, rule } from './_fixtures';
import { accountBalance } from './balances';
import { DEMO_TRIP_ID, createDemoLedger } from './defaults';
import { projectEventAccount, suggestShortageFixes } from './events';
import {
  daysBetween, linkableTrips, spreadTripRemaining, tripBudget, tripItemForCategory, tripItemLines, tripOutflows, tripPeriodText,
  tripSpendState, tripStatus, tripStatuses, validateTrip,
} from './trips';
import { judgeEvent, judgeInstallment } from './verdict';
import type { Expense, LedgerData, Trip } from './types';

const TODAY = '2026-11-09';
const NOW = '2026-11-01T00:00:00.000Z';

const incomeAcc = account('income', { id: 'inc', ownerName: '가람', order: 0 });
const eventAcc = account('event', { id: 'event', openingBalance: 1_000_000, order: 1 });
const reservoirAcc = account('reservoir', { id: 'res', openingBalance: 5_000_000, order: 2 });

function trip(p: Partial<Trip> = {}): Trip {
  return {
    id: 'trip', name: '제주 여행', startDate: '2027-02-20', endDate: '2027-02-23', budget: 900_000,
    items: { flight: 300_000, stay: 300_000 }, memo: '', author: 'a@x', createdAt: NOW, updatedAt: NOW, deleted: false, ...p,
  };
}

function ledger(p: Partial<LedgerData> = {}): LedgerData {
  return emptyLedger({ accounts: [incomeAcc, eventAcc, reservoirAcc], ...p });
}

function tripExpense(p: Partial<Expense> & Pick<Expense, 'amount'>): Expense {
  return expense({ date: TODAY, accountId: 'event', tripId: 'trip', ...p });
}

describe('여행 상태', () => {
  it('통장과 상관없이 묶은 지출을 모아 예산 · 쓴 돈 · 남은 돈 · 항목을 센다', () => {
    const d = ledger({
      trips: [trip()],
      expenses: [
        tripExpense({ amount: 280_000, tripItem: 'flight' }),
        // 예전 기록: 저수지에서 나간 숙소비도 여행에 묶는다
        tripExpense({ amount: 120_000, accountId: 'res', tripItem: 'stay' }),
        tripExpense({ amount: 30_000, tripItem: null }),
        tripExpense({ amount: 99_000, deleted: true }),
        expense({ date: TODAY, amount: 50_000, accountId: 'event' }),
      ],
    });
    const s = tripStatus(d, d.trips[0]!, TODAY);
    expect(s.budget).toBe(900_000);
    expect(s.spent).toBe(430_000);
    expect(s.remaining).toBe(470_000);
    expect(s.spentElsewhere).toBe(120_000);
    expect(s.expenses).toHaveLength(3);
    expect(s.items).toEqual([
      { item: 'flight', budget: 300_000, spent: 280_000, remaining: 20_000 },
      { item: 'stay', budget: 300_000, spent: 120_000, remaining: 180_000 },
      { item: 'other', budget: null, spent: 30_000, remaining: null },
    ]);
    expect(s.phase).toBe('upcoming');
    expect(s.daysUntil).toBe(daysBetween(TODAY, '2027-02-20'));
    expect(s.projected).toEqual([{ month: '2027-02', amount: 470_000 }]);
  });

  it('총예산이 0 이면 항목 예산 합', () => {
    expect(tripBudget({ budget: 0, items: { flight: 100_000, food: 50_000 } })).toBe(150_000);
    expect(tripBudget({ budget: 200_000, items: { flight: 100_000 } })).toBe(200_000);
  });

  it('여행 중 → 다가오는 여행 → 지난 여행 순, 지운 여행은 빠진다', () => {
    const d = ledger({
      trips: [
        trip({ id: 'later', startDate: '2027-05-01', endDate: '2027-05-03' }),
        trip({ id: 'past', startDate: '2026-08-01', endDate: '2026-08-03' }),
        trip({ id: 'now', startDate: '2026-11-08', endDate: '2026-11-12' }),
        trip({ id: 'soon', startDate: '2026-12-01', endDate: '2026-12-02' }),
        trip({ id: 'gone', deleted: true }),
      ],
    });
    expect(tripStatuses(d, TODAY).map((s) => s.trip.id)).toEqual(['now', 'soon', 'later', 'past']);
    expect(tripStatuses(d, TODAY).map((s) => s.phase)).toEqual(['ongoing', 'upcoming', 'upcoming', 'past']);
    expect(linkableTrips(d, TODAY, 'gone').map((t) => t.id)).toContain('gone');
  });
});

describe('항목별 예산 기준 (나머지 예산)', () => {
  it('항목 예산 없는 항목은 총예산 − 항목 예산 합을 함께 쓴다', () => {
    // 총예산 90만, 항목 예산 60만 → 나머지 30만. 식비 12만 · 기타 3만 = 15만 씀
    const d = ledger({
      trips: [trip()],
      expenses: [
        tripExpense({ amount: 280_000, tripItem: 'flight' }),
        tripExpense({ amount: 120_000, tripItem: 'food' }),
        tripExpense({ amount: 30_000, tripItem: null }),
      ],
    });
    const { pool, lines } = tripItemLines(tripStatus(d, d.trips[0]!, TODAY));
    expect(pool).toEqual({ budget: 300_000, spent: 150_000, remaining: 150_000 });
    expect(lines.map((l) => [l.item, l.basis, l.state])).toEqual([
      ['flight', 'own', 'near'],
      ['stay', 'own', 'ok'],
      ['food', 'pool', 'ok'],
      ['other', 'pool', 'ok'],
    ]);
  });

  it('나머지 예산을 넘으면 예산 없는 항목 모두 over', () => {
    const d = ledger({
      trips: [trip()],
      expenses: [tripExpense({ amount: 250_000, tripItem: 'food' }), tripExpense({ amount: 80_000, tripItem: 'tour' })],
    });
    const { pool, lines } = tripItemLines(tripStatus(d, d.trips[0]!, TODAY));
    expect(pool).toEqual({ budget: 300_000, spent: 330_000, remaining: -30_000 });
    expect(lines.filter((l) => l.basis === 'pool').map((l) => l.state)).toEqual(['over', 'over']);
  });

  it('총예산이 없거나 나머지가 없으면 예산 밖', () => {
    for (const t of [trip({ budget: 0 }), trip({ budget: 600_000 }), trip({ budget: 500_000 })]) {
      const d = ledger({ trips: [t], expenses: [tripExpense({ amount: 40_000, tripItem: 'food' })] });
      const { pool, lines } = tripItemLines(tripStatus(d, t, TODAY));
      expect(pool).toBeNull();
      expect(lines.find((l) => l.item === 'food')).toMatchObject({ basis: 'outside', state: 'near', spent: 40_000 });
    }
  });

  it('쓴 정도: 90% 이상 near, 넘으면 over, 예산 없으면 쓴 돈이 있을 때만 near', () => {
    expect(tripSpendState(89, 100)).toBe('ok');
    expect(tripSpendState(90, 100)).toBe('near');
    expect(tripSpendState(100, 100)).toBe('near');
    expect(tripSpendState(101, 100)).toBe('over');
    expect(tripSpendState(0, null)).toBe('ok');
    expect(tripSpendState(1, null)).toBe('near');
  });
});

describe('남은 예산을 예측 달로 나누기', () => {
  it('여러 달에 걸치면 날 수 비율로 나누고 나머지는 첫 달에', () => {
    // 12/29 ~ 1/2: 12월 3일 · 1월 2일
    expect(spreadTripRemaining({ startDate: '2026-12-29', endDate: '2027-01-02' }, 1_000_001, TODAY)).toEqual([
      { month: '2026-12', amount: 600_001 },
      { month: '2027-01', amount: 400_000 },
    ]);
  });

  it('여행 중이면 오늘부터, 끝난 여행 · 남은 돈 0 은 넣지 않는다', () => {
    expect(spreadTripRemaining({ startDate: '2026-10-30', endDate: '2026-11-10' }, 200_000, TODAY)).toEqual([
      { month: '2026-11', amount: 200_000 },
    ]);
    expect(spreadTripRemaining({ startDate: '2026-10-01', endDate: '2026-10-03' }, 200_000, TODAY)).toEqual([]);
    expect(spreadTripRemaining({ startDate: '2027-01-01', endDate: '2027-01-03' }, 0, TODAY)).toEqual([]);
    expect(spreadTripRemaining({ startDate: '2027-01-01', endDate: '2027-01-03' }, -5, TODAY)).toEqual([]);
  });

  it('끝나는 날이 시작일보다 앞이면 시작일 하루로 본다', () => {
    expect(spreadTripRemaining({ startDate: '2027-01-05', endDate: '2027-01-01' }, 10_000, TODAY)).toEqual([
      { month: '2027-01', amount: 10_000 },
    ]);
  });
});

describe('이벤트통장 예측 (두 번 빠지지 않게)', () => {
  const base = () => ledger({ trips: [trip()] });
  const feb = (d: LedgerData) => projectEventAccount(d, TODAY).months.find((m) => m.month === '2027-02')!;
  const lastEnd = (d: LedgerData) => projectEventAccount(d, TODAY).months.at(-1)!.endBalance;

  it('남은 예산이 여행 달에 나가는 돈으로 들어간다', () => {
    const m = feb(base());
    expect(m.trips).toBe(900_000);
    expect(m.tripList).toEqual([{ id: 'trip', name: '제주 여행', amount: 900_000 }]);
    expect(projectEventAccount(base(), TODAY).months[0]!.trips).toBeUndefined();
    expect(lastEnd(base())).toBe(100_000);
  });

  it('이벤트통장에서 이미 낸 돈은 잔액에서 빠지고 남은 예산에서도 빠져 전체는 같다', () => {
    const d = { ...base(), expenses: [tripExpense({ amount: 300_000, tripItem: 'flight' })] };
    expect(accountBalance(d, 'event', TODAY)).toBe(700_000);
    expect(feb(d).trips).toBe(600_000);
    expect(lastEnd(d)).toBe(lastEnd(base()));
  });

  it('오늘 뒤 날짜의 지출 · 청구도 한 번만 빠진다', () => {
    const later = { ...base(), expenses: [tripExpense({ date: '2026-12-15', amount: 300_000 })] };
    expect(lastEnd(later)).toBe(lastEnd(base()));
    const claim = {
      ...base(),
      expenses: [tripExpense({ amount: 300_000, paidBy: '가람', claimAccountId: 'inc', claimDue: '2026-11-21' })],
    };
    expect(projectEventAccount(claim, TODAY).months[0]!.claims).toBe(300_000);
    expect(lastEnd(claim)).toBe(lastEnd(base()));
  });

  it('일정과 여행에 함께 묶인 지출도 한 번만 빠진다 (여행 쪽에서만 센다)', () => {
    const withEvent = { ...base(), events: [event({ id: 'e1', date: '2027-02-20', amount: 200_000, accountId: 'event' })] };
    const before = lastEnd(withEvent);
    const tripOnly = { ...withEvent, expenses: [tripExpense({ date: '2026-11-05', amount: 100_000 })] };
    const both = { ...withEvent, expenses: [tripExpense({ date: '2026-11-05', amount: 100_000, eventId: 'e1' })] };
    expect(lastEnd(tripOnly)).toBe(before);
    expect(lastEnd(both)).toBe(before);
    expect(feb(both).planned).toBe(200_000);
    // 여행을 지우면 일정에 묶인 지출로 센다
    const gone = { ...both, trips: [trip({ deleted: true })] };
    expect(feb(gone).planned).toBe(100_000);
  });

  it('저수지에서 낸 돈은 이벤트통장에서 나갈 돈을 줄인다', () => {
    const d = { ...base(), expenses: [tripExpense({ amount: 400_000, accountId: 'res' })] };
    expect(feb(d).trips).toBe(500_000);
    expect(lastEnd(d)).toBe(lastEnd(base()) + 400_000);
  });

  it('예산을 넘게 쓰면 더 넣지 않고, 지운 여행은 빠진다', () => {
    const over = { ...base(), expenses: [tripExpense({ amount: 1_000_000 })] };
    expect(feb(over).trips).toBeUndefined();
    expect(tripOutflows({ ...base(), trips: [trip({ deleted: true })] }, TODAY)).toEqual([]);
  });

  it('모자라면 ① · ② 제안이 그대로 나온다', () => {
    const d = ledger({
      accounts: [incomeAcc, { ...eventAcc, openingBalance: 100_000 }, reservoirAcc],
      rules: [rule({ fromAccountId: 'inc', toAccountId: 'event', amount: 100_000, startMonth: '2026-11' })],
      trips: [trip({ budget: 1_200_000, items: {} })],
    });
    const p = projectEventAccount(d, TODAY);
    expect(p.shortages[0]).toEqual({ month: '2027-02', amount: 700_000 });
    const fix = suggestShortageFixes(d, TODAY, p);
    expect(fix.increaseMonthly?.toMonth).toBe('2027-02');
    expect(fix.fromReservoir).toMatchObject({ month: '2027-02', amount: 700_000, reservoirAccountId: 'res' });
  });
});

describe('사도 돼? — 여행에 쓸 돈의 할부 안내', () => {
  it('여행을 고르면 회차를 여행에 묶어 보아 같은 돈을 두 번 세지 않는다', () => {
    // 시작 1,000,000 · 여행 예산 900,000 → 끝 잔액 100,000. 여행 예산 안의 400,000 할부는 앞당겨질 뿐
    const d = ledger({ trips: [trip()] });
    const withTrip = judgeInstallment({ source: 'event', data: d, today: TODAY, tripId: 'trip' }, 400_000)!;
    expect(withTrip.fits).toBe(true);
    expect(withTrip.message).toBe('12개월 할부면 매달 33,333원이에요. 이벤트통장 일정에도 문제없어요');
    expect(judgeEvent(d, TODAY, 400_000, { tripId: 'trip' }).signal).toBe('ok');
    // 여행 없이 보면 400,000 이 더 나가 모자란다
    expect(judgeInstallment({ source: 'event', data: d, today: TODAY }, 400_000)!.fits).toBe(false);
  });
});

describe('사도 돼? — 여행에 쓸 돈', () => {
  it('여행 남은 예산 안이면 예측 끝은 그대로이고 예산 안이라고 알려 준다', () => {
    const d = ledger({ trips: [trip()] });
    const v = judgeEvent(d, TODAY, 300_000, { tripId: 'trip' });
    expect(v.signal).toBe('ok');
    expect(v.message).toBe('제주 여행 예산 안이에요. 예정된 일정에도 문제없어요');
    expect(v.details).toContainEqual({ label: '제주 여행 남은 예산', value: '600,000원' });
    expect(v.projectionAfter!.currentBalance).toBe(1_000_000);
    expect(v.projectionAfter!.months.at(-1)!.endBalance).toBe(projectEventAccount(d, TODAY).months.at(-1)!.endBalance);
    // 여행 없이 보면 같은 돈이 한 번 더 나간다
    const plain = judgeEvent(d, TODAY, 300_000);
    expect(plain.projectionAfter!.months.at(-1)!.endBalance).toBe(v.projectionAfter!.months.at(-1)!.endBalance - 300_000);
  });

  it('여행 예산을 넘으면 넘는 돈만 더 나간다', () => {
    const d = ledger({ trips: [trip()] });
    const v = judgeEvent(d, TODAY, 1_000_000, { tripId: 'trip' });
    expect(v.signal).toBe('ok');
    expect(v.message).toBe('제주 여행 예산은 100,000원 넘지만 일정에는 문제없어요');
    expect(v.details).toContainEqual({ label: '제주 여행 남은 예산', value: '100,000원 넘어요' });
    expect(v.projectionAfter!.months.at(-1)!.endBalance).toBe(0);
  });
});

describe('입력과 문구', () => {
  it('validateTrip', () => {
    const ok = { name: '제주', startDate: '2027-02-20', endDate: '2027-02-23', budget: 100 };
    expect(validateTrip(ok)).toBeNull();
    expect(validateTrip({ ...ok, name: ' ' })).toBe('여행 이름을 입력해 주세요');
    expect(validateTrip({ ...ok, endDate: '2027-02-19' })).toBe('돌아오는 날이 떠나는 날보다 빨라요');
    expect(validateTrip({ ...ok, budget: 0 })).toBe('예산을 입력해 주세요');
    expect(validateTrip({ ...ok, budget: 0, items: { flight: 10 } })).toBeNull();
  });

  it('카테고리로 항목 짐작 · 기간 문구', () => {
    expect(tripItemForCategory('교통')).toBe('transport');
    expect(tripItemForCategory('식비')).toBe('food');
    expect(tripItemForCategory('여행')).toBeNull();
    expect(tripPeriodText({ startDate: '2027-02-20', endDate: '2027-02-23' })).toBe('2월 20일~23일 (3박 4일)');
    expect(tripPeriodText({ startDate: '2026-12-30', endDate: '2027-01-02' })).toBe('12월 30일~1월 2일 (3박 4일)');
    expect(tripPeriodText({ startDate: '2027-02-20', endDate: '2027-02-20' })).toBe('2월 20일');
  });
});

describe('체험 모드 여행', () => {
  for (const today of ['2026-11-09', '2026-11-01', '2026-12-31']) {
    it(`제주 여행 일정 대신 여행으로 두어도 부족 금액이 같다 (${today})`, () => {
      const plain = createDemoLedger(today, NOW, { claims: true });
      const d = createDemoLedger(today, NOW, { claims: true, trips: true });
      expect(d.events.some((e) => e.id === 'demo-event-jeju')).toBe(false);
      const s = tripStatus(d, d.trips.find((t) => t.id === DEMO_TRIP_ID)!, today);
      expect(s.spent).toBe(450_000);
      expect(s.remaining).toBe(450_000);
      expect(s.phase).toBe('upcoming');
      expect(projectEventAccount(d, today).shortages).toEqual(projectEventAccount(plain, today).shortages);
      const noClaims = createDemoLedger(today, NOW, { trips: true });
      expect(tripStatus(noClaims, noClaims.trips[0]!, today).spent).toBe(450_000);
      expect(projectEventAccount(noClaims, today).shortages).toEqual(projectEventAccount(plain, today).shortages);
    });
  }
});
