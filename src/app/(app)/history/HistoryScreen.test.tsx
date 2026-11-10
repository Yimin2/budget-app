// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { current, renderApp, startDemo } from '../_components/__tests__/harness';

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
  params: new URLSearchParams(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/history',
  useSearchParams: () => nav.params,
}));

import { HistoryScreen, historyHref, parseHistoryTab } from './HistoryScreen';

beforeEach(() => {
  nav.params = new URLSearchParams();
  nav.router.replace.mockClear();
  nav.router.push.mockClear();
});
afterEach(cleanup);

async function open(params = '') {
  nav.params = new URLSearchParams(params);
  const h = renderApp(<HistoryScreen />);
  await startDemo(h);
  return h;
}

describe('내역 화면', () => {
  it('탭 주소: 모르는 값은 지출, 지출은 /history', () => {
    expect(parseHistoryTab(null)).toBe('expenses');
    expect(parseHistoryTab('nope')).toBe('expenses');
    expect(parseHistoryTab('accounts')).toBe('accounts');
    expect(historyHref('expenses')).toBe('/history');
    expect(historyHref('transfers')).toBe('/history?tab=transfers');
  });

  it('기본은 지출, 탭을 바꾸면 주소의 ?tab= 이 바뀌어요', async () => {
    await open();
    expect(screen.getByRole('heading', { level: 1, name: '내역' })).toBeTruthy();
    const tabs = screen.getByRole('radiogroup', { name: '내역 종류' });
    expect(within(tabs).getAllByRole('radio').map((r) => r.textContent)).toEqual(['지출', '이체', '통장 잔액']);
    expect(within(tabs).getByRole('radio', { name: '지출' }).getAttribute('aria-checked')).toBe('true');
    expect(await screen.findByRole('region', { name: '2026년 11월 지출 목록' })).toBeTruthy();
    fireEvent.click(within(tabs).getByRole('radio', { name: '통장 잔액' }));
    expect(nav.router.replace).toHaveBeenCalledWith('/history?tab=accounts', { scroll: false });
  });

  it('맨 위 [내역 · 통계]: 내역이 골라져 있고 통계를 누르면 /history/stats 로', async () => {
    await open();
    const views = screen.getByRole('radiogroup', { name: '내역 · 통계' });
    expect(within(views).getAllByRole('radio').map((r) => r.textContent)).toEqual(['내역', '통계']);
    expect(within(views).getByRole('radio', { name: '내역' }).getAttribute('aria-checked')).toBe('true');
    // [내역 · 통계]가 [지출 · 이체 · 통장 잔액]보다 위
    const tabs = screen.getByRole('radiogroup', { name: '내역 종류' });
    expect(views.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(views).getByRole('radio', { name: '통계' }));
    expect(nav.router.push).toHaveBeenCalledWith('/history/stats', { scroll: false });
    cleanup();
    // 이체 · 통장 잔액 탭에도 있고, 통장 하나(&id=)에서는 숨겨요
    await open('tab=transfers');
    expect(screen.getByRole('radiogroup', { name: '내역 · 통계' })).toBeTruthy();
    cleanup();
    await open('tab=accounts&id=demo-acc-event');
    expect(screen.queryByRole('radiogroup', { name: '내역 · 통계' })).toBeNull();
  });

  it('이체 탭: 수입 · 이체 기록을 달마다 보여 주고 눌러서 자세히 봐요', async () => {
    const h = await open('tab=transfers');
    expect(screen.getByRole('radio', { name: '이체' }).getAttribute('aria-checked')).toBe('true');
    const transfers = current(h).ledger.data!.transfers.filter((t) => !t.deleted);
    expect(transfers.length).toBeGreaterThan(0);
    const rows = document.querySelectorAll('.lrow');
    expect(rows.length).toBe(Math.min(transfers.length, 40));
    fireEvent.click(rows[0] as HTMLElement);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: '이체 기록' })).toBeTruthy();
  });

  it('통장 잔액 탭: 잔액 합계 · 통장 카드 · 매달 배분, 통장 하나(&id=)는 탭 없이 상세', async () => {
    await open('tab=accounts');
    expect(screen.getByRole('region', { name: '통장 잔액 합계' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: '내역 종류' })).toBeTruthy();
    cleanup();
    await open('tab=accounts&id=demo-acc-event');
    expect(screen.queryByRole('radiogroup', { name: '내역 종류' })).toBeNull();
    expect(screen.getByRole('link', { name: '통장 목록' }).getAttribute('href')).toBe('/history?tab=accounts');
  });
});
