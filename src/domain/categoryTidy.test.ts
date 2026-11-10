import { describe, expect, it } from 'vitest';
import {
  categoryGroupForAccount, categoryUseScores, hiddenCategories, pickableCategories, rankCategories, setHiddenRows, unusedCategories,
} from './categories';
import { applyMergeRows, mergeCountsText, planCategoryMerge } from './categoryMerge';
import { activeLivingRows } from './living';
import { account, emptyLedger, event, expense, fixed } from './_fixtures';
import type { Category, Favorite } from './types';

const cat = (id: string, order: number, p: Partial<Category> = {}): Category => ({
  id, name: id, icon: 'dots', defaultAccountRole: 'fixed', order, deleted: false, ...p,
});
const TODAY = '2026-11-10';

describe('기록 창 카테고리: 자주 쓴 6개 · 묶음 · 더 보기', () => {
  const cats = [
    cat('식비', 0), cat('카페', 1), cat('교통', 2), cat('생활', 3), cat('쇼핑', 4), cat('의료', 5), cat('문화', 6), cat('미용', 7),
    cat('경조사', 8, { defaultAccountRole: 'event' }), cat('여행', 9, { defaultAccountRole: 'event' }),
    cat('숨김', 10, { hidden: true }), cat('지움', 11, { deleted: true }),
  ];
  const ex = (categoryId: string, date: string, p = {}) => expense({ date, amount: 1000, accountId: 'acc-fixed', categoryId, ...p });

  it('최근 90일 쓴 횟수를 가까울수록 무겁게 세고, 90일 밖 · 지운 지출 · 자동 고정비 · 미래는 세지 않아요', () => {
    const s = categoryUseScores(
      [
        ex('미용', '2026-11-10'), ex('미용', '2026-08-13'), ex('문화', '2026-08-01'),
        ex('문화', '2026-11-09', { deleted: true }), ex('문화', '2026-11-09', { fixedExpenseId: 'fx' }), ex('문화', '2026-11-20'),
      ],
      TODAY,
    );
    expect(s.get('미용')).toBeCloseTo(2 + (1 + 1 / 90), 5);
    expect(s.has('문화')).toBe(false);
  });

  it('점수 순으로 6개, 같으면 정한 순서. 쓴 기록이 모자라면 정한 순서로 채워요', () => {
    const scores = categoryUseScores([ex('미용', '2026-11-01'), ex('미용', '2026-11-02'), ex('문화', '2026-11-03'), ex('카페', '2026-10-01')], TODAY);
    const r = rankCategories(cats, scores, { group: 'living' });
    expect(r.top.map((c) => c.id)).toEqual(['미용', '문화', '카페', '식비', '교통', '생활']);
    // 같은 묶음 나머지 먼저, 그다음 다른 묶음. 숨김 · 지움은 빠져요
    expect(r.rest.map((c) => c.id)).toEqual(['쇼핑', '의료', '경조사', '여행']);
  });

  it('최근 날짜가 무거워서, 같은 횟수면 더 최근에 쓴 카테고리가 앞이에요', () => {
    const scores = categoryUseScores([ex('의료', '2026-08-20'), ex('쇼핑', '2026-11-09')], TODAY);
    expect(rankCategories(cats, scores, { group: 'living' }).top.slice(0, 2).map((c) => c.id)).toEqual(['쇼핑', '의료']);
  });

  it('이벤트통장이면 이벤트 카테고리만 먼저, 나머지는 더 보기에', () => {
    const r = rankCategories(cats, new Map(), { group: 'event' });
    expect(r.top.map((c) => c.id)).toEqual(['경조사', '여행']);
    expect(r.rest[0]!.id).toBe('식비');
    expect(r.rest.some((c) => c.id === '숨김')).toBe(false);
  });

  it('고른 카테고리는 늘 보여요 (더 보기 안이든 숨긴 것이든)', () => {
    expect(rankCategories(cats, new Map(), { group: 'living', selectedId: '미용' }).top.map((c) => c.id)).toContain('미용');
    const r = rankCategories(cats, new Map(), { group: 'living', selectedId: '숨김' });
    expect(r.top[r.top.length - 1]!.id).toBe('숨김');
    expect(rankCategories(cats, new Map(), { group: 'living', selectedId: '식비' }).top).toHaveLength(6);
  });

  it('통장 묶음: 이벤트 → event, 고정지출 · 용돈 · 생활비 통장 → living, 그 밖은 거르지 않음', () => {
    expect(categoryGroupForAccount(account('event'))).toBe('event');
    expect(categoryGroupForAccount(account('fixed'))).toBe('living');
    expect(categoryGroupForAccount(account('allowance'))).toBe('living');
    expect(categoryGroupForAccount(account('reservoir'))).toBeNull();
    expect(categoryGroupForAccount(account('other', { id: 'liv' }), ['liv'], 'liv')).toBe('living');
    expect(categoryGroupForAccount(null)).toBeNull();
  });
});

