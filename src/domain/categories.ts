/**
 * 카테고리 순서 — 사용자가 정한 순서(order)를 모든 화면이 따른다 (기록 · 사도 돼? · 내역 필터 · 생활비 항목 · 홈).
 * 지우지 않은 카테고리를 order → 처음 나온 순서로 줄 세운다
 */
import type { Category, Id } from './types';

/** 지우지 않은 카테고리, 순서대로 */
export function orderedCategories(categories: Category[]): Category[] {
  return categories
    .map((c, i) => ({ c, i }))
    .filter((x) => !x.c.deleted)
    .sort((a, b) => a.c.order - b.c.order || a.i - b.i)
    .map((x) => x.c);
}

/**
 * id 카테고리를 delta 칸(-1 = 위로, +1 = 아래로) 옮긴 뒤, 지우지 않은 카테고리의 order 를 0..n-1 로 다시 매긴다.
 * order 가 바뀐 행만 돌려준다 (못 옮기면 빈 배열). 같은 결과를 다시 적용해도 바뀌는 행이 없다
 */
export function moveCategory(categories: Category[], id: Id, delta: number): Category[] {
  const from = orderedCategories(categories).findIndex((c) => c.id === id);
  if (from < 0) return [];
  return moveCategoryTo(categories, id, from + Math.trunc(delta));
}

/**
 * id 카테고리를 순서의 to 번째(0부터, 범위 밖이면 끝으로)로 옮긴 뒤 order 를 0..n-1 로 다시 매긴다 (끌어 놓기).
 * order 가 바뀐 행만 돌려준다
 */
export function moveCategoryTo(categories: Category[], id: Id, toIndex: number): Category[] {
  const list = orderedCategories(categories);
  const from = list.findIndex((c) => c.id === id);
  if (from < 0 || !Number.isFinite(toIndex)) return [];
  const to = Math.max(0, Math.min(list.length - 1, Math.trunc(toIndex)));
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return renumber(next);
}

/** 정한 순서(ids)대로 order 를 0..n-1 로. 목록에 없는 카테고리는 뒤에 원래 순서대로. 바뀐 행만 */
export function reorderCategories(categories: Category[], ids: Id[]): Category[] {
  const list = orderedCategories(categories);
  const pos = new Map(ids.map((id, i) => [id, i]));
  const next = [...list].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9) || list.indexOf(a) - list.indexOf(b));
  return renumber(next);
}

function renumber(list: Category[]): Category[] {
  const out: Category[] = [];
  list.forEach((c, i) => {
    if (c.order !== i) out.push({ ...c, order: i });
  });
  return out;
}

/* ───────── 숨김 · 고르는 목록 (기록 창 · 사도 돼? 칩) ───────── */

/** 고를 수 있는 카테고리: 지우지 않고 숨기지 않은 것 */
export function isPickableCategory(c: Category): boolean {
  return !c.deleted && c.hidden !== true;
}

/** 고르는 목록에 보일 카테고리, 순서대로 (숨긴 것 · 지운 것 빼고) */
export function pickableCategories(categories: Category[]): Category[] {
  return orderedCategories(categories).filter(isPickableCategory);
}

/** 숨긴 카테고리, 순서대로 (지운 것 빼고) */
export function hiddenCategories(categories: Category[]): Category[] {
  return orderedCategories(categories).filter((c) => c.hidden === true);
}

/**
 * 숨기기 · 다시 보기: 바뀌는 행만 돌려준다 (이미 그 상태면 빈 배열 → 다시 해도 같음). 지운 카테고리는 건드리지 않는다.
 * 다시 보기는 숨김 칸을 비운다(undefined)
 */
export function setHiddenRows(categories: Category[], ids: Id[], hidden: boolean): Category[] {
  const want = new Set(ids);
  const out: Category[] = [];
  for (const c of categories) {
    if (!want.has(c.id) || c.deleted) continue;
    if ((c.hidden === true) === hidden) continue;
    const next: Category = { ...c };
    if (hidden) next.hidden = true;
    else delete next.hidden;
    out.push(next);
  }
  return out;
}

/** 카테고리의 묶음: 이벤트통장 카테고리 = 'event', 나머지 = 'living' (생활비) */
export type CategoryGroup = 'living' | 'event';

export function categoryGroupOf(c: Pick<Category, 'defaultAccountRole'>): CategoryGroup {
  return c.defaultAccountRole === 'event' ? 'event' : 'living';
}

/**
 * 고른 통장에 맞는 카테고리 묶음: 이벤트통장 → 이벤트, 고정지출 · 생활비 · 용돈 통장 → 생활비.
 * 그 밖의 통장(저수지 · 저축 · 수입 …)이나 모르는 통장은 null (묶음으로 거르지 않음)
 */
export function categoryGroupForAccount(
  account: { role: string } | null | undefined,
  livingAccountIds: Id[] = [],
  accountId?: Id | null,
): CategoryGroup | null {
  if (accountId && livingAccountIds.includes(accountId)) return 'living';
  if (!account) return null;
  if (account.role === 'event') return 'event';
  if (account.role === 'fixed' || account.role === 'allowance') return 'living';
  return null;
}

