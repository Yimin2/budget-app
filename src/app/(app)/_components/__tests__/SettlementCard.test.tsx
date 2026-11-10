// @vitest-environment jsdom
/** 이번 달 정산 한 줄 요약 카드: '이번 달 줄 돈 ○만 (사람 ○만) · 날짜 [정산하기]' → /plan/settle */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatShortDate } from '@/domain';
import { makeHarness } from '../../plan/testHarness';
import { SettlementCard } from '../SettlementCard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/plan',
}));

afterEach(cleanup);

const L = (h: ReturnType<typeof makeHarness>) => h.probe.ledger!;
const eventCat = (h: ReturnType<typeof makeHarness>) =>
  L(h).data!.categories.find((c) => !c.deleted && c.defaultAccountRole === 'event')!.id;

describe('이번 달 정산 한 줄 요약', () => {
  it('이번 달 줄 돈 · 사람마다 · 정산일 한 줄과 [정산하기] → /plan/settle', async () => {
    const h = makeHarness();
    render(<SettlementCard />, { wrapper: h.Wrapper });
    const card = await screen.findByRole('region', { name: '이번 달 정산' });
    expect(card.id).toBe('settlement');
    const date = formatShortDate(L(h).settlement!.date);
    expect(within(card).getByTestId('settlement-line').textContent).toBe(`이번 달 줄 돈 30만 (민지 30만) · ${date}`);
    expect(within(card).getByRole('link', { name: '정산하기' }).getAttribute('href')).toBe('/plan/settle');

    // 저수지 돈으로 낸 이벤트 청구도 사람에게 줄 돈으로 더해져요 (많은 순)
    await act(async () => {
      await L(h).addExpense({ date: '2026-10-02', amount: 24_000, accountId: 'demo-acc-reservoir', categoryId: eventCat(h), memo: '꽃', paidBy: '준호' });
    });
    await waitFor(() =>
      expect(within(card).getByTestId('settlement-line').textContent).toBe(`이번 달 줄 돈 32.4만 (민지 30만 · 준호 2.4만) · ${date}`),
    );
    expect(card.textContent).not.toMatch(/저수지에 (쓸|줄) 돈|저수지에서 돌려받을|빌려 줄 돈/);
  });

  it('지금 줄 돈이 없으면 "이번 달 줄 돈이 없어요"와 다음 정산 정보, 청구가 없으면 숨겨요', async () => {
    const h = makeHarness();
    render(<SettlementCard />, { wrapper: h.Wrapper });
    const card = await screen.findByRole('region', { name: '이번 달 정산' });
    await act(async () => {
      await L(h).settleClaims(['demo-claim-jeju']);
    });
    const upcoming = L(h).settlement!.upcoming[0]!;
    await waitFor(() => expect(within(card).getByTestId('settlement-line').textContent).toContain('이번 달 줄 돈이 없어요'));
    expect(card.textContent).toContain(`다음 정산 ${formatShortDate(upcoming.due)} 2.4만`);
    expect(within(card).getByRole('link', { name: '정산하기' }).getAttribute('href')).toBe('/plan/settle');

    const rest = L(h).settlement!.upcoming.flatMap((g) => g.claims.map((c) => c.expense.id));
    await act(async () => {
      await L(h).settleClaims(rest);
    });
    await waitFor(() => expect(screen.queryByRole('region', { name: '이번 달 정산' })).toBeNull());
  });

  it("이벤트통장이 음수면 한 줄 요약에 '이벤트통장이 ○원 모자라요'를 함께 보여요", async () => {
    const h = makeHarness();
    render(<SettlementCard />, { wrapper: h.Wrapper });
    const card = await screen.findByRole('region', { name: '이번 달 정산' });
    expect(within(card).queryByTestId('settlement-short')).toBeNull();
    await act(async () => {
      await L(h).addExpense({ date: '2026-11-03', amount: 5_000_000, accountId: 'demo-acc-event', categoryId: eventCat(h), memo: '큰 지출' });
    });
    await waitFor(() => expect(L(h).settlement!.shortfall).toBeGreaterThan(0));
    const won = L(h).settlement!.shortfall.toLocaleString('ko-KR');
    await waitFor(() => expect(within(card).getByTestId('settlement-line').textContent).toContain(` · 이벤트통장이 ${won}원 모자라요`));
  });

  it('홈(compact)은 지금 돌려줄 돈이 있을 때만 보여요', async () => {
    const h = makeHarness();
    render(<SettlementCard compact />, { wrapper: h.Wrapper });
    const card = await screen.findByRole('region', { name: '이번 달 정산' });
    expect(card.id).toBe('');
    expect(within(card).getByRole('link', { name: '정산하기' }).getAttribute('href')).toBe('/plan/settle');
    await act(async () => {
      await L(h).settleClaims(['demo-claim-jeju']);
    });
    await waitFor(() => expect(screen.queryByRole('region', { name: '이번 달 정산' })).toBeNull());
  });
});
