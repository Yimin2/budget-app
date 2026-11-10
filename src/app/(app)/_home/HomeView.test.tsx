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
  it('불러오는 동안 뼈대를 보여 주고, 다 불러오면 오늘 써도 되는 돈(하루씩 항목 합)을 크게 보여 줘요', async () => {
    const h = await renderHome();
    expect(screen.getByText('11월 20일 금요일')).toBeTruthy();
    const hero = await screen.findByRole('region', { name: '오늘 써도 되는 돈' });
    const living = h.probe.ledger!.living!;
    expect(living.todayAvailable).toBeGreaterThan(0);
    expect(within(hero).getByText(formatWon(living.todayAvailable))).toBeTruthy();
    expect(within(hero).getByText(formatWon(living.remaining))).toBeTruthy();
    expect(within(hero).getByText(`${living.daysLeft}일 남음`)).toBeTruthy();
    expect(within(hero).getByRole('progressbar', { name: '이번 달 생활비 사용' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /사도 돼\? 확인하기/ }).getAttribute('href')).toBe('/check');
    // 큰 숫자 = 하루에 나눠 쓰는 항목(식비·카페·교통)의 오늘 써도 되는 돈 합
    const daily = living.items.filter((i) => i.spread === 'daily');
    expect(daily.map((i) => i.name)).toEqual(['식비', '카페', '교통']);
    expect(living.todayAvailable).toBe(daily.reduce((s, i) => s + (i.todayAvailable ?? 0), 0));
    expect(within(hero).getByText('식비 · 카페 · 교통 합계')).toBeTruthy();
  });

  it('항목별 생활비: 항목마다 막대 · 남은 돈 · 하루 항목은 오늘 써도 되는 돈', async () => {
    const h = await renderHome();
    const card = await screen.findByRole('region', { name: '항목별 생활비' });
    const living = h.probe.ledger!.living!;
    const rows = within(card).getAllByRole('listitem');
    expect(rows).toHaveLength(living.items.length);
    expect(within(card).getAllByRole('progressbar')).toHaveLength(living.items.length);
    const food = living.items.find((i) => i.name === '식비')!;
    const foodRow = within(card).getByRole('progressbar', { name: '식비 사용' }).closest('li') as HTMLElement;
    expect(within(foodRow).getByText(formatWon(food.todayAvailable!))).toBeTruthy();
    const shopRow = within(card).getByRole('progressbar', { name: '쇼핑 사용' }).closest('li') as HTMLElement;
    expect(within(shopRow).getByText('한 달 한도')).toBeTruthy();
    expect(within(card).getByRole('link', { name: /예산 바꾸기/ }).getAttribute('href')).toBe('/settings#st-living');
  });

  it('이벤트통장 부족 알림 · 다가오는 일정 3개 · 최근 지출 5개', async () => {
    await renderHome();
    await screen.findByRole('region', { name: '오늘 써도 되는 돈' });
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
    await screen.findByRole('region', { name: '오늘 써도 되는 돈' });
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
    await screen.findByRole('region', { name: '오늘 써도 되는 돈' });
    await act(async () => {
      await h.probe.session!.createLedger({ kind: 'shared', name: '새 가계부' });
    });
    const setup = await screen.findByRole('region', { name: '생활비 예산을 정해 주세요' });
    expect(within(setup).getByRole('link', { name: '생활비 정하기' }).getAttribute('href')).toBe('/settings#st-living');
    expect(screen.queryByRole('region', { name: '항목별 생활비' })).toBeNull();
    expect(screen.getByText('다가오는 일정이 없어요.')).toBeTruthy();
    expect(screen.getByText(/아직 기록한 지출이 없어요/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '자주 쓰는 지출 추가' }).textContent).toContain('추가하기');
    expect(screen.queryByText(/이벤트통장이 .*모자라요/)).toBeNull();
  });

  it('돌려받을 돈: 사람별 합 · 다음 정산일 · [보냈어요]로 돌려준 기록', async () => {
    const h = await renderHome();
    const card = await screen.findByRole('region', { name: '돌려받을 돈' });
    expect(within(card).getByText('324,000원')).toBeTruthy();
    expect(card.textContent).toContain('민지 300,000원 · 준호 24,000원');
    expect(card.textContent).toContain('다음 정산일 12월 1일');
    expect(within(card).getByText('민지에게 300,000원')).toBeTruthy();
    expect(card.textContent).toContain('이벤트통장 → 민지 수입통장 · 제주 항공권');
    expect(card.textContent).toContain('정산일을 기다리는 1건 보기');

    const eventBefore = h.probe.ledger!.balances['demo-acc-event']!;
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: '민지에게 300,000원 보냈어요' }));
    });
    await screen.findByText('민지에게 300,000원 돌려줬다고 기록했어요');
    expect(h.probe.ledger!.balances['demo-acc-event']).toBe(eventBefore - 300_000);
    expect(h.probe.ledger!.balances['demo-acc-income']).toBe(0);
    expect(within(card).queryByText('민지에게 300,000원')).toBeNull();
    expect(h.probe.ledger!.claims!.total).toBe(24_000);

    // 되돌리기 → 다시 돌려줄 돈
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    });
    await waitFor(() => expect(h.probe.ledger!.claims!.total).toBe(324_000));
  });

  it('가계부를 고르지 않았으면 고르기로 안내해요', async () => {
    await renderHome({ autoStart: false });
    expect(await screen.findByRole('heading', { name: '가계부를 골라 주세요' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '가계부 고르기' }).getAttribute('href')).toBe('/start');
  });
});
