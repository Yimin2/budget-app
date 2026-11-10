/**
 * 한국 공휴일 표 (2025~2028). 생활비 '쓰는 날'의 '공휴일 빼기'에 써요 (PLAN 4-1).
 *
 * 출처: 「관공서의 공휴일에 관한 규정」 · 「공휴일에 관한 법률」(2021 시행, 2023 개정으로 부처님오신날 · 성탄절 대체공휴일 추가),
 * 한국천문연구원 음력 날짜(설날 · 부처님오신날 · 추석, ICU dangi 달력으로 다시 확인), 정부 발표(2025-01-27 임시공휴일).
 * 대체공휴일 규칙:
 * - 설날 · 추석 연휴가 일요일이나 다른 공휴일과 겹치면 연휴 다음 첫 평일 (토요일은 대체 없음)
 * - 삼일절 · 광복절 · 개천절 · 한글날 · 어린이날 · 부처님오신날 · 성탄절이 토 · 일요일이나 다른 공휴일과 겹치면 다음 첫 평일
 * - 신정 · 현충일은 대체 없음
 * 선거일: 2025-06-03 대통령 선거, 2026-06-03 지방 선거, 2028-04-12 국회의원 선거(법정 날짜 기준 예정).
 * 표에 없는 해(2024 이전 · 2029 이후)는 공휴일을 모른다고 보고 요일만 봐요. 새 해가 정해지면 이 표에 더해 주세요.
 */
import type { ISODate } from './types';

/** 표가 다루는 해 */
export const HOLIDAY_YEARS = { from: 2025, to: 2028 } as const;

/** 날짜 → 공휴일 이름 */
export const KR_HOLIDAYS: Readonly<Record<ISODate, string>> = {
  // 2025
  '2025-01-01': '신정',
  '2025-01-27': '임시공휴일',
  '2025-01-28': '설날 연휴',
  '2025-01-29': '설날',
  '2025-01-30': '설날 연휴',
  '2025-03-01': '삼일절',
  '2025-03-03': '대체공휴일(삼일절)',
  '2025-05-05': '어린이날 · 부처님오신날',
  '2025-05-06': '대체공휴일(어린이날 · 부처님오신날)',
  '2025-06-03': '대통령 선거일',
  '2025-06-06': '현충일',
  '2025-08-15': '광복절',
  '2025-10-03': '개천절',
  '2025-10-05': '추석 연휴',
  '2025-10-06': '추석',
  '2025-10-07': '추석 연휴',
  '2025-10-08': '대체공휴일(추석)',
  '2025-10-09': '한글날',
  '2025-12-25': '성탄절',
  // 2026
  '2026-01-01': '신정',
  '2026-02-16': '설날 연휴',
  '2026-02-17': '설날',
  '2026-02-18': '설날 연휴',
  '2026-03-01': '삼일절',
  '2026-03-02': '대체공휴일(삼일절)',
  '2026-05-05': '어린이날',
  '2026-05-24': '부처님오신날',
  '2026-05-25': '대체공휴일(부처님오신날)',
  '2026-06-03': '지방 선거일',
  '2026-06-06': '현충일',
  '2026-08-15': '광복절',
  '2026-08-17': '대체공휴일(광복절)',
  '2026-09-24': '추석 연휴',
  '2026-09-25': '추석',
  '2026-09-26': '추석 연휴',
  '2026-10-03': '개천절',
  '2026-10-05': '대체공휴일(개천절)',
  '2026-10-09': '한글날',
  '2026-12-25': '성탄절',
  // 2027
  '2027-01-01': '신정',
  '2027-02-06': '설날 연휴',
  '2027-02-07': '설날',
  '2027-02-08': '설날 연휴',
  '2027-02-09': '대체공휴일(설날)',
  '2027-03-01': '삼일절',
  '2027-05-05': '어린이날',
  '2027-05-13': '부처님오신날',
  '2027-06-06': '현충일',
  '2027-08-15': '광복절',
  '2027-08-16': '대체공휴일(광복절)',
  '2027-09-14': '추석 연휴',
  '2027-09-15': '추석',
  '2027-09-16': '추석 연휴',
  '2027-10-03': '개천절',
  '2027-10-04': '대체공휴일(개천절)',
  '2027-10-09': '한글날',
  '2027-10-11': '대체공휴일(한글날)',
  '2027-12-25': '성탄절',
  '2027-12-27': '대체공휴일(성탄절)',
  // 2028
  '2028-01-01': '신정',
  '2028-01-26': '설날 연휴',
  '2028-01-27': '설날',
  '2028-01-28': '설날 연휴',
  '2028-03-01': '삼일절',
  '2028-04-12': '국회의원 선거일',
  '2028-05-02': '부처님오신날',
  '2028-05-05': '어린이날',
  '2028-06-06': '현충일',
  '2028-08-15': '광복절',
  '2028-10-02': '추석 연휴',
  '2028-10-03': '추석 · 개천절',
  '2028-10-04': '추석 연휴',
  '2028-10-05': '대체공휴일(추석)',
  '2028-10-09': '한글날',
  '2028-12-25': '성탄절',
};

