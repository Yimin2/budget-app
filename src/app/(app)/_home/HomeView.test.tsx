// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatWon } from '@/domain';
import { HomeView } from './HomeView';
import { makeHarness } from './testUtils';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

afterEach(cleanup);

async function renderHome(opts: { autoStart?: boolean } = {}) {
  const h = makeHarness(opts);
  // 체험 모드 시작(비동기)까지 act 안에서 끝내야 React 가 경고하지 않아요
  await act(async () => {
    render(<HomeView />, { wrapper: h.Wrapper });
  });
  return h;
}

describe('HomeView — 체험 가계부', () => {
  it('불러오는 동안 뼈대를 보여 주고, 다 불러오면 오늘 써도 되는 생활비를 크게 보여 줘요', async () => {
    const h = await renderHome();
    expect(screen.getByText('11월 20일 금요일')).toBeTruthy();
    const hero = await screen.findByRole('region', { name: '오늘 써도 되는 생활비' });
    const living = h.probe.ledger!.living!;
    expect(living.todayAvailable).toBeGreaterThan(0);
    expect(within(hero).getByText(formatWon(living.todayAvailable))).toBeTruthy();
    expect(within(hero).getByText(formatWon(living.remaining))).toBeTruthy();
    expect(within(hero).getByText(`${living.daysLeft}일 남음`)).toBeTruthy();
    expect(within(hero).getByRole('progressbar', { name: '이번 달 생활비 사용' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /사도 돼\? 확인하기/ }).getAttribute('href')).toBe('/check');
  });

  it('이벤트통장 부족 알림 · 다가오는 일정 3개 · 최근 지출 5개', async () => {
    await renderHome();
    await screen.findByRole('region', { name: '오늘 써도 되는 생활비' });
    expect(screen.getByText('2027년 4월에 이벤트통장이 300,000원 모자라요')).toBeTruthy();
    expect(screen.getByRole('link', { name: '대처하기' }).getAttribute('href')).toBe('/events');

    const upcoming = screen.getByRole('list', { name: '다가오는 일정' });
    const items = within(upcoming).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain('명절 부모님 용돈');
    expect(items[1]!.textContent).toContain('제주 여행');

    const recent = screen.getByRole('region', { name: '최근 지출' });
    expect(within(recent).getAllByRole('listitem')).toHaveLength(5);
    // 작성자 이름(아바타)
    expect(within(recent).getAllByText(/민지|준호/).length).toBeGreaterThan(0);
  });

  it('자주 쓰는 지출을 누르면 바로 기록하고, 되돌리기로 지워요', async () => {
    const h = await renderHome();
    await screen.findByRole('region', { name: '오늘 써도 되는 생활비' });
    const before = h.probe.ledger!.living!.spent;

    fireEvent.click(screen.getByRole('button', { name: '커피 4,500원 바로 기록하기' }));
    await screen.findByText('커피 4,500원 기록했어요');
    await waitFor(() => expect(h.probe.ledger!.living!.spent).toBe(before + 4_500));
    const recorded = h.probe.ledger!.data!.expenses.find((e) => e.memo === '커피' && e.date === '2026-11-20' && e.id.startsWith('demo-') === false);
    expect(recorded?.amount).toBe(4_500);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    });
    await screen.findByText('기록을 되돌렸어요');
    await waitFor(() => expect(h.probe.ledger!.living!.spent).toBe(before));
    expect(h.probe.ledger!.data!.expenses.find((e) => e.id === recorded!.id)?.deleted).toBe(true);
  });
});

describe('HomeView — 새 가계부', () => {
  it('생활비를 안 정했으면 설정으로 안내하고, 빈 목록 문구를 보여 줘요', async () => {
    const h = await renderHome();
    await screen.findByRole('region', { name: '오늘 써도 되는 생활비' });
    await act(async () => {
      await h.probe.session!.createLedger({ kind: 'shared', name: '새 가계부' });
    });
    const setup = await screen.findByRole('region', { name: '한 달 생활비를 정해 주세요' });
    expect(within(setup).getByRole('link', { name: '생활비 정하기' }).getAttribute('href')).toBe('/settings#st-fixed');
    expect(screen.getByText('다가오는 일정이 없어요.')).toBeTruthy();
    expect(screen.getByText(/아직 기록한 지출이 없어요/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '자주 쓰는 지출 추가' }).textContent).toContain('추가하기');
    expect(screen.queryByText(/이벤트통장이 .*모자라요/)).toBeNull();
  });

  it('가계부를 고르지 않았으면 고르기로 안내해요', async () => {
    await renderHome({ autoStart: false });
    expect(await screen.findByRole('heading', { name: '가계부를 골라 주세요' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '가계부 고르기' }).getAttribute('href')).toBe('/start');
  });
});
