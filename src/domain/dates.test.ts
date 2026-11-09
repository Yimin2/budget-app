import {
  addDays, addMonths, compareMonth, dateInMonth, daysInMonth, daysLeftInMonth, formatDateKo, formatMonthKo,
  formatShortDate, isMonthActive, monthOf, monthRange, toISODate,
} from './dates';

describe('dates', () => {
  it('toISODate uses local fields', () => {
    expect(toISODate(new Date(2026, 10, 9, 23, 59))).toBe('2026-11-09');
    expect(toISODate(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
  it('month math', () => {
    expect(monthOf('2026-11-09')).toBe('2026-11');
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-05', -17)).toBe('2024-12');
    expect(compareMonth('2026-12', '2027-01')).toBeLessThan(0);
    expect(compareMonth('2027-01', '2026-12')).toBe(1);
    expect(monthRange('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(monthRange('2026-11', '2026-10')).toEqual([]);
  });
  it('day math across month/year/leap boundaries', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30'); // 서머타임 같은 시간대 영향 없음
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2026-11')).toBe(30);
    expect(daysLeftInMonth('2026-11-10')).toBe(21);
    expect(daysLeftInMonth('2026-11-30')).toBe(1);
    expect(dateInMonth('2027-02', 31)).toBe('2027-02-28');
    expect(dateInMonth('2026-11', 5)).toBe('2026-11-05');
  });
  it('formats korean', () => {
    expect(formatMonthKo('2026-11')).toBe('11월');
    expect(formatMonthKo('2027-01', 2026)).toBe('2027년 1월');
    expect(formatMonthKo('2026-05', 2026)).toBe('5월');
    expect(formatDateKo('2026-11-10')).toBe('11월 10일 화요일');
    expect(formatDateKo('2026-11-10', false)).toBe('11월 10일');
    expect(formatShortDate('2026-11-10')).toBe('11/10');
  });
  it('isMonthActive', () => {
    expect(isMonthActive('2026-11', '2026-11', null)).toBe(true);
    expect(isMonthActive('2026-10', '2026-11', null)).toBe(false);
    expect(isMonthActive('2026-12', '2026-01', '2026-11')).toBe(false);
    expect(isMonthActive('2026-11', '2026-01', '2026-11')).toBe(true);
  });
});
