// @vitest-environment jsdom
/** 이벤트 화면 카드 4 '일정': 일정 · 여행을 날짜순 한 목록 · [+ 추가] 메뉴 · 기록에서 찾은 일 안내 · 폰 접기 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlannedEvent, TripStatus } from '@/domain';
import { EventsView } from './EventsView';
import { scheduleGroups } from './ScheduleCard';
import { chooseScheduleAdd, makeHarness } from './testHarness';
import type { EventSections } from './selectors';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/plan',
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

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

async function renderCard() {
  const h = makeHarness();
  render(<EventsView />, { wrapper: h.Wrapper });
  const card = await screen.findByRole('region', { name: /^일정 · / });
  return { h, card, add: within(card).getByRole('button', { name: '추가' }) };
}

/** 작년 12월 기록 → '기록에서 찾기' 제안 1건 */
async function withSuggestion(h: ReturnType<typeof makeHarness>) {
  await act(async () => {
    await h.probe.ledger!.addExpense({ date: '2025-12-08', amount: 120_000, accountId: 'demo-acc-event', categoryId: null, memo: '하늘 생신' });
  });
  await screen.findByText('지난 기록에서 매년 반복되는 일 1건을 찾았어요');
}

const itemNames = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map((el) => el.getAttribute('data-item-id'));

