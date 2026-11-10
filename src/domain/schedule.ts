/**
 * 생활비 항목의 '쓰는 날' (PLAN 4-1): 요일 · 공휴일 빼기로 하루 예산을 나누거나, 주 N회로 한 번에 쓸 돈을 나눠요.
 * 모두 순수 함수. 공휴일은 holidays.ts 의 표 (표 밖의 해는 요일만 봐요).
 */
import { addDays, daysInMonth, monthOf } from './dates';
import { isKoreanHoliday } from './holidays';
import { floorTo100 } from './money';
import type { FixedExpense, ISODate, LivingSchedule, LivingWeekly, Won, YearMonth } from './types';

/** 요일 짧은 이름 (0=일 … 6=토) */
export const WEEKDAY_SHORT = ['일', '월', '화', '수', '목', '금', '토'] as const;
/** 요일 이름 */
export const WEEKDAY_LONG = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'] as const;
/** 화면 순서 (월 → 일) */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const WEEKENDS = [0, 6];

/** 매일 (예전 계산과 같다) */
export const EVERY_DAY: LivingSchedule = { days: null, skipHolidays: false, perWeek: null };

/** 쓰는 요일 정리: 0~6 만, 겹침 빼고 오름차순. 비었거나 7개 모두면 null (매일) */
export function normalizeDays(days: unknown): number[] | null {
  if (!Array.isArray(days)) return null;
  const set = new Set<number>();
  for (const d of days) if (typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6) set.add(d);
  if (set.size === 0 || set.size === 7) return null;
  return [...set].sort((a, b) => a - b);
}

/** 주 N회 정리: 1~7 정수만, 아니면 null */
export function normalizePerWeek(n: unknown): number | null {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 7 ? n : null;
}

/** 고정지출 행의 쓰는 날 (빈 칸 · 없음 = 매일) */
export function scheduleOf(row: Pick<FixedExpense, 'useDays' | 'skipHolidays' | 'perWeek'>): LivingSchedule {
  const perWeek = normalizePerWeek(row.perWeek);
  if (perWeek !== null) return { days: null, skipHolidays: false, perWeek };
  return { days: normalizeDays(row.useDays), skipHolidays: row.skipHolidays === true, perWeek: null };
}

/** 매일 · 공휴일도 쓰는 (예전과 같은) 쓰는 날인지 */
export function isEveryDay(s: LivingSchedule): boolean {
  return s.perWeek === null && s.days === null && !s.skipHolidays;
}

export type ScheduleMode = 'all' | 'weekdays' | 'weekends' | 'custom' | 'weekly';

const sameDays = (a: number[] | null, b: number[]) => !!a && a.length === b.length && a.every((d, i) => d === b[i]);

/** 화면의 쓰는 날 고르기 값 */
export function scheduleMode(s: LivingSchedule): ScheduleMode {
  if (s.perWeek !== null) return 'weekly';
  if (s.days === null) return 'all';
  if (sameDays(s.days, WEEKDAYS)) return 'weekdays';
  if (sameDays(s.days, WEEKENDS)) return 'weekends';
  return 'custom';
}

/** 짧은 표시: '평일 · 공휴일 빼기' · '월 · 수 · 금' · '주 2회'. 매일이면 '' */
export function scheduleLabel(s: LivingSchedule): string {
  if (s.perWeek !== null) return `주 ${s.perWeek}회`;
  const mode = scheduleMode(s);
  const days =
    mode === 'all'
      ? '매일'
      : mode === 'weekdays'
        ? '평일'
        : mode === 'weekends'
          ? '주말'
          : WEEK_ORDER.filter((d) => s.days!.includes(d)).map((d) => WEEKDAY_SHORT[d]).join(' · ');
  if (!s.skipHolidays) return mode === 'all' ? '' : days;
  return `${days} · 공휴일 빼기`;
}

/** 요일 (0=일 … 6=토) */
export function weekdayOf(date: ISODate): number {
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))).getUTCDay();
}

/** 이 날이 쓰는 날인지 (요일 · 공휴일 · 쉬는 날). 주 N회는 늘 true (횟수로 본다) */
export function isUseDay(date: ISODate, s: LivingSchedule, daysOff: ReadonlySet<string> = new Set()): boolean {
  if (s.perWeek !== null) return true;
  if (s.days !== null && !s.days.includes(weekdayOf(date))) return false;
  if (s.skipHolidays && (isKoreanHoliday(date) || daysOff.has(date))) return false;
  return true;
}

function monthEnd(month: YearMonth): ISODate {
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
}

/** 오늘부터 말일까지(오늘 포함) 쓰는 날 목록 */
export function useDatesLeft(today: ISODate, s: LivingSchedule, daysOff: ReadonlySet<string> = new Set()): ISODate[] {
  const end = monthEnd(monthOf(today));
  const out: ISODate[] = [];
  for (let d = today; d <= end; d = addDays(d, 1)) if (isUseDay(d, s, daysOff)) out.push(d);
  return out;
}

