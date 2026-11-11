// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { current, renderApp, startDemo } from '../../_components/__tests__/harness';

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
  params: new URLSearchParams(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/history/stats',
  useSearchParams: () => nav.params,
}));

import { StatsScreen } from './StatsScreen';

beforeEach(() => {
  nav.params = new URLSearchParams();
  nav.router.push.mockClear();
});
afterEach(cleanup);

async function open(opts: { couple?: boolean; params?: string; past?: boolean } = {}) {
  nav.params = new URLSearchParams(opts.params ?? '');
  const h = renderApp(<StatsScreen />, { couple: opts.couple });
  await startDemo(h);
  if (opts.past) {
    // 체험 가계부는 이번 달에 시작해요. 지난 기록을 하나 넣어 지난 달을 고를 수 있게
    await act(async () => {
      await current(h).ledger.addExpense({ date: '2026-09-05', amount: 12_000, accountId: 'demo-acc-fixed', categoryId: null, memo: '지난 기록' });
    });
  }
  return h;
}

const section = (id: string) => screen.getByTestId(id);
/** 묶음은 처음부터 펼쳐져 있어요 (접혀 있으면 펼쳐요) */
const expand = (id: string) => {
  const s = section(id);
  const btn = within(s).queryByRole('button', { name: /펼치기$/ });
  if (btn) fireEvent.click(btn);
  return s;
};

describe('통계 화면', () => {
  it('제목은 통계, 맨 위 [내역 · 통계] 바꾸기는 없어요', async () => {
    await open();
    expect(screen.getByRole('heading', { level: 1, name: '통계' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: '내역 · 통계' })).toBeNull();
  });

  it('달 바꾸기: 이번 달에서는 ▶ 이 꺼지고, ◀ 로 지난 달 · [이번 달]로 돌아와요', async () => {
    await open({ past: true });
    const bar = screen.getByRole('group', { name: '통계 달 고르기' });
    expect(screen.getByTestId('stats-month').textContent).toBe('2026년 11월');
    expect((within(bar).getByRole('button', { name: '다음 달' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(bar).queryByRole('button', { name: '이번 달' })).toBeNull();
    fireEvent.click(within(bar).getByRole('button', { name: '이전 달' }));
    expect(screen.getByTestId('stats-month').textContent).toBe('2026년 10월');
    // 묶음들도 고른 달을 따라가요
    expect(section('stats-category').textContent).toContain('2026년 10월');
    fireEvent.click(within(bar).getByRole('button', { name: '이번 달' }));
    expect(screen.getByTestId('stats-month').textContent).toBe('2026년 11월');
  });

  it('?month= 로 볼 달을 정하고, 고를 수 없는 달은 맞춰요', async () => {
    await open({ past: true, params: 'month=2026-10' });
    expect(screen.getByTestId('stats-month').textContent).toBe('2026년 10월');
    cleanup();
    await open({ past: true, params: 'month=2030-01' });
    expect(screen.getByTestId('stats-month').textContent).toBe('2026년 11월');
  });

  it('묶음은 모바일 · 데스크톱 모두 처음부터 펼쳐져 있고, [접기] · [펼치기]로 같은 자리에서 접어요 (창 없음)', async () => {
    await open();
    for (const id of ['stats-budget', 'stats-category', 'stats-trend', 'stats-event']) {
      const s = section(id);
      const btn = within(s).getByRole('button', { name: /접기$/ });
      expect(btn.getAttribute('aria-expanded')).toBe('true');
      expect(document.getElementById(btn.getAttribute('aria-controls')!)!.hidden).toBe(false);
    }
    expect(section('stats-budget').textContent).toMatch(/생활비 예산 .+ 중 .+ 썼어요/);

    const s = section('stats-budget');
    const list = within(s).getByRole('list', { name: '2026년 11월 생활비 항목별 예산과 쓴 돈' });
    expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(0);
    expect(within(s).getByRole('list', { name: '고정비 · 용돈' }).textContent).toContain('고정비');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(within(s).getByRole('button', { name: /접기$/ }));
    expect(within(s).queryByRole('list')).toBeNull();
    const again = within(s).getByRole('button', { name: /펼치기$/ });
    expect(again.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(again);
    expect(within(s).getByRole('list', { name: '2026년 11월 생활비 항목별 예산과 쓴 돈' })).toBeTruthy();
  });

  it('카테고리별 비율: 도넛(글 대체) + 범례, [전체 · 사람] 고르기', async () => {
    await open({ couple: true });
    const s = expand('stats-category');
    const who = within(s).getByRole('radiogroup', { name: '누가 쓴 돈을 볼까요' });
    const names = within(who).getAllByRole('radio').map((r) => r.textContent);
    expect(names[0]).toBe('전체');
    expect(names.length).toBe(3);
    const donut = within(s).getByTestId('stats-donut');
    expect(donut.getAttribute('role')).toBe('img');
    const allLabel = donut.getAttribute('aria-label')!;
    expect(allLabel).toMatch(/^2026년 11월 쓴 돈 .+만: /);
    const legend = within(s).getByRole('list', { name: '카테고리별 쓴 돈' });
    expect(within(legend).getAllByRole('listitem').length).toBeLessThanOrEqual(6);

    fireEvent.click(within(who).getByRole('radio', { name: names[1]! }));
    expect(within(who).getByRole('radio', { name: names[1]! }).getAttribute('aria-checked')).toBe('true');
    const personLabel = within(s).queryByTestId('stats-donut')?.getAttribute('aria-label') ?? within(s).getByText(/이 달에 쓴 돈이 없어요/).textContent!;
    expect(personLabel).toContain(names[1]!);
    expect(personLabel).not.toBe(allLabel);
  });

  it('월별 추이: 12개월 막대, 달을 누르면 아래에 그달 내역', async () => {
    await open();
    const s = expand('stats-trend');
    const chart = within(s).getByRole('group', { name: /달마다 쓴 돈/ });
    const bars = within(chart).getAllByRole('button');
    expect(bars).toHaveLength(12);
    expect(bars.at(-1)!.getAttribute('aria-pressed')).toBe('true');
    expect(bars[0]!.getAttribute('aria-label')).toMatch(/^2025년 12월 /);
    expect(within(s).getByRole('table', { name: '최근 12개월 달마다 쓴 돈' })).toBeTruthy();
    expect(within(s).getByTestId('trend-breakdown').textContent).toContain('2026년 11월');
    fireEvent.click(bars[10]!);
    expect(bars[10]!.getAttribute('aria-pressed')).toBe('true');
    expect(within(s).getByTestId('trend-breakdown').textContent).toContain('2026년 10월');
  });

  it('이벤트통장 1년 회고: 적립 · 쓴 돈 · 잔액 변화 · 저수지 · 큰 일정 · 카테고리', async () => {
    await open();
    expect(section('stats-event').textContent).toMatch(/적립 .+ · 쓴 돈 .+ · 잔액/);
    expect(section('stats-event').textContent).toContain('2025년 12월 ~ 2026년 11월');
    const s = expand('stats-event');
    for (const t of ['들어온 적립', '쓴 돈', '잔액 변화', '저수지에서 빌린 돈', '저수지에 갚은 돈', '가장 큰 일정 · 여행', '카테고리별 쓴 돈']) {
      expect(within(s).getAllByText(t).length).toBeGreaterThan(0);
    }
  });
});
