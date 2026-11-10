/**
 * PLAN 4-3 '매년 일정 한 번에 등록' — 설날 · 추석 · 어버이날 · 양가 부모님 생신 · 결혼기념일 · 크리스마스 · 직접 추가를
 * 한 번에 매년 반복 예정 일정으로 넣는다.
 *
 * - 항목마다 결정적 일정 id(`annual-…`)를 쓴다. 이미 그 id(반복 회차 `id@날짜` 포함)의 지우지 않은 행이 있으면 '등록됨'이고
 *   다시 눌러도 새 행을 만들지 않는다 (함께 쓰는 사람이 동시에 눌러도 같은 행)
 * - 예전에 손으로 넣은 매년 예정 일정도 이름이 맞으면 '등록됨'으로 본다 (설날 · 구정 · 추석 · 한가위 · 어버이날 · 결혼기념 ·
 *   크리스마스 · 성탄, 생신은 사람 이름 + 아버/어머)
 * - 설날(음력 1-1) · 추석(음력 8-15)과 음력을 고른 생신 · 직접 추가는 음력 반복(`lunar`)으로, 해마다 그해 양력 날짜로 바뀐다
 * - 첫 회차 날짜 = 오늘 이후(오늘 포함) 처음 오는 그날
 * - 카테고리: 설날 · 추석 = 명절, 나머지 = 경조사 (가계부에 그 이름의 카테고리가 없으면 비움)
 * - 넣은 일정은 4-2 의 두 번 빼지 않기 규칙으로 그달 같은 카테고리 평소 쓰는 돈에서 빠진다
 */
import { dateInMonth } from './dates';
import { seriesBaseId } from './events';
import { formatLunarMonthDay, lunarThisYear, nextLunarOccurrence } from './holidays';
import { ledgerPeople } from './people';
import type { Id, ISODate, LedgerData, PlannedEvent, Won } from './types';

export type AnnualCalendar = 'solar' | 'lunar';
export type AnnualKind = 'seollal' | 'chuseok' | 'parents' | 'birthday' | 'anniversary' | 'christmas' | 'custom';

export interface AnnualItem {
  /** 결정적 일정 id (시리즈 기준 id) */
  id: Id;
  kind: AnnualKind;
  /** 목록에 보일 이름 (생신은 '민구 아버님') */
  label: string;
  /** 일정 이름 */
  name: string;
  categoryName: '명절' | '경조사';
  /** 정해진 날 (없으면 사용자가 고름) */
  fixed: { month: number; day: number; calendar: AnnualCalendar } | null;
  /** 양력/음력을 고를 수 있는지 */
  calendarChoice: boolean;
  /** 생신: 사람 이름 · 아버/어머 */
  person?: { name: string; parent: 'father' | 'mother' };
}

export interface AnnualSelection {
  id: Id;
  name: string;
  categoryName: AnnualItem['categoryName'];
  month: number;
  day: number;
  calendar: AnnualCalendar;
  amount: Won;
}

/** 등록할 일정 한 줄 (통장 · 작성 기록은 상태 계층이 채운다). 늘 매년 반복 */
export interface AnnualDraft {
  id: Id;
  name: string;
  date: ISODate;
  amount: Won;
  categoryId: Id | null;
  /** 음력 월-일 'MM-DD' (양력이면 없음) */
  lunar?: string;
}

export const ANNUAL_ID_PREFIX = 'annual-';

/** 짧고 늘 같은 해시 (FNV-1a, 36진수) */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const compact = (s: string) => s.replace(/\s/g, '').toLowerCase();

/** 직접 추가 항목의 결정적 id (같은 이름이면 같은 id) */
export function customAnnualId(name: string): Id {
  return `${ANNUAL_ID_PREFIX}custom-${shortHash(compact(name))}`;
}

