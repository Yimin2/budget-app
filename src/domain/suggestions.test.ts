import { describe, expect, it } from 'vitest';
import { account, emptyLedger, fixed } from './_fixtures';
import { normalizeMemo, suggestExpenses } from './suggestions';
import type { Category, Expense, LedgerData } from './types';

const TODAY = '2026-11-20';
const ME = 'me@x';
const YOU = 'you@x';
const MINE = 'acc-mine';
const YOURS = 'acc-yours';

const cat = (id: string, p: Partial<Category> = {}): Category =>
  ({ id, name: id, defaultAccountRole: 'fixed', order: 0, deleted: false, ...p }) as Category;

let seq = 0;
function ex(p: Partial<Expense> & Pick<Expense, 'date' | 'amount'>): Expense {
  seq += 1;
  return {
    id: `e${seq}`, accountId: MINE, categoryId: 'cafe', memo: '커피', eventId: null, fixedExpenseId: null, author: ME,
    createdAt: `${p.date}T12:00:${String(seq % 60).padStart(2, '0')}.000Z`, updatedAt: `${p.date}T12:00:00.000Z`, deleted: false, ...p,
  };
}

/** 두 사람 가계부: 사람마다 생활비 통장(주인 = 그 사람) + 함께 쓰는 이벤트통장 */
function ledger(expenses: Expense[], over: Partial<LedgerData> = {}): LedgerData {
  return emptyLedger({
    accounts: [
      account('fixed', { id: MINE, name: '생활비(나)', ownerName: '나', ownerEmail: ME, order: 0 }),
      account('fixed', { id: YOURS, name: '생활비(너)', ownerName: '너', ownerEmail: YOU, order: 1 }),
      account('event', { id: 'acc-event', order: 2 }),
    ],
    members: [
      { email: ME, displayName: '나' },
      { email: YOU, displayName: '너' },
    ] as LedgerData['members'],
    fixedExpenses: [
      fixed({ kind: 'living', accountId: MINE, amount: 300_000, categoryId: 'cafe' }),
      fixed({ kind: 'living', accountId: YOURS, amount: 300_000, categoryId: 'cafe' }),
    ],
    categories: [cat('cafe'), cat('food'), cat('gift', { defaultAccountRole: 'event' }), cat('old', { deleted: true }), cat('secret', { hidden: true })],
    expenses,
    ...over,
  });
}

const run = (data: LedgerData, opts: Partial<Parameters<typeof suggestExpenses>[1]> = {}) =>
  suggestExpenses(data, { today: TODAY, meKey: ME, myLivingId: MINE, ...opts });