/** 이 날짜의 해가 공휴일 표 안인지 */
export function holidayTableCovers(date: ISODate): boolean {
  const y = Number(date.slice(0, 4));
  return y >= HOLIDAY_YEARS.from && y <= HOLIDAY_YEARS.to;
}

/** 공휴일 이름. 공휴일이 아니거나 표 밖이면 null */
export function holidayName(date: ISODate): string | null {
  return KR_HOLIDAYS[date] ?? null;
}

/** 한국 공휴일인지 (표 밖의 해는 늘 false: 요일만 봐요) */
export function isKoreanHoliday(date: ISODate): boolean {
  return date in KR_HOLIDAYS;
}

/**
 * 공휴일 표가 곧 끝나는지: 오늘이 표의 마지막 해 10월 1일 이후거나 표 밖이면 true.
 * 설정에서 '공휴일 표가 곧 끝나요' 안내에 써요
 */
export function holidayTableEndingSoon(today: ISODate): boolean {
  return today >= `${HOLIDAY_YEARS.to}-10-01` || !holidayTableCovers(today);
}

/* ───────── 음력 → 양력 (설날 · 추석 · 음력 생신) ───────── */

/**
 * 음력 해 표 (2020~2040). [음력 해, 그해 음력 1월 1일의 양력 날짜, 윤달(0 = 없음), 달 길이(1 = 30일, 0 = 29일, 윤달 포함 순서)].
 *
 * 왜 표인가: `Intl.DateTimeFormat('ko-u-ca-dangi')`(ICU 단기 달력)는 Node 22 · 최신 Chrome · Safari · Firefox 에 있지만,
 * ICU 데이터를 줄인 환경(small-icu 빌드 · 일부 안드로이드 웹뷰)에서는 단기 달력이 없거나 그레고리력으로 조용히 바뀌어요.
 * 날짜가 기기마다 달라지면 안 되니 ICU dangi 로 한 번 뽑은 값을 여기 박아 두고, 테스트에서 ICU(있을 때)와
 * 공휴일 표(한국천문연구원 날짜)로 다시 맞춰 봐요. 표 밖의 해만 ICU dangi 가 있으면 그것으로 셈하고, 없으면 모른다(null)고 해요.
 * 윤달 생신은 평달 같은 날로 봐요. 그달이 29일까지면 30일은 29일로 써요.
 */
const LUNAR_TABLE: readonly (readonly [number, string, number, string])[] = [
  [2020, '2020-01-25', 4, '1011010010101'],
  [2021, '2021-02-12', 0, '011010101010'],
  [2022, '2022-02-01', 0, '101011010101'],
  [2023, '2023-01-22', 2, '0101010110101'],
  [2024, '2024-02-10', 0, '010010110110'],
  [2025, '2025-01-29', 6, '1010010101110'],
  [2026, '2026-02-17', 0, '101001010111'],
  [2027, '2027-02-07', 0, '010100100111'],
  [2028, '2028-01-27', 5, '0110100100110'],
  [2029, '2029-02-13', 0, '110110010011'],
  [2030, '2030-02-03', 0, '010110101010'],
  [2031, '2031-01-23', 3, '1010101101010'],
  [2032, '2032-02-11', 0, '100101101101'],
  [2033, '2033-01-31', 11, '0100101011101'],
  [2034, '2034-02-19', 0, '010010101110'],
  [2035, '2035-02-08', 0, '101001001101'],
  [2036, '2036-01-28', 6, '1101001001101'],
  [2037, '2037-02-15', 0, '110100100101'],
  [2038, '2038-02-04', 0, '110101010010'],
  [2039, '2039-01-24', 5, '1101101010100'],
  [2040, '2040-02-12', 0, '101101101010'],
];

/** 음력 표가 다루는 해 */
export const LUNAR_YEARS = { from: 2020, to: 2040 } as const;

/** 음력 월 · 일 (윤달이면 leap) */
export interface LunarDate {
  year: number;
  month: number;
  day: number;
  leap: boolean;
}

