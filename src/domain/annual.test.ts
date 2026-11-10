import { describe, expect, it } from 'vitest';
import { account, emptyLedger, event, expense } from './_fixtures';
import {
  annualItems, customAnnualEvents, customAnnualId, isCoveredByAnnual, nextAnnualDate, planAnnualRegistration, registeredAnnualEvent,
  type AnnualDraft, type AnnualSelection,
} from './annual';
import { projectEventAccount } from './events';
import { findRecurringCandidates } from './yearly';
import type { Category, LedgerData, PlannedEvent } from './types';

const TODAY = '2026-11-10';
const incM = account('income', { id: 'inc-m', name: '민구 수입통장', ownerName: '민구', ownerEmail: 'mingu@x.com', order: 0, openingDate: '2026-11-01' });
const incK = account('income', { id: 'inc-k', name: '기쁜 수입통장', ownerName: '기쁜', ownerEmail: 'gippeum@x.com', order: 1, openingDate: '2026-11-01' });
const eventAcc = account('event', { id: 'evt', order: 2, openingBalance: 5_000_000, openingDate: '2025-01-01' });
const cat = (id: string, name: string): Category => ({ id, name, icon: 'gift', defaultAccountRole: 'event', order: 0, deleted: false });
const CATS = [cat('c-fam', '경조사'), cat('c-hol', '명절')];
const MEMBERS = [
  { email: 'mingu@x.com', displayName: '이민구' },
  { email: 'gippeum@x.com', displayName: '김기쁜' },
];

function ledger(p: Partial<LedgerData> = {}): LedgerData {
  return emptyLedger({ accounts: [incM, incK, eventAcc], categories: CATS, members: MEMBERS, ...p });
}

/** 상태 계층이 하는 것처럼 초안을 일정 행으로 */
const toRows = (drafts: AnnualDraft[]): PlannedEvent[] =>
  drafts.map((d) =>
    event({ id: d.id, date: d.date, name: d.name, amount: d.amount, accountId: eventAcc.id, categoryId: d.categoryId, repeat: 'yearly', ...(d.lunar ? { lunar: d.lunar } : {}) }),
  );

const sel = (id: string, p: Partial<AnnualSelection>): AnnualSelection => ({
  id, name: id, categoryName: '경조사', month: 1, day: 1, calendar: 'solar', amount: 100_000, ...p,
});

describe('매년 일정 체크 목록', () => {
  it('생신은 가계부 사람 이름으로 네 줄 (하드코딩 이름 없음)', () => {
    const items = annualItems(ledger());
    expect(items.map((i) => i.label)).toEqual([
      '설날', '추석', '어버이날', '민구 아버님', '민구 어머님', '기쁜 아버님', '기쁜 어머님', '결혼기념일', '크리스마스',
    ]);
    const bday = items.filter((i) => i.kind === 'birthday');
    expect(bday.every((i) => i.calendarChoice && i.fixed === null)).toBe(true);
    expect(new Set(bday.map((i) => i.id)).size).toBe(4);
    expect(items.find((i) => i.kind === 'seollal')).toMatchObject({ categoryName: '명절', fixed: { month: 1, day: 1, calendar: 'lunar' } });
    // 사람이 없으면 아버님 · 어머님 두 줄
    expect(annualItems(emptyLedger()).filter((i) => i.kind === 'birthday').map((i) => i.label)).toEqual(['아버님', '어머님']);
  });

  it('다음 날짜: 양력은 올해(지났으면 내년), 음력은 그해 양력으로', () => {
    expect(nextAnnualDate(12, 25, 'solar', TODAY)).toBe('2026-12-25');
    expect(nextAnnualDate(5, 8, 'solar', TODAY)).toBe('2027-05-08');
    expect(nextAnnualDate(1, 1, 'lunar', TODAY)).toBe('2027-02-07');
    expect(nextAnnualDate(8, 15, 'lunar', TODAY)).toBe('2027-09-15');
    expect(nextAnnualDate(2, 29, 'solar', TODAY)).toBe('2027-02-28');
    expect(nextAnnualDate(13, 1, 'solar', TODAY)).toBeNull();
    expect(nextAnnualDate(1, 31, 'lunar', TODAY)).toBeNull();
  });
});

