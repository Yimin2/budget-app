import { account, emptyLedger, event, expense, rule } from './_fixtures';
import {
  allocateCuts,
  allocateUnits,
  ceilTo10000,
  cutMessage,
  monthlyRepayment,
  normalizeRepayMonths,
  raiseMessage,
  recommendCompromise,
  requiredContribution,
} from './compromise';
import { monthRange } from './dates';
import { projectEventAccount } from './events';
import type { Category, Expense, LedgerData } from './types';

const TODAY = '2026-11-10';
const income = account('income', { order: 0, openingDate: '2025-11-01' });
const eventAcc = account('event', { order: 2, openingBalance: 3_000_000, openingDate: '2025-11-01' });
const cat = (id: string, name: string): Category => ({ id, name, icon: 'gift', defaultAccountRole: 'event', order: 0, deleted: false });
const CATS = [cat('c-fam', '경조사'), cat('c-gift', '선물')];
const spend = (date: string, amount: number, p: Partial<Expense> = {}) => expense({ date, amount, accountId: eventAcc.id, ...p });

/**
 * 2025-11 ~ 2026-10 (12개월): 경조사 매달 10만, 선물은 9개월 5만 → 최근 3개월 11만.
 * 최근 12개월 평균: 경조사 10만 · 선물 6.5만 = 16.5만. 선물 최근 3개월 11만 − 1년 평균 6.5만 = 4.5만 넘음
 */
function history(): Expense[] {
  const months = monthRange('2025-11', '2026-10');
  return months.flatMap((m, i) => [
    spend(`${m}-05`, 100_000, { categoryId: 'c-fam' }),
    spend(`${m}-15`, i >= 9 ? 110_000 : 50_000, { categoryId: 'c-gift' }),
  ]);
}

function ledger(p: Partial<LedgerData> = {}): LedgerData {
  return emptyLedger({
    accounts: [income, eventAcc],
    categories: CATS,
    expenses: history(),
    // 매년 12월 60만 → 12개월 평균 5만
    events: [event({ id: 'ev-y', date: '2026-12-05', amount: 600_000, accountId: eventAcc.id, repeat: 'yearly' })],
    rules: [rule({ fromAccountId: income.id, toAccountId: eventAcc.id, amount: 200_000, startMonth: '2025-11' })],
    ...p,
  });
}

describe('필요 적립', () => {
  it('평소 쓰는 돈 + 등록 일정 평균, 만 원 단위 올림 (여유분 없음)', () => {
    expect(ceilTo10000(1)).toBe(10_000);
    expect(ceilTo10000(230_000)).toBe(230_000);
    expect(requiredContribution(180_000, 50_000)).toBe(230_000);
    expect(requiredContribution(180_001, 50_000)).toBe(240_000);
    expect(requiredContribution(0, 0)).toBe(0);
  });

  it('가계부에서: 최근 12개월 평균 16.5만 + 매년 일정 60만 ÷ 12 = 21.5만 → 만 원 올림 22만', () => {
    const data = ledger();
    const plan = recommendCompromise(data, TODAY, projectEventAccount(data, TODAY), { loanBalance: 0 })!;
    expect(plan.monthlyUsual).toBe(165_000);
    expect(plan.monthlyPlanned).toBe(50_000);
    expect(plan.required).toBe(220_000);
    expect(plan.current).toBe(200_000);
    expect(plan.raise).toBe(20_000);
    expect(plan.recommended).toBe(220_000);
  });

  it('예외로 표시한 지출은 필요 적립에서 빠진다', () => {
    const data = ledger({ expenses: [...history(), spend('2026-10-20', 1_200_000, { excluded: true })] });
    const plan = recommendCompromise(data, TODAY, projectEventAccount(data, TODAY), { loanBalance: 0 })!;
    expect(plan.required).toBe(220_000);
  });
});

describe('적립 올리기 안내', () => {
  it('지금 적립이 적으면 분명히 안내하고, 같거나 많으면 없다', () => {
    expect(raiseMessage(200_000, 230_000)).toBe('적립이 실제 필요보다 월 3만원 적어요 → 월 23만원으로 올려야 해요');
    expect(raiseMessage(500_000, 550_000)).toBe('적립이 실제 필요보다 월 5만원 적어요 → 월 55만원으로 올려야 해요');
    expect(raiseMessage(230_000, 230_000)).toBeNull();
    expect(raiseMessage(300_000, 230_000)).toBeNull();
  });
});

