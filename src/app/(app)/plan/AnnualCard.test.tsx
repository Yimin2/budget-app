// @vitest-environment jsdom
/** 이벤트 화면: 매년 일정 한 번에 등록 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventsView } from './EventsView';
import { chooseScheduleAdd, makeHarness } from './testHarness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/plan',
}));

afterEach(cleanup);

/** '일정' 카드의 [+ 추가] 메뉴에서 '매년 일정 한 번에 등록'을 눌러 같은 자리에서 펼쳐요 */
async function renderCard() {
  const h = makeHarness();
  render(<EventsView />, { wrapper: h.Wrapper });
  await screen.findByRole('region', { name: /^일정/ });
  chooseScheduleAdd('매년 일정 한 번에 등록');
  const card = screen.getByRole('region', { name: '매년 일정 한 번에 등록' });
  return { h, card };
}

describe('매년 일정 한 번에 등록', () => {
  it("'일정' 카드의 [+ 추가] → 매년 일정 한 번에 등록으로 같은 자리에서 체크 목록을 펼치고, [닫기]로 접으면 [+ 추가]로 돌아가요 (창 없음)", async () => {
    const h = makeHarness();
    render(<EventsView />, { wrapper: h.Wrapper });
    const schedule = await screen.findByRole('region', { name: /^일정/ });
    expect(screen.queryByRole('region', { name: '매년 일정 한 번에 등록' })).toBeNull();
    // 제목 줄에 따로 있던 버튼은 없어요
    expect(within(schedule).queryByRole('button', { name: '매년 일정 한 번에 등록' })).toBeNull();
    chooseScheduleAdd('매년 일정 한 번에 등록');
    expect(screen.queryByRole('dialog')).toBeNull();
    const card = within(schedule).getByRole('region', { name: '매년 일정 한 번에 등록' });
    // 펼친 칸으로 포커스가 옮겨가요
    expect(card.parentElement!.contains(document.activeElement)).toBe(true);
    // 체험 가계부의 결혼기념일(매년)은 이미 등록됨
    expect(within(card).getByTestId('annual-summary').textContent).toBe('등록됨 1개');
    expect(within(card).getByRole('checkbox', { name: /설날/ })).toBeTruthy();
    fireEvent.click(within(schedule).getByRole('button', { name: '매년 일정 한 번에 등록 닫기' }));
    expect(screen.queryByRole('region', { name: '매년 일정 한 번에 등록' })).toBeNull();
    expect(document.activeElement).toBe(within(schedule).getByRole('button', { name: '추가' }));
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

  it('생신 줄에서 음력을 고르면 음력 월 · 일 칸과 올해 양력이 바로 보이고, 그 음력과 올해 양력 날짜로 넣어요', async () => {
    const { h, card } = await renderCard();
    const check = within(card).getAllByRole('checkbox', { name: /아버님/ })[0]!;
    const label = document.querySelector(`label[for="${check.id}"] span`)!.textContent!;
    fireEvent.click(check);
    fireEvent.click(within(within(card).getByRole('radiogroup', { name: `${label} 양력 또는 음력` })).getByText('음력'));
    const preview = within(card).getByTestId('annual-lunar-preview');
    expect(preview.textContent).toContain('음력 월 · 일을 골라 주세요');
    expect(preview.textContent).toContain('윤달');
    fireEvent.change(within(card).getByLabelText(`${label} 음력 월`), { target: { value: '11' } });
    fireEvent.change(within(card).getByLabelText(`${label} 음력 일`), { target: { value: '15' } });
    // 2026 음력 11월 15일 = 양력 2026-12-23 (오늘 2026-11-20 뒤라 올해)
    expect(within(card).getByTestId('annual-lunar-preview').textContent).toContain('올해 양력: 2026-12-23');
    fireEvent.change(within(card).getByLabelText(`${label} 금액`), { target: { value: '200000' } });
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: '등록하기' }));
    });
    await screen.findByText('매년 일정 1개를 넣었어요');
    const ev = h.probe.ledger!.data!.events.find((e) => e.name === `${label} 생신` && !e.deleted)!;
    expect(ev).toMatchObject({ date: '2026-12-23', lunar: '11-15', repeat: 'yearly' });
    // 등록됨 줄과 다가오는 일정 목록에 음력 기준과 이 회차 양력이 보여요
    await waitFor(() => expect(within(card).getByText(/매년 음력 11\/15/)).toBeTruthy());
    const upcoming = screen.getByRole('region', { name: '다가오는 일정' });
    expect(within(upcoming).getByText(/음력 11\/15 \(올해 12\/23\)/)).toBeTruthy();
  });

  it('그해 29일까지인 달의 30일은 29일로 셈하고 알려 줘요', async () => {
    const { h, card } = await renderCard();
    fireEvent.click(within(card).getByRole('button', { name: '직접 추가' }));
    fireEvent.change(within(card).getByLabelText('일정 이름'), { target: { value: '큰아버지 생신' } });
    fireEvent.click(within(within(card).getByRole('radiogroup', { name: '큰아버지 생신 양력 또는 음력' })).getByText('음력'));
    fireEvent.change(within(card).getByLabelText('큰아버지 생신 음력 월'), { target: { value: '3' } });
    fireEvent.change(within(card).getByLabelText('큰아버지 생신 음력 일'), { target: { value: '30' } });
    const text = within(card).getByTestId('annual-lunar-preview').textContent!;
    // 2026 음력 3월(30일)은 지났고, 다음인 2027 음력 3월은 29일까지
    expect(text).toContain('올해 양력: 2026-05-16 (지났어요 · 다음 2027-05-05)');
    expect(text).toContain('2027년 음력 3월은 29일까지라 30일 대신 29일로 셈해요');
    fireEvent.change(within(card).getByLabelText('직접 추가 금액'), { target: { value: '100000' } });
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: '등록하기' }));
    });
    await screen.findByText('매년 일정 1개를 넣었어요');
    expect(h.probe.ledger!.data!.events.find((e) => e.name === '큰아버지 생신')).toMatchObject({ date: '2027-05-05', lunar: '03-30' });
  });

  it('설날 · 추석 줄은 음력 날짜가 정해져 있어 그해 양력만 읽기 전용으로 보여요', async () => {
    const { card } = await renderCard();
    const seollal = within(card).getByRole('checkbox', { name: /설날/ });
    expect(seollal.closest('li')!.textContent).toContain('음력 1/1 · 올해 양력: 2026-02-17 (지났어요 · 다음 2027-02-07)');
    const chuseok = within(card).getByRole('checkbox', { name: /추석/ });
    expect(chuseok.closest('li')!.textContent).toContain('음력 8/15 · 올해 양력: 2026-09-25 (지났어요 · 다음 2027-09-15)');
    fireEvent.click(chuseok);
    expect(within(chuseok.closest('li')!).queryByLabelText(/음력 월/)).toBeNull();
  });

  it('일정 창에서 음력 일정의 음력 월 · 일을 고치면 음력 값과 다음 회차 양력 날짜가 바뀌어요', async () => {
    const h = makeHarness();
    render(<EventsView />, { wrapper: h.Wrapper });
    await screen.findByRole('region', { name: /^일정 · / });
    await act(async () => {
      await h.probe.ledger!.addEvent({ date: '2026-12-23', name: '외할머니 생신', amount: 100_000, repeat: 'yearly', lunar: '11-15' });
    });
    const upcoming = screen.getByRole('region', { name: '다가오는 일정' });
    expect(within(upcoming).getByText(/음력 11\/15 \(올해 12\/23\)/)).toBeTruthy();
    fireEvent.click(within(upcoming).getByRole('button', { name: /외할머니 생신/ }));
    const dialog = await screen.findByRole('dialog', { name: '일정 고치기' });
    expect(within(dialog).getByRole('radio', { name: '음력' }).getAttribute('aria-checked')).toBe('true');
    expect((within(dialog).getByLabelText('음력 월') as HTMLSelectElement).value).toBe('11');
    expect((within(dialog).getByLabelText('음력 일') as HTMLSelectElement).value).toBe('15');
    expect(within(dialog).getByTestId('event-calendar-hint').textContent).toContain('올해 양력: 2026-12-23');

    // 음력 12월 15일 → 2026 음력 해의 12/15 = 양력 2027-01-22 (올해 양력 날짜는 이미 지남)
    fireEvent.change(within(dialog).getByLabelText('음력 월'), { target: { value: '12' } });
    expect((within(dialog).getByLabelText(/^날짜/) as HTMLInputElement).value).toBe('2027-01-22');
    expect(within(dialog).getByTestId('event-calendar-hint').textContent).toContain('다음 2027-01-22');
    fireEvent.click(within(dialog).getByRole('button', { name: '저장하기' }));
    await screen.findByText('‘외할머니 생신’ 일정을 고쳤어요');
    const ev = h.probe.ledger!.data!.events.find((e) => e.name === '외할머니 생신')!;
    expect(ev).toMatchObject({ lunar: '12-15', date: '2027-01-22', repeat: 'yearly' });
    await waitFor(() => expect(within(screen.getByRole('region', { name: '다가오는 일정' })).getByText(/음력 12\/15 \(2027년 1\/22\)/)).toBeTruthy());
  });
});
