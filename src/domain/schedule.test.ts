import {
  EVERY_DAY, isEveryDay, isUseDay, mondayOf, normalizeDays, scheduleLabel, scheduleMode, scheduleOf, useDatesLeft, useDayPlan,
  weekdayOf, weeklyPlan, weekQuota,
} from './schedule';
import type { LivingSchedule } from './types';

const WEEKDAY_SKIP: LivingSchedule = { days: [1, 2, 3, 4, 5], skipHolidays: true, perWeek: null };
const WEEKDAY_ONLY: LivingSchedule = { days: [1, 2, 3, 4, 5], skipHolidays: false, perWeek: null };
const WEEKEND: LivingSchedule = { days: [0, 6], skipHolidays: false, perWeek: null };

describe('쓰는 날 정리 · 표시', () => {
  it('행의 빈 칸은 매일, 주 N회가 있으면 요일 · 공휴일 칸은 안 봐요', () => {
    expect(scheduleOf({})).toEqual(EVERY_DAY);
    expect(isEveryDay(scheduleOf({ useDays: null, skipHolidays: false, perWeek: null }))).toBe(true);
    expect(scheduleOf({ useDays: [5, 1, 1, 9], skipHolidays: true })).toEqual({ days: [1, 5], skipHolidays: true, perWeek: null });
    expect(scheduleOf({ useDays: [1, 2], skipHolidays: true, perWeek: 2 })).toEqual({ days: null, skipHolidays: false, perWeek: 2 });
    expect(scheduleOf({ perWeek: 0 }).perWeek).toBeNull();
    expect(scheduleOf({ perWeek: 8 }).perWeek).toBeNull();
    expect(normalizeDays([0, 1, 2, 3, 4, 5, 6])).toBeNull();
    expect(normalizeDays([])).toBeNull();
  });

  it('짧은 표시와 고르기 값', () => {
    expect(scheduleLabel(EVERY_DAY)).toBe('');
    expect(scheduleLabel(WEEKDAY_SKIP)).toBe('평일 · 공휴일 빼기');
    expect(scheduleLabel(WEEKEND)).toBe('주말');
    expect(scheduleLabel({ days: [0, 1, 3], skipHolidays: false, perWeek: null })).toBe('월 · 수 · 일');
    expect(scheduleLabel({ days: null, skipHolidays: true, perWeek: null })).toBe('매일 · 공휴일 빼기');
    expect(scheduleLabel({ days: null, skipHolidays: false, perWeek: 2 })).toBe('주 2회');
    expect(scheduleMode(WEEKDAY_SKIP)).toBe('weekdays');
    expect(scheduleMode(WEEKEND)).toBe('weekends');
    expect(scheduleMode({ days: [1, 3], skipHolidays: false, perWeek: null })).toBe('custom');
    expect(scheduleMode({ days: null, skipHolidays: false, perWeek: 1 })).toBe('weekly');
  });
});

describe('쓰는 날 세기', () => {
  it('2026-11-10(화)부터 평일: 15일 (11월은 공휴일 없음)', () => {
    expect(weekdayOf('2026-11-10')).toBe(2);
    expect(useDatesLeft('2026-11-10', WEEKDAY_SKIP)).toHaveLength(15);
    expect(useDatesLeft('2026-11-10', EVERY_DAY)).toHaveLength(21);
  });

  it('공휴일 빼기: 12월 21일(월)부터 평일 9일 중 성탄절을 빼면 8일', () => {
    expect(useDatesLeft('2026-12-21', WEEKDAY_ONLY)).toHaveLength(9);
    expect(useDatesLeft('2026-12-21', WEEKDAY_SKIP)).toHaveLength(8);
    expect(isUseDay('2026-12-25', WEEKDAY_SKIP)).toBe(false);
    expect(isUseDay('2026-12-25', WEEKDAY_ONLY)).toBe(true);
  });

  it('추석 연휴 · 대체공휴일도 빼요 (2026년 9월 24~25일, 10월 5일)', () => {
    expect(useDatesLeft('2026-09-21', WEEKDAY_SKIP)).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-28', '2026-09-29', '2026-09-30']);
    expect(isUseDay('2026-10-05', WEEKDAY_SKIP)).toBe(false);
  });

  it('쉬는 날(회사 휴무)도 공휴일 빼기 항목에서만 빼요', () => {
    const off = new Set(['2026-11-13', '2026-11-14']);
    expect(useDatesLeft('2026-11-10', WEEKDAY_SKIP, off)).toHaveLength(14);
    expect(useDatesLeft('2026-11-10', WEEKDAY_ONLY, off)).toHaveLength(15);
  });

  it('표 밖의 해는 요일만 봐요 (2029-01-01 월요일도 쓰는 날)', () => {
    expect(weekdayOf('2029-01-01')).toBe(1);
    expect(isUseDay('2029-01-01', WEEKDAY_SKIP)).toBe(true);
  });

  it('월요일과 주 몫: 꽉 찬 주는 N, 달 끝 짧은 주는 올림(N × 날 수 ÷ 7)', () => {
    expect(mondayOf('2026-11-10')).toBe('2026-11-09');
    expect(mondayOf('2026-11-08')).toBe('2026-11-02');
    expect(mondayOf('2026-11-30')).toBe('2026-11-30');
    expect(weekQuota(2, '2026-11-09', '2026-11')).toBe(2);
    expect(weekQuota(2, '2026-11-30', '2026-11')).toBe(1); // 11월 30일 하루
    expect(weekQuota(2, '2026-10-26', '2026-11')).toBe(1); // 11월 1일(일) 하루
    expect(weekQuota(2, '2026-12-28', '2026-12')).toBe(2); // 12월 28~31일 4일 → 올림(8/7)
    expect(weekQuota(3, '2026-12-28', '2026-12')).toBe(2); // 올림(12/7)
    expect(weekQuota(7, '2026-11-30', '2026-11')).toBe(1);
  });
});