describe('저수지 빚 나눠 갚기', () => {
  it('빚 ÷ 개월, 천 원 단위 올림', () => {
    expect(monthlyRepayment(3_850_000, 24)).toBe(161_000);
    expect(monthlyRepayment(3_850_000, 12)).toBe(321_000);
    expect(monthlyRepayment(3_850_000, 18)).toBe(214_000);
    expect(monthlyRepayment(3_850_000, 36)).toBe(107_000);
    expect(monthlyRepayment(1_200_000, 12)).toBe(100_000);
    expect(monthlyRepayment(0, 24)).toBe(0);
  });

  it('개월 수는 12 · 18 · 24 · 36 중 하나, 아니면 24', () => {
    expect(normalizeRepayMonths('18')).toBe(18);
    expect(normalizeRepayMonths(36)).toBe(36);
    expect(normalizeRepayMonths('7')).toBe(24);
    expect(normalizeRepayMonths(null)).toBe(24);
    expect(normalizeRepayMonths('abc')).toBe(24);
  });

  it('안내 문구', () => {
    expect(cutMessage(24, 161_000)).toBe('저수지 빚을 24개월에 갚으려면 쓰는 돈을 월 16.1만원 줄여야 해요');
  });
});

describe('카테고리별 줄일 금액', () => {
  it('allocateUnits: 비례 + 큰 나머지, 한도까지', () => {
    const r = allocateUnits(10, [
      { key: 'a', weight: 2, cap: 100 },
      { key: 'b', weight: 1, cap: 100 },
    ]);
    expect([r.get('a'), r.get('b')]).toEqual([7, 3]);
    const capped = allocateUnits(10, [
      { key: 'a', weight: 9, cap: 2 },
      { key: 'b', weight: 1, cap: 100 },
    ]);
    expect([capped.get('a'), capped.get('b')]).toEqual([2, 8]);
    const short = allocateUnits(10, [{ key: 'a', weight: 1, cap: 4 }]);
    expect(short.get('a')).toBe(4);
  });

  it('평소보다 많이 쓰는 카테고리(선물 +4.5만)부터, 나머지는 평소 쓰는 돈에 비례, 천 원 단위로 합이 맞게', () => {
    const plan = allocateCuts(ledger(), eventAcc.id, '2026-11', 84_000);
    // 선물 4.5만 먼저 → 남은 3.9만을 10만 : 6.5만 = 2.4만(23.6 → 큰 나머지로 올림) : 1.5만
    expect(plan.cuts.map((c) => [c.name, c.amount])).toEqual([
      ['선물', 60_000],
      ['경조사', 24_000],
    ]);
    expect(plan.total).toBe(84_000);
    expect(plan.unallocated).toBe(0);
    expect(plan.cuts.find((c) => c.name === '선물')!.over).toBe(45_000);
    expect(plan.cuts.find((c) => c.name === '경조사')!.over).toBe(0);
    expect(plan.cuts.every((c) => c.amount % 1000 === 0)).toBe(true);
  });

  it('넘는 만큼보다 적으면 넘는 카테고리에서만', () => {
    const plan = allocateCuts(ledger(), eventAcc.id, '2026-11', 30_000);
    expect(plan.cuts.map((c) => [c.name, c.amount])).toEqual([['선물', 30_000]]);
  });

  it('카테고리 평소 쓰는 돈보다 많이 줄이지 않고, 못 나눈 금액을 알려 준다', () => {
    const plan = allocateCuts(ledger(), eventAcc.id, '2026-11', 300_000);
    expect(plan.cuts.map((c) => [c.name, c.amount])).toEqual([
      ['경조사', 100_000],
      ['선물', 65_000],
    ]);
    expect(plan.unallocated).toBe(135_000);
  });

  it('기록이 3개월 이하면 1년 평균과 비교하지 않고 평소 쓰는 돈에 비례', () => {
    const data = ledger({
      accounts: [income, { ...eventAcc, openingDate: '2026-09-01' }],
      expenses: [
        spend('2026-09-05', 100_000, { categoryId: 'c-fam' }),
        spend('2026-10-05', 100_000, { categoryId: 'c-fam' }),
        spend('2026-10-15', 100_000, { categoryId: 'c-gift' }),
      ],
    });
    const plan = allocateCuts(data, eventAcc.id, '2026-11', 30_000);
    expect(plan.cuts.map((c) => [c.name, c.amount, c.over])).toEqual([
      ['경조사', 20_000, 0],
      ['선물', 10_000, 0],
    ]);
  });
});

