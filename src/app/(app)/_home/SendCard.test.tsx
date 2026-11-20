// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendList } from '@/domain';
import { SendCard } from './SendCard';
import { makeHarness } from './testUtils';

afterEach(cleanup);

describe('오늘 보낼 돈 카드', () => {
  it('월급을 기록하기 전엔 없고, 기록하면 배분 줄과 복사 · 보냈어요가 생겨요', async () => {
    const h = makeHarness({ couple: true });
    await act(async () => {
      render(<SendCard />, { wrapper: h.Wrapper });
    });
    await waitFor(() => expect(h.probe.ledger?.status).toBe('ready'));
    expect(screen.queryByTestId('send-card')).toBeNull();

    const salary = h.probe.ledger!.data!.accounts.find((a) => a.name === '월급통장')!;
    await act(async () => {
      await h.probe.ledger!.addTransfer({ date: '2026-11-20', kind: 'income', fromAccountId: null, toAccountId: salary.id, amount: 2_950_000, memo: '월급' });
    });
    const card = await screen.findByTestId('send-card');
    const list = sendList(h.probe.ledger!.data!, h.probe.ledger!.today);
    expect(within(card).getByText(`${list.pendingCount}건 남음`)).toBeTruthy();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const first = list.sources[0]!.items.find((i) => i.pending)!;
    const row = within(card).getByTestId(`send-${first.transfer.id}`);
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: /금액 복사/ }));
    });
    expect(writeText).toHaveBeenCalledWith(String(first.transfer.amount));

    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: '보냈어요' }));
    });
    await waitFor(() => expect(h.probe.ledger!.data!.transfers.find((t) => t.id === first.transfer.id)?.sentAt).toBeTruthy());
  });
});