/** 그 주 월요일 */
export function mondayOf(date: ISODate): ISODate {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

/**
 * 한 주(월~일)의 이번 달 몫 = 올림(N × 그 주에서 이번 달에 든 날 수 ÷ 7).
 * 한 주가 다 이번 달이면 N, 달 처음 · 끝의 짧은 주는 날 수만큼 나눠요 (하루라도 있으면 1회 이상)
 */
export function weekQuota(perWeek: number, monday: ISODate, month: YearMonth): number {
  let days = 0;
  for (let i = 0; i < 7; i++) if (monthOf(addDays(monday, i)) === month) days++;
  if (days === 0) return 0;
  return Math.ceil((perWeek * days) / 7);
}

/** 쓰는 날 항목의 하루 예산 */
export interface UseDayPlan {
  dailyBudget: Won;
  todayAvailable: Won;
  today: boolean;
  daysLeft: number;
  daysAfterToday: number;
  next: { date: ISODate; amount: Won } | null;
}

/**
 * 쓰는 날로 나눈 하루 예산. 쓰는 날이 이번 달에 더 없으면 null (한 달 한도만처럼 봐요).
 * - 오늘이 쓰는 날: 하루 예산 = 100원 내림((남은 돈 + 오늘 쓴 돈) ÷ 오늘 포함 남은 쓰는 날), 0 아래면 0
 * - 쉬는 날: 오늘 몫 0. 다음 쓰는 날 하루 예산 = 100원 내림(남은 돈 ÷ 남은 쓰는 날) (0 아래면 0)
 */
export function useDayPlan(
  remaining: Won, spentToday: Won, today: ISODate, s: LivingSchedule, daysOff: ReadonlySet<string> = new Set(),
): UseDayPlan | null {
  const dates = useDatesLeft(today, s, daysOff);
  if (dates.length === 0) return null;
  const isToday = dates[0] === today;
  if (isToday) {
    const start = remaining + spentToday;
    const dailyBudget = start > 0 ? floorTo100(start / dates.length) : 0;
    return {
      dailyBudget, todayAvailable: dailyBudget - spentToday, today: true, daysLeft: dates.length, daysAfterToday: dates.length - 1, next: null,
    };
  }
  return {
    dailyBudget: 0,
    todayAvailable: 0,
    today: false,
    daysLeft: dates.length,
    daysAfterToday: dates.length,
    next: { date: dates[0]!, amount: remaining > 0 ? floorTo100(remaining / dates.length) : 0 },
  };
}

/**
 * 주 N회 항목 (PLAN 4-1). usedDates = 이번 달에 이 항목 지출이 1건 이상 있는 날.
 * - 이번 주 몫 Q = weekQuota(N, 이번 주 월요일), 이번 주 쓴 날 = 이번 주(이번 달 안) 지출 있는 날 수
 * - 앞으로의 몫 F = 다음 주부터 이번 달에 걸친 주마다 weekQuota 합 (마지막 짧은 주는 날 수만큼)
 * - 오늘 안 썼으면: 이번 주 남은 L = max(0, Q − 쓴 날), 남은 횟수 U = L + F,
 *   한 번에 쓸 돈 = 100원 내림(남은 돈 ÷ U), 오늘 써도 되는 돈 = L > 0 이면 한 번에 쓸 돈, 아니면 0
 * - 오늘 썼으면: 오늘이 한 번. L = max(0, Q − 쓴 날(오늘 포함)), U = 1 + L + F,
 *   한 번에 쓸 돈 = 100원 내림((남은 돈 + 오늘 쓴 돈) ÷ U), 오늘 써도 되는 돈 = 한 번에 쓸 돈 − 오늘 쓴 돈
 * U = 0 이면 null (한 달 한도만처럼 봐요)
 */
export function weeklyPlan(
  remaining: Won, spentToday: Won, today: ISODate, perWeek: number, usedDates: ReadonlySet<ISODate>,
): (LivingWeekly & { dailyBudget: Won; todayAvailable: Won }) | null {
  const month = monthOf(today);
  const monday = mondayOf(today);
  const sunday = addDays(monday, 6);
  const quota = weekQuota(perWeek, monday, month);
  const usedToday = usedDates.has(today);
  let usedOther = 0;
  for (const d of usedDates) if (d !== today && d >= monday && d <= sunday && monthOf(d) === month) usedOther++;
  let future = 0;
  for (let m = addDays(monday, 7); monthOf(m) === month; m = addDays(m, 7)) future += weekQuota(perWeek, m, month);
  const usedThisWeek = usedOther + (usedToday ? 1 : 0);

  if (usedToday) {
    const leftThisWeek = Math.max(0, quota - usedThisWeek);
    const usesLeft = 1 + leftThisWeek + future;
    const start = remaining + spentToday;
    const perUse = start > 0 ? floorTo100(start / usesLeft) : 0;
    return { perWeek, usedThisWeek, usedToday, leftThisWeek, usesLeft, perUse, dailyBudget: perUse, todayAvailable: perUse - spentToday };
  }
  const leftThisWeek = Math.max(0, quota - usedOther);
  const usesLeft = leftThisWeek + future;
  if (usesLeft === 0) return null;
  const perUse = remaining > 0 ? floorTo100(remaining / usesLeft) : 0;
  const todayAvailable = leftThisWeek > 0 ? perUse : 0;
  return { perWeek, usedThisWeek, usedToday, leftThisWeek, usesLeft, perUse, dailyBudget: todayAvailable, todayAvailable };
}
