import { describe, expect, it } from 'vitest';
import { claimTransferId } from './claims';
import { createDemoLedger } from './defaults';
import { projectEventAccount } from './events';
import { monthSpentItems, thisMonthSpending } from './monthSpent';
import { pastMonthBars } from './pastBalances';
import { computeSettlement, eventMonthUsage } from './settlement';
import { account, emptyLedger, event, expense, transfer } from './_fixtures';

const EV = 'acc-event';
const TODAY = '2026-11-20';

/** 8월에 쓴 청구 두 건(하나는 11/10 지급, 하나는 아직) + 8월 이벤트통장 지출 + 11월 지출 · 일정 */
function ledger() {
  const paid = expense({ id: 'c-paid', date: '2026-08-05', amount: 175_000, accountId: EV, categoryId: 'cat-occ', paidBy: '민구', claimAccountId: 'acc-fixed' });
  const pending = expense({ id: 'c-pend', date: '2026-08-20', amount: 50_000, accountId: EV, categoryId: 'cat-gift', paidBy: '민지', claimAccountId: 'acc-fixed' });
  return emptyLedger({
    accounts: [account('event', { openingBalance: 1_000_000, openingDate: '2026-07-01' }), account('fixed')],
    categories: [
      { id: 'cat-occ', name: '경조사', order: 0, deleted: false } as never,
      { id: 'cat-gift', name: '선물', order: 1, deleted: false } as never,
    ],
    expenses: [
      paid,
      pending,
      expense({ id: 'aug-plain', date: '2026-08-12', amount: 30_000, accountId: EV, categoryId: 'cat-occ' }),
      expense({ id: 'nov-1', date: '2026-11-03', amount: 40_000, accountId: EV, categoryId: 'cat-gift' }),
      // 오늘 뒤 날짜로 미리 기록한 지출은 예정
      expense({ id: 'nov-later', date: '2026-11-28', amount: 20_000, accountId: EV, categoryId: 'cat-occ' }),
    ],
    transfers: [
      // 8월에 쓴 청구를 11/10 에 돌려줬어요 (11월에 통장에서 나간 돈)
      transfer({ id: claimTransferId(paid.id), date: '2026-11-10', amount: 175_000, fromAccountId: EV, toAccountId: 'acc-fixed' }),
    ],
    events: [event({ id: 'ev-1', name: '지수 결혼식', date: '2026-11-25', amount: 100_000, accountId: EV })],
  });
}

describe('그달 쓴 돈 (쓴 날 기준)', () => {
  it('지난 달: 8월에 쓴 청구는 11월에 돌려줘도 8월 항목으로 남고, 정산 상태(지급일 · 줄 돈)를 붙여요', () => {
    const aug = monthSpentItems(ledger(), EV, '2026-08');
    expect(aug.total).toBe(255_000);
    expect(aug.count).toBe(3);
    expect(aug.rows.map((r) => [r.label, r.amount, r.count, r.claims])).toEqual([
      ['경조사', 205_000, 2, { pending: 0, paid: 175_000, paidOn: '2026-11-10', borrowed: 0 }],
      ['선물', 50_000, 1, { pending: 50_000, paid: 0, paidOn: null, borrowed: 0 }],
    ]);
    // 돌려준 이체는 지출이 아니라 11월 쓴 돈에 들어가지 않아요
    const nov = monthSpentItems(ledger(), EV, '2026-11');
    expect(nov.rows.flatMap((r) => r.expenseIds)).toEqual(['nov-1', 'nov-later']);
    expect(nov.total).toBe(60_000);
    // 청구가 없는 줄은 claims null
    expect(nov.rows.every((r) => r.claims === null)).toBe(true);
  });

  it('이번 달: 지금까지 + 예정 (돌려주기 빼고), 여행 · 지난 날짜 일정은 따로', () => {
    const data = ledger();
    const proj = projectEventAccount(data, TODAY);
    const t = thisMonthSpending(data, EV, TODAY, proj.months[0]!);
    expect(t.spentRows.map((r) => [r.label, r.amount])).toEqual([['선물', 40_000]]);
    expect(t.plannedRows.map((r) => [r.label, r.amount, r.date])).toEqual([
      ['지수 결혼식', 100_000, '2026-11-25'],
      ['경조사', 20_000, '2026-11-28'],
    ]);
    expect([t.spent, t.planned, t.total, t.trip, t.overdue]).toEqual([40_000, 120_000, 160_000, 0, 0]);
    // 지난 청구 돌려주기(8월에 쓴 것)는 이번 달 쓴 돈 줄에 없어요
    expect([...t.spentRows, ...t.plannedRows].some((r) => r.expenseIds.includes('c-paid') || r.expenseIds.includes('c-pend'))).toBe(false);
  });

  it("이번 달 합은 숫자 띠 '이번 달 쓴 돈'(eventMonthUsage spent + planned) · 여행과 같아요 (체험 가계부)", () => {
    for (const opts of [{}, { history: true }, { trips: true, installments: true, claims: true }]) {
      const data = createDemoLedger(TODAY, `${TODAY}T09:00:00.000Z`, opts);
      const proj = projectEventAccount(data, TODAY);
      const s = computeSettlement(data, TODAY, proj);
      const usage = eventMonthUsage(data, s, TODAY);
      const t = thisMonthSpending(data, s.eventAccountId!, TODAY, proj.months[0]!);
      expect(t.spent).toBe(usage.spent);
      expect(t.planned).toBe(usage.planned);
      expect(t.total).toBe(usage.spent + usage.planned);
      expect(t.trip).toBe(usage.tripSpent + usage.tripPlanned);
    }
  });

  it('통장 시작 전 달(빗금 막대)의 쓴 돈과 같은 합', () => {
    const data = createDemoLedger(TODAY, `${TODAY}T09:00:00.000Z`);
    data.expenses.push(
      expense({ date: '2026-06-05', amount: 100_000, accountId: 'demo-acc-event', categoryId: 'demo-cat-occasion' }),
      expense({ date: '2026-06-20', amount: 30_000, accountId: 'demo-acc-event', categoryId: 'demo-cat-gift' }),
    );
    const bars = pastMonthBars(data, 'demo-acc-event', TODAY).flatMap((b) => (b.kind === 'spentOnly' ? [b] : []));
    expect(bars.length).toBeGreaterThan(0);
    for (const b of bars) {
      const m = monthSpentItems(data, 'demo-acc-event', b.month);
      expect(m.total).toBe(b.spent);
      expect(m.count).toBe(b.count);
    }
  });
});
