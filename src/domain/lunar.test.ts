import { describe, expect, it } from 'vitest';
import { event, account } from './_fixtures';
import { expandOccurrences, nextEventDate, nextOccurrenceDate } from './events';
import {
  KR_HOLIDAYS, LUNAR_YEARS, chuseokDate, lunarToSolar, nextLunarOccurrence, parseLunarMonthDay, seollalDate, solarToLunar,
} from './holidays';

describe('음력 → 양력 (내장 표)', () => {
  it('알려진 해의 설날 · 추석', () => {
    expect(seollalDate(2026)).toBe('2026-02-17');
    expect(chuseokDate(2026)).toBe('2026-09-25');
    expect(seollalDate(2027)).toBe('2027-02-07');
    expect(chuseokDate(2025)).toBe('2025-10-06');
    expect(seollalDate(2030)).toBe('2030-02-03');
    expect(seollalDate(2035)).toBe('2035-02-08');
    expect(chuseokDate(2035)).toBe('2035-09-16');
  });

  it('공휴일 표(한국천문연구원 날짜)의 설날 · 추석과 같다 (2025~2028)', () => {
    for (let y = 2025; y <= 2028; y++) {
      expect(KR_HOLIDAYS[seollalDate(y)!]).toMatch(/설날/);
      expect(KR_HOLIDAYS[chuseokDate(y)!]).toMatch(/추석/);
    }
  });

  it('윤달 해: 윤달은 평달 뒤에 오고, 평달을 고르면 평달', () => {
    // 2025 윤6월 (평6월 2025-06-25, 윤6월 2025-07-25)
    expect(lunarToSolar(2025, 6, 1)).toBe('2025-06-25');
    expect(lunarToSolar(2025, 6, 1, true)).toBe('2025-07-25');
    expect(lunarToSolar(2025, 7, 1)).toBe('2025-08-23');
    expect(solarToLunar('2025-07-25')).toEqual({ year: 2025, month: 6, day: 1, leap: true });
  });

  it('그달에 없는 30일은 29일로, 말이 안 되는 값은 null', () => {
    // 2026 음력 2월은 29일까지 (달 길이 '101001010111' 의 두 번째 = 0)
    expect(lunarToSolar(2026, 2, 30)).toBe(lunarToSolar(2026, 2, 29));
    expect(lunarToSolar(2026, 13, 1)).toBeNull();
    expect(lunarToSolar(2026, 1, 31)).toBeNull();
  });

  it('음력 12월은 다음 양력 해 1월에 올 수 있다', () => {
    expect(lunarToSolar(2026, 12, 15)).toBe('2027-01-22');
    expect(solarToLunar('2027-01-22')).toMatchObject({ year: 2026, month: 12, day: 15 });
  });

  it('양력 → 음력 → 양력 왕복', () => {
    for (const d of ['2026-02-17', '2026-09-25', '2031-05-05', '2040-12-31', '2033-12-22']) {
      const l = solarToLunar(d)!;
      expect(lunarToSolar(l.year, l.month, l.day, l.leap)).toBe(d);
    }
  });

  it('ICU 단기 달력이 있으면 표와 같다 (표 전체 해)', () => {
    let f: Intl.DateTimeFormat;
    try {
      f = new Intl.DateTimeFormat('en-u-ca-dangi', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
      if (f.resolvedOptions().calendar !== 'dangi') return;
    } catch {
      return;
    }
    for (let t = Date.UTC(LUNAR_YEARS.from, 2, 1); t < Date.UTC(LUNAR_YEARS.to, 11, 31); t += 86_400_000 * 7) {
      const iso = new Date(t).toISOString().slice(0, 10);
      const parts = f.formatToParts(new Date(t));
      const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
      const ours = solarToLunar(iso)!;
      expect(`${ours.year}/${ours.month}${ours.leap ? 'bis' : ''}/${ours.day}`).toBe(`${get('relatedYear')}/${get('month')}/${get('day')}`);
    }
  });

  it('다음 음력 날짜 (오늘 포함)', () => {
    expect(nextLunarOccurrence(1, 1, '2026-11-10')).toBe('2027-02-07');
    expect(nextLunarOccurrence(8, 15, '2026-09-25')).toBe('2026-09-25');
    expect(nextLunarOccurrence(8, 15, '2026-09-26')).toBe('2027-09-15');
  });

  it("음력 칸 'MM-DD' 읽기", () => {
    expect(parseLunarMonthDay('08-15')).toEqual({ month: 8, day: 15 });
    expect(parseLunarMonthDay('1-1')).toEqual({ month: 1, day: 1 });
    expect(parseLunarMonthDay('')).toBeNull();
    expect(parseLunarMonthDay('13-01')).toBeNull();
  });
});

describe('음력 매년 반복 일정', () => {
  const acc = account('event');
  const bday = event({ id: 'b', date: '2026-04-20', amount: 200_000, accountId: acc.id, repeat: 'yearly', lunar: '03-04' });

  it('해마다 그해 음력 날짜를 양력으로 펼친다 (이 행은 그 날짜 그대로)', () => {
    expect(lunarToSolar(2026, 3, 4)).toBe('2026-04-20');
    const occ = expandOccurrences(bday, '2026-01', '2029-12').map((o) => o.date);
    expect(occ).toEqual(['2026-04-20', lunarToSolar(2027, 3, 4), lunarToSolar(2028, 3, 4), lunarToSolar(2029, 3, 4)]);
    expect(occ[1]).toBe('2027-04-10');
    // 달 범위로 자르기: 2027-04 만
    expect(expandOccurrences(bday, '2027-04', '2027-04').map((o) => o.date)).toEqual(['2027-04-10']);
    // 양력이면 같은 달 같은 날
    const solar = { ...bday, lunar: undefined };
    expect(expandOccurrences(solar, '2027-04', '2027-04').map((o) => o.date)).toEqual(['2027-04-20']);
  });

  it('설날처럼 양력 달이 해마다 바뀌어도 그달에 들어간다', () => {
    const seol = event({ id: 's', date: '2026-02-17', amount: 300_000, accountId: acc.id, repeat: 'yearly', lunar: '01-01' });
    expect(expandOccurrences(seol, '2027-01', '2028-12').map((o) => o.date)).toEqual(['2027-02-07', '2028-01-27']);
    expect(expandOccurrences(seol, '2027-01', '2027-01')).toEqual([]);
  });

  it('완료 · 취소 뒤 다음 회차는 다음 음력 해의 양력 날짜', () => {
    expect(nextOccurrenceDate('2026-02-17', 'yearly', 17, '01-01')).toBe('2027-02-07');
    expect(nextEventDate([bday], bday)).toBe('2027-04-10');
    // 음력이 아닌 매년 일정은 그대로
    expect(nextOccurrenceDate('2026-02-17', 'yearly', 17)).toBe('2027-02-17');
    // 매월이면 음력 값은 보지 않는다
    expect(nextOccurrenceDate('2026-02-17', 'monthly', 17, '01-01')).toBe('2026-03-17');
  });

  it('사용자가 날짜를 하루 옮긴 행도 같은 음력 해로 보고 다음 해로 넘어간다', () => {
    expect(nextOccurrenceDate('2026-02-18', 'yearly', 18, '01-01')).toBe('2027-02-07');
  });

  it('음력 표 밖의 해는 ICU 로 셈하거나, 그것도 없으면 양력 1년 뒤', () => {
    const late = event({ id: 'l', date: '2040-02-12', amount: 1, accountId: acc.id, repeat: 'yearly', lunar: '01-01' });
    const next = nextEventDate([late], late)!;
    expect(next > '2041-01-01' && next < '2041-03-01').toBe(true);
  });
});

describe('음력 월 · 일 고르기 도우미', () => {
  it('그해 음력 달의 날 수와 30일 → 29일 줄임 표시', async () => {
    const { lunarMonthLength, convertLunar } = await import('./holidays');
    expect(lunarMonthLength(2026, 1)).toBe(30);
    expect(lunarMonthLength(2026, 2)).toBe(29);
    expect(lunarMonthLength(2026, 13)).toBeNull();
    expect(convertLunar(2026, 2, 30)).toEqual({ lunarYear: 2026, date: lunarToSolar(2026, 2, 29), clamped: true, monthLength: 29 });
    expect(convertLunar(2026, 1, 30)?.clamped).toBe(false);
  });

  it('올해 양력: 한 양력 해에 두 번 오면 아직 안 온 쪽, 지났으면 다음 회차도', async () => {
    const { lunarThisYear } = await import('./holidays');
    // 음력 11/15 는 2026년에 2026-01-03(2025 음력 해) · 2026-12-23(2026 음력 해) 두 번
    expect(lunarThisYear(11, 15, '2026-11-20')).toMatchObject({ thisYear: { date: '2026-12-23' }, next: { date: '2026-12-23' } });
    expect(lunarThisYear(8, 15, '2026-11-20')).toMatchObject({ thisYear: { date: '2026-09-25' }, next: { date: '2027-09-15' } });
    expect(lunarThisYear(8, 31, '2026-11-20')).toBeNull();
  });

  it('목록 꼬리표: 음력 8/15 (올해 9/25) · 다른 해면 연도', async () => {
    const { lunarRepeatLabel, lunarShortLabel } = await import('./holidays');
    expect(lunarShortLabel('08-15')).toBe('음력 8/15');
    expect(lunarRepeatLabel('08-15', '2026-09-25', '2026-11-20')).toBe('음력 8/15 (올해 9/25)');
    expect(lunarRepeatLabel('08-15', '2027-09-15', '2026-11-20')).toBe('음력 8/15 (2027년 9/15)');
    expect(lunarRepeatLabel('bad', '2027-09-15', '2026-11-20')).toBe('');
  });
});
