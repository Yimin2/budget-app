// @vitest-environment jsdom
/** 이벤트 화면 카드 4 '일정': 일정 · 여행을 날짜순 한 목록 · 제목 줄 버튼 · 폰 접기 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlannedEvent, TripStatus } from '@/domain';
import { EventsView } from './EventsView';
import { scheduleGroups } from './ScheduleCard';
import { makeHarness } from './testHarness';
import type { EventSections } from './selectors';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/plan',
}));

afterEach(cleanup);

const TODAY = '2026-11-20';
const ev = (id: string, date: string, amount: number) => ({ id, date, amount, name: id }) as PlannedEvent;
const trip = (id: string, startDate: string, phase: TripStatus['phase'], remaining: number) =>
  ({ trip: { id, name: id, startDate, endDate: startDate }, phase, remaining, budget: 900_000, spent: 900_000 - remaining }) as TripStatus;

describe('scheduleGroups', () => {
  const sections: EventSections = {
    overdue: [],
    past: [],
    total: 3,
    upcoming: [
      { month: '2026-12', events: [ev('a', '2026-12-05', 100_000), ev('b', '2026-12-25', 100_000)], total: 200_000 },
      { month: '2027-05', events: [ev('c', '2027-05-08', 200_000)], total: 200_000 },
    ],
  } as EventSections;

  it('여행을 떠나는 날의 달에 날짜순으로 섞고, 금액은 남은 예산(넘었으면 0) · 지난 여행은 빼요', () => {
    const groups = scheduleGroups(
      sections,
      [trip('jeju', '2027-02-20', 'upcoming', 450_000), trip('busan', '2026-12-05', 'upcoming', -10_000), trip('old', '2026-03-01', 'past', 0)],
      TODAY,
    );
    expect(groups.map((g) => g.month)).toEqual(['2026-12', '2027-02', '2027-05']);
    expect(groups[0]!.entries.map((e) => (e.kind === 'event' ? e.event.id : `trip:${e.trip.trip.id}`))).toEqual(['a', 'trip:busan', 'b']);
    expect(groups[0]!.total).toBe(200_000);
    expect(groups[1]!.total).toBe(450_000);
  });

  it('여행 중이라 떠난 날이 지났으면 이번 달 맨 앞에', () => {
    const groups = scheduleGroups(sections, [trip('now', '2026-11-18', 'ongoing', 100_000)], TODAY);
    expect(groups[0]!.month).toBe('2026-11');
    expect(groups[0]!.entries[0]).toMatchObject({ kind: 'trip', date: TODAY });
  });
});

describe('일정 카드', () => {
  it('제목 줄에 [매년 일정 한 번에 등록] · [기록에서 찾기] · [+ 추가], 폰에서는 첫 달만 보이고 [펼치기]로 나머지', async () => {
    const h = makeHarness();
    render(<EventsView />, { wrapper: h.Wrapper });
    const card = await screen.findByRole('region', { name: /^일정 · / });
    expect(within(card).getByRole('heading', { level: 2 }).textContent).toMatch(/^일정 · \d+건 .+만$/);
    for (const name of ['매년 일정 한 번에 등록', '기록에서 찾기', '추가']) {
      expect(within(card).getByRole('button', { name }).getAttribute('aria-expanded')).toBe('false');
    }
    const toggle = within(card).getByRole('button', { name: '일정 목록 펼치기' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const list = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(within(list).getByRole('region', { name: '다가오는 일정' })).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // 한 번에 하나만 펼쳐요
    fireEvent.click(within(card).getByRole('button', { name: '추가' }));
    fireEvent.click(within(card).getByRole('button', { name: '기록에서 찾기' }));
    expect(within(card).getByRole('button', { name: '추가' }).getAttribute('aria-expanded')).toBe('false');
    expect(within(card).queryByRole('button', { name: '새 일정' })).toBeNull();
    expect(within(card).getByRole('region', { name: '매년 돌아오는 일' })).toBeTruthy();
  });
});
