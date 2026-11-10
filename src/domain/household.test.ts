import { describe, expect, it } from 'vitest';
import { account, emptyLedger, expense, fixed } from './_fixtures';
import { accountBalance, isCountedTransfer } from './balances';
import { createDemoLedger } from './defaults';
import { livingOwners, myLivingAccountId, mySpenderKey, spenderKeyForAccount, spenderOptions } from './household';
import { autoTransferId, monthEndTransferId } from './ids';
import { incomeRecordId } from './income';
import { computeLiving, livingAccountIds, livingByAccount, livingLeftoverItems } from './living';
import { decideMonthEnd, pendingMonthEnd } from './monthEnd';
import { judgeLiving } from './verdict';
import type { LedgerData } from './types';

const NOW = '2026-11-01T00:00:00.000Z';
const couple = (today: string) => createDemoLedger(today, `${today}T01:00:00.000Z`, { couple: true, claims: true, installments: true, trips: true });

describe('부부 체험 예시 (월급통장 하나 · 수입 계획 · 나머지 배분 · 사람별 생활비)', () => {
  it('월급통장 하나에 두 사람 수입 계획, 21일 · 25일 나머지는 저수지로', () => {
    const d = couple('2026-11-26');
    expect(d.accounts.filter((a) => a.role === 'income').map((a) => a.name)).toEqual(['월급통장']);
    expect(d.incomePlans.map((p) => [p.personName, p.amount, p.dayOfMonth])).toEqual([
      ['민지', 3_200_000, 21],
      ['준호', 2_800_000, 25],
    ]);
    const tr = (id: string) => d.transfers.find((t) => t.id === id);
    expect(tr(incomeRecordId('demo-income-minji', '2026-11'))?.amount).toBe(3_200_000);
    expect(tr(incomeRecordId('demo-income-junho', '2026-11'))?.amount).toBe(2_800_000);
    expect(tr(autoTransferId('demo-rule-21-reservoir', '2026-11'))?.amount).toBe(900_000);
    expect(tr(autoTransferId('demo-rule-25-reservoir', '2026-11'))?.amount).toBe(1_050_000);
    expect(accountBalance(d, 'demo-acc-income', '2026-11-26')).toBe(0);
  });

  it('생활비 통장이 사람마다 있고, 나는 로그인한 사람의 통장 (모르면 고를 때까지 없음)', () => {
    const d = couple('2026-11-10');
    expect(livingAccountIds(d, '2026-11')).toEqual(['demo-acc-living-minji', 'demo-acc-living-junho']);
    expect(livingOwners(d, '2026-11').map((o) => [o.accountId, o.name, o.person?.email])).toEqual([
      ['demo-acc-living-minji', '민지', 'minji@demo'],
      ['demo-acc-living-junho', '준호', 'junho@demo'],
    ]);
    expect(myLivingAccountId(d, '2026-11', 'minji@demo')).toBe('demo-acc-living-minji');
    expect(myLivingAccountId(d, '2026-11', 'JUNHO@demo')).toBe('demo-acc-living-junho');
    // 어느 통장과도 이어지지 않은 계정은 첫 사람으로 짐작하지 않아요 (체험 모드만 첫 사람)
    expect(myLivingAccountId(d, '2026-11', 'someone@else')).toBeNull();
    expect(myLivingAccountId(d, '2026-11', 'someone@else', { fallbackFirst: true })).toBe('demo-acc-living-minji');
    const spenders = spenderOptions(d, '2026-11');
    expect(spenders.map((s) => [s.key, s.name, s.livingAccountId])).toEqual([
      ['minji@demo', '민지', 'demo-acc-living-minji'],
      ['junho@demo', '준호', 'demo-acc-living-junho'],
    ]);
    expect(mySpenderKey(spenders, 'junho@demo', null)).toBe('junho@demo');
    expect(mySpenderKey(spenders, null, 'demo-acc-living-junho')).toBe('junho@demo');
    expect(spenderKeyForAccount(spenders, 'demo-acc-living-junho')).toBe('junho@demo');
    expect(spenderKeyForAccount(spenders, 'demo-acc-event')).toBeNull();
  });

  it('홈의 큰 숫자(내가 오늘 써도 되는 돈)는 날짜와 상관없이 0원보다 커요', () => {
    for (const today of ['2026-11-01', '2026-11-10', '2026-11-21', '2026-11-25', '2026-11-30', '2027-02-28', '2027-03-31']) {
      const d = couple(today);
      const views = livingByAccount(d, today);
      expect(views.map((v) => v.name)).toEqual(['민지', '준호']);
      for (const v of views) expect(v.status.todayAvailable).toBeGreaterThan(0);
      const total = computeLiving(d, today);
      expect(total.todayAvailable).toBe(views[0]!.status.todayAvailable + views[1]!.status.todayAvailable);
    }
  });

  it('사람마다 그 사람 생활비 통장의 항목과 지출만 세요', () => {
    const d = couple('2026-11-10');
    const minji = computeLiving(d, '2026-11-10', 'demo-acc-living-minji');
    const junho = computeLiving(d, '2026-11-10', 'demo-acc-living-junho');
    expect(minji.items.filter((i) => !i.unbudgeted).map((i) => i.name)).toEqual(['식비', '카페', '교통', '생활', '쇼핑', '의료', '문화']);
    expect(minji.monthBudget).toBe(670_000);
    expect(junho.monthBudget).toBe(410_000);
    const spentBy = (acc: string) =>
      d.expenses
        .filter((e) => !e.deleted && e.accountId === acc && !e.fixedExpenseId && !e.eventId && e.date.startsWith('2026-11'))
        .reduce((s, e) => s + e.amount, 0);
    expect(minji.spent).toBe(spentBy('demo-acc-living-minji'));
    expect(junho.spent).toBe(spentBy('demo-acc-living-junho'));
    // 사도 돼?는 고른 사람의 항목 예산으로
    const food = d.categories.find((c) => c.name === '식비')!.id;
    const big = minji.items.find((i) => i.categoryId === food)!.remaining;
    expect(judgeLiving(minji, food, big).signal).not.toBe('bad');
    expect(judgeLiving(junho, food, big).signal).toBe('bad');
  });

  it('회비 · 보험은 사람마다 따로 한 줄이고 각자 생활비 통장에서 나가요', () => {
    const d = couple('2026-11-26');
    const bills = d.fixedExpenses.filter((f) => f.kind === 'bill' && (f.name === '회비' || f.name === '보험'));
    expect(bills.map((f) => [f.name, f.accountId])).toEqual([
      ['회비', 'demo-acc-living-minji'],
      ['보험', 'demo-acc-living-minji'],
      ['회비', 'demo-acc-living-junho'],
      ['보험', 'demo-acc-living-junho'],
    ]);
  });
});