/** 자주 쓴 카테고리를 셀 기간 (일) */
export const RANK_DAYS = 90;
/** 기록 창에 먼저 보일 카테고리 개수 */
export const TOP_CATEGORIES = 6;

/**
 * 최근 90일 동안 카테고리마다 쓴 횟수 점수 (가까울수록 무겁게: 오늘 2 → 90일 전 1).
 * 지운 지출 · 자동 기록된 고정 지출 · 미래 날짜는 세지 않는다
 */
export function categoryUseScores(
  expenses: { date: string; categoryId: Id | null; deleted: boolean; fixedExpenseId?: Id | null }[],
  today: string,
  days = RANK_DAYS,
): Map<Id, number> {
  const end = Date.parse(`${today}T00:00:00Z`);
  const scores = new Map<Id, number>();
  if (!Number.isFinite(end)) return scores;
  for (const e of expenses) {
    if (e.deleted || !e.categoryId || e.fixedExpenseId) continue;
    const t = Date.parse(`${e.date}T00:00:00Z`);
    if (!Number.isFinite(t)) continue;
    const age = Math.round((end - t) / 86_400_000);
    if (age < 0 || age >= days) continue;
    scores.set(e.categoryId, (scores.get(e.categoryId) ?? 0) + 1 + (days - age) / days);
  }
  return scores;
}

export interface RankedCategories {
  /** 먼저 보일 카테고리 (자주 쓴 순, 같으면 정한 순서). 고른 카테고리가 여기 없으면 끝에 붙는다 */
  top: Category[];
  /** [더 보기]로 펼칠 나머지: 같은 묶음 먼저, 그다음 다른 묶음, 각각 정한 순서 */
  rest: Category[];
}

/**
 * 기록 창 카테고리 줄 세우기. 고를 수 있는 카테고리(숨김 · 지움 제외) 중 통장 묶음(group)에 맞는 것을
 * 최근 90일 쓴 점수 순(같으면 정한 순서)으로 limit 개. 쓴 기록이 모자라면 정한 순서로 채운다.
 * 고른 카테고리(selectedId)는 늘 보인다 (숨긴 · 지운 카테고리라도 지금 고른 값이면 top 끝에)
 */
export function rankCategories(
  categories: Category[],
  scores: Map<Id, number>,
  opts: { group?: CategoryGroup | null; selectedId?: Id | null; limit?: number } = {},
): RankedCategories {
  const limit = opts.limit ?? TOP_CATEGORIES;
  const list = pickableCategories(categories);
  const pos = new Map(list.map((c, i) => [c.id, i]));
  const inGroup = opts.group ? list.filter((c) => categoryGroupOf(c) === opts.group) : list;
  const sorted = [...inGroup].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || pos.get(a.id)! - pos.get(b.id)!);
  const top = sorted.slice(0, limit);
  const topIds = new Set(top.map((c) => c.id));
  const restSame = inGroup.filter((c) => !topIds.has(c.id));
  const restOther = opts.group ? list.filter((c) => categoryGroupOf(c) !== opts.group) : [];
  let rest = [...restSame, ...restOther];
  const sel = opts.selectedId ?? null;
  if (sel && !topIds.has(sel)) {
    const picked = rest.find((c) => c.id === sel) ?? categories.find((c) => c.id === sel);
    if (picked) {
      top.push(picked);
      rest = rest.filter((c) => c.id !== sel);
    }
  }
  return { top, rest };
}

/**
 * 최근 3개월 동안 안 쓴 카테고리 (숨기기 제안): 보이는 카테고리 중 since(포함) 이후 지출이 없고,
 * 이번 달 생활비 예산 항목도 아니고, 앞으로의 예정 일정도 없는 것. 정한 순서대로
 */
export function unusedCategories(
  data: {
    categories: Category[];
    expenses: { date: string; categoryId: Id | null; deleted: boolean }[];
    fixedExpenses: { categoryId: Id | null; deleted: boolean; kind: string; startMonth: string; endMonth: string | null }[];
    events: { categoryId: Id | null; deleted: boolean; status: string; date: string }[];
  },
  today: string,
  months = 3,
): Category[] {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const back = new Date(Date.UTC(y, m - 1 - months, 1));
  const lastDay = new Date(Date.UTC(back.getUTCFullYear(), back.getUTCMonth() + 1, 0)).getUTCDate();
  back.setUTCDate(Math.min(d, lastDay));
  const since = back.toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const used = new Set<Id>();
  for (const e of data.expenses) if (!e.deleted && e.categoryId && e.date >= since && e.date <= today) used.add(e.categoryId);
  for (const f of data.fixedExpenses) {
    if (f.deleted || f.kind !== 'living' || !f.categoryId) continue;
    if (f.startMonth <= month && (!f.endMonth || f.endMonth >= month)) used.add(f.categoryId);
  }
  for (const ev of data.events) if (!ev.deleted && ev.categoryId && ev.status === 'planned' && ev.date >= today) used.add(ev.categoryId);
  return pickableCategories(data.categories).filter((c) => !used.has(c.id));
}
