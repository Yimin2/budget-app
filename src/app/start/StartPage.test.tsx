// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { current, fakeGoogle, renderApp } from '@/app/(app)/_components/__tests__/harness';

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => nav.router, usePathname: () => '/start' }));

import StartPage from './page';

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe('/start', () => {
  it('로그인 전: 앱 약속 · 구글 설정이 없으면 버튼을 막고 이유를 보여 줘요 · 체험해 보기 → 홈', async () => {
    const h = renderApp(<StartPage />);
    expect(await screen.findByRole('heading', { level: 1, name: '사기 전에 써도 되는지 알려주는 가계부' })).toBeTruthy();
    const google = screen.getByRole('button', { name: '구글로 시작하기' }) as HTMLButtonElement;
    expect(google.disabled).toBe(true);
    expect(google.getAttribute('aria-describedby')).toBe('sp-google-off');
    expect(screen.getByText(/구글 로그인이 아직 설정되지 않았어요/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '체험해 보기' }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/'));
    expect(current(h).session.mode).toBe('demo');
  });

  it('구글 로그인 뒤 고른 가계부가 없으면 가계부 고르기를 보여 줘요', async () => {
    const pickSpreadsheet = vi.fn(async () => null);
    const h = renderApp(<StartPage />, { google: fakeGoogle({ isGoogleConfigured: () => true, pickSpreadsheet }) });
    const google = (await screen.findByRole('button', { name: '구글로 시작하기' })) as HTMLButtonElement;
    expect(google.disabled).toBe(false);
    fireEvent.click(google);
    expect(await screen.findByRole('heading', { level: 1, name: '어떤 가계부를 열까요?' })).toBeTruthy();
    expect(current(h).session.status).toBe('signedIn');
    expect(nav.router.replace).not.toHaveBeenCalledWith('/');
    expect(screen.getByText('아직 연 가계부가 없어요')).toBeTruthy();
    expect(screen.getByRole('link', { name: '새 가계부 만들기' }).getAttribute('href')).toBe('/start/new');

    fireEvent.click(screen.getByRole('button', { name: '공유받은 가계부 열기' }));
    await waitFor(() => expect(pickSpreadsheet).toHaveBeenCalled());
    // 고르지 않고 닫으면 그대로
    expect(screen.getByRole('heading', { level: 1, name: '어떤 가계부를 열까요?' })).toBeTruthy();
  });

  it('로그인했으면 최근 가계부를 열거나 목록에서 뺄 수 있어요', async () => {
    const h = renderApp(<StartPage />);
    fireEvent.click(await screen.findByRole('button', { name: '체험해 보기' }));
    await waitFor(() => expect(current(h).session.status).toBe('signedIn'));
    const list = screen.getByRole('heading', { level: 2, name: '최근 가계부' }).closest('.card') as HTMLElement;
    expect(within(list).getByText('지금 가계부')).toBeTruthy();
    expect((screen.getByRole('button', { name: '공유받은 가계부 열기' }) as HTMLButtonElement).disabled).toBe(true);

    nav.router.push.mockClear();
    fireEvent.click(within(list).getByRole('button', { name: '민지·준호 가계부, 공용 가계부, 이 브라우저, 지금 가계부' }));
    expect(nav.router.push).toHaveBeenCalledWith('/');

    fireEvent.click(within(list).getByRole('button', { name: '민지·준호 가계부 목록에서 빼기' }));
    await waitFor(() => expect(current(h).session.recentLedgers).toHaveLength(0));
    expect(current(h).session.activeLedger).toBeNull();
    expect(screen.getByText('아직 연 가계부가 없어요')).toBeTruthy();
  });
});
