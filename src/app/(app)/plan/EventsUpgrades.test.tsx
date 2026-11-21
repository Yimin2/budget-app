// @vitest-environment jsdom
/** 이벤트 화면: 매년 돌아오는 일 · 큰 지출 빼기 링크 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventsView } from './EventsView';
import { chooseScheduleAdd, headerAddButton, makeHarness } from './testHarness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/plan',
}));

afterEach(cleanup);

async function renderEvents() {
  const h = makeHarness();
  render(<EventsView />, { wrapper: h.Wrapper });
  await screen.findByTestId('events-status');
  return h;
}

describe('매년 돌아오는 일 (머리의 [+ 추가 ▾] → 기록에서 찾기)', () => {
  /** 머리의 [+ 추가 ▾] 메뉴에서 '기록에서 찾기'를 눌러 '일정' 카드 안에서 펼쳐요 */
  function openRecurring() {
    chooseScheduleAdd(/^기록에서 찾기/);
    const schedule = screen.getByRole('region', { name: /^연간 일정 · / });
    return { card: within(schedule).getByRole('region', { name: '매년 돌아오는 일' }) };
  }
  const addMenu = () => {
    fireEvent.click(headerAddButton());
    return screen.getByRole('menu');
  };

  it('작년 기록을 찾아 제안하고 [넣기]는 같은 날 매년 일정으로, 그 뒤엔 제안이 사라져요', async () => {
    const h = await renderEvents();
    // 찾은 게 없으면 메뉴에 '기록에서 찾기'가 없고 안내도 없어요
    let menu = addMenu();
    expect(within(menu).queryByRole('menuitem', { name: /^기록에서 찾기/ })).toBeNull();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByText(/매년 반복되는 일 \d+건을 찾았어요/)).toBeNull();
    expect(screen.queryByRole('region', { name: '매년 돌아오는 일' })).toBeNull();
    await act(async () => {
      await h.probe.ledger!.addExpense({ date: '2025-12-08', amount: 120_000, accountId: 'demo-acc-event', categoryId: null, memo: '하늘 생신' });
    });
    // 찾은 제안 수가 메뉴 항목에 보여요
    await screen.findByText('지난 기록에서 매년 반복되는 일 1건을 찾았어요');
    menu = addMenu();
    expect(within(menu).getByRole('menuitem', { name: /^기록에서 찾기,\s?1건$/ })).toBeTruthy();
    fireEvent.keyDown(menu, { key: 'Escape' });
    const { card } = openRecurring();
    expect(card.textContent).toContain("작년 12월에 '하늘 생신' 120,000원이 있었어요. 올해도 일정으로 넣을까요?");
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: '‘하늘 생신’ 일정으로 넣기' }));
    });
    await screen.findByText(/‘하늘 생신’을 12월 8일 일정으로 넣었어요/);
    const ev = h.probe.ledger!.data!.events.find((e) => e.name === '하늘 생신')!;
    expect(ev).toMatchObject({ date: '2026-12-08', amount: 120_000, repeat: 'yearly', status: 'planned', accountId: 'demo-acc-event' });
    await waitFor(() => expect(within(card).getByTestId('recurring-summary').textContent).toBe('지난 기록에서 해마다 나올 만한 지출을 아직 찾지 못했어요'));
    expect(within(card).queryByRole('button', { name: /일정으로 넣기/ })).toBeNull();
  });

  it('[괜찮아요]는 가계부 설정에 숨겨 다시 보이지 않아요', async () => {
    const h = await renderEvents();
    await act(async () => {
      await h.probe.ledger!.addExpense({ date: '2025-12-24', amount: 80_000, accountId: 'demo-acc-event', categoryId: null, memo: '조카 생일 선물' });
    });
    const { card } = openRecurring();
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: '‘조카 생일 선물’ 괜찮아요' }));
    });
    await screen.findByText('‘조카 생일 선물’ 제안은 다시 보이지 않아요');
    expect(h.probe.ledger!.data!.settings.dismissedRecurring).toEqual(['12|조카 생일 선물']);
    await waitFor(() => expect(within(card).queryByRole('button', { name: /괜찮아요/ })).toBeNull());
  });
});

describe('큰 지출 빼기 링크', () => {
  it('기록이 없으면 링크가 없고, 평소보다 훨씬 큰 지출이 생기면 평소 쓰는 돈 카드에 /plan/usual 링크가 보여요', async () => {
    const h = await renderEvents();
    const usual = screen.getByRole('region', { name: '평소 쓰는 돈' });
    expect(within(usual).queryByTestId('usual-exceptions-link')).toBeNull();
    await act(async () => {
      for (const m of ['2026-07', '2026-08', '2026-09', '2026-10']) {
        await h.probe.ledger!.addExpense({ date: `${m}-05`, amount: 50_000, accountId: 'demo-acc-event', categoryId: null, memo: '선물' });
      }
      await h.probe.ledger!.addExpense({ date: '2026-10-12', amount: 1_000_000, accountId: 'demo-acc-event', categoryId: null, memo: '친구 결혼식' });
    });
    const link = await within(usual).findByTestId('usual-exceptions-link');
    expect(link.getAttribute('href')).toBe('/plan/usual');
    expect(screen.queryByRole('region', { name: '해 보기' })).toBeNull();
  });
});
