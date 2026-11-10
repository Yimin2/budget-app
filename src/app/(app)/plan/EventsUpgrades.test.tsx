// @vitest-environment jsdom
/** 이벤트 화면: 범위 띠 · 매년 돌아오는 일 · 예외 지출 빼기 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventsView } from './EventsView';
import { makeHarness } from './testHarness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/plan',
}));

afterEach(cleanup);

async function renderEvents() {
  const h = makeHarness();
  render(<EventsView />, { wrapper: h.Wrapper });
  await screen.findByRole('region', { name: '이벤트통장 잔액' });
  return h;
}

const chart = () => screen.getByRole('region', { name: '앞으로 12개월 예상 잔액' });

describe('범위 띠 (아끼면 ~ 많이 쓰면)', () => {
  it('기록이 없으면 띠 없이 보통 막대만, 표에도 범위 칸이 없어요', async () => {
    await renderEvents();
    expect(within(chart()).queryByTestId('projection-band')).toBeNull();
    expect(within(chart()).queryAllByTestId('projection-whisker')).toHaveLength(0);
    expect(within(screen.getByRole('table')).queryByRole('columnheader', { name: '많이 쓰면' })).toBeNull();
  });

  it('흔들리는 기록이 있으면 넓은 화면 띠 · 좁은 화면 세로 막대 · 표의 아끼면 · 많이 쓰면 칸이 보여요', async () => {
    const h = await renderEvents();
    await act(async () => {
      await h.probe.ledger!.addExpense({ date: '2026-09-12', amount: 50_000, accountId: 'demo-acc-event', categoryId: null });
      await h.probe.ledger!.addExpense({ date: '2026-10-12', amount: 250_000, accountId: 'demo-acc-event', categoryId: null });
    });
    await waitFor(() => expect(within(chart()).getByTestId('projection-band')).toBeTruthy());
    expect(within(chart()).getAllByTestId('projection-whisker').length).toBeGreaterThan(0);
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: '아끼면' })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: '많이 쓰면' })).toBeTruthy();
    expect(within(chart()).getByText(/띠는 평소 쓰는 돈을 아끼면 · 많이 쓰면이에요. 지난 2개월 기록의 표준편차만큼 넓혔어요/)).toBeTruthy();
    expect(within(chart()).getAllByText('아끼면 · 많이 쓰면').length).toBeGreaterThan(0);
    const r = h.probe.ledger!.eventProjection!.range!;
    expect(r.method).toBe('stddev');
    expect(r.spreadHigh).toBe(100_000);
  });
});

describe('매년 돌아오는 일', () => {
  it('작년 기록을 찾아 제안하고 [넣기]는 같은 날 매년 일정으로, 그 뒤엔 제안이 사라져요', async () => {
    const h = await renderEvents();
    expect(screen.queryByRole('region', { name: '매년 돌아오는 일' })).toBeNull();
    await act(async () => {
      await h.probe.ledger!.addExpense({ date: '2025-12-08', amount: 120_000, accountId: 'demo-acc-event', categoryId: null, memo: '하늘 생신' });
    });
    const card = await screen.findByRole('region', { name: '매년 돌아오는 일' });
    expect(card.textContent).toContain("작년 12월에 '하늘 생신' 120,000원이 있었어요. 올해도 일정으로 넣을까요?");
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: '‘하늘 생신’ 일정으로 넣기' }));
    });
    await screen.findByText(/‘하늘 생신’을 12월 8일 일정으로 넣었어요/);
    const ev = h.probe.ledger!.data!.events.find((e) => e.name === '하늘 생신')!;
    expect(ev).toMatchObject({ date: '2026-12-08', amount: 120_000, repeat: 'yearly', status: 'planned', accountId: 'demo-acc-event' });
    await waitFor(() => expect(screen.queryByRole('region', { name: '매년 돌아오는 일' })).toBeNull());
  });

  it('[괜찮아요]는 가계부 설정에 숨겨 다시 보이지 않아요', async () => {
    const h = await renderEvents();
    await act(async () => {
      await h.probe.ledger!.addExpense({ date: '2025-12-24', amount: 80_000, accountId: 'demo-acc-event', categoryId: null, memo: '크리스마스 선물' });
    });
    const card = await screen.findByRole('region', { name: '매년 돌아오는 일' });
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: '‘크리스마스 선물’ 괜찮아요' }));
    });
    await screen.findByText('‘크리스마스 선물’ 제안은 다시 보이지 않아요');
    expect(h.probe.ledger!.data!.settings.dismissedRecurring).toEqual(['12|크리스마스 선물']);
    await waitFor(() => expect(screen.queryByRole('region', { name: '매년 돌아오는 일' })).toBeNull());
  });
});

describe('예외 지출 빼기', () => {
  /** 9 · 10월에 평소 선물 5만, 10월에 큰 축의금 100만 */
  async function withHistory() {
    const h = await renderEvents();
    await act(async () => {
      for (const m of ['2026-07', '2026-08', '2026-09', '2026-10']) {
        await h.probe.ledger!.addExpense({ date: `${m}-05`, amount: 50_000, accountId: 'demo-acc-event', categoryId: null, memo: '선물' });
      }
      await h.probe.ledger!.addExpense({ date: '2026-10-12', amount: 1_000_000, accountId: 'demo-acc-event', categoryId: null, memo: '친구 결혼식' });
    });
    const card = await screen.findByRole('region', { name: '예외 지출 빼기' });
    return { h, card };
  }

  it('예전 해 보기 카드는 없고, 기록이 없으면 예외 카드도 보이지 않아요', async () => {
    await renderEvents();
    expect(screen.queryByRole('region', { name: '해 보기' })).toBeNull();
    expect(screen.queryByRole('region', { name: '예외 지출 빼기' })).toBeNull();
  });

  it('체크하면 평소 쓰는 돈과 예측이 바로 바뀌고, [되돌리기]는 아무것도 저장하지 않아요', async () => {
    const { h, card } = await withHistory();
    expect(within(card).getAllByRole('listitem')).toHaveLength(1);
    expect(card.textContent).toContain('친구 결혼식');
    const before = h.probe.ledger!.eventProjection!;
    const box = within(card).getByRole('checkbox', { name: '‘친구 결혼식’ 예외로 빼기' }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(box.checked).toBe(true);
    expect(within(chart()).getByText('미리 보는 중')).toBeTruthy();
    expect(card.textContent).toMatch(/평소 쓰는 돈 한 달 평균 [\d.]+만원 → [\d.]+만원/);
    expect(card.textContent).toContain('1건을 바꿔 봤어요');
    // 아직 저장하지 않았어요
    expect(h.probe.ledger!.data!.expenses.find((e) => e.memo === '친구 결혼식')!.excluded).toBeUndefined();
    expect(h.probe.ledger!.eventProjection).toBe(before);

    fireEvent.click(within(card).getByRole('button', { name: '되돌리기' }));
    expect(within(chart()).queryByText('미리 보는 중')).toBeNull();
    expect(box.checked).toBe(false);
    expect(h.probe.ledger!.data!.expenses.find((e) => e.memo === '친구 결혼식')!.excluded).toBeUndefined();
  });

  it('[저장]을 누르면 그때 예외 칸이 저장되고, 잔액은 그대로예요', async () => {
    const { h, card } = await withHistory();
    const balance = h.probe.ledger!.balances['demo-acc-event'];
    const usualBefore = h.probe.ledger!.eventProjection!.months.reduce((s, m) => s + m.usual, 0);
    const save = within(card).getByRole('button', { name: '저장' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(within(card).getByRole('checkbox', { name: '‘친구 결혼식’ 예외로 빼기' }));
    await act(async () => {
      fireEvent.click(save);
    });
    await screen.findByText('예외 표시 1건을 저장했어요');
    const saved = h.probe.ledger!.data!.expenses.find((e) => e.memo === '친구 결혼식')!;
    expect(saved.excluded).toBe(true);
    expect(h.probe.ledger!.balances['demo-acc-event']).toBe(balance);
    expect(h.probe.ledger!.eventProjection!.months.reduce((s, m) => s + m.usual, 0)).toBeLessThan(usualBefore);
    expect(within(chart()).queryByText('미리 보는 중')).toBeNull();
    // 저장한 예외는 체크된 채로 남아 다시 풀 수 있어요
    const again = screen.getByRole('region', { name: '예외 지출 빼기' });
    expect((within(again).getByRole('checkbox', { name: '‘친구 결혼식’ 예외로 빼기' }) as HTMLInputElement).checked).toBe(true);
    expect(again.textContent).toContain('예외로 표시함');
  });
});
