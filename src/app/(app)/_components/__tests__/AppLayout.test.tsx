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

  it('체험 모드: 메뉴 4개(홈 · 내역 · 예산 · 이벤트) + 가운데 + 기록 · 내 정보 버튼 → 설정 · 가계부 전환', async () => {
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
    expect(within(side).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/', '/history', '/budget', '/plan']);
    // 하단 메뉴: 홈 · 내역 · [+] · 예산 · 이벤트
    expect(within(dock).getAllByRole('link').map((a) => a.textContent)).toEqual(['홈', '내역', '예산', '이벤트']);
    const plus = within(dock).getByRole('button', { name: '기록' });
    expect(plus.previousElementSibling?.textContent).toBe('내역');
    expect(plus.nextElementSibling?.textContent).toBe('예산');
    // 설정은 메뉴가 아니라 내 정보 버튼 (모바일 머리 · 사이드바 아래)
    expect(within(dock).queryByRole('link', { current: 'page' })).toBeNull();
    const profiles = screen.getAllByRole('link', { name: '내 정보와 설정' });
    expect(profiles).toHaveLength(2);
    for (const p of profiles) {
      expect(p.getAttribute('href')).toBe('/settings');
      expect(p.getAttribute('aria-current')).toBe('page');
    }
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
  });

  it('+ 기록: 지출 기록 · 사도 돼? · 이체 기록 중에서 골라요', async () => {
    nav.pathname = '/history';
    const h = renderApp(
      <AppLayout>
        <p>내역 내용</p>
      </AppLayout>,
    );
    await startDemo(h);
    const [dockPlus, sidePlus] = [
      within(screen.getAllByRole('navigation', { name: '주 메뉴' })[1]!).getByRole('button', { name: '기록' }),
      document.querySelector('.side-create') as HTMLElement,
    ];
    expect(sidePlus.getAttribute('aria-label')).toBe('기록');
    expect(dockPlus.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(dockPlus);
    let sheet = screen.getByRole('dialog', { name: '무엇을 기록할까요?' });
    expect(dockPlus.getAttribute('aria-expanded')).toBe('true');
    expect(within(sheet).getAllByRole('button').map((b) => b.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('지출 기록'), expect.stringContaining('사도 돼?'), expect.stringContaining('이체 기록')]),
    );

    // 지출 기록 → 지출 기록 창
    fireEvent.click(within(sheet).getByRole('button', { name: /지출 기록/ }));
    expect(screen.queryByRole('dialog', { name: '무엇을 기록할까요?' })).toBeNull();
    expect(screen.getByRole('dialog', { name: '지출 기록' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '지출 기록' })).toBeNull());

    // 이체 기록 → 이체 기록 창
    fireEvent.click(sidePlus);
    sheet = screen.getByRole('dialog', { name: '무엇을 기록할까요?' });
    fireEvent.click(within(sheet).getByRole('button', { name: /이체 기록/ }));
    expect(screen.getByRole('dialog', { name: '이체 기록' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '이체 기록' })).toBeNull());

    // 사도 돼? → /check
    fireEvent.click(dockPlus);
    fireEvent.click(within(screen.getByRole('dialog', { name: '무엇을 기록할까요?' })).getByRole('button', { name: /사도 돼\?/ }));
    expect(nav.router.push).toHaveBeenCalledWith('/check');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(current(h).session.status).toBe('signedIn');
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
    // 항목별 남은 돈 (넘긴 항목은 '넘음')
    const items = within(dialog).getByRole('list', { name: '항목별 남은 돈' });
    const rows = within(items).getAllByRole('listitem');
    expect(rows.length).toBe(current(h).ledger.pendingMonthEnd!.items.length);
    expect(rows[0]!.textContent).toContain('식비');

    fireEvent.click(within(dialog).getByRole('button', { name: '저수지로 보내기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const data = current(h).ledger.data!;
    expect(data.monthEnds.find((m) => m.month === '2026-10')).toMatchObject({ choice: 'reservoir', decidedBy: 'minji@demo' });
    expect(data.transfers.some((t) => t.id === 'monthend:2026-10' && t.amount === leftover)).toBe(true);
    expect(await screen.findByText(/저수지로 .*원을 보냈어요/)).toBeTruthy();
  });

  it('월말 처리: 이월하면 항목마다 같은 항목의 이번 달 예산에 더해요', async () => {
    const ledgerStorage = createMemoryStorage();
    const lastMonth = createDemoLedger('2026-10-31', '2026-10-01T00:00:00.000Z');
    await new LocalBackend(ledgerStorage).create(lastMonth, DEMO_LEDGER_ID);
    const h = renderApp(
      <AppLayout>
        <p>홈</p>
      </AppLayout>,
      { ledgerStorage },
    );
    await startDemo(h);
    const dialog = await screen.findByRole('dialog');
    const pending = current(h).ledger.pendingMonthEnd!;
    fireEvent.click(within(dialog).getByRole('button', { name: '이번 달 생활비로 넘기기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const row = current(h).ledger.data!.monthEnds.find((m) => m.month === '2026-10')!;
    expect(row.choice).toBe('carryover');
    expect(row.items).toEqual(pending.items.map((i) => ({ categoryId: i.categoryId, leftover: i.leftover })));
    const food = pending.items.find((i) => i.name === '식비')!;
    expect(current(h).ledger.living!.items.find((i) => i.name === '식비')!.carryIn).toBe(food.leftover);
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
