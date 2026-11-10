import { describe, expect, it } from 'vitest';
import { createDemoLedger } from '@/domain';
import type { AllocationRule } from '@/domain/types';
import {
  allocationTotal, categoryRoleOptions, incomeSummaries, ownerLabel, paydayPreviewLines, periodLabel, referenceIncome, spreadsheetUrl,
  visibleFixed, visibleRules,
} from './helpers';

const demo = createDemoLedger('2026-11-20', '2026-11-20T01:00:00.000Z');

const rule = (p: Partial<AllocationRule>): AllocationRule => ({
  id: 'r',
  fromAccountId: 'demo-acc-income',
  toAccountId: 'demo-acc-event',
  amount: 100,
  dayOfMonth: 1,
  startMonth: '2026-01',
  endMonth: null,
  deleted: false,
  ...p,
});

describe('settings helpers', () => {
  it('구글 시트 주소', () => {
    expect(spreadsheetUrl('abc')).toBe('https://docs.google.com/spreadsheets/d/abc/edit');
  });

  it('보여 줄 규칙: 지운 것 · 끝난 것은 빼고 시작월 순', () => {
    const list = visibleRules(
      [
        rule({ id: 'next', startMonth: '2026-12' }),
        rule({ id: 'gone', deleted: true }),
        rule({ id: 'ended', endMonth: '2026-10' }),
        rule({ id: 'now', startMonth: '2026-03', endMonth: '2026-11' }),
      ],
      '2026-11',
    );
    expect(list.map((r) => r.id)).toEqual(['now', 'next']);
  });

  it('기간 문구', () => {
    expect(periodLabel('2026-12', null, '2026-11')).toBe('12월부터');
    expect(periodLabel('2027-01', null, '2026-11')).toBe('2027년 1월부터');
    expect(periodLabel('2026-01', '2026-11', '2026-11')).toBe('이번 달까지');
    expect(periodLabel('2026-01', '2027-02', '2026-11')).toBe('2027년 2월까지');
    expect(periodLabel('2026-01', null, '2026-11')).toBeNull();
  });

  it('체험 데이터: 배분 합계 500만 = 이번 달 월급 500만', () => {
    expect(allocationTotal(demo, '2026-11')).toBe(5_000_000);
    expect(referenceIncome(demo, '2026-11')).toEqual({ month: '2026-11', amount: 5_000_000 });
    // 이번 달 수입이 없으면 지난달을 봐요
    expect(referenceIncome(demo, '2026-12')).toEqual({ month: '2026-11', amount: 5_000_000 });
    expect(referenceIncome(demo, '2027-02')).toBeNull();
  });

  it('사람별 수입통장: 통장마다 배분 합 · 수입 · 넘침', () => {
    expect(allocationTotal(demo, '2026-11', 'demo-acc-income')).toBe(3_000_000);
    expect(allocationTotal(demo, '2026-11', 'demo-acc-income-junho')).toBe(2_000_000);
    expect(referenceIncome(demo, '2026-11', 'demo-acc-income-junho')).toEqual({ month: '2026-11', amount: 2_000_000 });
    const over = { ...demo, rules: [...demo.rules, { ...demo.rules[4]!, id: 'more', amount: 300_000 }] };
    expect(incomeSummaries(over, '2026-11').map((x) => [x.account.name, x.total, x.over])).toEqual([
      ['민지 수입통장', 3_000_000, 0],
      ['준호 수입통장', 2_300_000, 300_000],
    ]);
  });

  it('주인 표시: 이름에 이미 있으면 빼요', () => {
    expect(ownerLabel({ name: '민지 수입통장', ownerName: '민지', ownerEmail: null })).toBeNull();
    expect(ownerLabel({ name: '월급통장', ownerName: '준호', ownerEmail: null })).toBe('준호');
    expect(ownerLabel({ name: '월급통장', ownerName: null, ownerEmail: 'jun@x.com' })).toBe('jun');
    expect(ownerLabel({ name: '고정지출통장', ownerName: null, ownerEmail: null })).toBeNull();
  });

  it('고정 지출: 생활비 항목 → 고정비(결제일 순, 예시의 용돈은 1일 고정비)', () => {
    const kinds = visibleFixed(demo.fixedExpenses, '2026-11').map((f) => f.name);
    expect(kinds).toEqual([
      '식비', '카페', '교통', '생활', '쇼핑', '의료', '문화', '용돈(민지)', '용돈(준호)', '월세', '통신비', '보험',
    ]);
  });

  it('카테고리 기본 통장 고르기: 있는 통장 역할만 (+ 지금 값)', () => {
    const opts = categoryRoleOptions(demo.accounts);
    expect(opts.map((o) => o.value)).toEqual(['income', 'fixed', 'event', 'reservoir', 'savings']);
    expect(opts[1]!.label).toBe('고정지출통장');
    expect(categoryRoleOptions(demo.accounts, 'allowance').map((o) => o.value)).toContain('allowance');
  });
});

