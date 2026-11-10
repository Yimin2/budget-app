// @vitest-environment jsdom
/** 이벤트 화면: 월별 이벤트 비용 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventMonthlyCosts } from '@/domain';
import { EventsView } from './EventsView';
import { makeHarness } from './testHarness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/plan',
}));

afterEach(cleanup);

async function renderCard() {
  const h = makeHarness();
  render(<EventsView />, { wrapper: h.Wrapper });
  const card = await screen.findByRole('region', { name: '월별 이벤트 비용' });
  return { h, card };
}

const rows = (card: HTMLElement) => within(card).getAllByTestId(/^month-cost-\d{4}-\d{2}$/);
const monthButton = (row: HTMLElement) => row.querySelector('button[aria-expanded]') as HTMLButtonElement;

describe('월별 이벤트 비용', () => {
  it('12개월 예상 잔액 카드 바로 뒤에 있어요', async () => {
    const { card } = await renderCard();
    const chart = screen.getByRole('region', { name: '앞으로 12개월 예상 잔액' });
    const sections = screen.getAllByRole('region');
    expect(sections.indexOf(card)).toBe(sections.indexOf(chart) + 1);
  });

  it('처음에는 이번 달과 다음 2개월만, [더 보기]로 지난 12개월 · 앞으로 12개월까지 같은 자리에서 펼쳐요', async () => {
    const { card } = await renderCard();
    expect(rows(card).map((r) => r.dataset.testid)).toEqual(['month-cost-2026-11', 'month-cost-2026-12', 'month-cost-2027-01']);
    expect(within(rows(card)[0]!).getByText('이번 달')).toBeTruthy();
    expect(within(rows(card)[1]!).getByText('예정')).toBeTruthy();

    const more = within(card).getByRole('button', { name: '월별 이벤트 비용 더 보기' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(more.getAttribute('aria-controls')!)).toBeTruthy();
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const all = rows(card);
    expect(all).toHaveLength(25);
    expect(all[0]!.dataset.testid).toBe('month-cost-2025-11');
    expect(all[12]!.dataset.testid).toBe('month-cost-2026-11');
    expect(all[24]!.dataset.testid).toBe('month-cost-2027-11');
    expect(within(all[0]!).getByText('썼어요')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: '월별 이벤트 비용 접기' }));
    expect(rows(card)).toHaveLength(3);
  });

  it('한 줄 요약은 큰 항목과 합계, 달을 누르면 그 자리에서 모든 항목과 금액이 펼쳐져요', async () => {
    const { h, card } = await renderCard();
    const ledger = h.probe.ledger!;
    const costs = eventMonthlyCosts(ledger.data!, '2026-11-20');
    const dec = costs.find((m) => m.month === '2026-12')!;
    const row = rows(card)[1]!;
    const head = monthButton(row);
    expect(head.textContent).toContain('12월');
    if (dec.items.length > 0) expect(within(row).getByTestId('month-cost-items').textContent).toContain(dec.items[0]!.shortLabel);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById(head.getAttribute('aria-controls')!)!;
    expect(panel).toBeTruthy();
    for (const item of dec.items) expect(panel.textContent).toContain(item.label);
    expect(panel.textContent).toContain('합계');
    fireEvent.click(head);
    expect(document.getElementById(head.getAttribute('aria-controls')!)).toBeNull();
  });

  it('지난 달 쓴 돈은 일정 이름으로 묶여 보이고, 지출을 누르면 지출 고치기 창이 열려요', async () => {
    const { h, card } = await renderCard();
    await act(async () => {
      await h.probe.ledger!.addEvent({
        date: '2026-08-15',
        name: '장모님 생신',
        amount: 300_000,
        accountId: 'demo-acc-event',
        categoryId: null,
        repeat: 'none',
        memo: '',
      });
    });
    const ev = h.probe.ledger!.data!.events.find((e) => e.name === '장모님 생신')!;
    await act(async () => {
      await h.probe.ledger!.addExpense({ date: '2026-08-15', amount: 280_000, accountId: 'demo-acc-event', categoryId: null, eventId: ev.id, memo: '케이크 · 용돈' });
    });
    fireEvent.click(within(card).getByRole('button', { name: '월별 이벤트 비용 더 보기' }));
    const aug = within(card).getByTestId('month-cost-2026-08');
    expect(within(aug).getByText('썼어요')).toBeTruthy();
    expect(within(aug).getByTestId('month-cost-items').textContent).toContain('장모님 생신 28만');
    fireEvent.click(monthButton(aug));
    fireEvent.click(within(aug).getByRole('button', { name: '8/15 ‘케이크 · 용돈’ 280,000원 지출 고치기' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});
