import { describe, expect, it } from 'vitest';
import { account, emptyLedger, expense } from './_fixtures';
import { allBalances } from './balances';
import { projectEventAccount } from './events';
import {
  applyExclusions, averageUsual, effectiveExclusions, exclusionPreviewMessage, findExceptionCandidates, projectWithExclusions,
} from './exceptions';
import type { Category, Expense, LedgerData } from './types';
import { estimateUsual, usualHistory, usualSpread } from './usual';
import { findRecurringCandidates } from './yearly';

const TODAY = '2026-11-10';
const income = account('income', { order: 0, openingDate: '2026-01-01' });
const eventAcc = account('event', { order: 1, openingBalance: 3_000_000, openingDate: '2026-01-01' });
const cat = (id: string, name: string): Category => ({ id, name, icon: 'gift', defaultAccountRole: 'event', order: 0, deleted: false });
const CATS = [cat('c-gift', '선물'), cat('c-fam', '경조사')];
const spend = (date: string, amount: number, p: Partial<Expense> = {}) =>
  expense({ date, amount, accountId: eventAcc.id, categoryId: 'c-gift', ...p });
const ledger = (p: Partial<LedgerData> = {}) => emptyLedger({ accounts: [income, eventAcc], categories: CATS, ...p });

/** 2026-05 ~ 2026-10 선물 매달 10만, 8월에 결혼식 축의금 100만(경조사) + 선물 60만 */
function sample() {
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  const base = months.map((m) => spend(`${m}-05`, 100_000, { id: `g-${m}` }));
  return ledger({
    expenses: [
      ...base,
      spend('2026-08-20', 600_000, { id: 'big-gift', memo: '노트북 선물' }),
      spend('2026-08-15', 1_000_000, { id: 'wedding', memo: '동생 결혼식', categoryId: 'c-fam' }),
      spend('2026-09-15', 100_000, { id: 'fam-small', categoryId: 'c-fam' }),
      spend('2026-10-15', 100_000, { id: 'fam-small2', categoryId: 'c-fam' }),
    ],
  });
}

describe('예외 표시는 평소 쓰는 돈 · 범위 · 매년 찾기에서 빠져요', () => {
  it('평소 쓰는 돈 기록과 최근 평균에서 뺀다 (잔액은 그대로)', () => {
    const data = sample();
    const flagged = applyExclusions(data, { wedding: true });
    expect(usualHistory(data, eventAcc.id).byMonth.get('2026-08')!.get('c-fam')).toBe(1_000_000);
    expect(usualHistory(flagged, eventAcc.id).byMonth.get('2026-08')!.get('c-fam')).toBeUndefined();
    const before = estimateUsual(usualHistory(data, eventAcc.id), '2026-12', '2026-11');
    const after = estimateUsual(usualHistory(flagged, eventAcc.id), '2026-12', '2026-11');
    expect(before.total - after.total).toBe(Math.round(1_000_000 / 6));
    // 잔액에는 그대로 쓴 돈
    expect(allBalances(flagged, TODAY)[eventAcc.id]).toBe(allBalances(data, TODAY)[eventAcc.id]);
  });

  it('범위(백분위) 폭도 예외를 뺀 기록으로 센다', () => {
    const data = sample();
    const before = usualSpread(usualHistory(data, eventAcc.id), '2026-11');
    const after = usualSpread(usualHistory(applyExclusions(data, { wedding: true, 'big-gift': true }), eventAcc.id), '2026-11');
    expect(before.method).toBe('percentile');
    expect(after.high).toBeLessThan(before.high);
    // 예외를 모두 빼면 달마다 같아 폭이 거의 없다
    const p = projectEventAccount(applyExclusions(data, { wedding: true, 'big-gift': true }), TODAY);
    const q = projectEventAccount(data, TODAY);
    expect(p.range!.spreadHigh).toBeLessThan(q.range!.spreadHigh);
  });

  it('매년 돌아오는 일 찾기에서도 뺀다', () => {
    const data = ledger({
      expenses: [spend('2025-11-20', 300_000, { id: 'b1', memo: '아빠 생신' }), spend('2024-11-21', 280_000, { id: 'b0', memo: '아빠 생신' })],
    });
    expect(findRecurringCandidates(data, TODAY)).toHaveLength(1);
    expect(findRecurringCandidates(applyExclusions(data, { b1: true, b0: true }), TODAY)).toHaveLength(0);
  });
});