describe('쓰는 날 하루 예산', () => {
  it('오늘이 쓰는 날: (남은 돈 + 오늘 쓴 돈) ÷ 오늘 포함 남은 쓰는 날, 100원 내림', () => {
    const p = useDayPlan(219_000, 0, '2026-11-10', WEEKDAY_SKIP)!;
    expect(p).toMatchObject({ dailyBudget: 14_600, todayAvailable: 14_600, today: true, daysLeft: 15, daysAfterToday: 14, next: null });
    const spent = useDayPlan(209_000, 10_000, '2026-11-10', WEEKDAY_SKIP)!;
    expect(spent.dailyBudget).toBe(14_600);
    expect(spent.todayAvailable).toBe(4_600);
    expect(useDayPlan(100_000, 0, '2026-11-10', WEEKDAY_SKIP)!.dailyBudget).toBe(6_600); // 6,666 → 6,600
  });

  it('쉬는 날: 오늘 몫 0, 다음 쓰는 날과 그날 하루 예산', () => {
    const p = useDayPlan(219_000, 0, '2026-11-14', WEEKDAY_SKIP)!; // 토요일
    expect(p).toMatchObject({ dailyBudget: 0, todayAvailable: 0, today: false, daysLeft: 11, daysAfterToday: 11 });
    expect(p.next).toEqual({ date: '2026-11-16', amount: 19_900 });
    // 쉬는 날에 쓴 돈은 남은 돈에서 빠지고 오늘 몫은 그대로 0
    const spent = useDayPlan(200_000, 19_000, '2026-11-14', WEEKDAY_SKIP)!;
    expect(spent.todayAvailable).toBe(0);
    expect(spent.next!.amount).toBe(18_100);
  });

  it('말일 · 남은 쓰는 날이 없을 때', () => {
    expect(useDayPlan(50_000, 0, '2026-11-30', WEEKDAY_SKIP)).toMatchObject({ dailyBudget: 50_000, daysLeft: 1, daysAfterToday: 0 });
    expect(useDayPlan(50_000, 0, '2026-11-30', WEEKEND)).toBeNull();
    expect(useDayPlan(50_000, 0, '2026-11-28', WEEKDAY_SKIP, new Set(['2026-11-30']))).toBeNull();
    expect(useDayPlan(-5_000, 0, '2026-11-10', WEEKDAY_SKIP)!.dailyBudget).toBe(0);
  });
});

describe('주 N회', () => {
  const used = (...dates: string[]) => new Set(dates);

  it('11월 10일(화), 주 2회: 이번 주 2 + 다음 주들 2 + 2 + 마지막 짧은 주 1 = 7회', () => {
    const p = weeklyPlan(140_000, 0, '2026-11-10', 2, used())!;
    expect(p).toMatchObject({ perWeek: 2, usedThisWeek: 0, usedToday: false, leftThisWeek: 2, usesLeft: 7, perUse: 20_000 });
    expect(p.todayAvailable).toBe(20_000);
  });

  it('이번 주에 한 번 썼으면 남은 1회, 지난주 · 지난달 쓴 날은 세지 않아요', () => {
    const p = weeklyPlan(120_000, 0, '2026-11-10', 2, used('2026-11-09', '2026-11-05'))!;
    expect(p).toMatchObject({ usedThisWeek: 1, leftThisWeek: 1, usesLeft: 6, perUse: 20_000, todayAvailable: 20_000 });
  });

  it('이번 주를 다 쓰면 오늘 몫 0 (한 번에 쓸 돈은 다음 주부터)', () => {
    const p = weeklyPlan(100_000, 0, '2026-11-12', 2, used('2026-11-09', '2026-11-11'))!;
    expect(p).toMatchObject({ leftThisWeek: 0, usesLeft: 5, perUse: 20_000, todayAvailable: 0, dailyBudget: 0 });
  });

  it('오늘 썼으면 오늘이 한 번: (남은 돈 + 오늘 쓴 돈) ÷ (1 + 이번 주 남은 + 앞으로)', () => {
    const p = weeklyPlan(115_000, 25_000, '2026-11-10', 2, used('2026-11-10'))!;
    expect(p).toMatchObject({ usedThisWeek: 1, usedToday: true, leftThisWeek: 1, usesLeft: 7, perUse: 20_000, todayAvailable: -5_000 });
  });

  it('마지막 짧은 주: 11월 30일(월)은 주 2회여도 1회, 그것도 쓰면 남은 횟수 없음', () => {
    const p = weeklyPlan(30_000, 0, '2026-11-30', 2, used())!;
    expect(p).toMatchObject({ leftThisWeek: 1, usesLeft: 1, perUse: 30_000, todayAvailable: 30_000 });
    expect(weeklyPlan(30_000, 0, '2026-11-29', 2, used('2026-11-23', '2026-11-25'))).toMatchObject({ leftThisWeek: 0, usesLeft: 1 });
    expect(weeklyPlan(0, 0, '2026-11-30', 1, used('2026-11-30'))).toMatchObject({ usesLeft: 1, perUse: 0 });
    expect(weeklyPlan(30_000, 0, '2026-12-31', 1, used('2026-12-28'))).toBeNull();
  });
});