/** 체크 목록 (직접 추가 빼고). 생신은 가계부 사람(앞의 두 명)마다 아버님 · 어머님 */
export function annualItems(data: LedgerData): AnnualItem[] {
  const items: AnnualItem[] = [
    { id: `${ANNUAL_ID_PREFIX}seollal`, kind: 'seollal', label: '설날', name: '설날', categoryName: '명절', fixed: { month: 1, day: 1, calendar: 'lunar' }, calendarChoice: false },
    { id: `${ANNUAL_ID_PREFIX}chuseok`, kind: 'chuseok', label: '추석', name: '추석', categoryName: '명절', fixed: { month: 8, day: 15, calendar: 'lunar' }, calendarChoice: false },
    { id: `${ANNUAL_ID_PREFIX}parents-day`, kind: 'parents', label: '어버이날', name: '어버이날', categoryName: '경조사', fixed: { month: 5, day: 8, calendar: 'solar' }, calendarChoice: false },
  ];
  const people = ledgerPeople(data).slice(0, 2);
  const sides = people.length > 0 ? people.map((p) => ({ name: p.name, key: shortHash(p.email.toLowerCase()) })) : [{ name: '', key: '' }];
  for (const side of sides) {
    for (const parent of ['father', 'mother'] as const) {
      const who = `${side.name ? `${side.name} ` : ''}${parent === 'father' ? '아버님' : '어머님'}`;
      items.push({
        id: `${ANNUAL_ID_PREFIX}bday-${side.key ? `${side.key}-` : ''}${parent === 'father' ? 'f' : 'm'}`,
        kind: 'birthday',
        label: who,
        name: `${who} 생신`,
        categoryName: '경조사',
        fixed: null,
        calendarChoice: true,
        person: { name: side.name, parent },
      });
    }
  }
  items.push(
    { id: `${ANNUAL_ID_PREFIX}anniversary`, kind: 'anniversary', label: '결혼기념일', name: '결혼기념일', categoryName: '경조사', fixed: null, calendarChoice: false },
    { id: `${ANNUAL_ID_PREFIX}christmas`, kind: 'christmas', label: '크리스마스', name: '크리스마스', categoryName: '경조사', fixed: { month: 12, day: 25, calendar: 'solar' }, calendarChoice: false },
  );
  return items;
}

/** 이름이 이 항목을 가리키는지 (예전에 손으로 넣은 일정 찾기) */
function nameMatches(item: AnnualItem, name: string): boolean {
  const c = compact(name);
  switch (item.kind) {
    case 'seollal':
      return c.includes('설날') || c.includes('구정') || c.startsWith('설명절') || name.trim().split(/\s+/).includes('설');
    case 'chuseok':
      return c.includes('추석') || c.includes('한가위');
    case 'parents':
      return c.includes('어버이날');
    case 'anniversary':
      return c.includes('결혼기념');
    case 'christmas':
      return c.includes('크리스마스') || c.includes('성탄');
    case 'birthday': {
      if (!item.person) return false;
      const who = compact(item.person.name);
      const parent = item.person.parent === 'father' ? ['아버', '아빠'] : ['어머', '엄마'];
      return (who === '' || c.includes(who)) && parent.some((p) => c.includes(p)) && (c.includes('생신') || c.includes('생일'));
    }
    default:
      return false;
  }
}

/** 시리즈에서 보여 줄 행: 예정 중 가장 이른 것, 없으면 가장 늦은 행 */
function pickRow(rows: PlannedEvent[]): PlannedEvent | null {
  const planned = rows.filter((e) => e.status === 'planned').sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (planned[0]) return planned[0];
  return [...rows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0] ?? null;
}

/** 이 id 시리즈의 지우지 않은 행 중 보여 줄 행 (없으면 null) */
export function annualSeriesRow(data: LedgerData, id: Id): PlannedEvent | null {
  return pickRow(data.events.filter((e) => !e.deleted && seriesBaseId(e.id) === id));
}

/** 항목이 이미 등록됐으면 그 일정(고치기로 열 행). 결정적 id 가 먼저, 없으면 이름이 맞는 매년 예정 일정 */
export function registeredAnnualEvent(data: LedgerData, item: Pick<AnnualItem, 'id'> & Partial<AnnualItem>): PlannedEvent | null {
  const own = annualSeriesRow(data, item.id);
  if (own) return own;
  if (!item.kind) return null;
  const full = item as AnnualItem;
  return pickRow(
    data.events.filter(
      (e) => !e.deleted && e.status === 'planned' && e.repeat === 'yearly' && !e.id.startsWith(ANNUAL_ID_PREFIX) && nameMatches(full, e.name),
    ),
  );
}

