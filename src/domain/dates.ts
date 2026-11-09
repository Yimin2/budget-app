import type { ISODate, YearMonth } from './types';

const pad2 = (n: number) => String(n).padStart(2, '0');
const pad4 = (n: number) => String(n).padStart(4, '0');

function parseYM(month: YearMonth): [number, number] {
  return [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
}
function parseDate(date: ISODate): [number, number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
}
function fromUTC(ms: number): ISODate {
  const d = new Date(ms);
  return `${pad4(d.getUTCFullYear())}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 로컬 시간 기준 오늘 'YYYY-MM-DD' */
export function toISODate(d: Date): ISODate {
  return `${pad4(d.getFullYear())}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/**
 * 저장된 시각(ISO 8601, 보통 UTC 'Z')을 이 기기 시간대의 날짜로. 해석할 수 없으면 앞 10글자가 날짜일 때만 그대로, 아니면 null.
 * 예: 한국에서 '2026-11-30T23:30:00.000Z' → '2026-12-01'
 */
export function localDateOf(timestamp: string | null | undefined): ISODate | null {
  if (!timestamp) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(timestamp)) return timestamp;
  const ms = Date.parse(timestamp);
  if (Number.isFinite(ms)) return toISODate(new Date(ms));
  const head = timestamp.slice(0, 10);
  return isValidDate(head) ? head : null;
}
export function monthOf(date: ISODate): YearMonth {
  return date.slice(0, 7);
}
export function addMonths(month: YearMonth, n: number): YearMonth {
  const [y, m] = parseYM(month);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = idx - ny * 12 + 1;
  return `${pad4(ny)}-${pad2(nm)}`;
}
export function addDays(date: ISODate, n: number): ISODate {
  const [y, m, d] = parseDate(date);
  return fromUTC(Date.UTC(y, m - 1, d) + n * 86_400_000);
}
export function daysInMonth(month: YearMonth): number {
  const [y, m] = parseYM(month);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** 오늘 포함 말일까지 남은 날 수 */
export function daysLeftInMonth(date: ISODate): number {
  const day = Number(date.slice(8, 10));
  return daysInMonth(monthOf(date)) - day + 1;
}
/** month 의 day 일 (말일보다 크면 말일) */
export function dateInMonth(month: YearMonth, day: number): ISODate {
  const d = Math.min(Math.max(1, Math.floor(day)), daysInMonth(month));
  return `${month}-${pad2(d)}`;
}
/** a < b 이면 음수 (월 비교) */
export function compareMonth(a: YearMonth, b: YearMonth): number {
  const [ay, am] = parseYM(a);
  const [by, bm] = parseYM(b);
  return ay * 12 + am - (by * 12 + bm);
}
/** 'YYYY-MM' (01~12월) 꼴인지. 시트에서 빈 칸·이상한 값이 들어와도 계산이 폭주하지 않게 확인한다 */
export function isValidMonth(month: unknown): month is YearMonth {
  return typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}
/** 'YYYY-MM-DD' 꼴인지 */
export function isValidDate(date: unknown): date is ISODate {
  return typeof date === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date);
}
/** from 부터 to 까지(포함) 월 목록. 둘 중 하나라도 'YYYY-MM' 이 아니면 빈 목록 */
export function monthRange(from: YearMonth, to: YearMonth): YearMonth[] {
  if (!isValidMonth(from) || !isValidMonth(to)) return [];
  const n = compareMonth(to, from);
  const out: YearMonth[] = [];
  for (let i = 0; i <= n; i++) out.push(addMonths(from, i));
  return out;
}
/** '2026-11' → '11월', 연도가 기준과 다르면 '2027년 1월' */
export function formatMonthKo(month: YearMonth, baseYear?: number): string {
  const [y, m] = parseYM(month);
  if (baseYear !== undefined && y !== baseYear) return `${y}년 ${m}월`;
  return `${m}월`;
}

const WEEKDAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

/** '2026-11-10' → '11월 10일 화요일' (요일 포함 여부 옵션, 기본 포함) */
export function formatDateKo(date: ISODate, withWeekday = true): string {
  const [y, m, d] = parseDate(date);
  const base = `${m}월 ${d}일`;
  if (!withWeekday) return base;
  return `${base} ${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`;
}
/** '2026-11-10' → '11/10' */
export function formatShortDate(date: ISODate): string {
  const [, m, d] = parseDate(date);
  return `${m}/${d}`;
}
/** 월이 [start, end] 기간 안인지 (end null = 계속). 시작월이 올바르지 않으면 늘 false */
export function isMonthActive(month: YearMonth, start: YearMonth, end: YearMonth | null): boolean {
  if (!isValidMonth(month) || !isValidMonth(start)) return false;
  if (compareMonth(month, start) < 0) return false;
  if (end !== null && isValidMonth(end) && compareMonth(month, end) > 0) return false;
  return true;
}