describe('사람별 생활비 월말 처리', () => {
  const a = account('fixed', { id: 'liv-a', ownerName: '가람', openingDate: '2026-10-01' });
  const b = account('fixed', { id: 'liv-b', ownerName: '나래', order: 1, openingDate: '2026-10-01' });
  const res = account('reservoir', { id: 'res', order: 2, openingDate: '2026-10-01' });
  const base = (): LedgerData =>
    emptyLedger({
      settings: { name: 't', kind: 'shared', sharedLedgerId: null, schemaVersion: 1, createdAt: '2026-10-01T00:00:00.000Z' },
      accounts: [a, b, res],
      categories: [{ id: 'food', name: '식비', icon: 'utensils', defaultAccountRole: 'fixed', order: 0, deleted: false }],
      fixedExpenses: [
        fixed({ kind: 'living', amount: 100_000, accountId: a.id, categoryId: 'food', startMonth: '2026-10' }),
        fixed({ kind: 'living', amount: 50_000, accountId: b.id, categoryId: 'food', startMonth: '2026-10' }),
      ],
      expenses: [
        expense({ date: '2026-10-05', amount: 30_000, accountId: a.id, categoryId: 'food' }),
        expense({ date: '2026-10-06', amount: 60_000, accountId: b.id, categoryId: 'food' }),
      ],
    });

  it('항목에 통장을 적고, 이름 앞에 주인 이름을 붙여요', () => {
    expect(livingLeftoverItems(base(), '2026-10')).toEqual([
      { categoryId: 'food', leftover: 70_000, name: '가람 식비', icon: 'utensils', accountId: a.id },
      { categoryId: 'food', leftover: -10_000, name: '나래 식비', icon: 'utensils', accountId: b.id },
    ]);
    expect(pendingMonthEnd(base(), '2026-11-02')?.leftover).toBe(60_000);
  });

  it('저수지로: 남은 돈이 있는 통장마다 한 건씩 결정적 id 로 보내고, 월말 행이 저수지일 때만 잔액에 들어가요', () => {
    const d = base();
    const items = livingLeftoverItems(d, '2026-10');
    const { monthEnd, transfers } = decideMonthEnd(d, '2026-10', 60_000, 'reservoir', 'a@x', NOW, items);
    expect(transfers.map((t) => [t.id, t.fromAccountId, t.amount])).toEqual([[monthEndTransferId('2026-10'), a.id, 70_000]]);
    expect(monthEnd.items).toEqual([
      { categoryId: 'food', leftover: 70_000, accountId: a.id },
      { categoryId: 'food', leftover: -10_000, accountId: b.id },
    ]);
    // 둘 다 남으면 두 건 (두 번째는 monthend:<월>@<통장id>)
    const both = decideMonthEnd(d, '2026-10', 80_000, 'reservoir', 'a@x', NOW, [
      { categoryId: 'food', leftover: 70_000, accountId: a.id },
      { categoryId: 'food', leftover: 10_000, accountId: b.id },
    ]);
    expect(both.transfers.map((t) => t.id)).toEqual([monthEndTransferId('2026-10'), `${monthEndTransferId('2026-10')}@${b.id}`]);
    const second = both.transfers[1]!;
    expect(isCountedTransfer({ ...d, monthEnds: [] }, second)).toBe(false);
    expect(isCountedTransfer({ ...d, monthEnds: [both.monthEnd] }, second)).toBe(true);
  });

  it('이월: 다음 달 같은 사람 · 같은 항목에 더해요 (통장 없는 예전 이월은 첫 생활비 통장으로)', () => {
    const d = base();
    const items = livingLeftoverItems(d, '2026-10');
    const { monthEnd } = decideMonthEnd(d, '2026-10', 60_000, 'carryover', 'a@x', NOW, items);
    const next = { ...d, monthEnds: [monthEnd] };
    expect(computeLiving(next, '2026-11-01', a.id).carryIn).toBe(70_000);
    expect(computeLiving(next, '2026-11-01', b.id).carryIn).toBe(-10_000);
    const legacy = { ...d, monthEnds: [{ ...monthEnd, items: [{ categoryId: 'food', leftover: 5_000 }] }] };
    expect(computeLiving(legacy, '2026-11-01', a.id).carryIn).toBe(5_000);
    expect(computeLiving(legacy, '2026-11-01', b.id).carryIn).toBe(0);
  });
});

describe('예전 가계부 (생활비 통장 하나 · 사람별 수입통장)', () => {
  it('생활비는 예전처럼 하나로 계산하고, 사람별 화면은 나타나지 않아요', () => {
    const d = createDemoLedger('2026-11-10', NOW, { claims: true });
    const views = livingByAccount(d, '2026-11-10');
    expect(views).toHaveLength(1);
    expect(views[0]!.status).toEqual(computeLiving(d, '2026-11-10'));
    expect(computeLiving(d, '2026-11-10').monthBudget).toBe(600_000);
    expect(d.incomePlans).toEqual([]);
    expect(myLivingAccountId(d, '2026-11', 'junho@demo')).toBe('demo-acc-fixed');
    // 누가 썼나요?: 사람은 있지만 생활비 통장은 하나라 모두 같은 통장
    expect(spenderOptions(d, '2026-11').map((s) => s.livingAccountId)).toEqual([null, null]);
  });
});
