// @vitest-environment jsdom
/** 새로고침 (PLAN 7): 모바일 당겨서 새로고침(포인터 · 터치) · 머리 · 사이드바 새로고침 버튼 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell, type NavItem, type ShellRefresh } from '../AppShell';

afterEach(() => {
  cleanup();
  document.body.removeAttribute('data-scroll-lock');
});

const nav: NavItem[] = [
  { href: '/', label: '홈', icon: 'home' },
  { href: '/history', label: '내역', icon: 'receipt' },
];

function renderShell(refresh: Partial<ShellRefresh> = {}) {
  const onRefresh = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const r: ShellRefresh = { onRefresh, busy: false, status: '방금 맞췄어요', ...refresh };
  render(
    <AppShell nav={nav} current="/" refresh={r} profile={{ href: '/settings', name: '민지', avatar: <span>민</span> }}>
      <p>본문</p>
    </AppShell>,
  );
  return { onRefresh: r.onRefresh as typeof onRefresh, body: screen.getByText('본문') };
}

function pull(target: Element, dy: number, pointerType = 'touch') {
  fireEvent.pointerDown(target, { pointerType, clientY: 100, isPrimary: true });
  fireEvent.pointerMove(target, { pointerType, clientY: 100 + dy / 2, isPrimary: true });
  fireEvent.pointerMove(target, { pointerType, clientY: 100 + dy, isPrimary: true });
}

describe('당겨서 새로고침', () => {
  it('맨 위에서 충분히 당겼다 놓으면 새로고침하고, 그동안 44px 표시가 돌아요', async () => {
    const { onRefresh, body } = renderShell();
    pull(body, 200);
    const indicator = document.querySelector('.ptr')!;
    expect(indicator.getAttribute('data-state')).toBe('armed');
    expect(screen.getByRole('status').textContent).toBe('놓으면 새로 맞춰요');
    fireEvent.pointerUp(body, { pointerType: 'touch', clientY: 300, isPrimary: true });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(indicator.getAttribute('data-state')).toBe('refreshing');
    expect((indicator as HTMLElement).style.getPropertyValue('--ptr-y')).toBe('44px');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(indicator.getAttribute('data-state')).toBe('idle');
  });

  it('조금만 당기거나 · 취소되거나 · 마우스로 끌면 하지 않아요', () => {
    const { onRefresh, body } = renderShell();
    pull(body, 60);
    expect(document.querySelector('.ptr')!.getAttribute('data-state')).toBe('pulling');
    fireEvent.pointerUp(body, { pointerType: 'touch', clientY: 160, isPrimary: true });
    pull(body, 200);
    fireEvent.pointerCancel(body, { pointerType: 'touch', clientY: 300, isPrimary: true });
    pull(body, 200, 'mouse');
    fireEvent.pointerUp(body, { pointerType: 'mouse', clientY: 300, isPrimary: true });
    expect(onRefresh).not.toHaveBeenCalled();
    expect(document.querySelector('.ptr')!.getAttribute('data-state')).toBe('idle');
  });

  it('본문이 맨 위가 아니거나 창이 열려 있으면 시작하지 않아요', () => {
    const { onRefresh, body } = renderShell();
    document.body.setAttribute('data-scroll-lock', '');
    pull(body, 200);
    fireEvent.pointerUp(body, { pointerType: 'touch', clientY: 300, isPrimary: true });
    document.body.removeAttribute('data-scroll-lock');
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 120 });
    pull(body, 200);
    fireEvent.pointerUp(body, { pointerType: 'touch', clientY: 300, isPrimary: true });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('터치 이벤트로도 돼요', () => {
    const { onRefresh, body } = renderShell();
    fireEvent.touchStart(body, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(body, { touches: [{ clientY: 300 }] });
    fireEvent.touchEnd(body, { touches: [] });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('새로고침 버튼', () => {
  it('모바일 머리와 사이드바 아래에 마지막으로 맞춘 시각과 함께 있고, 누르면 새로고침해요', () => {
    const { onRefresh } = renderShell();
    const buttons = screen.getAllByRole('button', { name: '새로 맞추기 · 방금 맞췄어요' });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.closest('.shell-top')).not.toBeNull();
    expect(buttons[1]!.closest('.side')).not.toBeNull();
    expect(buttons[0]!.textContent).toContain('방금 맞췄어요');
    fireEvent.click(buttons[0]!);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('맞추는 중에는 다시 누르지 않아요 (aria-busy)', () => {
    const { onRefresh } = renderShell({ busy: true, status: '맞추는 중…' });
    const [btn] = screen.getAllByRole('button', { name: '새로 맞추기 · 맞추는 중…' });
    expect(btn!.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(btn!);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
