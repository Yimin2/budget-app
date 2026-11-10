import { describe, expect, it } from 'vitest';
import { moveCategory, moveCategoryTo, orderedCategories, reorderCategories } from './categories';
import { computeLiving } from './living';
import { account, emptyLedger, expense, fixed } from './_fixtures';
import type { Category } from './types';

const cat = (id: string, order: number, deleted = false): Category => ({ id, name: id, icon: 'dots', defaultAccountRole: 'fixed', order, deleted });

describe('카테고리 순서', () => {
  const cats = [cat('a', 0), cat('b', 1), cat('gone', 2, true), cat('c', 3)];

  it('아래로 · 위로 옮기면 지우지 않은 카테고리의 order 를 0..n-1 로 다시 매기고 바뀐 행만 돌려줘요', () => {
    expect(moveCategory(cats, 'a', 1).map((c) => [c.id, c.order])).toEqual([['b', 0], ['a', 1], ['c', 2]]);
    expect(moveCategory(cats, 'c', -1).map((c) => [c.id, c.order])).toEqual([['c', 1], ['b', 2]]);
  });

  it('맨 위에서 위로 · 맨 아래에서 아래로는 바꿀 게 없어요 (번호가 이미 0..n-1 이면)', () => {
    const tidy = [cat('a', 0), cat('b', 1), cat('c', 2)];
    expect(moveCategory(tidy, 'a', -1)).toEqual([]);
    expect(moveCategory(tidy, 'c', 1)).toEqual([]);
    expect(moveCategory(tidy, 'nope', 1)).toEqual([]);
  });

  it('같은 결과를 다시 적용하면 바뀌는 행이 없어요', () => {
    const changed = moveCategory(cats, 'a', 1);
    const applied = cats.map((c) => changed.find((x) => x.id === c.id) ?? c);
    expect(orderedCategories(applied).map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(reorderCategories(applied, ['b', 'a', 'c'])).toEqual([]);
  });

  it('생활비 항목은 카테고리 순서를 따르고, 기타(예산 없음) 묶음은 언제나 맨 뒤', () => {
    const fix = account('fixed');
    const base = emptyLedger({
      accounts: [fix],
      categories: [cat('food', 0), cat('cafe', 1), cat('bus', 2)],
      fixedExpenses: ['food', 'cafe', 'bus'].map((id) =>
        fixed({ amount: 300_000, accountId: fix.id, kind: 'living', categoryId: id, startMonth: '2026-01' }),
      ),
      expenses: [expense({ date: '2026-11-20', amount: 1000, accountId: fix.id, categoryId: null })],
    });
    expect(computeLiving(base, '2026-11-20').items.map((i) => i.categoryId)).toEqual(['food', 'cafe', 'bus', null]);
    const changed = moveCategory(base.categories, 'bus', -2);
    const moved = { ...base, categories: base.categories.map((c) => changed.find((x) => x.id === c.id) ?? c) };
    expect(computeLiving(moved, '2026-11-20').items.map((i) => i.categoryId)).toEqual(['bus', 'food', 'cafe', null]);
  });
});

describe('moveCategoryTo (끌어 놓기)', () => {
  const mk = (id: string, order: number) => ({ id, name: id, icon: 'tag', defaultAccountRole: 'fixed' as const, order, deleted: false });
  const cats = [mk('a', 0), mk('b', 1), mk('c', 2), mk('d', 3)];
  it('한 번에 여러 칸 옮기고 바뀐 행만 돌려줘요', () => {
    expect(moveCategoryTo(cats, 'a', 2).map((c) => [c.id, c.order])).toEqual([['b', 0], ['c', 1], ['a', 2]]);
    expect(moveCategoryTo(cats, 'd', 0).map((c) => [c.id, c.order])).toEqual([['d', 0], ['a', 1], ['b', 2], ['c', 3]]);
  });
  it('제자리 · 없는 id 는 빈 배열, 범위 밖은 끝으로', () => {
    expect(moveCategoryTo(cats, 'b', 1)).toEqual([]);
    expect(moveCategoryTo(cats, 'x', 0)).toEqual([]);
    expect(moveCategoryTo(cats, 'a', 99).map((c) => c.id)).toEqual(['b', 'c', 'd', 'a']);
  });
});
