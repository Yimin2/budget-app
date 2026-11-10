import { addDays } from './dates';
import { HOLIDAY_YEARS, holidayName, holidayTableCovers, holidayTableEndingSoon, isKoreanHoliday, KR_HOLIDAYS } from './holidays';
import { weekdayOf } from './schedule';

const SUBSTITUTABLE = ['삼일절', '어린이날', '부처님오신날', '광복절', '개천절', '한글날', '성탄절'];

/** 표의 기본 공휴일에서 대체공휴일 규칙으로 대체일을 다시 계산 (표와 같아야 해요) */
function expectedSubstitutes(year: number): string[] {
  const entries = Object.entries(KR_HOLIDAYS).filter(([d]) => d.startsWith(`${year}-`));
  const isHoliday = (d: string) => d in KR_HOLIDAYS && !KR_HOLIDAYS[d]!.startsWith('대체공휴일');
  const weekend = (d: string) => weekdayOf(d) === 0 || weekdayOf(d) === 6;
  const afters: string[] = [];
  const blockDates = new Set<string>();
  for (const lunar of ['설날', '추석']) {
    const block = entries.filter(([, n]) => n.startsWith(lunar)).map(([d]) => d).sort();
    if (block.length === 0) continue;
    expect(block).toHaveLength(3);
    block.forEach((d) => blockDates.add(d));
    if (block.some((d) => weekdayOf(d) === 0 || KR_HOLIDAYS[d]!.includes('·'))) afters.push(block[2]!);
  }
  for (const [d, n] of entries) {
    if (blockDates.has(d) || n.startsWith('대체공휴일') || !SUBSTITUTABLE.some((s) => n.includes(s))) continue;
    if (weekend(d) || n.includes('·')) afters.push(d);
  }
  const subs: string[] = [];
  for (const after of afters.sort()) {
    let d = addDays(after, 1);
    while (weekend(d) || isHoliday(d) || subs.includes(d)) d = addDays(d, 1);
    subs.push(d);
  }
  return subs.sort();
}

describe('holidays', () => {
  it('표는 2025~2028 이고 해마다 신정 · 설날 3일 · 추석 3일 · 국경일 · 성탄절이 있어요', () => {
    expect(HOLIDAY_YEARS).toEqual({ from: 2025, to: 2028 });
    for (let y = HOLIDAY_YEARS.from; y <= HOLIDAY_YEARS.to; y++) {
      const names = Object.entries(KR_HOLIDAYS).filter(([d]) => d.startsWith(`${y}-`)).map(([, n]) => n).join('|');
      for (const n of ['신정', '설날', '삼일절', '어린이날', '부처님오신날', '현충일', '광복절', '추석', '개천절', '한글날', '성탄절']) {
        expect(names).toContain(n);
      }
      expect(holidayName(`${y}-01-01`)).toBe('신정');
      expect(holidayName(`${y}-12-25`)).toBe('성탄절');
    }
  });

  it.each([2025, 2026, 2027, 2028])('%i 대체공휴일은 규칙대로예요 (설 · 추석은 일요일 · 겹침, 그 밖은 토 · 일 · 겹침)', (y) => {
    const inTable = Object.entries(KR_HOLIDAYS)
      .filter(([d, n]) => d.startsWith(`${y}-`) && n.startsWith('대체공휴일'))
      .map(([d]) => d)
      .sort();
    expect(inTable).toEqual(expectedSubstitutes(y));
  });

  it('알려진 날: 2026 추석 연휴 · 대체공휴일, 선거일', () => {
    expect(['2026-09-24', '2026-09-25', '2026-09-26'].every(isKoreanHoliday)).toBe(true);
    expect(isKoreanHoliday('2026-08-17')).toBe(true);
    expect(isKoreanHoliday('2026-10-05')).toBe(true);
    expect(isKoreanHoliday('2026-06-03')).toBe(true);
    expect(isKoreanHoliday('2026-11-10')).toBe(false);
    expect(isKoreanHoliday('2027-02-09')).toBe(true);
  });

  it('표 밖의 해는 모른다고 보고, 표가 끝나 가면 알려요', () => {
    expect(holidayTableCovers('2028-12-31')).toBe(true);
    expect(holidayTableCovers('2029-01-01')).toBe(false);
    expect(isKoreanHoliday('2029-01-01')).toBe(false);
    expect(holidayTableEndingSoon('2026-11-10')).toBe(false);
    expect(holidayTableEndingSoon('2028-09-30')).toBe(false);
    expect(holidayTableEndingSoon('2028-10-01')).toBe(true);
    expect(holidayTableEndingSoon('2029-03-01')).toBe(true);
  });
});
