// @vitest-environment jsdom
/** '/plan/usual' 한 번뿐이었던 큰 지출 빼기 (PLAN 4-2 예외 지출 빼기) */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeHarness } from '../testHarness';
import { UsualScreen } from './UsualScreen';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/plan/usual',
}));

afterEach(cleanup);

/** 7 ~ 10월에 평소 선물 5만, 10월에 큰 축의금 100만 */
async function withHistory() {
  const h = makeHarness();
  render(<UsualScreen />, { wrapper: h.Wrapper });
  await screen.findByRole('heading', { level: 1, name: '한 번뿐이었던 큰 지출 빼기' });
  await screen.findByText('뺄 만한 큰 지출이 없어요');
  await act(async () => {
    for (const m of ['2026-07', '2026-08', '2026-09', '2026-10']) {
      await h.probe.ledger!.addExpense({ date: `${m}-05`, amount: 50_000, accountId: 'demo-acc-event', categoryId: null, memo: '선물' });
    }
    await h.probe.ledger!.addExpense({ date: '2026-10-12', amount: 1_000_000, accountId: 'demo-acc-event', categoryId: null, memo: '친구 결혼식' });
  });
  await screen.findByTestId('exception-summary');
  const card = screen.getByRole('region', { name: '큰 지출 빼기' });
  return { h, card };
}

describe('큰 지출 빼기 화면', () => {
  it('뺄 만한 지출이 없으면 빈 상태', async () => {
    const h = makeHarness();
    render(<UsualScreen />, { wrapper: h.Wrapper });
    expect(await screen.findByText('뺄 만한 큰 지출이 없어요')).toBeTruthy();
  });

  it('체크하면 평소 쓰는 돈이 어떻게 바뀌는지 견주고, [되돌리기]는 아무것도 저장하지 않아요', async () => {
    const { h, card } = await withHistory();
    expect(within(card).getByTestId('exception-summary').textContent).toBe('예외 0건 · 후보 1건');
    expect(card.textContent).toContain('친구 결혼식');
    const before = h.probe.ledger!.eventProjection!;
    const box = within(card).getByRole('checkbox', { name: '‘친구 결혼식’ 예외로 빼기' }) as HTMLInputElement;
    fireEvent.click(box);
    expect(box.checked).toBe(true);
    expect(card.textContent).toMatch(/평소 쓰는 돈 한 달 평균 [\d.]+만원 → [\d.]+만원/);
    expect(h.probe.ledger!.data!.expenses.find((e) => e.memo === '친구 결혼식')!.excluded).toBeUndefined();
    expect(h.probe.ledger!.eventProjection).toBe(before);
    fireEvent.click(within(card).getByRole('button', { name: '되돌리기' }));
    expect(box.checked).toBe(false);
  });

  it('[저장]을 누르면 그때 예외 칸이 저장되고, 잔액은 그대로예요', async () => {
    const { h, card } = await withHistory();
    const balance = h.probe.ledger!.balances['demo-acc-event'];
    const usualBefore = h.probe.ledger!.eventProjection!.months.reduce((s, m) => s + m.usual, 0);
    fireEvent.click(within(card).getByRole('checkbox', { name: '‘친구 결혼식’ 예외로 빼기' }));
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: '저장' }));
    });
    await screen.findByText('예외 표시 1건을 저장했어요');
    expect(h.probe.ledger!.data!.expenses.find((e) => e.memo === '친구 결혼식')!.excluded).toBe(true);
    expect(h.probe.ledger!.balances['demo-acc-event']).toBe(balance);
    expect(h.probe.ledger!.eventProjection!.months.reduce((s, m) => s + m.usual, 0)).toBeLessThan(usualBefore);
  });
});
