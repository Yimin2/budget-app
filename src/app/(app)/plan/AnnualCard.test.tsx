// @vitest-environment jsdom
/** 이벤트 화면: 매년 일정 한 번에 등록 */
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

async function renderCard() {
  const h = makeHarness();
  render(<EventsView />, { wrapper: h.Wrapper });
  const card = await screen.findByRole('region', { name: '매년 일정 한 번에 등록' });
  fireEvent.click(within(card).getByRole('button', { name: '매년 일정 한 번에 등록 펼치기' }));
  return { h, card };
}

describe('매년 일정 한 번에 등록', () => {
  it('처음에는 접힌 요약 한 줄만, [펼치기]로 같은 자리에서 체크 목록을 펼치고 [접기]로 접어요', async () => {
    const h = makeHarness();
    render(<EventsView />, { wrapper: h.Wrapper });
    const card = await screen.findByRole('region', { name: '매년 일정 한 번에 등록' });
    // 체험 가계부의 결혼기념일(매년)은 이미 등록됨
    expect(within(card).getByTestId('annual-summary').textContent).toBe('등록됨 1개');
    expect(within(card).queryByRole('checkbox', { name: /설날/ })).toBeNull();
    expect(within(card).queryByRole('button', { name: '등록하기' })).toBeNull();
    const toggle = within(card).getByRole('button', { name: '매년 일정 한 번에 등록 펼치기' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBeTruthy();
    expect(within(card).getByRole('checkbox', { name: /설날/ })).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: '매년 일정 한 번에 등록 접기' }));
    expect(within(card).queryByRole('checkbox', { name: /설날/ })).toBeNull();
  });

  it('체크하고 금액을 넣어 등록하면 매년 반복 예정 일정이 되고, 그 줄은 등록됨 + 고치기로 바뀌어요', async () => {
    const { h, card } = await renderCard();
    // 체험 가계부의 결혼기념일(매년)은 이미 등록됨
    expect(within(card).getByRole('button', { name: '‘결혼기념일’ 일정 고치기' })).toBeTruthy();
    const register = within(card).getByRole('button', { name: '등록하기' }) as HTMLButtonElement;
    expect(register.disabled).toBe(true);

    fireEvent.click(within(card).getByRole('checkbox', { name: /설날/ }));
    // 금액 없이 누르면 그 줄에 알려요
    await act(async () => {
      fireEvent.click(register);
    });
    expect(within(card).getByRole('alert').textContent).toContain('금액을 입력해 주세요');
    fireEvent.change(within(card).getByLabelText('설날 금액'), { target: { value: '300000' } });
    await act(async () => {
      fireEvent.click(register);
    });
    await screen.findByText('매년 일정 1개를 넣었어요');
    const ev = h.probe.ledger!.data!.events.find((e) => e.id === 'annual-seollal')!;
    expect(ev).toMatchObject({ name: '설날', date: '2027-02-07', amount: 300_000, repeat: 'yearly', lunar: '01-01', status: 'planned', accountId: 'demo-acc-event' });
    await waitFor(() => expect(within(card).getByRole('button', { name: '‘설날’ 일정 고치기' })).toBeTruthy());
    expect(within(card).queryByRole('checkbox', { name: /설날/ })).toBeNull();

    // 고치기는 일정 창을 열고, 음력으로 보여요
    fireEvent.click(within(card).getByRole('button', { name: '‘설날’ 일정 고치기' }));
    const dialog = await screen.findByRole('dialog', { name: '일정 고치기' });
    expect(dialog.textContent).toContain('음력 1월 1일이에요');
  });

  it('직접 추가: 이름 · 날짜 · 음력 · 금액으로 넣고, 같은 이름은 두 번 생기지 않아요', async () => {
    const { h, card } = await renderCard();
    fireEvent.click(within(card).getByRole('button', { name: '직접 추가' }));
    fireEvent.change(within(card).getByLabelText('일정 이름'), { target: { value: '할머니 생신' } });
    fireEvent.change(within(card).getByLabelText('할머니 생신 월'), { target: { value: '3' } });
    fireEvent.change(within(card).getByLabelText('할머니 생신 일'), { target: { value: '4' } });
    fireEvent.click(within(within(card).getByRole('radiogroup', { name: '할머니 생신 양력 또는 음력' })).getByText('음력'));
    fireEvent.change(within(card).getByLabelText('직접 추가 금액'), { target: { value: '100000' } });
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: '등록하기' }));
    });
    await screen.findByText('매년 일정 1개를 넣었어요');
    const rows = () => h.probe.ledger!.data!.events.filter((e) => e.name === '할머니 생신' && !e.deleted);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ date: '2027-04-10', lunar: '03-04', repeat: 'yearly' });
    await waitFor(() => expect(within(card).getByRole('button', { name: '‘할머니 생신’ 일정 고치기' })).toBeTruthy());
    // 상태 계층도 다시 눌러 같은 행을 두 번 만들지 않아요
    await act(async () => {
      const again = await h.probe.ledger!.registerAnnualEvents([
        { id: rows()[0]!.id, name: '할머니 생신', date: '2027-04-10', amount: 100_000, categoryId: null, lunar: '03-04' },
      ]);
      expect(again).toEqual([]);
    });
    expect(rows()).toHaveLength(1);
  });
});
