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