describe('추천 타협안 · 12개월 확인 · 요약', () => {
  it('요약: 적립 올리기 · 쓰는 돈 줄이기 · 부족 없음 · 저수지 빚 기간', () => {
    const data = ledger();
    const plan = recommendCompromise(data, TODAY, projectEventAccount(data, TODAY), { loanBalance: 3_850_000 })!;
    expect(plan.repayMonths).toBe(24);
    expect(plan.monthlyRepay).toBe(161_000);
    expect(plan.cut.total).toBe(161_000);
    expect(plan.shortages).toEqual([]);
    expect(plan.summary).toBe('추천: 적립 월 22만(+2만) · 쓰는 돈 월 16.1만 줄이기 → 12개월 부족 없음 · 저수지 빚 385만을 24개월에 갚아요');
    expect(plan.raiseMessage).toBe('적립이 실제 필요보다 월 2만원 적어요 → 월 22만원으로 올려야 해요');
    expect(plan.cutMessage).toBe('저수지 빚을 24개월에 갚으려면 쓰는 돈을 월 16.1만원 줄여야 해요');
    expect(plan.cutGapMessage).toBeNull();
    expect(plan.shortageMessage).toBeNull();
  });

  it('개월 수를 바꾸면 갚을 돈 · 줄일 금액 · 요약이 바뀐다', () => {
    const data = ledger();
    const plan = recommendCompromise(data, TODAY, projectEventAccount(data, TODAY), { loanBalance: 3_850_000, repayMonths: 36 })!;
    expect(plan.monthlyRepay).toBe(107_000);
    expect(plan.summary).toBe('추천: 적립 월 22만(+2만) · 쓰는 돈 월 10.7만 줄이기 → 12개월 부족 없음 · 저수지 빚 385만을 36개월에 갚아요');
  });

  it('저수지 빚이 없으면 적립만, 적립이 충분하면 "그대로"', () => {
    const data = ledger({ rules: [rule({ fromAccountId: income.id, toAccountId: eventAcc.id, amount: 300_000, startMonth: '2025-11' })] });
    const plan = recommendCompromise(data, TODAY, projectEventAccount(data, TODAY), { loanBalance: 0 })!;
    expect(plan.raise).toBe(0);
    expect(plan.raiseMessage).toBeNull();
    expect(plan.cutMessage).toBeNull();
    expect(plan.summary).toBe('추천: 적립 월 30만 그대로 → 12개월 부족 없음');
  });

  it('추천대로 해도 모자라면 어느 달에 얼마인지 알려 준다', () => {
    // 평소 쓰는 돈(16.5만)보다 훨씬 많이 갚아야 해서 못 나눈 금액이 잔액을 깎는다
    const data = ledger();
    const before = projectEventAccount(data, TODAY);
    expect(before.shortages).toEqual([]);
    const plan = recommendCompromise(data, TODAY, before, { loanBalance: 12_000_000, repayMonths: 12 })!;
    expect(plan.monthlyRepay).toBe(1_000_000);
    expect(plan.cut.unallocated).toBe(835_000);
    expect(plan.cutGapMessage).toBe('평소 쓰는 돈을 모두 줄여도 월 83.5만원이 모자라요');
    expect(plan.shortages.length).toBeGreaterThan(0);
    const first = plan.shortages[0]!;
    expect(first.month).toBe('2026-12');
    expect(plan.shortageMessage).toMatch(/^추천대로 해도 12월에 .+만원 모자라요$/);
    expect(plan.summary).toMatch(/→ 12월에 .+만 부족 · 저수지 빚 1,200만을 12개월에 갚아요$/);
  });

  it('평소 쓰는 돈 기록이 없으면 null', () => {
    const data = ledger({ accounts: [income, { ...eventAcc, openingDate: '2026-11-01' }], expenses: [] });
    expect(recommendCompromise(data, TODAY, projectEventAccount(data, TODAY), { loanBalance: 1_000_000 })).toBeNull();
  });
});
