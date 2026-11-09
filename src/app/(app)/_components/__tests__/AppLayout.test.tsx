// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoLedger, livingLeftover } from '@/domain';
import { DEMO_LEDGER_ID } from '@/state';
import { createMemoryStorage, LocalBackend } from '@/storage';
import { current, renderApp, startDemo } from './harness';

const nav = vi.hoisted(() => {
  const router = { replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
  return { router, pathname: '/' };
});
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
}));

import AppLayout from '../../layout';

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  nav.pathname = '/';
});

describe('앱 틀 (app)/layout', () => {
  it('로그인 전이면 /start 로 보내고 화면 내용은 그리지 않아요', async () => {
    renderApp(
      <AppLayout>
        <p>홈 내용</p>
      </AppLayout>,
    );
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/start'));
    expect(screen.queryByText('홈 내용')).toBeNull();
  });

  it('체험 모드: 사이드바 7개 · 하단 메뉴 5개(더보기) · 가계부 전환', async () => {
    nav.pathname = '/settings';
    const h = renderApp(
      <AppLayout>
        <p>설정 내용</p>
      </AppLayout>,
    );
    await startDemo(h);
    // 체험을 시작하기 전(로그인 전)에는 /start 로 보냈을 수 있어요. 그 뒤로는 보내지 않아요
    nav.router.replace.mockClear();
    expect(screen.getByText('설정 내용')).toBeTruthy();
    const [side, dock] = screen.getAllByRole('navigation', { name: '주 메뉴' }) as [HTMLElement, HTMLElement];
    expect(within(side).getAllByRole('link')).toHaveLength(7);
    const dockLinks = within(dock).getAllByRole('link');
    expect(dockLinks).toHaveLength(5);
    expect(within(dock).getByRole('link', { current: 'page' }).textContent).toContain('더보기');
    expect(nav.router.replace).not.toHaveBeenCalled();

    const trigger = screen.getByRole('button', { name: /민지·준호 가계부, 공용 가계부/ });
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: '가계부 바꾸기' });
    const radio = within(menu).getByRole('menuitemradio');
    expect(radio.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radio);
    // 체험 모드는 공유받은 가계부를 열 수 없어요
    expect(within(menu).getByRole('menuitem', { name: /공유받은 가계부 열기/ }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /새 가계부/ }));
    expect(nav.router.push).toHaveBeenCalledWith('/start/new');

    // 로그아웃 → /start
    fireEvent.click(screen.getAllByRole('button', { name: '로그아웃' })[0]!);
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/start'));
    expect(current(h).session.status).toBe('signedOut');
  });

  it('가계부 전환: 최근 가계부에서 고르면 바뀌어요', async () => {
    const h = renderApp(
      <AppLayout>
        <p>내용</p>
      </AppLayout>,
    );
    await startDemo(h);
    await act(async () => {
      await current(h).session.createLedger({ kind: 'personal', name: '내 용돈' });
    });
    await waitFor(() => expect(current(h).ledger.data?.settings.name).toBe('내 용돈'));
    fireEvent.click(screen.getByRole('button', { name: /내 용돈, 개인 가계부/ }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(2);
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /민지·준호 가계부/ }));
    await waitFor(() => expect(current(h).session.activeLedger?.id).toBe(DEMO_LEDGER_ID));
  });

  it('월말 처리: 지난달 생활비가 남았으면 저절로 묻고, 저수지로 보내면 기록해요', async () => {
    const ledgerStorage = createMemoryStorage();
    const lastMonth = createDemoLedger('2026-10-31', '2026-10-01T00:00:00.000Z');
    const leftover = livingLeftover(lastMonth, '2026-10');
    expect(leftover).toBeGreaterThan(0);
    await new LocalBackend(ledgerStorage).create(lastMonth, DEMO_LEDGER_ID);

    const h = renderApp(
      <AppLayout>
        <p>홈</p>
      </AppLayout>,
      { ledgerStorage },
    );
    await startDemo(h);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading').textContent).toContain('지난달 생활비가');
    expect(within(dialog).getByText('공용 가계부는 먼저 고른 사람의 선택이 적용돼요. 누가 골랐는지 기록에 남아요.')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: '저수지로 보내기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const data = current(h).ledger.data!;
    expect(data.monthEnds.find((m) => m.month === '2026-10')).toMatchObject({ choice: 'reservoir', decidedBy: 'minji@demo' });
    expect(data.transfers.some((t) => t.id === 'monthend:2026-10' && t.amount === leftover)).toBe(true);
    expect(await screen.findByText(/저수지로 .*원을 보냈어요/)).toBeTruthy();
  });

  it('월말 처리: 나중에 고를게요로 닫으면 이번 접속 동안은 다시 묻지 않아요', async () => {
    const ledgerStorage = createMemoryStorage();
    await new LocalBackend(ledgerStorage).create(createDemoLedger('2026-10-31', '2026-10-01T00:00:00.000Z'), DEMO_LEDGER_ID);
    const h = renderApp(
      <AppLayout>
        <p>홈</p>
      </AppLayout>,
      { ledgerStorage },
    );
    await startDemo(h);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '나중에 고를게요' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(current(h).ledger.pendingMonthEnd).not.toBeNull();
  });
});
