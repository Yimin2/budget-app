import { describe, expect, it } from 'vitest';
import { accountBalance, createDemoLedger } from '@/domain';
import type { LedgerData, Transfer } from '@/domain/types';
import { accountHistory, flowSummary, groupByMonth, monthFlows, monthTitle, monthTotals, ro } from './selectors';

const TODAY = '2026-11-20';
const NOW = '2026-11-20T01:00:00.000Z';

function demo(): LedgerData {
  return createDemoLedger(TODAY, NOW);
}

function transfer(over: Partial<Transfer>): Transfer {
  return {
    id: 'tx',
    date: TODAY,
    kind: 'transfer',
    fromAccountId: null,
    toAccountId: null,
    amount: 1000,
    status: 'done',
    ruleId: null,
    memo: '',
    author: 'minji@demo',
    createdAt: NOW,
    updatedAt: NOW,
    deleted: false,
    ...over,
  };
}

describe('ro', () => {
  it('받침에 맞춰 으로/로', () => {
    expect(ro('이벤트통장')).toBe('으로');
    expect(ro('저수지')).toBe('로');
    expect(ro('용돈 지갑')).toBe('으로');
    expect(ro('월급')).toBe('으로');
    expect(ro('서울')).toBe('로'); // ㄹ 받침
    expect(ro('Bank')).toBe('(으)로');
  });
});

describe('monthFlows · monthTotals', () => {
  it('체험 가계부: 수입통장은 500만 들어오고 500만 나가요', () => {
    const data = demo();
    const flows = monthFlows(data, TODAY);
    expect(flows['demo-acc-income']).toEqual({ in: 5_000_000, out: 5_000_000 });
    expect(flows['demo-acc-event']).toEqual({ in: 300_000, out: 0 });
    const fixed = flows['demo-acc-fixed']!;
    expect(fixed.in).toBe(2_000_000);
    // 고정지출통장 잔액 = 시작 + 들어옴 − 나감
    expect(1_350_000 + fixed.in - fixed.out).toBe(accountBalance(data, 'demo-acc-fixed', TODAY));
  });

  it('미래 날짜 · 예정 · 지운 기록은 빼요', () => {
    const data = demo();
    data.transfers.push(
      transfer({ id: 'a', date: '2026-11-25', fromAccountId: 'demo-acc-reservoir', toAccountId: 'demo-acc-event' }),
      transfer({ id: 'b', status: 'planned', fromAccountId: 'demo-acc-reservoir', toAccountId: 'demo-acc-event' }),
      transfer({ id: 'c', deleted: true, fromAccountId: 'demo-acc-reservoir', toAccountId: 'demo-acc-event' }),
    );
    expect(monthFlows(data, TODAY)['demo-acc-event']).toEqual({ in: 300_000, out: 0 });
  });

  it('이번 달 수입 합 · 지출 합', () => {
    const data = demo();
    const totals = monthTotals(data, TODAY);
    expect(totals.income).toBe(5_000_000);
    const spent = data.expenses.filter((e) => !e.deleted && e.date <= TODAY).reduce((s, e) => s + e.amount, 0);
    expect(totals.spent).toBe(spent);
  });
});

describe('flowSummary', () => {
  it('체험 가계부: 배분 4건 = 수입 500만, 경고 없음', () => {
    const f = flowSummary(demo(), '2026-11');
    expect(f.incomeAccount?.id).toBe('demo-acc-income');
    expect(f.items.map((i) => [i.name, i.amount])).toEqual([
      ['고정지출통장', 2_000_000],
      ['이벤트통장', 300_000],
      ['저수지통장', 1_200_000],
      ['저축투자통장', 1_500_000],
    ]);
    expect(f.total).toBe(5_000_000);
    expect(f.income).toEqual({ month: '2026-11', amount: 5_000_000 });
    expect(f.over).toBe(0);
    expect(f.left).toBe(0);
    expect(f.incomeMark).toBeNull();
    expect(f.items.reduce((s, i) => s + i.share, 0)).toBeCloseTo(1);
  });

  it('배분이 수입보다 많으면 over 와 수입 위치', () => {
    const data = demo();
    data.rules.push({ ...data.rules[0]!, id: 'extra', toAccountId: 'demo-acc-event', amount: 1_000_000 });
    const f = flowSummary(data, '2026-11');
    expect(f.total).toBe(6_000_000);
    expect(f.over).toBe(1_000_000);
    expect(f.incomeMark).toBeCloseTo(5 / 6);
    expect(f.items.find((i) => i.accountId === 'demo-acc-event')?.amount).toBe(1_300_000);
  });

  it('수입이 더 많으면 남는 돈', () => {
    const data = demo();
    data.rules = data.rules.filter((r) => r.id !== 'demo-rule-reservoir');
    const f = flowSummary(data, '2026-11');
    expect(f.left).toBe(1_200_000);
    expect(f.leftShare).toBeCloseTo(1_200_000 / 5_000_000);
  });

  it('끝난 규칙 · 지운 규칙 · 수입통장이 아닌 곳에서 나가는 규칙은 빼요', () => {
    const data = demo();
    data.rules[0] = { ...data.rules[0]!, endMonth: '2026-10' };
    data.rules[1] = { ...data.rules[1]!, deleted: true };
    data.rules.push({ ...data.rules[2]!, id: 'x', fromAccountId: 'demo-acc-fixed' });
    const f = flowSummary(data, '2026-11');
    expect(f.items.map((i) => i.accountId)).toEqual(['demo-acc-reservoir', 'demo-acc-savings']);
  });

  it('수입 기록이 없으면 비교하지 않아요', () => {
    const data = demo();
    data.transfers = data.transfers.filter((t) => t.kind !== 'income');
    const f = flowSummary(data, '2026-11');
    expect(f.income).toBeNull();
    expect(f.over).toBe(0);
  });
});