/** 직접 추가로 등록한 일정들 (시리즈마다 한 줄) */
export function customAnnualEvents(data: LedgerData): PlannedEvent[] {
  const bases = new Set<string>();
  for (const e of data.events) {
    const base = seriesBaseId(e.id);
    if (!e.deleted && base.startsWith(`${ANNUAL_ID_PREFIX}custom-`)) bases.add(base);
  }
  return [...bases]
    .map((b) => annualSeriesRow(data, b))
    .filter((e): e is PlannedEvent => e !== null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 오늘 이후(포함) 처음 오는 그날. 음력은 그해 양력으로 (셈할 수 없으면 null) */
export function nextAnnualDate(month: number, day: number, calendar: AnnualCalendar, today: ISODate): ISODate | null {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > (calendar === 'lunar' ? 30 : 31)) return null;
  if (calendar === 'lunar') return nextLunarOccurrence(month, day, today);
  const mm = String(month).padStart(2, '0');
  const y = Number(today.slice(0, 4));
  const thisYear = dateInMonth(`${y}-${mm}`, day);
  return thisYear >= today ? thisYear : dateInMonth(`${y + 1}-${mm}`, day);
}

/**
 * 음력 월 · 일을 고를 때 바로 보여 줄 줄: '올해 양력: 2026-10-03' (지났으면 '· 다음 2027-…').
 * 그해 그달이 29일까지인데 30일을 골랐으면 note 에 '…29일로 셈해요'. 윤달은 따로 고르지 않고 평달 같은 날로 셈해요.
 * 셈할 수 없으면 null
 */
export function lunarPreview(month: number, day: number, today: ISODate): { line: string; note: string | null; next: ISODate | null } | null {
  const r = lunarThisYear(month, day, today);
  if (!r) return null;
  const { thisYear, next } = r;
  let line: string;
  if (thisYear) {
    line = `올해 양력: ${thisYear.date}`;
    if (thisYear.date < today && next) line += ` (지났어요 · 다음 ${next.date})`;
  } else {
    line = `다음 양력: ${next!.date}`;
  }
  const clampedYears = [...new Set([thisYear, next].filter((c) => c?.clamped).map((c) => c!.lunarYear))];
  const note =
    clampedYears.length > 0
      ? `${clampedYears.join(' · ')}년 음력 ${month}월은 29일까지라 ${day}일 대신 29일로 셈해요`
      : null;
  return { line, note, next: next?.date ?? null };
}

function categoryIdByName(data: LedgerData, name: string): Id | null {
  return data.categories.find((c) => !c.deleted && c.name === name)?.id ?? null;
}

/**
 * 고른 항목 → 새로 넣을 일정. 이미 등록된 항목(결정적 id 의 행이 있거나 이름이 맞는 매년 일정) · 같은 id 두 번 ·
 * 금액이 0 이하이거나 날짜를 셈할 수 없는 항목은 뺀다 (다시 해도 같은 결과)
 */
export function planAnnualRegistration(data: LedgerData, today: ISODate, selections: AnnualSelection[]): AnnualDraft[] {
  const items = new Map(annualItems(data).map((i) => [i.id, i]));
  const seen = new Set<string>();
  const out: AnnualDraft[] = [];
  for (const s of selections) {
    if (seen.has(s.id) || !(s.amount > 0) || !s.name.trim()) continue;
    const item = items.get(s.id);
    if (registeredAnnualEvent(data, item ?? { id: s.id })) continue;
    const date = nextAnnualDate(s.month, s.day, s.calendar, today);
    if (!date) continue;
    seen.add(s.id);
    out.push({
      id: s.id,
      name: s.name.trim(),
      date,
      amount: Math.round(s.amount),
      categoryId: categoryIdByName(data, s.categoryName),
      ...(s.calendar === 'lunar' ? { lunar: formatLunarMonthDay(s.month, s.day) } : {}),
    });
  }
  return out;
}

const COVERED_WORDS = ['설날', '구정', '설명절', '명절', '추석', '한가위', '어버이날', '결혼기념', '크리스마스', '성탄'];
const PARENT_WORDS = ['아버', '어머', '아빠', '엄마', '부모', '장인', '장모'];

/**
 * '매년 돌아오는 일'(기록에서 찾기)이 다루지 않을 이름: 이 체크 목록의 항목이거나(설 · 명절 · 추석 · 어버이날 ·
 * 결혼기념일 · 크리스마스 · 성탄 · 부모님(아버 · 어머 · 아빠 · 엄마 · 부모 · 장인 · 장모) 생신 · 생일) 직접 추가로 등록한 일정과 이름이 같은 것
 */
export function isCoveredByAnnual(data: LedgerData, name: string): boolean {
  const c = compact(name);
  if (!c) return false;
  if (COVERED_WORDS.some((w) => c.includes(w)) || name.trim().split(/\s+/).includes('설')) return true;
  // 부모님 생신 (다른 사람의 생신 · 생일은 기록에서 찾기가 계속 제안해요)
  const withoutGrand = c.replace(/할아버|할머/g, '');
  if ((c.includes('생신') || c.includes('생일')) && PARENT_WORDS.some((w) => withoutGrand.includes(w))) return true;
  return customAnnualEvents(data).some((e) => compact(e.name) === c);
}
