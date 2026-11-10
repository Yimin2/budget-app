import { describe, expect, it } from 'vitest';
import { account, emptyLedger, event, expense } from './_fixtures';
import { projectEventAccount } from './events';
import type { Category, Expense, LedgerData } from './types';
import { findRecurringCandidates, hasRecurringKeyword, nameTokens, recurringMessage, shiftYears } from './yearly';

const TODAY = '2026-09-10';
const income = account('income', { order: 0, openingDate: '2025-01-01' });
const eventAcc = account('event', { order: 1, openingBalance: 3_000_000, openingDate: '2025-01-01' });
const living = account('fixed', { order: 2, openingDate: '2025-01-01' });
const cat = (id: string, name: string, role: Category['defaultAccountRole'] = 'event'): Category => ({
  id, name, icon: 'gift', defaultAccountRole: role, order: 0, deleted: false,
});
const CATS = [cat('c-gift', '선물'), cat('c-fam', '경조사'), cat('c-food', '식비', 'fixed')];
const spend = (date: string, amount: number, p: Partial<Expense> = {}) => expense({ date, amount, accountId: eventAcc.id, ...p });
const ledger = (p: Partial<LedgerData> = {}) => emptyLedger({ accounts: [income, living, eventAcc], categories: CATS, ...p });

describe('낱말 · 키워드', () => {
  it('두 글자 이상 낱말, 숫자 · 기호는 뺀다', () => {
    expect(nameTokens('아빠 생신 (케이크) 2025')).toEqual(['아빠', '생신', '케이크']);
    expect(nameTokens('설 선물')).toEqual(['설', '선물']);
  });
  it('해마다 돌아오는 일 낱말', () => {
    expect(hasRecurringKeyword('엄마 생신')).toBe(true);
    expect(hasRecurringKeyword('결혼기념일 저녁')).toBe(true);
    expect(hasRecurringKeyword('설 선물')).toBe(true);
    expect(hasRecurringKeyword('설치비')).toBe(false);
    expect(hasRecurringKeyword('돌잔치')).toBe(false);
  });
  it('2월 29일은 다른 해에 28일', () => {
    expect(shiftYears('2024-02-29', 1)).toBe('2025-02-28');
  });
});

