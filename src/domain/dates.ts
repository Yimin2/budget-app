import type { ISODate, YearMonth } from './types';

/** 로컬 시간 기준 오늘 'YYYY-MM-DD' */
export function toISODate(d: Date): ISODate {
  throw new Error('not implemented');
}
export function monthOf(date: ISODate): YearMonth {
  throw new Error('not implemented');
}
export function addMonths(month: YearMonth, n: number): YearMonth {
  throw new Error('not implemented');
}
export function addDays(date: ISODate, n: number): ISODate {
  throw new Error('not implemented');
}
export function daysInMonth(month: YearMonth): number {
  throw new Error('not implemented');
}
/** 오늘 포함 말일까지 남은 날 수 */
export function daysLeftInMonth(date: ISODate): number {
  throw new Error('not implemented');
}
/** month 의 day 일 (말일보다 크면 말일) */
export function dateInMonth(month: YearMonth, day: number): ISODate {
  throw new Error('not implemented');
}
/** a < b 이면 음수 (월 비교) */
export function compareMonth(a: YearMonth, b: YearMonth): number {
  throw new Error('not implemented');
}
/** from 부터 to 까지(포함) 월 목록 */
export function monthRange(from: YearMonth, to: YearMonth): YearMonth[] {
  throw new Error('not implemented');
}
/** '2026-11' → '11월', 연도가 기준과 다르면 '2027년 1월' */
export function formatMonthKo(month: YearMonth, baseYear?: number): string {
  throw new Error('not implemented');
}
/** '2026-11-10' → '11월 10일 화요일' (요일 포함 여부 옵션) */
export function formatDateKo(date: ISODate, withWeekday?: boolean): string {
  throw new Error('not implemented');
}
/** '2026-11-10' → '11/10' */
export function formatShortDate(date: ISODate): string {
  throw new Error('not implemented');
}
/** 월이 [start, end] 기간 안인지 (end null = 계속) */
export function isMonthActive(month: YearMonth, start: YearMonth, end: YearMonth | null): boolean {
  throw new Error('not implemented');
}
