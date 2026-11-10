// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeHarness } from '../testHarness';
import { emptyLedger, expense as makeExpense } from '@/domain/_fixtures';
import { tripStatus } from '@/domain';
import type { Expense, Trip } from '@/domain';
import type { ReadyLedger } from '../../_components';
import { TripDailyCard } from './TripDailyCard';
import { TripView } from './TripScreen';
import { dailySummaryText, dayRowLabel, itemBudgetHint, itemLineText, newestFirst, projectionNote, remainingText, spendTone, tripPhaseText } from './selectors';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/plan/trips',
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
    // 최근 날짜 먼저
    expect(rows[0]!.textContent).toContain('제주 항공권');
    expect(rows[0]!.textContent).toContain('민지 돌려받기 전');
    expect(rows[1]!.textContent).toContain('제주 숙소 예약금');
    expect(rows[1]!.textContent).toContain('숙박 · 이벤트통장');

    // 항목 줄 색 · 문구: 항공은 다 써서 warning, 숙박은 보통
    const itemRow = (name: string) => screen.getByRole('progressbar', { name: `${name} 예산 사용` }).closest('li')!;
    expect(itemRow('항공').textContent).toContain('다 썼어요');
    expect(itemRow('항공').textContent).toContain('30만 / 30만');
    expect(itemRow('항공').className).toMatch(/toneWarning/);
    expect(itemRow('숙박').textContent).toContain('15만 남음');
    expect(itemRow('숙박').className).not.toMatch(/tone/);
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

  it('날짜별: 접힌 요약 → 펼치면 여행 전 · 날마다 줄, 줄을 누르면 그날 지출, 지출을 누르면 고치기 창', async () => {
    await renderTrip('demo-trip-jeju');
    const card = await screen.findByRole('region', { name: '날짜별' });
    // 처음에는 접혀 있어요
    expect(within(card).getByTestId('trip-daily-summary').textContent).toBe('여행 전 45만 · 여행 날에 쓴 돈은 아직 없어요');
    expect(within(card).queryByRole('list', { name: '날짜별 쓴 돈' })).toBeNull();
    const expand = within(card).getByRole('button', { name: '날짜별 펼치기' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(expand);
    expect(expand.getAttribute('aria-expanded')).toBe('true');

    const days = within(card).getByRole('list', { name: '날짜별 쓴 돈' });
    const rows = within(days).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      '여행 전 (미리 낸 돈)45만',
      '2/20 (1일차)—쓴 돈 없음',
      '2/21 (2일차)—쓴 돈 없음',
      '2/22 (3일차)—쓴 돈 없음',
      '2/23 (4일차)—쓴 돈 없음',
    ]);
    // 쓴 돈이 없는 날은 누를 수 없어요
    expect(within(rows[1]!).queryByRole('button')).toBeNull();

    const before = within(rows[0]!).getByRole('button', { name: /여행 전/ });
    expect(before.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(before);
    expect(before.getAttribute('aria-expanded')).toBe('true');
    const pays = within(card).getByRole('list', { name: '여행 전 (미리 낸 돈) 지출' });
    const payRows = within(pays).getAllByRole('button');
    expect(payRows.map((b) => b.textContent)).toEqual([
      expect.stringContaining('제주 숙소 예약금'),
      expect.stringContaining('제주 항공권'),
    ]);
    fireEvent.click(payRows[0]!);
    const dialog = await screen.findByRole('dialog', { name: '지출 고치기' });
    expect((within(dialog).getByLabelText(/내용/) as HTMLInputElement).value).toBe('제주 숙소 예약금');
  });

  it('여행 목록', async () => {
    await renderTrip(null);
    const region = await screen.findByRole('region', { name: '다가오는 여행' });
    expect(within(region).getByRole('link', { name: /제주 여행/ }).getAttribute('href')).toBe('/plan/trips?id=demo-trip-jeju');
  });
});