describe('한 번에 등록', () => {
  const items = annualItems(ledger());
  const father = items.find((i) => i.label === '민구 아버님')!;
  const selections: AnnualSelection[] = [
    sel('annual-seollal', { name: '설날', categoryName: '명절', month: 1, day: 1, calendar: 'lunar', amount: 300_000 }),
    sel('annual-christmas', { name: '크리스마스', month: 12, day: 25, amount: 100_000 }),
    sel(father.id, { name: father.name, month: 3, day: 4, calendar: 'lunar', amount: 200_000 }),
  ];

  it('매년 반복 예정 일정 초안: 카테고리 · 음력 · 첫 날짜', () => {
    const drafts = planAnnualRegistration(ledger(), TODAY, selections);
    expect(drafts).toEqual([
      { id: 'annual-seollal', name: '설날', date: '2027-02-07', amount: 300_000, categoryId: 'c-hol', lunar: '01-01' },
      { id: 'annual-christmas', name: '크리스마스', date: '2026-12-25', amount: 100_000, categoryId: 'c-fam' },
      { id: father.id, name: '민구 아버님 생신', date: '2027-04-10', amount: 200_000, categoryId: 'c-fam', lunar: '03-04' },
    ]);
  });

  it('다시 해도 같은 결과: 등록된 항목은 건너뛰고 같은 id 두 번은 한 번', () => {
    const first = planAnnualRegistration(ledger(), TODAY, [...selections, selections[0]!]);
    expect(first).toHaveLength(3);
    const data = ledger({ events: toRows(first) });
    expect(planAnnualRegistration(data, TODAY, selections)).toEqual([]);
    // 완료해서 다음 회차(id@날짜)만 예정으로 남아도 등록됨
    const done = data.events.map((e) => (e.id === 'annual-christmas' ? { ...e, status: 'done' as const } : e));
    const next = { ...data.events.find((e) => e.id === 'annual-christmas')!, id: 'annual-christmas@2027-12-25', date: '2027-12-25' };
    const after = { ...data, events: [...done, next] };
    expect(planAnnualRegistration(after, TODAY, selections)).toEqual([]);
    expect(registeredAnnualEvent(after, { id: 'annual-christmas' })?.id).toBe('annual-christmas@2027-12-25');
    // 지운 행은 등록 안 됨 → 다시 넣을 수 있다
    const deleted = { ...data, events: data.events.map((e) => ({ ...e, deleted: true })) };
    expect(planAnnualRegistration(deleted, TODAY, selections)).toHaveLength(3);
  });

  it('금액 0 · 날짜를 셈할 수 없는 항목은 빼요', () => {
    expect(planAnnualRegistration(ledger(), TODAY, [sel('annual-anniversary', { amount: 0 }), sel('annual-x', { month: 0 })])).toEqual([]);
  });

  it('예전에 손으로 넣은 매년 일정도 이름이 맞으면 등록됨', () => {
    const data = ledger({
      events: [
        event({ id: 'old1', date: '2027-02-06', name: '설 명절 용돈', amount: 1, accountId: eventAcc.id, repeat: 'yearly' }),
        event({ id: 'old2', date: '2027-03-01', name: '민구 아버님 생신', amount: 1, accountId: eventAcc.id, repeat: 'yearly' }),
        event({ id: 'old3', date: '2026-12-01', name: '추석 선물', amount: 1, accountId: eventAcc.id, repeat: 'none' }),
      ],
    });
    const all = annualItems(data);
    const byLabel = (l: string) => registeredAnnualEvent(data, all.find((i) => i.label === l)!)?.id ?? null;
    expect(byLabel('설날')).toBe('old1');
    expect(byLabel('민구 아버님')).toBe('old2');
    expect(byLabel('기쁜 아버님')).toBeNull();
    // 매년 반복이 아니면 보지 않는다
    expect(byLabel('추석')).toBeNull();
    expect(planAnnualRegistration(data, TODAY, selections).map((d) => d.id)).toEqual(['annual-christmas']);
  });

  it('직접 추가: 같은 이름은 같은 id, 등록하면 목록에 보이고 기록에서 찾기는 다루지 않음', () => {
    const id = customAnnualId('할머니 생신');
    expect(customAnnualId(' 할머니  생신 ')).toBe(id);
    const drafts = planAnnualRegistration(ledger(), TODAY, [sel(id, { name: '할머니 생신', month: 9, day: 9, calendar: 'lunar' })]);
    expect(drafts[0]).toMatchObject({ id, lunar: '09-09' });
    const data = ledger({ events: toRows(drafts) });
    expect(customAnnualEvents(data).map((e) => e.id)).toEqual([id]);
    expect(planAnnualRegistration(data, TODAY, [sel(id, { name: '할머니 생신' })])).toEqual([]);
    expect(isCoveredByAnnual(data, '할머니 생신')).toBe(true);
    expect(isCoveredByAnnual(data, '조카 돌잔치')).toBe(false);
    expect(isCoveredByAnnual(data, '할아버지 생신')).toBe(false);
    expect(isCoveredByAnnual(data, '하늘 생신')).toBe(false);
    expect(isCoveredByAnnual(data, '엄마 생일')).toBe(true);
    expect(isCoveredByAnnual(data, '크리스마스 선물')).toBe(true);
  });
});

