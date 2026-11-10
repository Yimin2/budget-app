'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';
import { MOTION_MS, motionAllowed } from './motion';

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface ToastOptions {
  tone?: ToastTone;
  /** 예: { label: '되돌리기', onClick } */
  action?: { label: string; onClick: () => void };
  /** ms. 기본 4000, 동작 버튼이 있으면 10000. 0 이면 직접 닫을 때까지. 마우스를 올리거나 포커스가 있으면 멈춰요 */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  message: ReactNode;
  /** 사라지는 중 (200ms 동안 내려가며 옅어진 뒤 빠져요) */
  leaving?: boolean;
}

export interface ToastApi {
  /** 알림을 띄우고 id 를 돌려줘요 */
  show(message: ReactNode, options?: ToastOptions): number;
  success(message: ReactNode, options?: Omit<ToastOptions, 'tone'>): number;
  error(message: ReactNode, options?: Omit<ToastOptions, 'tone'>): number;
  dismiss(id: number): void;
  /** 동작 버튼(되돌리기 등)이 있는 알림을 모두 닫아요 — 가계부를 바꾸면 이전 가계부의 되돌리기를 누를 수 없게 */
  dismissActions(): void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_ICON: Record<Exclude<ToastTone, 'neutral'>, IconName> = {
  success: 'check-circle',
  warning: 'alert-triangle',
  danger: 'alert-circle',
  info: 'info',
};

const noop: ToastApi = { show: () => -1, success: () => -1, error: () => -1, dismiss: () => {}, dismissActions: () => {} };

interface TimerState {
  handle: ReturnType<typeof setTimeout> | null;
  remaining: number;
  startedAt: number;
}

/** 화면 아래 알림. ToastProvider 안에서 쓰세요 (layout 에 이미 있어요) */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? noop;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, TimerState>());
  /** 마우스가 올라가 있거나 포커스가 안에 있는 알림 (시간이 흐르지 않아요) */
  const held = useRef(new Map<number, { hover: boolean; focus: boolean }>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t?.handle) clearTimeout(t.handle);
    timers.current.delete(id);
    held.current.delete(id);
    if (!motionAllowed()) {
      setItems((list) => list.filter((x) => x.id !== id));
      return;
    }
    setItems((list) => list.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setItems((list) => list.filter((x) => x.id !== id)), MOTION_MS.base + 40);
  }, []);

  const run = useCallback(
    (id: number, ms: number) => {
      timers.current.set(id, { handle: setTimeout(() => dismiss(id), ms), remaining: ms, startedAt: Date.now() });
    },
    [dismiss],
  );

  const pause = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (!t || t.handle === null) return;
    clearTimeout(t.handle);
    t.handle = null;
    t.remaining = Math.max(0, t.remaining - (Date.now() - t.startedAt));
  }, []);

  const resume = useCallback(
    (id: number) => {
      const t = timers.current.get(id);
      const h = held.current.get(id);
      if (!t || t.handle !== null || (h && (h.hover || h.focus))) return;
      // 손을 뗀 뒤 읽을 시간을 조금 더 줘요
      run(id, Math.max(2000, t.remaining));
    },
    [run],
  );

  const hold = useCallback(
    (id: number, kind: 'hover' | 'focus', on: boolean) => {
      const h = held.current.get(id) ?? { hover: false, focus: false };
      h[kind] = on;
      held.current.set(id, h);
      if (on) pause(id);
      else resume(id);
    },
    [pause, resume],
  );

  const show = useCallback(
    (message: ReactNode, options: ToastOptions = {}) => {
      const id = nextId.current++;
      const duration = options.duration ?? (options.action ? 10000 : 4000);
      setItems((list) => [...list.filter((x) => !x.leaving).slice(-2), { id, message, ...options }]);
      if (duration > 0) run(id, duration);
      return id;
    },
    [run],
  );

  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const dismissActions = useCallback(() => {
    for (const t of itemsRef.current) if (t.action && !t.leaving) dismiss(t.id);
  }, [dismiss]);

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => t.handle && clearTimeout(t.handle));
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m, o) => show(m, { ...o, tone: 'success' }),
      error: (m, o) => show(m, { ...o, tone: 'danger' }),
      dismiss,
      dismissActions,
    }),
    [show, dismiss, dismissActions],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" role="status" aria-live="polite" aria-relevant="additions">
        {items.map((t) => {
          const tone = t.tone ?? 'neutral';
          return (
            <div
              key={t.id}
              className={cx('toast', tone !== 'neutral' && tone, t.leaving && 'is-leaving')}
              aria-hidden={t.leaving || undefined}
              onPointerEnter={() => hold(t.id, 'hover', true)}
              onPointerLeave={() => hold(t.id, 'hover', false)}
              onFocus={() => hold(t.id, 'focus', true)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hold(t.id, 'focus', false);
              }}
            >
              {tone !== 'neutral' ? <Icon name={TONE_ICON[tone]} size={20} className="ic" /> : null}
              <span className="txt">{t.message}</span>
              {t.action ? (
                <button
                  type="button"
                  className="toastbtn"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              ) : null}
              <button type="button" className="toastclose" aria-label="알림 닫기" onClick={() => dismiss(t.id)}>
                <Icon name="x" size={20} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