describe('날짜별 카드 (여행 중)', () => {
  const NOW = '2026-11-01T00:00:00.000Z';
  const trip = (p: Partial<Trip> = {}): Trip => ({
    id: 't', name: '부산 여행', startDate: '2026-11-19', endDate: '2026-11-21', budget: 500_000, items: {}, memo: '',
    author: 'a@x', createdAt: NOW, updatedAt: NOW, deleted: false, ...p,
  });
  const ex = (date: string, amount: number, memo: string): Expense =>
    makeExpense({ date, amount, memo, accountId: 'event', tripId: 't', createdAt: `${date}T01:00:00Z` });

  function renderCard(t: Trip, expenses: Expense[], today = '2026-11-20') {
    const data = emptyLedger({ trips: [t], expenses });
    const ledger = { data, today, accountByRole: () => null } as unknown as ReadyLedger;
    const onEdit = vi.fn();
    render(<TripDailyCard ledger={ledger} status={tripStatus(data, t, today)} onEditExpense={onEdit} />);
    return onEdit;
  }

  it('요약 · 막대 · 오늘 줄 강조 · 여러 날 함께 펼치기', () => {
    const onEdit = renderCard(trip(), [
      ex('2026-11-19', 230_000, '횟집'),
      ex('2026-11-20', 50_000, '택시'),
      ex('2026-11-20', 100_000, '시장'),
      ex('2026-11-23', 20_000, '기념품 배송비'),
    ]);
    expect(screen.getByTestId('trip-daily-summary').textContent).toBe('하루 평균 12.7만 · 가장 많이 쓴 날 11/19 23만');
    fireEvent.click(screen.getByRole('button', { name: '날짜별 펼치기' }));
    const rows = within(screen.getByRole('list', { name: '날짜별 쓴 돈' })).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['11/19 (1일차)23만', '11/20 (2일차)오늘15만', '11/21 (3일차)—쓴 돈 없음', '여행 뒤2만']);
    // 여행 전에 낸 돈이 없으면 그 줄은 없어요 · 오늘 줄만 강조
    expect(rows[1]!.getAttribute('aria-current')).toBe('date');
    expect(rows[1]!.className).toMatch(/dayToday/);
    expect(rows[0]!.getAttribute('aria-current')).toBeNull();
    // 막대는 가장 많이 쓴 날 대비
    const bar = (row: HTMLElement) => (row.querySelector('.bar > span') as HTMLElement).style.width;
    expect(bar(rows[0]!)).toBe('100%');
    expect(Number.parseFloat(bar(rows[1]!))).toBeCloseTo((150 / 230) * 100, 1);
    expect(bar(rows[2]!)).toBe('0%');

    fireEvent.click(within(rows[0]!).getByRole('button', { name: /^11\/19 \(1일차\)/ }));
    fireEvent.click(within(rows[1]!).getByRole('button', { name: /^11\/20 \(2일차\)/ }));
    expect(within(screen.getByRole('list', { name: '11/19 (1일차) 지출' })).getAllByRole('button')).toHaveLength(1);
    const today = within(screen.getByRole('list', { name: '11/20 (2일차) 지출' })).getAllByRole('button');
    expect(today.map((b) => b.textContent)).toEqual([expect.stringContaining('택시'), expect.stringContaining('시장')]);
    fireEvent.click(today[1]!);
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ memo: '시장' }));
    // 다시 누르면 접혀요
    fireEvent.click(within(rows[1]!).getByRole('button', { name: /^11\/20 \(2일차\)/ }));
    expect(screen.queryByRole('list', { name: '11/20 (2일차) 지출' })).toBeNull();
  });

  it('여행이 아니면 오늘 줄을 강조하지 않고, 하루 여행 · 지출 없는 여행도 보여요', () => {
    renderCard(trip({ startDate: '2026-11-25', endDate: '2026-11-25' }), [ex('2026-11-25', 80_000, '점심')]);
    expect(screen.getByTestId('trip-daily-summary').textContent).toBe('11/25 하루 8만');
    fireEvent.click(screen.getByRole('button', { name: '날짜별 펼치기' }));
    const rows = within(screen.getByRole('list', { name: '날짜별 쓴 돈' })).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['11/25 (1일차)8만']);
    cleanup();

    renderCard(trip(), [], '2026-11-10');
    expect(screen.getByTestId('trip-daily-summary').textContent).toBe('아직 날짜별로 정리할 지출이 없어요.');
    expect(screen.queryByRole('button', { name: /펼치기/ })).toBeNull();
  });
});