describe('예외 후보 찾기', () => {
  it('카테고리 한 달 중앙값의 2.5배 이상 · P90 이상인 지출을 금액 큰 순으로', () => {
    const list = findExceptionCandidates(sample(), TODAY);
    expect(list.map((c) => c.expense.id)).toEqual(['wedding', 'big-gift']);
    expect(list[0]).toMatchObject({ name: '동생 결혼식', reason: 'median', marked: false });
    // 경조사 한 달 합: 100만 · 10만 · 10만 → 중앙값 10만 → 10배
    expect(list[0]!.ratio).toBeCloseTo(10);
    // 선물 한 달 합: 10 10 10 70 10 10 → 중앙값 10만 → 60만은 6배
    expect(list[1]!.ratio).toBeCloseTo(6);
  });

  it('비슷한 금액만 있으면 후보가 없고, 다른 통장 · 일정 · 여행 · 지운 지출 · 앞날 지출은 보지 않는다', () => {
    const data = ledger({
      expenses: [
        ...['2026-07', '2026-08', '2026-09', '2026-10'].map((m) => spend(`${m}-05`, 100_000)),
        spend('2026-10-06', 1_000_000, { eventId: 'ev1' }),
        spend('2026-10-07', 1_000_000, { tripId: 'tr1' }),
        spend('2026-10-08', 1_000_000, { deleted: true }),
        spend('2026-12-01', 1_000_000),
        expense({ date: '2026-10-09', amount: 1_000_000, accountId: income.id, categoryId: 'c-gift' }),
      ],
    });
    expect(findExceptionCandidates(data, TODAY)).toEqual([]);
  });

  it('5건 이상이면 한 건 P90 이상도 후보 (한 건 중앙값보다 클 때만)', () => {
    // 같은 달에 몰려 한 달 중앙값으로는 잡히지 않는 경우
    const amounts = [10_000, 20_000, 30_000, 40_000, 50_000, 400_000];
    const data = ledger({ expenses: amounts.map((a, i) => spend(`2026-10-0${i + 1}`, a, { id: `x${i}` })) });
    const list = findExceptionCandidates(data, TODAY);
    expect(list.map((c) => [c.expense.id, c.reason])).toEqual([['x5', 'p90']]);
    // 모두 같은 금액이면 없음
    const same = ledger({ expenses: amounts.map((_, i) => spend(`2026-10-0${i + 1}`, 50_000)) });
    expect(findExceptionCandidates(same, TODAY)).toEqual([]);
  });

  it('최대 10건 + 이미 예외로 표시한 지출은 기준과 상관없이 늘 보인다', () => {
    const base = Array.from({ length: 12 }, (_, i) => spend(`2026-${String(i < 6 ? 5 + i : i - 1).padStart(2, '0')}-01`, 10_000));
    const big = Array.from({ length: 12 }, (_, i) => spend('2026-10-20', 500_000 + i * 1000, { id: `big${i}` }));
    const old = spend('2023-01-01', 5_000, { id: 'old', excluded: true });
    const list = findExceptionCandidates(ledger({ expenses: [...base, ...big, old] }), TODAY);
    expect(list.filter((c) => !c.marked)).toHaveLength(10);
    expect(list.find((c) => c.expense.id === 'old')).toMatchObject({ marked: true, reason: 'marked' });
  });

  it('이벤트통장이 없으면 빈 목록', () => {
    expect(findExceptionCandidates(emptyLedger({ accounts: [income] }), TODAY)).toEqual([]);
  });
});

describe('미리 보기 (저장하지 않는 덮어씌우기)', () => {
  it('바뀌는 것만 남기고, 원본은 그대로', () => {
    const data = ledger({ expenses: [spend('2026-10-01', 100_000, { id: 'a' }), spend('2026-10-02', 100_000, { id: 'b', excluded: true })] });
    expect(effectiveExclusions(data, { a: false, b: true, nope: true })).toEqual([]);
    expect(applyExclusions(data, { a: false })).toBe(data);
    expect(effectiveExclusions(data, { a: true, b: false })).toEqual([
      { id: 'a', excluded: true },
      { id: 'b', excluded: false },
    ]);
    const next = applyExclusions(data, { a: true, b: false });
    expect(next.expenses.map((e) => e.excluded)).toEqual([true, undefined]);
    expect(data.expenses.map((e) => e.excluded)).toEqual([undefined, true]);
  });

  it('뺀 예측은 평소 쓰는 돈이 줄고 예상 잔액이 늘어요, 한 줄 안내', () => {
    const data = sample();
    const before = projectEventAccount(data, TODAY);
    const after = projectWithExclusions(data, TODAY, { wedding: true });
    expect(averageUsual(after)).toBeLessThan(averageUsual(before));
    const last = after.months.length - 1;
    expect(after.months[last]!.endBalance).toBeGreaterThan(before.months[last]!.endBalance);
    expect(exclusionPreviewMessage(before, after, TODAY)).toMatch(
      /^평소 쓰는 돈 한 달 평균 26\.7만원 → 15\.6만원 · 12월 등 6개월 부족이 없어져요 · 2027년 10월 예상 잔액 \+133\.3만원$/,
    );
  });
});
