import { account, emptyLedger, event, expense, fixed, rule } from './_fixtures';
import { projectEventAccount, suggestShortageFixes } from './events';
import type { Category, Expense, LedgerData, Trip } from './types';
import { estimateUsual, manWon, recentUsualAverage, usualHistory, usualSpendingInsight } from './usual';
import { judgeEvent } from './verdict';

const TODAY = '2026-11-10';
const income = account('income', { order: 0, openingDate: '2026-11-01' });
const eventAcc = account('event', { order: 2, openingBalance: 1_000_000, openingDate: '2026-11-01' });
const living = account('fixed', { order: 1, openingDate: '2026-11-01' });

const cat = (id: string, name: string): Category => ({ id, name, icon: 'gift', defaultAccountRole: 'event', order: 0, deleted: false });
const CATS = [cat('c-fam', '경조사'), cat('c-gift', '선물'), cat('c-trip', '여행')];

/** 이벤트통장 평소 지출 한 건 */
const spend = (date: string, amount: number, p: Partial<Expense> = {}) => expense({ date, amount, accountId: eventAcc.id, ...p });

function ledger(p: Partial<LedgerData> = {}): LedgerData {
  return emptyLedger({ accounts: [income, living, eventAcc], categories: CATS, ...p });
}

const total = (m: Map<string | null, number>) => [...m.values()].reduce((a, v) => a + v, 0);
const monthOfP = (data: LedgerData, m: string) => projectEventAccount(data, TODAY).months.find((x) => x.month === m)!;

