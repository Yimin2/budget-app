/**
 * PLAN 4-3 '해 보기' — 예정 일정 · 여행을 잠깐 빼거나 금액 · 날짜를 바꿔 본 예측. 저장하지 않는 순수 덮어씌우기다.
 *
 * - 일정: 빼기(그 행을 지운 것으로), 금액, 날짜. 반복 일정은 그 행(시리즈 전체)에 적용된다
 * - 여행: 빼기, 총예산(항목 예산은 그대로, 0 이면 빼기와 같다), 날짜(떠나는 날을 옮기면 돌아오는 날도 같은 날 수만큼)
 * - 덮어씌운 LedgerData 로 projectEventAccount 를 그대로 돌려 비교한다
 */
import { addDays, formatMonthKo, monthOf } from './dates';
import { projectEventAccount } from './events';
import { daysBetween, tripBudget } from './trips';
import { manWon } from './usual';
import type { EventProjection, Id, ISODate, LedgerData, Won, YearMonth } from './types';

export interface WhatIfChange {
  kind: 'event' | 'trip';
  id: Id;
  /** 빼 보기 */
  exclude?: boolean;
  /** 바꿔 본 금액 (여행은 총예산) */
  amount?: Won;
  /** 바꿔 본 날짜 (여행은 떠나는 날) */
  date?: ISODate;
}

const validDate = (d: unknown): d is ISODate => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const validAmount = (n: unknown): n is Won => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** 실제로 무언가 바꾸는 변경만 (같은 값 · 없는 행은 뺀다) */
export function effectiveChanges(data: LedgerData, changes: WhatIfChange[]): WhatIfChange[] {
  const out: WhatIfChange[] = [];
  for (const c of changes) {
    if (c.kind === 'event') {
      const e = data.events.find((x) => x.id === c.id && !x.deleted && x.status === 'planned');
      if (!e) continue;
      const amount = validAmount(c.amount) && Math.round(c.amount) !== e.amount ? Math.round(c.amount) : undefined;
      const date = validDate(c.date) && c.date !== e.date ? c.date : undefined;
      if (c.exclude) out.push({ kind: 'event', id: c.id, exclude: true });
      else if (amount !== undefined || date !== undefined) out.push({ kind: 'event', id: c.id, amount, date });
    } else {
      const t = data.trips.find((x) => x.id === c.id && !x.deleted);
      if (!t) continue;
      const amount = validAmount(c.amount) && Math.round(c.amount) !== tripBudget(t) ? Math.round(c.amount) : undefined;
      const date = validDate(c.date) && c.date !== t.startDate ? c.date : undefined;
      if (c.exclude || amount === 0) out.push({ kind: 'trip', id: c.id, exclude: true });
      else if (amount !== undefined || date !== undefined) out.push({ kind: 'trip', id: c.id, amount, date });
    }
  }
  return out;
}

/** 변경을 덮어씌운 가계부 (원본은 그대로) */
export function applyWhatIf(data: LedgerData, changes: WhatIfChange[]): LedgerData {
  const list = effectiveChanges(data, changes);
  if (list.length === 0) return data;
  const ev = new Map(list.filter((c) => c.kind === 'event').map((c) => [c.id, c]));
  const tr = new Map(list.filter((c) => c.kind === 'trip').map((c) => [c.id, c]));
  return {
    ...data,
    events: data.events.map((e) => {
      const c = ev.get(e.id);
      if (!c) return e;
      if (c.exclude) return { ...e, deleted: true };
      return { ...e, ...(c.amount !== undefined ? { amount: c.amount } : {}), ...(c.date ? { date: c.date } : {}) };
    }),
    trips: data.trips.map((t) => {
      const c = tr.get(t.id);
      if (!c) return t;
      if (c.exclude) return { ...t, deleted: true };
      const next = { ...t };
      if (c.amount !== undefined) next.budget = c.amount;
      if (c.date) {
        const len = Math.max(0, daysBetween(t.startDate, t.endDate));
        next.startDate = c.date;
        next.endDate = addDays(c.date, len);
      }
      return next;
    }),
  };
}

/** 해 본 예측 */
export function projectWhatIf(data: LedgerData, today: ISODate, changes: WhatIfChange[]): EventProjection {
  return projectEventAccount(applyWhatIf(data, changes), today);
}

export interface WhatIfDiff {
  /** 없어지는 부족 달 */
  resolved: YearMonth[];
  /** 새로 생기는 부족 (금액은 바꾼 뒤) */
  added: { month: YearMonth; amount: Won }[];
  /** 마지막 달 예상 잔액 차이 */
  lastMonth: YearMonth | null;
  lastDelta: Won;
  /** 한 줄 안내 (바꾼 것이 없으면 '') */
  message: string;
}

function leadOf(changes: WhatIfChange[]): string {
  if (changes.length !== 1) return '바꾼 대로면';
  const c = changes[0]!;
  const what = c.kind === 'trip' ? '여행' : '일정';
  if (c.exclude) return `이 ${what}을 빼면`;
  if (c.amount !== undefined && c.date) return '금액과 날짜를 바꾸면';
  return c.amount !== undefined ? '금액을 바꾸면' : '날짜를 옮기면';
}

/** 예측 비교: '이 일정을 빼면 5월 부족이 없어져요 · 12월 예상 잔액 +40만원' */
export function whatIfDiff(
  data: LedgerData,
  today: ISODate,
  changes: WhatIfChange[],
  before: EventProjection,
  after: EventProjection,
): WhatIfDiff {
  const list = effectiveChanges(data, changes);
  const baseYear = Number(today.slice(0, 4));
  const label = (m: YearMonth) => (m === monthOf(today) ? '이번 달' : formatMonthKo(m, baseYear));
  const afterShort = new Map(after.shortages.map((s) => [s.month, s.amount]));
  const beforeShort = new Set(before.shortages.map((s) => s.month));
  const resolved = before.shortages.filter((s) => !afterShort.has(s.month)).map((s) => s.month);
  const added = after.shortages.filter((s) => !beforeShort.has(s.month));
  const lastB = before.months[before.months.length - 1];
  const lastA = after.months[after.months.length - 1];
  const lastMonth = lastA?.month ?? null;
  const lastDelta = lastA && lastB ? lastA.endBalance - lastB.endBalance : 0;
  if (list.length === 0) return { resolved, added, lastMonth, lastDelta, message: '' };

  const parts: string[] = [];
  if (resolved.length > 0) {
    const months = resolved.length <= 2 ? resolved.map(label).join(' · ') : `${label(resolved[0]!)} 등 ${resolved.length}개월`;
    parts.push(`${months} 부족이 없어져요`);
  }
  if (added.length > 0) parts.push(`${label(added[0]!.month)}에 ${manWon(added[0]!.amount)} 모자라게 돼요`);
  if (resolved.length === 0 && added.length === 0) {
    parts.push(after.shortages.length > 0 ? `모자라는 달은 그대로 ${after.shortages.length}개월이에요` : '모자라는 달은 없어요');
  }
  const rounded = Math.round(lastDelta / 1000) * 1000;
  const tail =
    lastMonth && rounded !== 0 ? ` · ${label(lastMonth)} 예상 잔액 ${rounded > 0 ? '+' : '−'}${manWon(lastDelta)}` : '';
  return { resolved, added, lastMonth, lastDelta, message: `${leadOf(list)} ${parts.join(', ')}${tail}` };
}
