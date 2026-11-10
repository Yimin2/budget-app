/**
 * PLAN 4-3 '매년 돌아오는 일' — 지난 지출에서 해마다 다시 나올 만한 일을 찾아 일정으로 넣자고 제안한다.
 *
 * - 살펴보는 지출: 오늘까지 최근 24개월, 지우지 않은 지출 중 통장이 이벤트통장이거나 카테고리의 기본 통장이 이벤트통장인 것
 *   (파일에서 가져온 지난 기록 포함). 여행에 묶인 지출 · 고정 지출 자동 기록 · 예외(평소 지출 아님)로 표시한 지출은 뺀다
 * - 이름 = 메모, 없으면 묶인 일정 이름, 없으면 카테고리 이름. 낱말 = 이름을 띄어쓰기로 나눈 두 글자 이상 낱말(과 '설')
 * - 반복: 서로 다른 해의 두 지출이 같은 날짜 ±15일이고, 낱말이 하나라도 같거나 (한쪽이라도 낱말이 없을 때) 카테고리가 같으면
 *   한 묶음. 묶음의 마지막 지출이 기준 (이름 · 금액 · 카테고리 · 날짜)
 * - 한 해 기록만 있을 때: 묶이지 않은 지출이라도 이름이나 카테고리에 생일 · 생신 · 어버이날 · 명절 · 설 · 추석 · 기념일 ·
 *   결혼기념 · 크리스마스 · 성탄 · 환갑이 있으면 후보
 * - 마지막 지출에서 1년 뒤 날이 오늘보다 15일 넘게 지났으면(올해 건너뜀) 빼고, 아니면 올해 같은 날(지났으면 내년)을 제안한다
 * - 앞으로 12개월 안에 같은 날 ±15일로 예정 일정이 있고 낱말이 같거나 (낱말이 없을 때) 카테고리가 같으면 이미 넣은 것으로 본다
 * - [괜찮아요]로 숨긴 키(설정 '숨긴매년제안')는 다시 보이지 않는다. 키 = '<달>|<낱말>' (낱말이 없으면 '<달>|cat:<카테고리id>')
 * - 순서: 반복으로 찾은 것 → 해 수 많은 순 → 금액 큰 순 → 제안 날짜 순
 */
import { addMonths, dateInMonth, formatMonthKo, monthOf } from './dates';
import { expandOccurrences, seriesAnchorDay } from './events';
import { firstAccountByRole } from './internal';
import { formatWon } from './money';
import type { Expense, Id, ISODate, LedgerData, Won } from './types';

export const RECURRING_KEYWORDS = ['생일', '생신', '어버이날', '명절', '설', '추석', '기념일', '결혼기념', '크리스마스', '성탄', '환갑'];
/** 같은 날로 보는 폭 (일) */
export const RECURRING_WINDOW_DAYS = 15;
/** 살펴보는 지난 달 수 */
export const RECURRING_LOOKBACK_MONTHS = 24;

export interface RecurringCandidate {
  /** 숨길 때 쓰는 키 (쉼표 없음) */
  key: string;
  name: string;
  /** 마지막 금액 */
  amount: Won;
  categoryId: Id | null;
  /** 마지막으로 쓴 날 */
  lastDate: ISODate;
  /** 일정으로 넣을 날 (올해 같은 날, 지났으면 내년) */
  suggestDate: ISODate;
  /** 기록이 있는 해 수 */
  years: number;
  /** repeat = 여러 해에 걸쳐 나옴, keyword = 한 해뿐이지만 이름이 해마다 돌아오는 일 */
  basis: 'repeat' | 'keyword';
  expenseIds: Id[];
}

const dayMs = 86_400_000;
const toUtc = (d: ISODate) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const daysApart = (a: ISODate, b: ISODate) => Math.round((toUtc(b) - toUtc(a)) / dayMs);

/** 날짜를 n 해 옮기기 (2월 29일 → 28일) */
export function shiftYears(date: ISODate, n: number): ISODate {
  const y = Number(date.slice(0, 4)) + n;
  return dateInMonth(`${String(y).padStart(4, '0')}-${date.slice(5, 7)}`, Number(date.slice(8, 10)));
}

