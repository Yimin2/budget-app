// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell, type NavItem } from '../AppShell';
import { Dialog } from '../Dialog';
import { Money } from '../Money';
import { usePresence, presenceClass, motionAllowed, useChanged } from '../motion';
import { Tabs } from '../Tabs';
import { ToastProvider, useToast } from '../Toast';
import { VerdictCard } from '../Verdict';

/** 움직임 줄이기 설정을 흉내 내요 (reduce=true 면 움직임 끔) */
function mockMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('no-preference') ? !reduce : query.includes('reduce') ? reduce : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => mockMotion(false));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.matchMedia = originalMatchMedia;
  document.body.innerHTML = '';
});

describe('motionAllowed', () => {
  it('움직임 줄이기 설정이나 matchMedia 가 없으면 false', () => {
    expect(motionAllowed()).toBe(true);
    mockMotion(true);
    expect(motionAllowed()).toBe(false);
    // @ts-expect-error 테스트: matchMedia 가 없는 환경
    window.matchMedia = undefined;
    expect(motionAllowed()).toBe(false);
  });
});

describe('usePresence', () => {
  it('새 항목은 enter, 빠진 항목은 잠시 leave 로 남았다가 사라져요', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ items }) => usePresence(items, (x) => x), { initialProps: { items: ['a', 'b'] } });
    expect(result.current.map((p) => p.state)).toEqual(['stay', 'stay']);

    rerender({ items: ['c', 'a', 'b'] });
    expect(result.current.map((p) => `${p.key}:${p.state}`)).toEqual(['c:enter', 'a:stay', 'b:stay']);

    rerender({ items: ['c', 'b'] });
    expect(result.current.map((p) => `${p.key}:${p.state}`)).toEqual(['c:stay', 'a:leave', 'b:stay']);
    expect(presenceClass('leave')).toBe('mo-row-out');

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.map((p) => p.key)).toEqual(['c', 'b']);
  });

  it('움직임을 줄이면 enter 없이 바로 빠져요', () => {
    mockMotion(true);
    const { result, rerender } = renderHook(({ items }) => usePresence(items, (x) => x), { initialProps: { items: ['a', 'b'] } });
    rerender({ items: ['b', 'c'] });
    expect(result.current.map((p) => `${p.key}:${p.state}`)).toEqual(['b:stay', 'c:stay']);
  });
});

describe('useChanged', () => {
  it('처음에는 false, 값이 바뀌면 true (움직임을 줄이면 늘 false)', () => {
    const { result, rerender } = renderHook(({ v }) => useChanged(v), { initialProps: { v: 'pending' } });
    expect(result.current).toBe(false);
    rerender({ v: 'settled' });
    expect(result.current).toBe(true);
    mockMotion(true);
    const second = renderHook(({ v }) => useChanged(v), { initialProps: { v: 'pending' } });
    second.rerender({ v: 'settled' });
    expect(second.result.current).toBe(false);
  });
});

describe('Money animate', () => {
  it('세는 동안에도 화면 읽기에는 최종 값만, 끝나면 최종 값 하나', () => {
    let now = 0;
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const { container, rerender } = render(<Money amount={1000} animate />);
    expect(container.textContent).toBe('1,000원');

    rerender(<Money amount={2000} animate />);
    now = 100;
    act(() => frames.shift()?.(now));
    expect(container.querySelector('.sr-only')?.textContent).toBe('2,000원');
    expect(container.querySelector('[aria-hidden]')?.textContent).not.toBe('2,000원');

    now = 400;
    act(() => {
      while (frames.length) frames.shift()?.(now);
    });
    expect(container.textContent).toBe('2,000원');
    expect(container.querySelector('.sr-only')).toBeNull();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('움직임을 줄이면 바로 새 값', () => {
    mockMotion(true);
    const { container, rerender } = render(<Money amount={1000} animate />);
    rerender(<Money amount={2000} animate />);
    expect(container.textContent).toBe('2,000원');
  });
});

function DialogHarness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        열기
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="지울까요?">
        <p>본문</p>
      </Dialog>
    </>
  );
}