describe('accountHistory', () => {
  it('최신순이고, 맨 위 기록의 잔액이 지금 잔액과 같아요', () => {
    const data = demo();
    for (const id of ['demo-acc-income', 'demo-acc-fixed', 'demo-acc-event', 'demo-acc-reservoir']) {
      const h = accountHistory(data, id, TODAY);
      const counted = h.filter((e) => e.status === 'counted');
      expect(counted[0]!.balance).toBe(accountBalance(data, id, TODAY));
      expect(h[h.length - 1]!.kind).toBe('opening');
      for (let i = 1; i < h.length; i++) expect(h[i - 1]!.date >= h[i]!.date).toBe(true);
    }
  });

  it('같은 날은 들어온 돈이 먼저 더해져요 (수입통장 잔액이 음수로 내려가지 않아요)', () => {
    const h = accountHistory(demo(), 'demo-acc-income', TODAY);
    expect(h.map((e) => e.kind)).toEqual(['transferOut', 'transferOut', 'transferOut', 'transferOut', 'income', 'opening']);
    for (const e of h) expect(e.balance! >= 0).toBe(true);
    expect(h[4]).toMatchObject({ title: '월급', detail: '수입', amount: 5_000_000, balance: 5_000_000 });
    const toEvent = h.find((e) => e.transfer?.toAccountId === 'demo-acc-event')!;
    expect(toEvent).toMatchObject({ title: '매달 배분', detail: '이벤트통장으로', amount: -300_000, auto: true });
  });

  it('받는 쪽은 + 와 보낸 통장 이름', () => {
    const h = accountHistory(demo(), 'demo-acc-event', TODAY);
    expect(h[0]).toMatchObject({ kind: 'transferIn', detail: '수입통장에서', amount: 300_000, balance: 900_000 });
  });

  it('예정 이체 · 미래 날짜는 pending, 시작일 전 기록은 beforeOpening (둘 다 잔액 null)', () => {
    const data = demo();
    data.transfers.push(
      transfer({ id: 'p', date: '2027-04-01', status: 'planned', fromAccountId: 'demo-acc-reservoir', toAccountId: 'demo-acc-event', amount: 300_000 }),
      transfer({ id: 'f', date: '2026-11-28', fromAccountId: 'demo-acc-reservoir', toAccountId: 'demo-acc-event', amount: 5000 }),
      transfer({ id: 'old', date: '2026-10-15', kind: 'income', toAccountId: 'demo-acc-event', amount: 7000 }),
      transfer({ id: 'adj', date: '2026-11-19', kind: 'adjustment', fromAccountId: 'demo-acc-event', amount: 2000 }),
    );
    const h = accountHistory(data, 'demo-acc-event', TODAY);
    expect(h[0]).toMatchObject({ key: 't:p:in', status: 'pending', balance: null });
    expect(h[1]).toMatchObject({ key: 't:f:in', status: 'pending', balance: null });
    const adj = h.find((e) => e.key === 't:adj:out')!;
    expect(adj).toMatchObject({ kind: 'adjustOut', title: '잔액 맞추기', amount: -2000, balance: 898_000 });
    const last = h[h.length - 1]!;
    expect(last).toMatchObject({ key: 't:old', status: 'beforeOpening', balance: null });
    expect(h[h.length - 2]!.kind).toBe('opening');
    expect(h.filter((e) => e.status === 'counted')[0]!.balance).toBe(accountBalance(data, 'demo-acc-event', TODAY));
  });

  it('지출: 내용 → 카테고리 → 지출, 고정 지출은 auto', () => {
    const h = accountHistory(demo(), 'demo-acc-fixed', TODAY);
    const rent = h.find((e) => e.expense?.fixedExpenseId === 'demo-fixed-rent')!;
    expect(rent).toMatchObject({ title: '월세', detail: '생활', amount: -800_000, auto: true });
    const coffee = h.find((e) => e.expense?.memo === '커피')!;
    expect(coffee).toMatchObject({ detail: '카페', auto: false });
  });

  it('없는 통장이면 빈 목록', () => {
    expect(accountHistory(demo(), 'nope', TODAY)).toEqual([]);
  });
});

describe('groupByMonth · monthTitle', () => {
  it('이어지는 같은 달끼리 묶어요', () => {
    const g = groupByMonth([{ date: '2026-11-03' }, { date: '2026-11-01' }, { date: '2026-10-30' }]);
    expect(g.map((x) => [x.month, x.items.length])).toEqual([
      ['2026-11', 2],
      ['2026-10', 1],
    ]);
  });
  it('올해가 아니면 연도', () => {
    expect(monthTitle('2026-11', 2026)).toBe('11월');
    expect(monthTitle('2027-01', 2026)).toBe('2027년 1월');
  });
});
