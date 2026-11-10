// @vitest-environment jsdom
/** 앱 틀의 새로고침 (PLAN 7): 마지막으로 맞춘 시각 글 · 버튼을 누르면 다시 읽기 · 시각 글 */
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncedAgo, syncStatus } from '../syncLabel';
import { current, renderApp, startDemo } from './harness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
}));

import AppLayout from '../../layout';

afterEach(cleanup);

describe('맞춘 시각 글', () => {
  const now = new Date(2026, 10, 20, 10, 0, 0);
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  it('방금 · N분 전 · N시간 전 · 날짜', () => {
    expect(syncedAgo(null, now)).toBe('');
    expect(syncedAgo(ago(20_000), now)).toBe('방금 맞췄어요');
    expect(syncedAgo(ago(5 * 60_000), now)).toBe('5분 전에 맞췄어요');
    expect(syncedAgo(ago(3 * 3_600_000), now)).toBe('3시간 전에 맞췄어요');
    expect(syncedAgo(new Date(2026, 10, 9, 8).toISOString(), now)).toBe('11월 9일에 맞췄어요');
  });
  it('읽는 중이면 "맞추는 중…"', () => {
    expect(syncStatus({ syncing: true, syncedAt: ago(0), fromCache: false, offline: false }, now)).toBe('맞추는 중…');
    expect(syncStatus({ syncing: false, syncedAt: ago(0), fromCache: false, offline: false }, now)).toBe('방금 맞췄어요');
  });
});

describe('앱 틀 새로고침 버튼', () => {
  it('가계부가 열리면 머리 · 사이드바에 "방금 맞췄어요", 누르면 다시 읽고 시각이 바뀌어요', async () => {
    const h = renderApp(
      <AppLayout>
        <p>홈 내용</p>
      </AppLayout>,
    );
    await startDemo(h);
    const buttons = await screen.findAllByRole('button', { name: '새로 맞추기 · 방금 맞췄어요' });
    expect(buttons).toHaveLength(2);
    const before = current(h).ledger.sync.syncedAt;
    h.clock.now = new Date(h.clock.now.getTime() + 5 * 60_000);
    await act(async () => {
      fireEvent.click(buttons[0]!);
    });
    await waitFor(() => expect(current(h).ledger.sync.syncedAt).not.toBe(before));
    expect(current(h).ledger.sync.syncedAt).toBe(h.clock.now.toISOString());
    expect(screen.getAllByRole('button', { name: '새로 맞추기 · 방금 맞췄어요' })).toHaveLength(2);
  });
});