describe('자주 쓰는 지출 자동 추천', () => {
  it('카테고리 + 내용(공백 · 대소문자 무시)으로 묶고, 많이 쓴 순 → 같으면 최근 순, 최대 6개', () => {
    const data = ledger([
      ex({ date: '2026-11-01', amount: 4_500, memo: '커피' }),
      ex({ date: '2026-11-10', amount: 4_800, memo: ' 커피  ' }),
      ex({ date: '2026-11-15', amount: 5_000, memo: '커피' }),
      ex({ date: '2026-11-02', amount: 9_000, categoryId: 'food', memo: 'Lunch' }),
      ex({ date: '2026-11-12', amount: 9_500, categoryId: 'food', memo: 'lunch' }),
      // 같은 2회: 마트(11-18)가 점심(11-12)보다 최근 → 먼저
      ex({ date: '2026-11-05', amount: 20_000, categoryId: 'food', memo: '마트' }),
      ex({ date: '2026-11-18', amount: 23_000, categoryId: 'food', memo: '마트' }),
      // 같은 내용이어도 카테고리가 다르면 따로
      ex({ date: '2026-11-03', amount: 7_000, categoryId: 'food', memo: '커피' }),
      ex({ date: '2026-11-04', amount: 1, categoryId: 'food', memo: 'a' }),
      ex({ date: '2026-11-06', amount: 2, categoryId: 'food', memo: 'b' }),
      ex({ date: '2026-11-07', amount: 3, categoryId: 'food', memo: 'c' }),
    ]);
    const list = run(data);
    expect(list).toHaveLength(6);
    expect(list.slice(0, 3).map((s) => [s.label, s.count, s.amount])).toEqual([
      ['커피', 3, 5_000],
      ['마트', 2, 23_000],
      ['lunch', 2, 9_500],
    ]);
    // 1회짜리는 최근 순: c(11-07) → b(11-06) → a(11-04) → 커피/식비(11-03) 는 7번째라 빠짐
    expect(list.slice(3).map((s) => s.label)).toEqual(['c', 'b', 'a']);
    expect(list[0]).toMatchObject({ categoryId: 'cafe', memo: '커피', accountId: MINE, lastDate: '2026-11-15' });
  });

  it('가장 최근 지출의 금액 · 카테고리 · 내용 · 통장을 쓰고, 생활비 통장은 내 생활비 통장으로', () => {
    const data = ledger([
      ex({ date: '2026-11-01', amount: 30_000, categoryId: 'gift', memo: '선물', accountId: 'acc-event' }),
      ex({ date: '2026-11-09', amount: 50_000, categoryId: 'gift', memo: '선물 ', accountId: 'acc-event' }),
    ]);
    expect(run(data)).toEqual([
      { key: 'gift|선물', label: '선물', amount: 50_000, categoryId: 'gift', memo: '선물', accountId: 'acc-event', count: 2, lastDate: '2026-11-09' },
    ]);
  });

  it('내가 쓴 지출만: 다른 사람 생활비 통장 지출 · 다른 사람이 기록한 함께 통장 지출은 빼고, 다른 사람이 내 통장에 기록한 건 내 것', () => {
    const data = ledger([
      ex({ date: '2026-11-10', amount: 9_000, memo: '너의 커피', accountId: YOURS, author: YOU }),
      ex({ date: '2026-11-10', amount: 9_000, memo: '내가 기록한 너의 커피', accountId: YOURS, author: ME }),
      ex({ date: '2026-11-11', amount: 10_000, memo: '너의 선물', categoryId: 'gift', accountId: 'acc-event', author: YOU }),
      ex({ date: '2026-11-12', amount: 4_000, memo: '너가 기록한 내 커피', accountId: MINE, author: YOU }),
    ]);
    expect(run(data).map((s) => s.label)).toEqual(['너가 기록한 내 커피']);
  });

  it('청구 · 예외 · 자동 기록(auto: · fixed: · imp: · income: …) · 고정비 · 일정 · 여행 · 지운 것 · 미래 · 3개월 전 · 지운/숨긴 카테고리는 빼요', () => {
    const base = { amount: 4_500, date: '2026-11-10' };
    const data = ledger([
      ex({ ...base, memo: '청구', paidBy: '나' }),
      ex({ ...base, memo: '예외', excluded: true }),
      ex({ ...base, memo: '자동1', id: 'auto:r1:2026-11' }),
      ex({ ...base, memo: '자동2', id: 'fixed:f1:2026-11' }),
      ex({ ...base, memo: '자동3', id: 'imp:file:expenses:1' }),
      ex({ ...base, memo: '자동4', id: 'income:p1:2026-11' }),
      ex({ ...base, memo: '자동5', id: 'event:ev1' }),
      ex({ ...base, memo: '고정비', fixedExpenseId: 'f1' }),
      ex({ ...base, memo: '일정', eventId: 'ev1' }),
      ex({ ...base, memo: '여행', tripId: 't1' }),
      ex({ ...base, memo: '지움', deleted: true }),
      ex({ ...base, memo: '0원', amount: 0 }),
      ex({ ...base, memo: '미래', date: '2026-11-21' }),
      ex({ ...base, memo: '오래됨', date: '2026-08-19' }),
      ex({ ...base, memo: '지운 카테고리', categoryId: 'old' }),
      ex({ ...base, memo: '숨긴 카테고리', categoryId: 'secret' }),
      ex({ ...base, memo: '3개월 안 첫날', date: '2026-08-20' }),
    ]);
    expect(run(data).map((s) => s.label)).toEqual(['3개월 안 첫날']);
  });

  it('기록이 없거나 나를 모르면 빈 목록, 예전에 등록한 즐겨찾기는 읽지 않아요', () => {
    const favorites = [{ id: 'fav', name: '커피', amount: 4_500, categoryId: 'cafe', accountId: MINE, order: 0, deleted: false }];
    expect(run(ledger([], { favorites }))).toEqual([]);
    expect(run(ledger([ex({ date: '2026-11-10', amount: 1 })]), { meKey: null, myLivingId: null })).toEqual([]);
  });

  it('내용이 없으면 카테고리 이름, 지운 통장이면 내 생활비 통장', () => {
    const data = ledger([ex({ date: '2026-11-10', amount: 3_000, memo: '', categoryId: 'food', accountId: 'acc-gone' })]);
    data.accounts.push(account('fixed', { id: 'acc-gone', ownerEmail: ME, deleted: true }));
    expect(run(data)).toMatchObject([{ label: 'food', memo: '', accountId: MINE }]);
    expect(run(data, { myLivingId: null })).toEqual([]);
  });

  it('normalizeMemo', () => {
    expect(normalizeMemo('  Ice   Americano ')).toBe('ice americano');
    expect(normalizeMemo(null)).toBe('');
  });
});