/** 이름 → 낱말 (두 글자 이상, '설'은 한 글자도) */
export function nameTokens(name: string): string[] {
  const parts = name
    .toLowerCase()
    .replace(/[^0-9a-z가-힣\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !/^\d+$/.test(t) && (t.length >= 2 || t === '설'));
  return [...new Set(parts)];
}

/** 이름(또는 카테고리 이름)에 해마다 돌아오는 일을 뜻하는 낱말이 있는지 */
export function hasRecurringKeyword(text: string): boolean {
  const compact = text.replace(/\s/g, '');
  if (RECURRING_KEYWORDS.some((k) => k.length >= 2 && compact.includes(k))) return true;
  return nameTokens(text).some((t) => t === '설' || t === '설날' || t.startsWith('설명절'));
}

const overlap = (a: string[], b: string[]) => a.some((t) => b.includes(t));

/** 같은 일로 볼 만큼 비슷한지: 낱말이 같거나, 한쪽이라도 낱말이 없을 때 카테고리가 같으면 */
function similar(a: { tokens: string[]; categoryId: Id | null }, b: { tokens: string[]; categoryId: Id | null }): boolean {
  if (a.tokens.length > 0 && b.tokens.length > 0) return overlap(a.tokens, b.tokens);
  return a.categoryId !== null && a.categoryId === b.categoryId;
}

/** 다른 해의 같은 날 ±15일인지 */
function sameDayOtherYear(a: ISODate, b: ISODate): boolean {
  const gap = Number(b.slice(0, 4)) - Number(a.slice(0, 4));
  for (const k of [gap - 1, gap, gap + 1]) {
    if (k === 0) continue;
    if (Math.abs(daysApart(shiftYears(a, k), b)) <= RECURRING_WINDOW_DAYS) return true;
  }
  return false;
}

export function recurringKey(date: ISODate, tokens: string[], categoryId: Id | null): string {
  const mm = date.slice(5, 7);
  return tokens.length > 0 ? `${mm}|${tokens.join(' ')}` : `${mm}|cat:${categoryId ?? '-'}`;
}

interface Item {
  e: Expense;
  name: string;
  tokens: string[];
  categoryId: Id | null;
  keyword: boolean;
}

/** 앞으로 12개월 안에 이미 넣은 예정 일정이 있는지 */
function isRegistered(data: LedgerData, today: ISODate, c: { suggestDate: ISODate; tokens: string[]; categoryId: Id | null }): boolean {
  const from = monthOf(today);
  const to = addMonths(from, 12);
  for (const ev of data.events) {
    if (ev.deleted || ev.status !== 'planned') continue;
    const anchor = ev.repeat === 'none' ? undefined : seriesAnchorDay(data.events, ev);
    const occ = expandOccurrences(ev, addMonths(from, -1), to, anchor);
    if (!occ.some((o) => Math.abs(daysApart(o.date, c.suggestDate)) <= RECURRING_WINDOW_DAYS)) continue;
    if (similar({ tokens: nameTokens(ev.name), categoryId: ev.categoryId }, c)) return true;
  }
  return false;
}

/** 매년 돌아올 만한 일 후보 (숨긴 것 · 이미 넣은 것 빼고, 순서대로) */
export function findRecurringCandidates(data: LedgerData, today: ISODate): RecurringCandidate[] {
  const eventAcc = firstAccountByRole(data, 'event');
  const cats = new Map(data.categories.map((c) => [c.id, c]));
  const eventCats = new Set(data.categories.filter((c) => !c.deleted && c.defaultAccountRole === 'event').map((c) => c.id));
  const events = new Map(data.events.map((e) => [e.id, e]));
  const since = dateInMonth(addMonths(monthOf(today), -RECURRING_LOOKBACK_MONTHS), Number(today.slice(8, 10)));

  const items: Item[] = [];
  for (const e of data.expenses) {
    if (e.deleted || !(e.amount > 0) || !e.date || e.date > today || e.date < since) continue;
    if (e.tripId || e.fixedExpenseId || e.excluded === true) continue;
    const onEvent = eventAcc !== null && e.accountId === eventAcc.id;
    if (!onEvent && !(e.categoryId !== null && eventCats.has(e.categoryId))) continue;
    const catName = e.categoryId !== null ? (cats.get(e.categoryId)?.name ?? '') : '';
    const name = e.memo.trim() || (e.eventId ? (events.get(e.eventId)?.name ?? '') : '') || catName;
    const memoName = e.memo.trim() || (e.eventId ? (events.get(e.eventId)?.name ?? '') : '');
    items.push({
      e,
      name: name || '이벤트 지출',
      tokens: nameTokens(memoName),
      categoryId: e.categoryId ?? null,
      keyword: hasRecurringKeyword(name) || hasRecurringKeyword(catName),
    });
  }
  items.sort((a, b) => (a.e.date < b.e.date ? -1 : a.e.date > b.e.date ? 1 : a.e.id < b.e.id ? -1 : 1));

  // 묶기 (union-find)
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const paired = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      if (a.e.date.slice(0, 4) === b.e.date.slice(0, 4)) continue;
      if (!sameDayOtherYear(a.e.date, b.e.date) || !similar(a, b)) continue;
      parent[find(i)] = find(j);
      paired.add(i);
      paired.add(j);
    }
  }
  const groups = new Map<number, number[]>();
  items.forEach((_, i) => {
    if (!paired.has(i) && !items[i]!.keyword) return;
    const r = paired.has(i) ? find(i) : -1 - i;
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });

  const dismissed = new Set(data.settings.dismissedRecurring ?? []);
  const byKey = new Map<string, RecurringCandidate & { tokens: string[] }>();
  for (const [root, idx] of groups) {
    const list = idx.map((i) => items[i]!);
    const last = list[list.length - 1]!;
    const lastDate = last.e.date;
    // 1년 뒤 날이 15일 넘게 지났으면 올해는 건너뛴 것으로 본다
    const nextYear = shiftYears(lastDate, 1);
    if (daysApart(nextYear, today) > RECURRING_WINDOW_DAYS) continue;
    let suggestDate = shiftYears(lastDate, Number(today.slice(0, 4)) - Number(lastDate.slice(0, 4)));
    if (suggestDate < today) suggestDate = shiftYears(suggestDate, 1);
    const tokens = last.tokens;
    const key = recurringKey(lastDate, tokens, last.categoryId);
    if (dismissed.has(key)) continue;
    const cand = {
      key,
      name: last.name,
      amount: last.e.amount,
      categoryId: last.categoryId,
      lastDate,
      suggestDate,
      years: new Set(list.map((x) => x.e.date.slice(0, 4))).size,
      basis: root >= 0 ? ('repeat' as const) : ('keyword' as const),
      expenseIds: list.map((x) => x.e.id),
      tokens,
    };
    if (isRegistered(data, today, cand)) continue;
    const prev = byKey.get(key);
    if (!prev || rank(cand, prev) < 0) byKey.set(key, cand);
  }
  return [...byKey.values()].sort(rank).map(({ tokens: _t, ...c }) => c);
}

function rank(a: RecurringCandidate, b: RecurringCandidate): number {
  if (a.basis !== b.basis) return a.basis === 'repeat' ? -1 : 1;
  if (a.years !== b.years) return b.years - a.years;
  if (a.amount !== b.amount) return b.amount - a.amount;
  if (a.suggestDate !== b.suggestDate) return a.suggestDate < b.suggestDate ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function yearWord(year: number, today: ISODate): string {
  const ty = Number(today.slice(0, 4));
  return year === ty ? '올해' : year === ty - 1 ? '작년' : year === ty + 1 ? '내년' : `${year}년`;
}

/** "작년 10월에 '아빠 생신' 100,000원이 있었어요. 올해도 일정으로 넣을까요?" */
export function recurringMessage(c: RecurringCandidate, today: ISODate): string {
  const ly = Number(c.lastDate.slice(0, 4));
  const month = formatMonthKo(monthOf(c.lastDate), ly);
  const again = Number(c.suggestDate.slice(0, 4)) === Number(today.slice(0, 4)) ? '올해도' : '내년에도';
  return `${yearWord(ly, today)} ${month}에 '${c.name}' ${formatWon(c.amount)}이 있었어요. ${again} 일정으로 넣을까요?`;
}