describe('여행 화면 문구', () => {
  it('날짜별 줄 이름 · 접힌 요약', () => {
    expect(dayRowLabel({ kind: 'before', date: null, dayIndex: null })).toBe('여행 전 (미리 낸 돈)');
    expect(dayRowLabel({ kind: 'day', date: '2026-12-20', dayIndex: 1 })).toBe('12/20 (1일차)');
    expect(dayRowLabel({ kind: 'after', date: null, dayIndex: null })).toBe('여행 뒤');
    const peak = { kind: 'day' as const, date: '2026-12-20', dayIndex: 1, total: 230_000, expenses: [] };
    const base = { dayCount: 4, daysTotal: 720_000, average: 180_000, peak, before: 450_000, after: 0 };
    expect(dailySummaryText(base)).toBe('하루 평균 18만 · 가장 많이 쓴 날 12/20 23만');
    expect(dailySummaryText({ ...base, daysTotal: 0, average: 0, peak: null, after: 10_000 })).toBe(
      '여행 전 45만 · 여행 뒤 1만 · 여행 날에 쓴 돈은 아직 없어요',
    );
    expect(dailySummaryText({ ...base, daysTotal: 0, average: 0, peak: null, before: 0 })).toBeNull();
  });


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

  it('항목 줄 문구: 항목 예산 · 나머지 예산 · 예산 밖', () => {
    const own = { item: 'flight' as const, budget: 300_000, spent: 330_000, remaining: -30_000, basis: 'own' as const, state: 'over' as const };
    expect(itemLineText(own, null)).toEqual({ status: '3만 넘었어요', detail: '33만 / 30만' });
    expect(itemLineText({ ...own, spent: 250_000, remaining: 50_000, state: 'ok' }, null).status).toBe('5만 남음');

    const pool = { budget: 300_000, spent: 150_000, remaining: 150_000 };
    const food = { item: 'food' as const, budget: null, spent: 120_000, remaining: null, basis: 'pool' as const, state: 'ok' as const };
    expect(itemLineText(food, pool)).toEqual({ status: '나머지 15만 남음', detail: '나머지 예산 30만 중 12만 씀 · 함께 15만' });
    expect(itemLineText(food, { ...pool, spent: 120_000, remaining: 180_000 }).detail).toBe('나머지 예산 30만 중 12만 씀');
    expect(itemLineText(food, { budget: 300_000, spent: 330_000, remaining: -30_000 }).status).toBe('나머지 3만 넘었어요');

    const outside = { ...food, spent: 40_000, basis: 'outside' as const, state: 'near' as const };
    expect(itemLineText(outside, null).status).toBe('예산 밖 4만 씀');
    expect(itemLineText({ ...outside, spent: 0, state: 'ok' }, null)).toEqual({ status: '', detail: '' });
  });

  it('낸 돈은 최근 날짜 먼저, 같은 날이면 나중에 기록한 것 먼저', () => {
    const e = (id: string, date: string, createdAt: string) => ({ id, date, createdAt });
    const sorted = newestFirst([
      e('a', '2026-11-01', '2026-11-01T01:00:00Z'),
      e('b', '2026-11-03', '2026-11-03T01:00:00Z'),
      e('c', '2026-11-01', '2026-11-02T01:00:00Z'),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('지난 여행의 남은 예산은 예측에 넣지 않는다고 알려요', () => {
    const s = {
      phase: 'past' as const, remaining: 1000, projected: [],
    } as unknown as Parameters<typeof projectionNote>[0];
    expect(projectionNote(s, '2026-11-20')).toBe('다녀온 여행이라 남은 예산은 예측에 넣지 않아요');
  });
});