describe('평소 쓰는 돈 추정', () => {
  it('작년 같은 달 기록이 있으면 카테고리마다 작년 같은 달 30% + 최근 12개월 평균 70% 로 섞는다', () => {
    const data = ledger({
      expenses: [
        spend('2025-12-03', 300_000, { categoryId: 'c-fam' }),
        ...['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m) => spend(`${m}-15`, 100_000, { categoryId: 'c-gift' })),
      ],
    });
    // 기록 시작 2025-12 → 최근 평균은 2025-12 ~ 2026-10 의 11개월: 경조사 300,000/11 → 27,273 · 선물 600,000/11 → 54,545
    const history = usualHistory(data, eventAcc.id);
    expect(Object.fromEntries(recentUsualAverage(history, '2026-11'))).toEqual({ 'c-fam': 27_273, 'c-gift': 54_545 });
    // 12월: 경조사 300,000×0.3 + 27,273×0.7 → 109,091 · 선물 0×0.3 + 54,545×0.7 → 38,182
    const est = estimateUsual(history, '2026-12', '2026-11');
    expect(est).toMatchObject({ basis: 'lastYear', total: 147_273 });
    expect(Object.fromEntries(est.byCategory)).toEqual({ 'c-fam': 109_091, 'c-gift': 38_182 });
    const dec = monthOfP(data, '2026-12');
    expect(dec.usual).toBe(147_273);
    expect(dec.usualBasis).toBe('lastYear');
    // 2026-01 은 기록 안의 달이라(2025-12 부터) 작년 기록 0원 + 평균의 70%: 경조사 19,091 + 선물 38,182
    expect(monthOfP(data, '2027-01')).toMatchObject({ usual: 57_273, usualBasis: 'lastYear' });
    // 작년 5월 선물 100,000: 선물 100,000×0.3 + 54,545×0.7 → 68,182 + 경조사 19,091
    expect(monthOfP(data, '2027-05').usual).toBe(87_273);
  });

  it('작년 같은 달에 크게 쓴 달은 최근 평균과 섞여 누그러진다 (그대로 베끼지 않는다)', () => {
    const last12 = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
    // 작년 12월만 1,300,000, 나머지 달은 100,000 → 최근 12개월 평균 2,400,000/12 = 200,000
    const data = ledger({ expenses: last12.map((m) => spend(`${m}-10`, m === '2025-12' ? 1_300_000 : 100_000)) });
    const history = usualHistory(data, eventAcc.id);
    expect(total(recentUsualAverage(history, '2026-11'))).toBe(200_000);
    // 12월: 1,300,000×0.3 + 200,000×0.7 = 530,000 — 작년 그대로(1,300,000)보다 훨씬 적고 평균보다는 많다
    const dec = monthOfP(data, '2026-12');
    expect(dec).toMatchObject({ usual: 530_000, usualBasis: 'lastYear' });
    // 평소 달: 100,000×0.3 + 200,000×0.7 = 170,000
    expect(monthOfP(data, '2027-01').usual).toBe(170_000);
  });

  it('작년 같은 달이 기록 밖이면 최근 12개월 평균 (12개월이 안 되면 있는 만큼)', () => {
    const data = ledger({
      expenses: [spend('2026-08-01', 90_000), spend('2026-09-01', 120_000), spend('2026-10-01', 60_000)],
    });
    const dec = monthOfP(data, '2026-12');
    expect(dec.usual).toBe(90_000);
    expect(dec.usualBasis).toBe('recent');
    // 2027-08 은 작년 같은 달(2026-08)이 기록 안
    expect(monthOfP(data, '2027-08')).toMatchObject({ usual: 90_000, usualBasis: 'lastYear' });
  });

  it('최근 평균은 지난 12개월만 본다', () => {
    const last12 = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
    const data = ledger({
      expenses: [
        spend('2025-10-10', 1_200_000), // 12개월보다 오래된 달
        ...last12.map((m) => spend(`${m}-10`, 60_000)),
      ],
    });
    const history = usualHistory(data, eventAcc.id);
    expect(history.start).toBe('2025-10');
    expect(total(recentUsualAverage(history, '2026-11'))).toBe(60_000);
    // 기록이 12개월을 넘으면 앞으로의 달은 늘 작년 같은 달 기록과 섞는다 60,000×0.3 + 60,000×0.7
    expect(estimateUsual(history, '2026-12', '2026-11')).toMatchObject({ basis: 'lastYear', total: 60_000 });
  });

  it('기록이 없으면 0 이고 줄을 보이지 않는다', () => {
    const p = projectEventAccount(ledger(), TODAY);
    expect(p.months.every((m) => m.usual === 0 && m.usualBasis === undefined)).toBe(true);
    expect(usualSpendingInsight(ledger(), TODAY, p)).toBeNull();
  });

  it('일정 · 여행 · 고정 지출 자동 기록 · 지운 지출 · 다른 통장 지출은 빼고, 청구는 지출 금액 그대로 센다', () => {
    const trip: Trip = {
      id: 't1', name: '제주', startDate: '2026-09-01', endDate: '2026-09-03', budget: 500_000, items: {}, memo: '',
      author: 'a@x', createdAt: '', updatedAt: '', deleted: false,
    };
    const ev = event({ id: 'ev-old', date: '2026-10-05', amount: 200_000, accountId: eventAcc.id, status: 'done' });
    const fx = fixed({ id: 'fx-1', amount: 30_000, accountId: eventAcc.id, kind: 'bill' });
    const data = ledger({
      trips: [trip],
      events: [ev],
      fixedExpenses: [fx],
      expenses: [
        spend('2026-10-05', 200_000, { eventId: 'ev-old' }),
        spend('2026-09-02', 400_000, { tripId: 't1' }),
        spend('2026-10-01', 30_000, { fixedExpenseId: 'fx-1' }),
        spend('2026-10-07', 70_000, { deleted: true }),
        expense({ date: '2026-10-08', amount: 55_000, accountId: living.id }),
        spend('2026-10-20', 40_000, { paidBy: '민지', claimAccountId: income.id }),
        spend('2026-09-20', 20_000),
      ],
    });
    // 기록 시작 = 2026-09 (가장 이른 이벤트통장 지출). 9월 20,000 · 10월 40,000 → 평균 30,000
    expect(monthOfP(data, '2026-12').usual).toBe(30_000);
  });

  it('통장 시작일 전 날짜로 가져온 지출도 기록으로 센다 (잔액에는 들어가지 않는다)', () => {
    const data = ledger({ expenses: [spend('2025-11-20', 250_000, { categoryId: 'c-gift' }), spend('2025-12-24', 150_000)] });
    const p = projectEventAccount(data, TODAY);
    expect(p.currentBalance).toBe(1_000_000);
    // 기록 시작 2025-11 → 최근 12개월 평균: 선물 250,000/12 → 20,833 · 미분류 150,000/12 = 12,500
    // 11월: 선물 250,000×0.3 + 20,833×0.7 → 89,583 + 미분류 12,500×0.7 = 8,750
    expect(p.months[0]).toMatchObject({ month: '2026-11', usual: 98_333, usualBasis: 'lastYear' });
    // 12월: 선물 20,833×0.7 → 14,583 + 미분류 150,000×0.3 + 12,500×0.7 = 53,750
    expect(p.months[1]).toMatchObject({ month: '2026-12', usual: 68_333 });
  });

  it('그달 등록한 일정 · 이미 쓴 평소 지출은 같은 카테고리에서 먼저 뺀다', () => {
    const data = ledger({
      events: [
        event({ date: '2026-12-12', amount: 200_000, accountId: eventAcc.id, categoryId: 'c-fam' }),
        event({ date: '2026-12-20', amount: 500_000, accountId: eventAcc.id, categoryId: 'c-trip' }),
      ],
      expenses: [
        spend('2025-11-10', 200_000, { categoryId: 'c-gift' }),
        spend('2025-12-10', 300_000, { categoryId: 'c-fam' }),
        spend('2025-12-11', 50_000, { categoryId: 'c-gift' }),
        spend('2026-11-05', 50_000, { categoryId: 'c-gift' }), // 이번 달 이미 쓴 선물
      ],
    });
    // 최근 12개월(2025-11 ~ 2026-10) 평균: 선물 250,000/12 → 20,833 · 경조사 300,000/12 = 25,000
    // 11월: 선물 200,000×0.3 + 20,833×0.7 → 74,583 − 이미 쓴 50,000 = 24,583 + 경조사 25,000×0.7 = 17,500
    expect(monthOfP(data, '2026-11').usual).toBe(42_083);
    // 12월: 경조사 300,000×0.3 + 25,000×0.7 = 107,500 − 결혼식 일정 200,000 → 0 (0 아래로 안 내려감)
    //       + 선물 50,000×0.3 + 20,833×0.7 → 29,583 (여행 일정은 여행 기록이 없어 빼지 않음)
    expect(monthOfP(data, '2026-12').usual).toBe(29_583);
  });
});

describe('예측 · 부족 · 사도 돼? 에 평소 쓰는 돈이 들어간다', () => {
  // 매달 150,000 적립 (12월부터), 5~10월 매달 200,000 평소 지출 (기록 전부라 최근 평균 200,000)
  const r = rule({ id: 'r-ev', fromAccountId: income.id, toAccountId: eventAcc.id, amount: 150_000, startMonth: '2026-12' });
  const recent = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m) => spend(`${m}-15`, 200_000));

  it('달 말 = 시작 + 적립 − 일정 − 평소 쓰는 돈', () => {
    const p = projectEventAccount(ledger({ rules: [r], expenses: recent }), TODAY);
    expect(p.months[0]).toMatchObject({ month: '2026-11', contributions: 0, usual: 200_000, endBalance: 800_000 });
    expect(p.months[1]).toMatchObject({ month: '2026-12', contributions: 150_000, usual: 200_000, endBalance: 750_000 });
    expect(p.months[11]!.endBalance).toBe(800_000 - 11 * 50_000);
    expect(p.shortages).toEqual([]);
  });

  it('평소 쓰는 돈 때문에 생긴 부족도 부족 알림과 ① ② 제안에 들어간다', () => {
    const data = ledger({
      rules: [r],
      expenses: recent,
      // 평소 기록(카테고리 없음)과 다른 카테고리라 평소 쓰는 돈에서 빼지 않는다
      events: [event({ name: '결혼식', date: '2027-03-14', amount: 700_000, accountId: eventAcc.id, categoryId: 'c-fam' })],
    });
    const p = projectEventAccount(data, TODAY);
    // 3월 말 = 1,000,000 − 200,000 + 4 × (150,000 − 200,000) − 700,000 = −100,000, 그 뒤 매달 50,000 씩 더 모자람
    expect(p.shortages[0]).toEqual({ month: '2027-03', amount: 100_000 });
    expect(p.shortages.at(-1)).toEqual({ month: '2027-10', amount: 450_000 });
    const fix = suggestShortageFixes(data, TODAY, p);
    // 가장 많이 필요한 달: 10월 450,000 ÷ 11회 → 41,000
    expect(fix.increaseMonthly).toMatchObject({ toMonth: '2027-10', times: 11, amount: 41_000 });
    // 같은 데이터에 평소 기록이 없으면 부족하지 않다
    expect(projectEventAccount({ ...data, expenses: [] }, TODAY).shortages).toEqual([]);
  });

  it('judgeEvent 도 평소 쓰는 돈을 넣어 판단한다', () => {
    const withHistory = ledger({ rules: [r], expenses: recent });
    const noHistory = ledger({ rules: [r] });
    // 평소 기록 없음: 1,000,000 − 500,000 = 500,000 에서 매달 +150,000 → 문제없음
    expect(judgeEvent(noHistory, TODAY, 500_000).signal).toBe('ok');
    // 평소 기록 있음: 300,000 에서 매달 −50,000 → 내년 5월부터 모자람
    const v = judgeEvent(withHistory, TODAY, 500_000);
    expect(v.signal).toBe('warn');
    expect(v.projectionAfter!.months[0]!.usual).toBe(200_000);
    expect(v.message).toMatch(/모자라요$/);
  });
});

