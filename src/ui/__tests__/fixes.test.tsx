// @vitest-environment jsdom
/** 검증된 결함 회귀 테스트 (UI 키트) */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../AppShell';
import { Field, MoneyInput } from '../Field';
import { ToastProvider, useToast } from '../Toast';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('sidebar links have names even when the label is hidden', () => {
  it('aria-label on every side-nav link', () => {
    render(
      <AppShell nav={[{ href: '/', label: '홈', icon: 'home' }, { href: '/check', label: '사도 돼?', icon: 'cart' }]} current="/">
        <p>본문</p>
      </AppShell>,
    );
    const side = document.querySelector('.side-nav')!;
    expect(Array.from(side.querySelectorAll('a')).map((a) => a.getAttribute('aria-label'))).toEqual(['홈', '사도 돼?']);
  });
});

describe('MoneyInput allowNegative', () => {
  function Harness({ onValue }: { onValue: (v: number | null) => void }) {
    const [v, setV] = useState<number | null>(null);
    return (
      <Field label="실제 잔액">
        <MoneyInput
          value={v}
          allowNegative
          onChange={(x) => {
            setV(x);
            onValue(x);
          }}
        />
      </Field>
    );
  }
  it('keeps a leading minus and the toggle flips the sign', () => {
    const values: (number | null)[] = [];
    render(<Harness onValue={(x) => values.push(x)} />);
    const input = screen.getByLabelText('실제 잔액') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-300000' } });
    expect(input.value).toBe('-300,000');
    expect(values.at(-1)).toBe(-300_000);
    fireEvent.click(screen.getByRole('button', { name: '마이너스' }));
    expect(values.at(-1)).toBe(300_000);
    expect(input.value).toBe('300,000');
  });
  it('without allowNegative the minus is ignored', () => {
    const onChange = vi.fn();
    render(
      <Field label="금액">
        <MoneyInput value={null} onChange={onChange} />
      </Field>,
    );
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '-500' } });
    expect(onChange).toHaveBeenLastCalledWith(500);
    expect(screen.queryByRole('button', { name: '마이너스' })).toBeNull();
  });
});

describe('undo toast', () => {
  function Trigger() {
    const toast = useToast();
    return (
      <>
        <button type="button" onClick={() => toast.success('기록했어요', { action: { label: '되돌리기', onClick: () => {} } })}>
          보이기
        </button>
        <button type="button" onClick={() => toast.dismissActions()}>
          닫기
        </button>
      </>
    );
  }
  it('stays while hovered or focused, and lasts 10s by default', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '보이기' }));
    const toastEl = document.querySelector('.toast')!;
    act(() => {
      vi.advanceTimersByTime(9_000);
    });
    expect(screen.getByRole('button', { name: '되돌리기' })).toBeTruthy();
    fireEvent.pointerEnter(toastEl);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole('button', { name: '되돌리기' })).toBeTruthy();
    fireEvent.pointerLeave(toastEl);
    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull();
  });
  it('dismissActions closes undo toasts (ledger switch)', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '보이기' }));
    expect(screen.getByRole('button', { name: '되돌리기' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull();
  });
});