const LUNAR_DAY_MS = 86_400_000;
const isoToUtc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const utcToIso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** 음력 한 해의 달들 (순서대로 월 · 윤달 · 길이 · 1일의 UTC 시각) */
function lunarMonths(year: number): { month: number; leap: boolean; length: number; start: number }[] | null {
  const row = LUNAR_TABLE.find((r) => r[0] === year);
  if (!row) return null;
  const [, newYear, leapMonth, lengths] = row;
  const out: { month: number; leap: boolean; length: number; start: number }[] = [];
  let start = isoToUtc(newYear);
  for (let i = 0; i < lengths.length; i++) {
    // 윤달은 그 평달 바로 뒤 (예: 윤6월 = 7번째 달)
    const leap = leapMonth > 0 && i === leapMonth;
    const month = leapMonth > 0 && i >= leapMonth ? (leap ? leapMonth : i) : i + 1;
    const length = lengths[i] === '1' ? 30 : 29;
    out.push({ month, leap, length, start });
    start += length * LUNAR_DAY_MS;
  }
  return out;
}

let dangiFormatter: Intl.DateTimeFormat | null | undefined;
/** ICU 단기 달력 (없거나 그레고리력으로 바뀌면 null) */
function dangi(): Intl.DateTimeFormat | null {
  if (dangiFormatter !== undefined) return dangiFormatter;
  try {
    const f = new Intl.DateTimeFormat('en-u-ca-dangi', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
    const ok = f.resolvedOptions().calendar === 'dangi' && lunarPartsOf(f, Date.UTC(2026, 1, 17))?.day === 1;
    dangiFormatter = ok ? f : null;
  } catch {
    dangiFormatter = null;
  }
  return dangiFormatter;
}

function lunarPartsOf(f: Intl.DateTimeFormat, t: number): LunarDate | null {
  const parts = f.formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const monthText = get('month');
  const month = parseInt(monthText, 10);
  const day = parseInt(get('day'), 10);
  const year = parseInt(get('relatedYear') || get('year'), 10);
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return null;
  return { year, month, day, leap: /bis|leap|윤/i.test(monthText) };
}

/**
 * 음력 → 양력. 그해 그달에 없는 30일은 29일로. 윤달(leap)은 그해에 윤달이 없으면 평달로.
 * 표 밖의 해는 ICU 단기 달력으로 셈하고, 그것도 없으면 null
 */
export function lunarToSolar(year: number, month: number, day: number, leap = false): string | null {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 30) return null;
  const months = lunarMonths(year);
  if (months) {
    const target = months.find((m) => m.month === month && m.leap === leap) ?? months.find((m) => m.month === month && !m.leap);
    if (!target) return null;
    return utcToIso(target.start + (Math.min(day, target.length) - 1) * LUNAR_DAY_MS);
  }
  const f = dangi();
  if (!f) return null;
  // 양력 (year-1)-12 ~ (year+1)-02 사이에서 찾는다 (설날은 양력 1월 하순 ~ 2월 하순)
  const from = Date.UTC(year, 0, 1);
  let best: string | null = null;
  for (let t = from; t < Date.UTC(year + 1, 2, 1); t += LUNAR_DAY_MS) {
    const p = lunarPartsOf(f, t);
    if (!p || p.year !== year || p.month !== month || p.leap !== leap) continue;
    if (p.day <= day) best = utcToIso(t);
    else break;
  }
  if (best === null && leap) return lunarToSolar(year, month, day, false);
  return best;
}

/** 양력 → 음력 (표 밖이면 ICU 단기 달력, 그것도 없으면 null) */
export function solarToLunar(date: string): LunarDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = isoToUtc(date);
  const y = Number(date.slice(0, 4));
  for (const year of [y, y - 1]) {
    const months = lunarMonths(year);
    if (!months) continue;
    for (const m of months) {
      if (t >= m.start && t < m.start + m.length * LUNAR_DAY_MS) {
        return { year, month: m.month, day: Math.round((t - m.start) / LUNAR_DAY_MS) + 1, leap: m.leap };
      }
    }
  }
  const f = dangi();
  return f ? lunarPartsOf(f, t) : null;
}

/** 그해 설날 (음력 1월 1일) */
export function seollalDate(year: number): string | null {
  return lunarToSolar(year, 1, 1);
}

/** 그해 추석 (음력 8월 15일) */
export function chuseokDate(year: number): string | null {
  return lunarToSolar(year, 8, 15);
}