describe('일정 카드', () => {
  it('제목 줄에는 [+ 추가] 하나, 폰에서는 첫 달만 보이고 [펼치기]로 나머지', async () => {
    const { card, add } = await renderCard();
    expect(within(card).getByRole('heading', { level: 2 }).textContent).toMatch(/^일정 · \d+건 .+만$/);
    expect(within(card).queryByRole('button', { name: '매년 일정 한 번에 등록' })).toBeNull();
    expect(within(card).queryByRole('button', { name: /^기록에서 찾기/ })).toBeNull();
    expect(add.getAttribute('aria-haspopup')).toBe('menu');
    expect(add.getAttribute('aria-expanded')).toBe('false');
    const toggle = within(card).getByRole('button', { name: '일정 목록 펼치기' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const list = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(within(list).getByRole('region', { name: '다가오는 일정' })).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('일정 카드 — [+ 추가] 메뉴', () => {
  it('누르면 버튼에 붙은 메뉴(창 아님)가 열리고 첫 항목에 포커스, 다시 누르거나 바깥을 누르면 닫혀요', async () => {
    const { card, add } = await renderCard();
    fireEvent.click(add);
    expect(add.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('dialog')).toBeNull();
    const menu = within(card).getByRole('menu', { name: '무엇을 추가할까요' });
    expect(add.getAttribute('aria-controls')).toBe(menu.id);
    // 찾은 기록이 없으면 '기록에서 찾기'는 없어요
    expect(itemNames(menu)).toEqual(['event', 'trip', 'annual']);
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: '새 일정' }));
    // 항목마다 한 줄 설명
    expect(within(menu).getByRole('menuitem', { name: '새 일정' }).getAttribute('aria-describedby')).toBeTruthy();
    expect(within(menu).getByText('결혼식 · 생신처럼 한 번 있는 일')).toBeTruthy();
    expect(within(menu).getByText('기간 · 예산을 정하고 지출을 묶어요')).toBeTruthy();
    expect(within(menu).getByText('설 · 추석 · 생신 · 어버이날')).toBeTruthy();
    fireEvent.click(add);
    expect(within(card).queryByRole('menu')).toBeNull();
    expect(add.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(add);
    expect(within(card).getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(within(card).queryByRole('menu')).toBeNull();
  });

  it('키보드: ↓ · ↑ (돌아가요) · Home · End 로 옮기고 Esc 는 닫고 버튼으로, Enter · Space 로 골라요', async () => {
    const { card, add } = await renderCard();
    add.focus();
    fireEvent.keyDown(add, { key: 'ArrowUp' });
    let menu = within(card).getByRole('menu');
    const item = (name: string) => within(menu).getByRole('menuitem', { name });
    expect(document.activeElement).toBe(item('매년 일정 한 번에 등록'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item('새 일정'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item('여행 추가'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(item('매년 일정 한 번에 등록'));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(item('새 일정'));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(item('매년 일정 한 번에 등록'));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(within(card).queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(add);

    fireEvent.keyDown(add, { key: 'ArrowDown' });
    menu = within(card).getByRole('menu');
    expect(document.activeElement).toBe(item('새 일정'));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(within(card).queryByRole('menu')).toBeNull();
    expect(within(card).getByRole('region', { name: '매년 일정 한 번에 등록' })).toBeTruthy();

    fireEvent.keyDown(add, { key: 'ArrowDown' });
    menu = within(card).getByRole('menu');
    fireEvent.keyDown(document.activeElement!, { key: ' ' });
    expect(await screen.findByRole('dialog', { name: '일정 추가' })).toBeTruthy();
  });

  it('새 일정 → 일정 추가 창, 여행 추가 → 여행 추가 창', async () => {
    const { card } = await renderCard();
    chooseScheduleAdd('새 일정');
    expect(await screen.findByRole('dialog', { name: '일정 추가' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    chooseScheduleAdd('여행 추가');
    expect(await screen.findByRole('dialog', { name: '여행 추가' })).toBeTruthy();
    expect(within(card).queryByRole('menu')).toBeNull();
  });

  it('매년 일정 · 기록에서 찾기 N건 → 카드 안에서 펼치고(한 번에 하나), [닫기]로 접어요', async () => {
    const { h, card, add } = await renderCard();
    await withSuggestion(h);
    fireEvent.click(add);
    const menu = within(card).getByRole('menu');
    expect(itemNames(menu)).toEqual(['event', 'trip', 'annual', 'recurring']);
    expect(within(menu).getByRole('menuitem', { name: /^기록에서 찾기,\s?1건$/ })).toBeTruthy();
    expect(within(menu).getByText('지난 지출에서 매년 반복되는 일 추천')).toBeTruthy();
    fireEvent.keyDown(menu, { key: 'Escape' });

    chooseScheduleAdd('매년 일정 한 번에 등록');
    expect(within(card).getByRole('region', { name: '매년 일정 한 번에 등록' })).toBeTruthy();
    chooseScheduleAdd(/^기록에서 찾기/);
    expect(within(card).queryByRole('region', { name: '매년 일정 한 번에 등록' })).toBeNull();
    const recurring = within(card).getByRole('region', { name: '매년 돌아오는 일' });
    expect(recurring.parentElement!.contains(document.activeElement)).toBe(true);
    fireEvent.click(within(card).getByRole('button', { name: '매년 돌아오는 일 닫기' }));
    expect(within(card).queryByRole('region', { name: '매년 돌아오는 일' })).toBeNull();
    expect(document.activeElement).toBe(add);
  });
});

describe('일정 카드 — 기록에서 찾은 일 안내', () => {
  it('찾은 게 있으면 목록 위에 안내, [보기]는 기록에서 찾기를 펼쳐요', async () => {
    const { h, card } = await renderCard();
    expect(within(card).queryByText(/매년 반복되는 일 \d+건을 찾았어요/)).toBeNull();
    await withSuggestion(h);
    fireEvent.click(within(card).getByRole('button', { name: '보기' }));
    expect(within(card).getByRole('region', { name: '매년 돌아오는 일' })).toBeTruthy();
    // 펼쳐 있는 동안은 안내를 숨겨요
    expect(within(card).queryByText('지난 기록에서 매년 반복되는 일 1건을 찾았어요')).toBeNull();
  });

  it('[닫기]하면 이 기기에 기억해 다시 열어도 보이지 않아요', async () => {
    const { h, card } = await renderCard();
    await withSuggestion(h);
    fireEvent.click(within(card).getByRole('button', { name: '매년 반복되는 일 안내 닫기' }));
    expect(within(card).queryByText('지난 기록에서 매년 반복되는 일 1건을 찾았어요')).toBeNull();
    expect(window.localStorage.getItem('budget:recurringHintDismissed')).toBe('1');
    // 메뉴의 '기록에서 찾기'는 그대로
    chooseScheduleAdd(/^기록에서 찾기/);
    expect(within(card).getByRole('region', { name: '매년 돌아오는 일' })).toBeTruthy();
    cleanup();
    const again = await renderCard();
    await withSuggestion(again.h).catch(() => undefined);
    expect(screen.queryByText('지난 기록에서 매년 반복되는 일 1건을 찾았어요')).toBeNull();
  });

  it('저장소를 못 써도 안내는 보이고 [닫기]는 이번 화면에서만 닫혀요', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { h, card } = await renderCard();
    await withSuggestion(h);
    fireEvent.click(within(card).getByRole('button', { name: '매년 반복되는 일 안내 닫기' }));
    expect(within(card).queryByText('지난 기록에서 매년 반복되는 일 1건을 찾았어요')).toBeNull();
  });
});