describe('매년 돌아오는 일 찾기', () => {
  it('서로 다른 해 같은 달(±15일)에 같은 낱말이면 반복으로 찾고, 마지막 금액 · 올해 같은 날을 제안해요', () => {
    const data = ledger({
      expenses: [
        spend('2024-10-08', 80_000, { memo: '아빠 생신 선물', categoryId: 'c-gift' }), // 24개월보다 오래돼 빠짐
        spend('2024-10-20', 90_000, { memo: '아빠 생신', categoryId: 'c-gift' }),
        spend('2025-10-12', 100_000, { memo: '아빠 생신', categoryId: 'c-gift' }),
        spend('2025-03-02', 40_000, { memo: '돌잔치', categoryId: 'c-fam' }), // 한 번뿐 · 키워드 없음
      ],
    });
    const list = findRecurringCandidates(data, TODAY);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: '아빠 생신', amount: 100_000, categoryId: 'c-gift', lastDate: '2025-10-12', suggestDate: '2026-10-12', years: 2, basis: 'repeat',
    });
    expect(recurringMessage(list[0]!, TODAY)).toBe("작년 10월에 '아빠 생신' 100,000원이 있었어요. 올해도 일정으로 넣을까요?");
  });

  it('메모가 없으면 같은 카테고리 · 같은 달로 묶고, 날짜가 지났으면 내년으로', () => {
    const data = ledger({
      expenses: [spend('2024-09-12', 300_000, { categoryId: 'c-fam' }), spend('2025-09-01', 350_000, { categoryId: 'c-fam' })],
    });
    const [c] = findRecurringCandidates(data, TODAY);
    expect(c).toMatchObject({ name: '경조사', amount: 350_000, suggestDate: '2027-09-01', basis: 'repeat' });
    expect(recurringMessage(c!, TODAY)).toContain('내년에도');
  });

  it('한 해 기록뿐이면 생일 · 명절 같은 낱말로 찾아요 (가져온 다른 통장 기록도 이벤트 카테고리면)', () => {
    const data = ledger({
      expenses: [
        spend('2026-02-15', 200_000, { memo: '설 용돈', categoryId: 'c-fam' }),
        expense({ date: '2025-12-24', amount: 70_000, accountId: living.id, categoryId: 'c-gift', memo: '크리스마스 선물' }),
        expense({ date: '2025-12-20', amount: 30_000, accountId: living.id, categoryId: 'c-food', memo: '크리스마스 외식' }), // 생활비 카테고리
        spend('2026-05-10', 50_000, { memo: '모임 회비' }),
      ],
    });
    const list = findRecurringCandidates(data, TODAY);
    expect(list.map((c) => [c.name, c.basis, c.suggestDate])).toEqual([
      ['설 용돈', 'keyword', '2027-02-15'],
      ['크리스마스 선물', 'keyword', '2026-12-24'],
    ]);
  });

  it('1년 뒤 날이 15일 넘게 지났으면(올해 건너뜀) 빼요', () => {
    const data = ledger({ expenses: [spend('2025-08-01', 100_000, { memo: '엄마 생신' })] });
    expect(findRecurringCandidates(data, TODAY)).toEqual([]);
    expect(findRecurringCandidates(data, '2026-08-10')).toHaveLength(1);
  });

  it('앞으로 12개월 안에 비슷한 예정 일정이 있으면 빼요 (반복 일정의 회차 포함)', () => {
    const base = [spend('2024-10-20', 90_000, { memo: '아빠 생신' }), spend('2025-10-12', 100_000, { memo: '아빠 생신' })];
    const registered = ledger({
      expenses: base,
      events: [event({ date: '2026-10-05', amount: 100_000, accountId: eventAcc.id, name: '아빠 생신 저녁' })],
    });
    expect(findRecurringCandidates(registered, TODAY)).toEqual([]);
    const series = ledger({
      expenses: base,
      events: [event({ date: '2025-10-12', amount: 100_000, accountId: eventAcc.id, name: '아빠 생신', repeat: 'yearly' })],
    });
    expect(findRecurringCandidates(series, TODAY)).toEqual([]);
    // 다른 이름 · 먼 날짜의 일정은 상관없어요
    const other = ledger({
      expenses: base,
      events: [event({ date: '2026-10-12', amount: 100_000, accountId: eventAcc.id, name: '민수 결혼식' })],
    });
    expect(findRecurringCandidates(other, TODAY)).toHaveLength(1);
  });

  it('[괜찮아요]로 숨긴 키(설정)는 다시 보이지 않아요', () => {
    const data = ledger({ expenses: [spend('2024-10-20', 90_000, { memo: '아빠 생신' }), spend('2025-10-12', 100_000, { memo: '아빠 생신' })] });
    const [c] = findRecurringCandidates(data, TODAY);
    expect(c!.key).toBe('10|아빠 생신');
    expect(c!.key).not.toContain(',');
    const hidden = { ...data, settings: { ...data.settings, dismissedRecurring: [c!.key] } };
    expect(findRecurringCandidates(hidden, TODAY)).toEqual([]);
  });

  it('넣으면 그달 · 그 카테고리 평소 쓰는 돈이 줄어 두 번 빼지 않아요', () => {
    const data = ledger({
      expenses: [spend('2024-10-20', 90_000, { memo: '아빠 생신', categoryId: 'c-gift' }), spend('2025-10-12', 100_000, { memo: '아빠 생신', categoryId: 'c-gift' })],
    });
    const [c] = findRecurringCandidates(data, TODAY);
    const before = projectEventAccount(data, TODAY).months.find((m) => m.month === '2026-10')!;
    // 작년 10월 선물 100,000×0.3 + 최근 12개월(2025-09 ~ 2026-08) 평균 8,333×0.7 → 35,833
    expect(before.usual).toBe(35_833);
    const added = {
      ...data,
      events: [event({ date: c!.suggestDate, amount: c!.amount, accountId: eventAcc.id, name: c!.name, categoryId: c!.categoryId, repeat: 'yearly' })],
    };
    const after = projectEventAccount(added, TODAY).months.find((m) => m.month === '2026-10')!;
    expect(after.planned).toBe(100_000);
    expect(after.usual).toBe(0);
    // 등록한 일정이 같은 카테고리 평소 쓰는 돈 추정을 대신해요 (추정 35,833 위에 100,000 을 또 얹지 않음)
    expect(after.endBalance).toBe(before.endBalance - (100_000 - 35_833));
    expect(findRecurringCandidates(added, TODAY)).toEqual([]);
  });
});