describe('수입 계획 · 나머지 배분 (PLAN 4-13)', () => {
  const couple = createDemoLedger('2026-11-10', '2026-11-10T01:00:00.000Z', { couple: true });

  it('월급날마다 한 줄: 받는 돈 → 정한 금액 · 나머지 → 저수지', () => {
    expect(paydayPreviewLines(couple, '2026-11', 'demo-acc-income').map((l) => l.text)).toEqual([
      '21일: 320만 → 생활비(민지) 90만 · 생활비(준호) 110만 · 이벤트 30만 · 남는 돈 전부 90만 → 저수지',
      '25일: 280만 → 용돈(민지) 40만 · 용돈(준호) 35만 · 저축투자 100만 · 남는 돈 전부 105만 → 저수지',
    ]);
  });

  it('예시 금액도 원 단위까지 맞게 보여요 (297만 → 82.8만 · 127.26만 · 50만 · 나머지 36.94만)', () => {
    const d = {
      ...couple,
      incomePlans: [{ ...couple.incomePlans[0]!, amount: 2_970_000 }],
      rules: [
        rule({ id: 'a', fromAccountId: 'demo-acc-income', toAccountId: 'demo-acc-living-minji', amount: 828_000, dayOfMonth: 21 }),
        rule({ id: 'b', fromAccountId: 'demo-acc-income', toAccountId: 'demo-acc-living-junho', amount: 1_272_600, dayOfMonth: 21 }),
        rule({ id: 'c', fromAccountId: 'demo-acc-income', toAccountId: 'demo-acc-event', amount: 500_000, dayOfMonth: 21 }),
        rule({ id: 'd', fromAccountId: 'demo-acc-income', toAccountId: 'demo-acc-reservoir', amount: 0, dayOfMonth: 21, kind: 'remainder' }),
      ],
    };
    expect(paydayPreviewLines(d, '2026-11', 'demo-acc-income')[0]!.text).toBe(
      '21일: 297만 → 생활비(민지) 82.8만 · 생활비(준호) 127.26만 · 이벤트 50만 · 남는 돈 전부 36.94만 → 저수지',
    );
  });

  it('수입은 수입 계획으로 비교하고, 나머지 규칙이 있으면 남는 돈은 그 규칙이 보내요 (경고 없음)', () => {
    const [s] = incomeSummaries(couple, '2026-11');
    expect(s).toMatchObject({ total: 4_050_000, income: { amount: 6_000_000, planned: true }, over: 0, left: 1_950_000 });
    expect(s!.remainder?.toAccountId).toBe('demo-acc-reservoir');
    // 정한 금액이 수입보다 많으면 그대로 경고
    const over = { ...couple, incomePlans: couple.incomePlans.map((p) => ({ ...p, amount: 1_000_000 })) };
    expect(incomeSummaries(over, '2026-11')[0]!.over).toBe(2_050_000);
  });
});
