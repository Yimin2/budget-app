// @vitest-environment jsdom
/** 이번 달 정산 카드: 사람마다 항목 목록 · 하나씩 지급 · 지급할 수 있는 돈 넘김 · 저수지에서 빌린 이벤트 청구 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimLoanTransferId, claimTransferId } from '@/domain';
import { makeHarness } from '../../plan/testHarness';
import { SettlementCard } from '../SettlementCard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/plan',
}));

afterEach(cleanup);

async function renderCard() {
  const h = makeHarness();
  render(<SettlementCard />, { wrapper: h.Wrapper });
  const card = await screen.findByRole('region', { name: '이번 달 정산' });
  return { h, card };
}

const L = (h: ReturnType<typeof makeHarness>) => h.probe.ledger!;
const eventCat = (h: ReturnType<typeof makeHarness>) =>
  L(h).data!.categories.find((c) => !c.deleted && c.defaultAccountRole === 'event')!.id;

describe('이번 달 정산 카드 — 항목 목록', () => {
  it('사람마다 항목을 펼쳐 날짜 · 이름 · 금액을 보여 주고, 처음엔 나눠 둔 것을 골라 둬요', async () => {
    const { card } = await renderCard();
    const toggle = within(card).getByRole('button', { name: '민지 항목 1건 접기' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const list = within(card).getByRole('list', { name: '민지 항목' });
    expect(within(list).getByRole('button', { name: '제주 항공권 자세히 보기' })).toBeTruthy();
    expect((within(list).getByRole('checkbox', { name: '제주 항공권 300,000원 고르기' }) as HTMLInputElement).checked).toBe(true);
    // 정산일 전 항목도 보이지만 처음엔 고르지 않아요
    const later = within(card).getByRole('list', { name: '준호 항목' });
    expect((within(later).getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    expect(within(card).queryByRole('list', { name: '민지 항목' })).toBeNull();
    expect(within(card).getByRole('button', { name: '민지 항목 1건 펼치기' })).toBeTruthy();
  });

  it('항목이 3개보다 많으면 좁은 화면에서 접어 두고 ○건을 보여 줘요', async () => {
    const { h, card } = await renderCard();
    await act(async () => {
      for (const [d, a, m] of [['2026-11-02', 10_000, '꽃다발'], ['2026-11-03', 20_000, '케이크'], ['2026-11-04', 30_000, '축의금 봉투']] as const) {
        await L(h).addExpense({ date: d, amount: a, accountId: 'demo-acc-event', categoryId: eventCat(h), memo: m, paidBy: '민지' });
      }
    });
    await waitFor(() => expect(within(card).getByRole('button', { name: '민지 항목 4건 펼치기' })).toBeTruthy());
    expect(within(card).queryByRole('list', { name: '민지 항목' })).toBeNull();
  });

  it('하나씩 지급: 고른 것만 지급하고 합이 바로 바뀌어요 (claim:<id> 이체 하나, 다시 눌러도 하나)', async () => {
    const { h, card } = await renderCard();
    await act(async () => {
      await L(h).addExpense({ date: '2026-11-05', amount: 50_000, accountId: 'demo-acc-event', categoryId: eventCat(h), memo: '하늘 돌잔치', paidBy: '민지' });
    });
    const list = await within(card).findByRole('list', { name: '민지 항목' });
    await waitFor(() => expect(within(card).getByRole('button', { name: '민지에게 350,000원 지급했어요' })).toBeTruthy());
    fireEvent.click(within(list).getByRole('checkbox', { name: '제주 항공권 300,000원 고르기' }));
    const pay = within(card).getByRole('button', { name: '민지에게 50,000원 지급했어요' });
    await act(async () => {
      fireEvent.click(pay);
    });
    await screen.findByText('민지에게 50,000원 지급했다고 기록했어요');
    const id = L(h).data!.expenses.find((e) => e.memo === '하늘 돌잔치')!.id;
    await act(async () => {
      await L(h).settleClaims([id]);
    });
    expect(L(h).data!.transfers.filter((t) => t.id === claimTransferId(id) && !t.deleted)).toHaveLength(1);
    // 남은 항목은 그대로 남고 다시 골라 둬요
    expect(L(h).settlement!.pay.map((g) => [g.name, g.amount])).toEqual([['민지', 300_000]]);
    expect(within(card).getByRole('button', { name: '민지에게 300,000원 지급했어요' })).toBeTruthy();
  });

  it('지급할 수 있는 돈보다 많이 고르면 알려 주고 넘는 것만 저수지에서 빌려 지급해요', async () => {
    const { h, card } = await renderCard();
    await act(async () => {
      await L(h).addExpense({ date: '2026-11-04', amount: 900_000, accountId: 'demo-acc-event', categoryId: eventCat(h), memo: '바다 결혼 선물', paidBy: '민지' });
    });
    const s = L(h).settlement!;
    expect([...s.carry, ...s.upcoming].flatMap((g) => g.claims.map((c) => c.expense.memo))).toContain('바다 결혼 선물');
    const box = await within(card).findByRole('checkbox', { name: '바다 결혼 선물 900,000원 고르기' });
    fireEvent.click(box);
    expect(card.textContent).toMatch(/지급할 수 있는 돈보다 [\d,]+원 많아요/);
    const borrow = within(card).getAllByRole('button', { name: '저수지에서 빌려 지급' });
    await act(async () => {
      fireEvent.click(borrow[borrow.length - 1]!);
    });
    await screen.findByText(/고른 \d건을 지급하고 넘는 [\d,]+원은 저수지에서 빌렸다고 기록했어요/);
    const big = L(h).data!.expenses.find((e) => e.memo === '바다 결혼 선물')!.id;
    expect(L(h).data!.transfers.some((t) => t.id === claimLoanTransferId(big) && !t.deleted)).toBe(true);
    expect(L(h).settlement!.loan.balance).toBe(900_000);
    expect(L(h).settlement!.pay).toEqual([]);
  });
});

describe('저수지통장 이벤트 청구 = 저수지에서 빌린 돈', () => {
  it('‘저수지에서 빌려 줄 돈’으로 보여 주고, 지급하면 이벤트통장 지출이 되며 저수지에 갚을 돈이 늘어요 (다시 눌러도 하나, 되돌리면 그대로)', async () => {
    const { h, card } = await renderCard();
    const before = { ...L(h).balances };
    await act(async () => {
      await L(h).addExpense({ date: '2026-10-02', amount: 120_000, accountId: 'demo-acc-reservoir', categoryId: eventCat(h), memo: '나무 돌잔치', paidBy: '민지' });
    });
    await within(card).findByRole('heading', { name: /저수지에서 빌려 줄 돈 · 120,000원/ });
    expect(card.textContent).not.toContain('빌린 돈이 아니에요');
    const id = L(h).data!.expenses.find((e) => e.memo === '나무 돌잔치')!.id;
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: '저수지에서 빌려 민지에게 120,000원 지급했어요' }));
    });
    await screen.findByText('저수지에서 빌려 민지에게 120,000원 지급했다고 기록했어요');
    await act(async () => {
      await L(h).borrowReservoirClaims([id]);
    });
    const d = L(h).data!;
    expect(d.expenses.find((e) => e.id === id)!.accountId).toBe('demo-acc-event');
    expect(d.transfers.filter((t) => t.id === claimLoanTransferId(id) && !t.deleted)).toHaveLength(1);
    expect(d.transfers.find((t) => t.id === claimTransferId(id))).toMatchObject({ fromAccountId: 'demo-acc-event', amount: 120_000 });
    expect(L(h).settlement!.loan.balance).toBe(120_000);
    expect(L(h).balances['demo-acc-event']).toBe(before['demo-acc-event']);
    expect(L(h).balances['demo-acc-reservoir']).toBe(before['demo-acc-reservoir']! - 120_000);

    await act(async () => {
      await L(h).undoReservoirClaims([id], 'borrowed');
    });
    expect(L(h).data!.expenses.find((e) => e.id === id)!.accountId).toBe('demo-acc-reservoir');
    expect(L(h).settlement!.loan.balance).toBe(0);
    expect(L(h).settlement!.reservoirLoanTotal).toBe(120_000);
    expect(L(h).balances).toEqual(before);
  });

  it('저수지에서 이미 돌려준 이벤트 청구는 한 번에 저수지에 갚을 돈으로 바꿔요 (잔액 그대로, 되돌리기)', async () => {
    const { h, card } = await renderCard();
    await act(async () => {
      await L(h).addExpense({ date: '2026-09-02', amount: 70_000, accountId: 'demo-acc-reservoir', categoryId: eventCat(h), memo: '숲 집들이', paidBy: '준호' });
      await L(h).addExpense({ date: '2026-09-09', amount: 30_000, accountId: 'demo-acc-reservoir', categoryId: eventCat(h), memo: '별 생일', paidBy: '준호' });
    });
    const ids = L(h).data!.expenses.filter((e) => e.memo === '숲 집들이' || e.memo === '별 생일').map((e) => e.id);
    await act(async () => {
      await L(h).settleClaims(ids);
    });
    const before = { ...L(h).balances };
    const btn = await within(card).findByRole('button', { name: '2건 100,000원을 저수지에 갚을 돈으로 바꿔요' });
    await act(async () => {
      fireEvent.click(btn);
    });
    await screen.findByText('2건 100,000원을 저수지에 갚을 돈으로 바꿨어요');
    await act(async () => {
      await L(h).convertSettledReservoirClaims(ids);
    });
    expect(L(h).settlement!.loan.balance).toBe(100_000);
    expect(L(h).balances).toEqual(before);
    expect(L(h).data!.transfers.filter((t) => ids.map(claimLoanTransferId).includes(t.id) && !t.deleted)).toHaveLength(2);
    expect(within(card).queryByRole('button', { name: /저수지에 갚을 돈으로 바꿔요/ })).toBeNull();

    await act(async () => {
      await L(h).undoReservoirClaims(ids, 'converted');
    });
    expect(L(h).settlement!.loan.balance).toBe(0);
    expect(L(h).balances).toEqual(before);
    expect(L(h).data!.expenses.filter((e) => ids.includes(e.id)).every((e) => e.accountId === 'demo-acc-reservoir')).toBe(true);
  });
});