describe('숨기기 · 다시 보기', () => {
  const cats = [cat('a', 0), cat('b', 1, { hidden: true }), cat('c', 2), cat('gone', 3, { deleted: true })];

  it('고르는 목록에서 숨긴 것 · 지운 것이 빠지고, 숨긴 목록은 따로', () => {
    expect(pickableCategories(cats).map((c) => c.id)).toEqual(['a', 'c']);
    expect(hiddenCategories(cats).map((c) => c.id)).toEqual(['b']);
  });

  it('바뀌는 행만 돌려주고 다시 하면 바뀌는 게 없어요. 다시 보기는 숨김 칸을 비워요', () => {
    const hid = setHiddenRows(cats, ['a', 'b', 'gone'], true);
    expect(hid.map((c) => c.id)).toEqual(['a']);
    const applied = cats.map((c) => hid.find((x) => x.id === c.id) ?? c);
    expect(setHiddenRows(applied, ['a'], true)).toEqual([]);
    const shown = setHiddenRows(applied, ['a', 'b'], false);
    expect(shown.map((c) => c.id)).toEqual(['a', 'b']);
    expect(shown.every((c) => !('hidden' in c))).toBe(true);
  });

  it('최근 3개월 동안 안 쓴 카테고리: 지출 · 이번 달 생활비 예산 · 앞으로의 일정이 없는 보이는 카테고리', () => {
    const d = emptyLedger({
      categories: [cat('식비', 0), cat('카페', 1), cat('문화', 2), cat('경조사', 3, { defaultAccountRole: 'event' }), cat('옛날', 4), cat('숨김', 5, { hidden: true })],
      expenses: [
        expense({ date: '2026-08-10', amount: 1, accountId: 'x', categoryId: '식비' }),
        expense({ date: '2026-08-09', amount: 1, accountId: 'x', categoryId: '옛날' }),
      ],
      fixedExpenses: [fixed({ kind: 'living', amount: 1, accountId: 'x', categoryId: '카페' })],
      events: [event({ date: '2026-12-01', amount: 1, accountId: 'x', categoryId: '경조사' })],
    });
    expect(unusedCategories(d, TODAY).map((c) => c.id)).toEqual(['문화', '옛날']);
  });
});

