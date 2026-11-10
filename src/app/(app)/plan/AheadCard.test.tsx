// @vitest-environment jsdom
/** 이벤트 화면 카드 2 '앞으로 12개월': 막대 · 고른 달 항목 · 다가오는 달 · 부족 알림 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatWon } from '@/domain';
import { EventsView } from './EventsView';
import { makeHarness } from './testHarness';
import { USUAL_BASIS_NOTE } from './selectors';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/plan',
}));

afterEach(cleanup);

async function renderCard() {
  const h = makeHarness();
  render(<EventsView />, { wrapper: h.Wrapper });
  const card = await screen.findByRole('region', { name: '앞으로 12개월' });
  return { h, card };
}

describe('앞으로 12개월 카드', () => {
  it('고른 달(처음엔 첫 부족 달)의 나갈 돈 항목과 그 달 끝 예상 잔액', async () => {
    const { h, card } = await renderCard();
    const april = h.probe.ledger!.eventProjection!.months.find((m) => m.month === '2027-04')!;
    const detail = within(card).getByTestId('ahead-month');
    expect(within(detail).getByRole('heading', { level: 3, name: '2027년 4월' })).toBeTruthy();
    const list = within(detail).getByRole('list', { name: '2027년 4월 나갈 돈' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(april.events.length);
    for (const e of april.events) expect(list.textContent).toContain(e.name);
    expect(detail.textContent).toContain(`그 달 끝 예상 잔액${formatWon(april.endBalance)}`);
    expect(detail.textContent).toContain(`${formatWon(-april.endBalance)} 모자라요`);
  });

  it('평소 쓰는 돈은 근거와 함께 마지막 줄, 금액은 예측 그대로', async () => {
    const { h, card } = await renderCard();
    await act(async () => {
      await h.probe.ledger!.addExpense({ date: '2026-10-12', amount: 900_000, accountId: 'demo-acc-event', categoryId: null });
    });
    const dec = h.probe.ledger!.eventProjection!.months.find((m) => m.month === '2026-12')!;
    expect(dec.usual).toBeGreaterThan(0);
    fireEvent.click(within(card).getByRole('button', { name: '12월 자세히 보기' }));
    const items = within(within(card).getByRole('list', { name: '12월 나갈 돈' })).getAllByRole('listitem');
    const last = items[items.length - 1]!;
    expect(last.textContent).toBe(`평소 쓰는 돈 (${USUAL_BASIS_NOTE[dec.usualBasis ?? 'recent']})${formatWon(dec.usual)}`);
  });

  it('다가오는 달: 이번 달부터 4개월 한 줄씩, 누르면 그 달을 골라요 · 지난 달 쓴 돈은 정산 화면 링크', async () => {
    const { card } = await renderCard();
    const up = within(card).getByRole('list', { name: '다가오는 달' });
    const rows = within(up).getAllByRole('button');
    expect(rows).toHaveLength(4);
    expect(rows[0]!.textContent).toMatch(/^11월 · 예정 .+ \(이번 달\)$/);
    expect(rows[1]!.textContent).toMatch(/^12월 · 예정 /);
    expect(rows.every((r) => r.getAttribute('aria-pressed') === 'false')).toBe(true);
    fireEvent.click(rows[1]!);
    expect(rows[1]!.getAttribute('aria-pressed')).toBe('true');
    expect(within(card).getByRole('heading', { level: 3, name: '12월' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: '12월 자세히 보기' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(card).getByRole('link', { name: /지난 달 쓴 돈은 정산 화면에서/ }).getAttribute('href')).toBe('/plan/settle#paid');
    // 지난 달 쓴 돈 목록은 없어요 (정산 화면에 있어요)
    expect(within(card).queryByText('썼어요')).toBeNull();
    expect(screen.queryByRole('region', { name: '월별 이벤트 비용' })).toBeNull();
  });

  it('모자라는 달이 있으면 같은 카드 안에 부족 알림(두 가지 방법)', async () => {
    const { card } = await renderCard();
    const panel = within(card).getByRole('group', { name: /2027년 4월에 300,000원 모자라요/ });
    expect(within(panel).getByRole('heading', { level: 3, name: /2027년 4월에 300,000원 모자라요 \(결혼식 4건 · 어버이날\)/ })).toBeTruthy();
    expect(within(panel).getAllByRole('radio')).toHaveLength(2);
  });

  it('폰에서는 상태 한 줄만, [펼치기]로 막대 · 항목 (넓은 화면은 CSS 로 늘 펼침)', async () => {
    const { card } = await renderCard();
    expect(within(card).getByTestId('ahead-status').textContent).toMatch(/^12개월 중 1개월이 모자라요/);
    const toggle = within(card).getByRole('button', { name: '앞으로 12개월 펼치기' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const body = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(within(body).getByRole('group', { name: '달 고르기' })).toBeTruthy();
    expect(body.contains(within(card).getByTestId('ahead-status'))).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});
