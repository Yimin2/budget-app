import { describe, expect, it } from 'vitest';
import { createDemoLedger } from '@/domain';
import type { AllocationRule } from '@/domain/types';
import {
  allocationTotal, categoryRoleOptions, incomeSummaries, ownerLabel, periodLabel, referenceIncome, spreadsheetUrl, visibleFixed,
  visibleRules,
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

  it('고정 지출: 생활비 항목 → 고정비(결제일 순) → 용돈', () => {
    const kinds = visibleFixed(demo.fixedExpenses, '2026-11').map((f) => f.name);
    expect(kinds).toEqual([
      '식비', '카페', '교통', '생활', '쇼핑', '의료', '문화', '월세', '통신비', '보험', '용돈(민지)', '용돈(준호)',
    ]);
  });

  it('카테고리 기본 통장 고르기: 있는 통장 역할만 (+ 지금 값)', () => {
    const opts = categoryRoleOptions(demo.accounts);
    expect(opts.map((o) => o.value)).toEqual(['income', 'fixed', 'event', 'reservoir', 'savings']);
    expect(opts[1]!.label).toBe('고정지출통장');
    expect(categoryRoleOptions(demo.accounts, 'allowance').map((o) => o.value)).toContain('allowance');
  });
});