describe('평소 쓰는 돈과 적립 안내', () => {
  const recent = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

  function data(contribution: number): LedgerData {
    return ledger({
      rules: [rule({ fromAccountId: income.id, toAccountId: eventAcc.id, amount: contribution, startMonth: '2026-01' })],
      expenses: [
        ...recent.flatMap((m) => [
          spend(`${m}-03`, 350_000, { categoryId: 'c-fam' }),
          spend(`${m}-04`, 150_000, { categoryId: 'c-gift' }),
          spend(`${m}-20`, 120_000, { categoryId: 'c-trip' }),
        ]),
        spend('2025-12-20', 1_200_000, { categoryId: 'c-fam' }), // 작년 12월 큰 경조사
        spend('2025-10-20', 3_000_000, { categoryId: 'c-fam' }), // 12개월보다 오래된 달: 평균 · 가장 많이 쓴 달에서 빠진다
      ],
      // 앞으로 12개월 등록 일정 1,440,000 → 매달 평균 120,000
      events: [event({ date: '2027-04-10', amount: 1_440_000, accountId: eventAcc.id, categoryId: 'c-trip' })],
    });
  }

  it('매달 나가는 돈이 적립보다 많으면 매달 줄어드는 금액을 알려 준다', () => {
    const d = data(500_000);
    const insight = usualSpendingInsight(d, TODAY, projectEventAccount(d, TODAY))!;
    // 경조사 (12 × 350,000 + 1,200,000) ÷ 12 = 450,000 · 선물 150,000 · 여행 120,000
    expect(insight.monthlyUsual).toBe(720_000);
    expect(insight.monthlyPlanned).toBe(120_000);
    expect(insight.message).toBe('평소 매달 84만원을 쓰는데 적립은 50만원이에요. 이대로면 매달 34만원씩 줄어요');
    expect(insight.topCategories.map((c) => [c.name, c.amount])).toEqual([
      ['경조사', 450_000],
      ['선물', 150_000],
      ['여행', 120_000],
    ]);
    expect(insight.heaviest).toEqual({ month: '2025-12', amount: 1_820_000 });
    expect(insight.months).toBe(12);
  });

  it('적립이 더 많으면 그 차이를 알려 준다', () => {
    const d = data(920_000);
    expect(usualSpendingInsight(d, TODAY, projectEventAccount(d, TODAY))!.message).toBe('적립이 평소 쓰는 돈보다 8만원 많아요');
  });

  it('manWon 은 천 원 단위로 반올림한다', () => {
    expect(manWon(620_000)).toBe('62만원');
    expect(manWon(1_234_500)).toBe('123.5만원');
    expect(manWon(8_000)).toBe('8천원');
    expect(manWon(0)).toBe('0원');
  });
});