describe('평소 쓰는 돈 · 기록에서 찾기와 함께', () => {
  it('등록한 음력 일정은 그해 양력 달의 같은 카테고리 평소 쓰는 돈에서 빠져요', () => {
    // 작년 2월(2026-02) 명절 지출 40만 → 2027-02 평소 쓰는 돈 40만
    const base = ledger({ expenses: [expense({ date: '2026-02-16', amount: 400_000, accountId: eventAcc.id, categoryId: 'c-hol' })] });
    const before = projectEventAccount(base, TODAY).months.find((m) => m.month === '2027-02')!;
    expect(before.usual).toBe(400_000);
    const drafts = planAnnualRegistration(base, TODAY, [
      sel('annual-seollal', { name: '설날', categoryName: '명절', month: 1, day: 1, calendar: 'lunar', amount: 300_000 }),
    ]);
    const data = { ...base, events: toRows(drafts) };
    const feb = projectEventAccount(data, TODAY).months.find((m) => m.month === '2027-02')!;
    expect(feb.events.map((e) => e.date)).toEqual(['2027-02-07']);
    expect(feb.planned).toBe(300_000);
    expect(feb.usual).toBe(100_000);
  });

  it('체크 목록이 다루는 일은 기록에서 찾기 제안에서 빼고, 나머지만 남아요', () => {
    const data = ledger({
      expenses: [
        expense({ date: '2025-09-20', amount: 300_000, accountId: eventAcc.id, memo: '추석 용돈' }),
        expense({ date: '2026-10-05', amount: 300_000, accountId: eventAcc.id, memo: '추석 용돈' }),
        expense({ date: '2025-12-02', amount: 50_000, accountId: eventAcc.id, memo: '조카 생일' }),
        expense({ date: '2026-03-20', amount: 200_000, accountId: eventAcc.id, memo: '아버님 생신' }),
      ],
    });
    const names = findRecurringCandidates(data, TODAY).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['추석 용돈', '조카 생일']));
    expect(names.filter((n) => !isCoveredByAnnual(data, n))).toEqual(['조카 생일']);
  });
});

describe('음력 날짜 미리 보기 (lunarPreview)', () => {
  it('올해 양력과, 지났으면 다음 회차', async () => {
    const { lunarPreview } = await import('./annual');
    expect(lunarPreview(11, 15, '2026-11-20')).toEqual({ line: '올해 양력: 2026-12-23', note: null, next: '2026-12-23' });
    expect(lunarPreview(1, 1, '2026-11-20')?.line).toBe('올해 양력: 2026-02-17 (지났어요 · 다음 2027-02-07)');
  });

  it('그해 29일까지인 달의 30일은 29일로 셈하고 알려 줘요', async () => {
    const { lunarPreview, planAnnualRegistration } = await import('./annual');
    expect(lunarPreview(3, 30, '2026-11-20')).toEqual({
      line: '올해 양력: 2026-05-16 (지났어요 · 다음 2027-05-05)',
      note: '2027년 음력 3월은 29일까지라 30일 대신 29일로 셈해요',
      next: '2027-05-05',
    });
    const drafts = planAnnualRegistration(emptyLedger(), '2026-11-20', [
      { id: 'annual-custom-x', name: '큰아버지 생신', categoryName: '경조사', month: 3, day: 30, calendar: 'lunar', amount: 100_000 },
    ]);
    expect(drafts[0]).toMatchObject({ date: '2027-05-05', lunar: '03-30' });
  });
});
