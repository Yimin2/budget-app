// @vitest-environment jsdom
/** 이벤트 화면: 범위 띠 · 매년 돌아오는 일 · 해 보기 */
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

describe('해 보기', () => {
  it('일정을 빼 보면 예측과 부족이 바로 바뀌고, [되돌리기]는 아무것도 저장하지 않아요', async () => {
    const h = await renderEvents();
    const before = h.probe.ledger!.data!.events.filter((e) => !e.deleted).length;
    const april = h.probe.ledger!.eventProjection!.months.find((m) => m.month === '2027-04')!;
    const biggest = [...april.events].sort((a, b) => b.amount - a.amount)[0]!;
    const card = screen.getByRole('region', { name: '해 보기' });
    fireEvent.click(within(card).getByRole('button', { name: '해 보기' }));

    const on = screen.getByRole('region', { name: '해 보기' });
    const row = within(on).getAllByRole('listitem').find((li) => li.textContent?.includes(biggest.name) && li.textContent.includes('4월'))!;
    fireEvent.click(within(row).getByRole('checkbox', { name: '빼 보기' }));
    expect(within(chart()).getByText('해 보는 중')).toBeTruthy();
    expect(on.textContent).toMatch(/이 일정을 빼면 2027년 4월 부족이 없어져요 · 2027년 10월 예상 잔액 \+\d+(\.\d)?만원/);
    expect(on.textContent).toContain('모자라는 달: 없어요');
    // 부족 알림은 해 보는 동안 숨겨요
    expect(screen.queryByRole('button', { name: '이 방법으로 반영하기' })).toBeNull();

    fireEvent.click(within(on).getByRole('button', { name: '되돌리기' }));
    expect(within(chart()).queryByText('해 보는 중')).toBeNull();
    expect(h.probe.ledger!.data!.events.filter((e) => !e.deleted)).toHaveLength(before);
    expect(screen.getByRole('button', { name: '이 방법으로 반영하기' })).toBeTruthy();
  });

  it('금액을 바꾸고 [이대로 바꾸기]를 누르면 그때 일정이 고쳐져요', async () => {
    const h = await renderEvents();
    const april = h.probe.ledger!.eventProjection!.months.find((m) => m.month === '2027-04')!;
    const target = [...april.events].sort((a, b) => b.amount - a.amount)[0]!;
    fireEvent.click(within(screen.getByRole('region', { name: '해 보기' })).getByRole('button', { name: '해 보기' }));
    const on = screen.getByRole('region', { name: '해 보기' });
    const apply = within(on).getByRole('button', { name: '이대로 바꾸기' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    const inputs = within(on).getAllByLabelText(`‘${target.name}’ 금액`);
    fireEvent.change(inputs[0]!, { target: { value: '10000' } });
    expect(on.textContent).toContain('금액을 바꾸면');
    // 아직 저장하지 않았어요
    expect(h.probe.ledger!.data!.events.find((e) => e.id === target.id)!.amount).toBe(target.amount);
    await act(async () => {
      fireEvent.click(apply);
    });
    await screen.findByText('바꾼 1건을 저장했어요');
    expect(h.probe.ledger!.data!.events.find((e) => e.id === target.id)!.amount).toBe(10_000);
    expect(within(chart()).queryByText('해 보는 중')).toBeNull();
  });
});
