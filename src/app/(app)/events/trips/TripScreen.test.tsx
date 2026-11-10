// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeHarness } from '../testHarness';
import { TripView } from './TripScreen';
import { itemBudgetHint, projectionNote, remainingText, spendTone, tripPhaseText } from './selectors';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/events/trips',
}));

afterEach(cleanup);

async function renderTrip(id: string | null) {
  const h = makeHarness();
  render(<TripView tripId={id} />, { wrapper: h.Wrapper });
  await waitFor(() => expect(h.probe.ledger?.status).toBe('ready'));
  return h;
}

describe('여행 화면', () => {
  it('여행 하나: 예산 · 쓴 돈 · 남은 돈, 항목 막대, 낸 돈 목록', async () => {
    await renderTrip('demo-trip-jeju');
    expect(await screen.findByRole('heading', { level: 1, name: '제주 여행' })).toBeTruthy();
    expect(screen.getByText(/2월 20일~23일 \(3박 4일\) · 92일 뒤 떠나요/)).toBeTruthy();
    const stats = screen.getByRole('region', { name: '여행 예산' });
    expect(stats.textContent).toContain('예산900,000원');
    expect(stats.textContent).toContain('쓴 돈450,000원');
    expect(stats.textContent).toContain('남은 돈450,000원');
    expect(screen.getByText('아직 안 쓴 450,000원은 2027년 2월 이벤트통장 예측에 넣었어요')).toBeTruthy();

    const flight = screen.getByRole('progressbar', { name: '항공 예산 사용' });
    expect(flight.getAttribute('aria-valuetext')).toBe('300,000원 중 300,000원');
    expect(screen.getByRole('progressbar', { name: '숙박 예산 사용' }).getAttribute('aria-valuetext')).toBe('300,000원 중 150,000원');
    expect(screen.getByRole('progressbar', { name: '식비 예산 사용' })).toBeTruthy();

    const pays = screen.getByRole('list', { name: '이 여행에 낸 돈' });
    const rows = within(pays).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('제주 숙소 예약금');
    expect(rows[0]!.textContent).toContain('숙박 · 이벤트통장');
    expect(rows[1]!.textContent).toContain('제주 항공권');
    expect(rows[1]!.textContent).toContain('민지 돌려받기 전');
  });

  it('지출 기록: 여행과 이벤트통장을 골라 두고, 기록하면 여행에 묶여요', async () => {
    const h = await renderTrip('demo-trip-jeju');
    fireEvent.click(await screen.findByRole('button', { name: '지출 기록' }));
    const dialog = await screen.findByRole('dialog', { name: '지출 기록' });
    expect((within(dialog).getByLabelText(/^통장/) as HTMLSelectElement).value).toBe('demo-acc-event');
    expect((within(dialog).getByRole('combobox', { name: /^여행/ }) as HTMLSelectElement).value).toBe('demo-trip-jeju');
    fireEvent.change(within(dialog).getByLabelText(/금액/), { target: { value: '60000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '투어' }));
    fireEvent.change(within(dialog).getByLabelText(/내용/), { target: { value: '요트 투어' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));
    await screen.findByText(/요트 투어 60,000원 기록했어요/);
    const added = h.probe.ledger!.data!.expenses.find((e) => e.memo === '요트 투어')!;
    expect(added).toMatchObject({ tripId: 'demo-trip-jeju', tripItem: 'tour', accountId: 'demo-acc-event' });
    await waitFor(() => expect(h.probe.ledger!.trips[0]!.spent).toBe(510_000));
    expect(screen.getByRole('progressbar', { name: '투어 예산 사용' }).getAttribute('aria-valuetext')).toBe('100,000원 중 60,000원');
  });

  it('고치기 · 지우기', async () => {
    const h = await renderTrip('demo-trip-jeju');
    fireEvent.click(await screen.findByRole('button', { name: '고치기' }));
    let dialog = await screen.findByRole('dialog', { name: '여행 고치기' });
    const budget = within(dialog).getByLabelText(/총예산/) as HTMLInputElement;
    expect(budget.value).toBe('900,000');
    fireEvent.change(budget, { target: { value: '1000000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장하기' }));
    await screen.findByText('‘제주 여행’ 여행을 고쳤어요');
    expect(h.probe.ledger!.trips[0]!.budget).toBe(1_000_000);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '고치기' }));
    dialog = await screen.findByRole('dialog', { name: '여행 고치기' });
    fireEvent.click(within(dialog).getByRole('button', { name: '여행 지우기' }));
    dialog = await screen.findByRole('dialog', { name: '여행을 지울까요?' });
    fireEvent.click(within(dialog).getByRole('button', { name: '지우기' }));
    await screen.findByText('‘제주 여행’ 여행을 지웠어요');
    expect(await screen.findByText('여행을 찾을 수 없어요')).toBeTruthy();
    expect(h.probe.ledger!.trips).toHaveLength(0);
  });

  it('여행 목록', async () => {
    await renderTrip(null);
    const region = await screen.findByRole('region', { name: '다가오는 여행' });
    expect(within(region).getByRole('link', { name: /제주 여행/ }).getAttribute('href')).toBe('/events/trips?id=demo-trip-jeju');
  });
});

describe('여행 화면 문구', () => {
  it('남은 날 · 남은 예산 · 막대 색 · 항목 합 안내', () => {
    expect(tripPhaseText({ phase: 'upcoming', daysUntil: 1 })).toBe('내일 떠나요');
    expect(tripPhaseText({ phase: 'upcoming', daysUntil: 30 })).toBe('30일 뒤 떠나요');
    expect(tripPhaseText({ phase: 'ongoing', daysUntil: null })).toBe('여행 중이에요');
    expect(remainingText(-5000)).toBe('5,000원 넘었어요');
    expect(spendTone(95, 100)).toBe('warning');
    expect(spendTone(101, 100)).toBe('danger');
    expect(spendTone(10, null)).toBe('warning');
    const items = { flight: 600, stay: null, transport: null, food: null, tour: null, shopping: null, other: null };
    expect(itemBudgetHint(500, items)).toBe('항목 합 600원이 총예산보다 100원 많아요');
    expect(itemBudgetHint(1000, items)).toBe('항목 합 600원 · 나머지 400원은 항목 없이 써요');
    expect(itemBudgetHint(null, { ...items, flight: null })).toBeNull();
  });

  it('지난 여행의 남은 예산은 예측에 넣지 않는다고 알려요', () => {
    const s = {
      phase: 'past' as const, remaining: 1000, projected: [],
    } as unknown as Parameters<typeof projectionNote>[0];
    expect(projectionNote(s, '2026-11-20')).toBe('다녀온 여행이라 남은 예산은 예측에 넣지 않아요');
  });
});