/** 음력 월-일 칸 값 'MM-DD' */
export function formatLunarMonthDay(month: number, day: number): string {
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 'MM-DD' → 월 · 일 (말이 안 되면 null) */
export function parseLunarMonthDay(text: string | null | undefined): { month: number; day: number } | null {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec((text ?? '').trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 30) return null;
  return { month, day };
}

/** '음력 8월 15일' */
export function lunarLabel(text: string | null | undefined): string {
  const md = parseLunarMonthDay(text);
  return md ? `음력 ${md.month}월 ${md.day}일` : '';
}

/** 음력 월 · 일이 이 양력 날짜 이후(포함) 처음 오는 양력 날짜 */
export function nextLunarOccurrence(month: number, day: number, onOrAfter: string): string | null {
  const y = Number(onOrAfter.slice(0, 4));
  for (const year of [y - 1, y, y + 1]) {
    const d = lunarToSolar(year, month, day);
    if (d && d >= onOrAfter) return d;
  }
  return null;
}

/** 그해 그 음력 달의 날 수 (29 · 30). 윤달은 셈하지 않아요(평달). 모르면 null */
export function lunarMonthLength(year: number, month: number): 29 | 30 | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  const months = lunarMonths(year);
  if (months) {
    const m = months.find((x) => x.month === month && !x.leap);
    return m ? (m.length === 30 ? 30 : 29) : null;
  }
  const d29 = lunarToSolar(year, month, 29);
  const d30 = lunarToSolar(year, month, 30);
  if (!d29 || !d30) return null;
  return d29 === d30 ? 29 : 30;
}

/** 음력 월 · 일을 어느 해 양력으로 바꾼 결과 (그달에 없는 30일이면 29일로 줄였다는 표시) */
export interface LunarConversion {
  /** 그 음력 해 (양력 날짜의 해와 다를 수 있어요: 음력 12월은 양력 다음 해 1~2월) */
  lunarYear: number;
  date: ISODate;
  /** 그해 그달이 29일까지라 30일을 29일로 셈했으면 true */
  clamped: boolean;
  monthLength: 29 | 30;
}

/** 음력 월 · 일 → 그 음력 해의 양력 (줄인 날 표시 포함). 말이 안 되거나 모르면 null */
export function convertLunar(year: number, month: number, day: number): LunarConversion | null {
  const date = lunarToSolar(year, month, day);
  const monthLength = lunarMonthLength(year, month);
  if (!date || !monthLength) return null;
  return { lunarYear: year, date, clamped: day > monthLength, monthLength };
}

/**
 * 음력 월 · 일의 '올해' 양력과 다음 회차. 올해 = 오늘이 든 양력 해에 오는 그 음력 월-일 (음력 해 기준이 아니라 양력 해 기준,
 * 두 번 오면 아직 안 온 쪽).
 * 올해 날짜가 이미 지났으면 next 는 다음 해 날짜. 모르면 null
 */
export function lunarThisYear(month: number, day: number, today: ISODate): { thisYear: LunarConversion | null; next: LunarConversion | null } | null {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 30) return null;
  const y = Number(today.slice(0, 4));
  const options = [y - 1, y, y + 1].map((ly) => convertLunar(ly, month, day)).filter((c): c is LunarConversion => c !== null);
  // 한 양력 해에 같은 음력 월-일이 두 번 올 수 있어요 (2026-01-03 · 2026-12-23 = 음력 11/15): 아직 안 온 것, 없으면 마지막
  const inYear = options.filter((c) => c.date.slice(0, 4) === String(y));
  const thisYear = inYear.find((c) => c.date >= today) ?? inYear[inYear.length - 1] ?? null;
  const next = options.find((c) => c.date >= today) ?? null;
  if (!thisYear && !next) return null;
  return { thisYear, next };
}

/** '음력 8/15' (말이 안 되면 빈 문자열) */
export function lunarShortLabel(text: string | null | undefined): string {
  const md = parseLunarMonthDay(text);
  return md ? `음력 ${md.month}/${md.day}` : '';
}

/**
 * 음력 반복 일정의 목록 꼬리표: '음력 8/15 (올해 10/6)'. 이 회차 양력 날짜가 올해가 아니면 '(2027년 2/7)'.
 * 음력 값이 말이 안 되면 빈 문자열
 */
export function lunarRepeatLabel(lunar: string | null | undefined, date: ISODate, today: ISODate): string {
  const base = lunarShortLabel(lunar);
  if (!base || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return base;
  const md = `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  const when = date.slice(0, 4) === today.slice(0, 4) ? '올해' : `${date.slice(0, 4)}년`;
  return `${base} (${when} ${md})`;
}