describe('Dialog 닫힘 움직임', () => {
  it('닫으면 누를 수 없는 사본이 is-leaving 으로 남았다가 지워져요', () => {
    vi.useFakeTimers();
    render(<DialogHarness />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    const ghost = document.querySelector('.dialog-root.is-leaving');
    expect(ghost).not.toBeNull();
    expect(ghost?.getAttribute('aria-hidden')).toBe('true');
    expect(ghost?.hasAttribute('inert')).toBe(true);
    expect(ghost?.querySelector('[id]')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(document.querySelector('.dialog-root')).toBeNull();
  });

  it('움직임을 줄이면 사본을 남기지 않아요', () => {
    mockMotion(true);
    render(<DialogHarness />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.dialog-root')).toBeNull();
  });
});

function ToastHarness() {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast.show('저장했어요')}>
      띄우기
    </button>
  );
}

describe('Toast 사라짐 움직임', () => {
  it('닫으면 is-leaving 으로 내려가며 사라진 뒤 빠져요', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '띄우기' }));
    fireEvent.click(screen.getByRole('button', { name: '알림 닫기' }));
    const leaving = document.querySelector('.toast.is-leaving');
    expect(leaving?.textContent).toContain('저장했어요');
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(document.querySelector('.toast')).toBeNull();
  });
});

describe('Tabs 밑줄', () => {
  it('밑줄 요소를 두고 선택된 탭 자리로 옮겨요', () => {
    function T() {
      const [v, setV] = useState<'a' | 'b'>('a');
      return <Tabs ariaLabel="보기" value={v} onChange={setV} items={[{ value: 'a', label: '목록' }, { value: 'b', label: '달력' }]} />;
    }
    const { container } = render(<T />);
    const list = screen.getByRole('tablist');
    expect(list.classList.contains('has-ink')).toBe(true);
    expect(container.querySelector('.tab-ink')?.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: '달력' }));
    expect(screen.getByRole('tab', { name: '달력' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('AppShell 움직임', () => {
  const nav: NavItem[] = [
    { href: '/', label: '홈', icon: 'home' },
    { href: '/check', label: '사도 돼?', icon: 'cart' },
  ];

  it('본문에 route-enter, 메뉴를 옮긴 뒤에만 하단 메뉴 아이콘이 튀어 올라요', () => {
    const { rerender } = render(
      <AppShell nav={nav} current="/">
        <p>본문</p>
      </AppShell>,
    );
    expect(screen.getByRole('main').classList.contains('route-enter')).toBe(true);
    expect(document.querySelector('.dock a.bump')).toBeNull();
    rerender(
      <AppShell nav={nav} current="/check">
        <p>본문</p>
      </AppShell>,
    );
    expect(document.querySelector('.dock a.on.bump')?.textContent).toContain('사도 돼?');
    expect(document.querySelector('.side-nav .nav-ind')).not.toBeNull();
  });
});

describe('VerdictCard', () => {
  it('신호가 바뀌면 동그라미를 새로 그려요 (다시 나타나는 움직임)', () => {
    const base = { title: '', message: '괜찮아요', details: [], when: null };
    const { container, rerender } = render(<VerdictCard verdict={{ ...base, signal: 'ok' }} />);
    const first = container.querySelector('.signal-icon');
    rerender(<VerdictCard verdict={{ ...base, message: '조금 더', signal: 'ok' }} />);
    expect(container.querySelector('.signal-icon')).toBe(first);
    rerender(<VerdictCard verdict={{ ...base, signal: 'bad' }} />);
    expect(container.querySelector('.signal-icon')).not.toBe(first);
    expect(container.querySelector('.verdict')?.classList.contains('bad')).toBe(true);
  });
});