describe('카테고리 합치기', () => {
  const fav = (p: Partial<Favorite>): Favorite => ({ id: 'fav1', name: '커피', amount: 4500, categoryId: null, accountId: null, order: 0, deleted: false, ...p });

  function ledger() {
    return emptyLedger({
      accounts: [account('fixed', { id: 'L' }), account('event', { id: 'E' })],
      categories: [cat('food', 0, { name: '식비' }), cat('cafe', 1, { name: '카페' }), cat('etc', 2)],
      expenses: [
        expense({ id: 'e1', date: '2026-11-01', amount: 5000, accountId: 'L', categoryId: 'cafe' }),
        expense({ id: 'e2', date: '2026-10-01', amount: 4000, accountId: 'L', categoryId: 'cafe' }),
        expense({ id: 'e3', date: '2026-10-01', amount: 9000, accountId: 'L', categoryId: 'food' }),
        expense({ id: 'e4', date: '2026-10-02', amount: 1, accountId: 'L', categoryId: 'cafe', deleted: true }),
      ],
      fixedExpenses: [
        // 같은 통장에 두 예산이 같은 기간 → 금액을 식비 행에 더함
        fixed({ id: 'food-L', kind: 'living', accountId: 'L', categoryId: 'food', amount: 500000, startMonth: '2026-01' }),
        fixed({ id: 'cafe-L', kind: 'living', accountId: 'L', categoryId: 'cafe', amount: 100000, startMonth: '2026-01' }),
        // 다른 통장에는 식비 예산이 없음 → 카페 행을 식비로 돌림
        fixed({ id: 'cafe-E', kind: 'living', accountId: 'E', categoryId: 'cafe', amount: 30000, startMonth: '2026-01' }),
        fixed({ id: 'bill', kind: 'bill', accountId: 'L', categoryId: 'cafe', amount: 9900, dayOfMonth: 5 }),
      ],
      favorites: [fav({ categoryId: 'cafe' })],
      events: [event({ id: 'ev', date: '2026-12-01', amount: 1, accountId: 'E', categoryId: 'cafe' })],
    });
  }

  it('지출 · 예산 · 고정비 · 자주 쓰는 지출 · 일정을 옮기고 카테고리를 지운 것으로 표시해요', () => {
    const d = ledger();
    const plan = planCategoryMerge(d, 'cafe', 'food');
    expect(plan.counts).toEqual({ expenses: 2, budgets: 2, fixed: 1, favorites: 1, events: 1 });
    expect(mergeCountsText(plan.counts)).toBe('지출 2건 · 예산 2개 · 고정비 1개 · 일정 1개');
    const after = applyMergeRows(d, plan);
    expect(after.expenses.filter((e) => !e.deleted && e.categoryId === 'cafe')).toEqual([]);
    expect(after.expenses.find((e) => e.id === 'e4')!.categoryId).toBe('cafe');
    expect(after.favorites[0]!.categoryId).toBe('food');
    expect(after.events[0]!.categoryId).toBe('food');
    expect(after.fixedExpenses.find((f) => f.id === 'bill')!.categoryId).toBe('food');
    expect(after.categories.find((c) => c.id === 'cafe')!.deleted).toBe(true);

    // 같은 통장: 식비 행에 금액을 더하고 카페 행은 지움. 다른 통장: 카페 행을 식비로
    expect(after.fixedExpenses.find((f) => f.id === 'food-L')!.amount).toBe(600000);
    expect(after.fixedExpenses.find((f) => f.id === 'cafe-L')!.deleted).toBe(true);
    const moved = after.fixedExpenses.find((f) => f.id === 'cafe-E')!;
    expect([moved.categoryId, moved.name, moved.amount, moved.deleted]).toEqual(['food', '식비', 30000, false]);
    const rows = activeLivingRows(after, '2026-11');
    expect(rows.filter((r) => r.categoryId === 'food').map((r) => [r.accountId, r.amount])).toEqual([['L', 600000], ['E', 30000]]);
  });

  it('다시 하면 바꿀 게 없어요 (이미 합친 카테고리는 지운 것이라 다시 합칠 수 없음)', () => {
    const after = applyMergeRows(ledger(), planCategoryMerge(ledger(), 'cafe', 'food'));
    expect(() => planCategoryMerge(after, 'cafe', 'food')).toThrow();
    expect(() => planCategoryMerge(ledger(), 'food', 'food')).toThrow();
  });

  it('되돌리기 행을 쓰면 합치기 전과 같아요 (나눠 만든 행은 지운 것으로)', () => {
    const d = ledger();
    d.fixedExpenses.find((f) => f.id === 'cafe-L')!.startMonth = '2026-06';
    const plan = planCategoryMerge(d, 'cafe', 'food');
    const after = applyMergeRows(d, plan);
    const undone = applyMergeRows(after, plan.undo);
    for (const m of ['2026-03', '2026-11']) {
      expect(activeLivingRows(undone, m).map((r) => [r.id, r.categoryId, r.amount])).toEqual(
        activeLivingRows(d, m).map((r) => [r.id, r.categoryId, r.amount]),
      );
    }
    expect(undone.expenses.map((e) => e.categoryId)).toEqual(d.expenses.map((e) => e.categoryId));
    expect(undone.categories.find((c) => c.id === 'cafe')!.deleted).toBe(false);
  });

  it('달 경계가 다르면 그 달부터 나눠요: 겹치는 달만 더하고, 식비 예산이 없는 달은 카페 예산을 식비로', () => {
    const d = emptyLedger({
      accounts: [account('fixed', { id: 'L' })],
      categories: [cat('food', 0, { name: '식비' }), cat('cafe', 1, { name: '카페' })],
      fixedExpenses: [
        fixed({ id: 'food', kind: 'living', accountId: 'L', categoryId: 'food', amount: 500000, startMonth: '2026-06' }),
        fixed({ id: 'cafe', kind: 'living', accountId: 'L', categoryId: 'cafe', amount: 100000, startMonth: '2026-01', endMonth: '2026-09' }),
      ],
    });
    const after = applyMergeRows(d, planCategoryMerge(d, 'cafe', 'food'));
    const at = (m: string) => activeLivingRows(after, m).map((r) => [r.categoryId, r.amount]);
    expect(at('2026-03')).toEqual([['food', 100000]]);
    expect(at('2026-07')).toEqual([['food', 600000]]);
    expect(at('2026-11')).toEqual([['food', 500000]]);
    // 같은 달에 두 행이 겹치지 않아요
    for (const m of ['2026-05', '2026-06', '2026-09', '2026-10']) expect(activeLivingRows(after, m)).toHaveLength(1);
  });

  it("'이 달만 다른 금액'은 그달 두 항목의 실제 금액 합으로 맞춰요", () => {
    const d = emptyLedger({
      accounts: [account('fixed', { id: 'L' })],
      categories: [cat('food', 0, { name: '식비' }), cat('cafe', 1, { name: '카페' })],
      fixedExpenses: [
        fixed({ id: 'food', kind: 'living', accountId: 'L', categoryId: 'food', amount: 500000 }),
        fixed({ id: 'cafe', kind: 'living', accountId: 'L', categoryId: 'cafe', amount: 100000 }),
        fixed({ id: 'cafe@once-2026-12', kind: 'living', accountId: 'L', categoryId: 'cafe', amount: 50000, startMonth: '2026-12', endMonth: '2026-12', override: true }),
        fixed({ id: 'food@once-2027-01', kind: 'living', accountId: 'L', categoryId: 'food', amount: 700000, startMonth: '2027-01', endMonth: '2027-01', override: true }),
      ],
    });
    const after = applyMergeRows(d, planCategoryMerge(d, 'cafe', 'food'));
    const amt = (m: string) => activeLivingRows(after, m).map((r) => [r.categoryId, r.amount]);
    expect(amt('2026-11')).toEqual([['food', 600000]]);
    expect(amt('2026-12')).toEqual([['food', 550000]]);
    expect(amt('2027-01')).toEqual([['food', 800000]]);
  });
});
