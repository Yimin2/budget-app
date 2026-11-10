'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';
import { useMotionAllowed } from './motion';

/** 놓으면 새로고침하는 당긴 거리 (px, 손가락 이동의 절반) */
export const PULL_THRESHOLD = 64;
const PULL_MAX = 96;
/** 표시 동그라미 크기 */
export const PULL_INDICATOR = 44;

type PullState = 'idle' | 'pulling' | 'armed' | 'refreshing';

function scrollTop(): number {
  if (typeof document === 'undefined') return 0;
  const el = document.scrollingElement ?? document.documentElement;
  return Math.max(el?.scrollTop ?? 0, typeof window !== 'undefined' ? window.scrollY || 0 : 0);
}

/**
 * 모바일: 본문 맨 위에서 아래로 당겼다 놓으면 새로고침 (의존성 없이 터치 · 포인터 이벤트).
 * 본문(문서)이 맨 위일 때만, 창이 열려 있지 않을 때만 시작해요. 터치 이벤트가 오면 그 뒤로는 터치만 써요
 * (브라우저가 스크롤을 시작하면 포인터 이벤트는 끊기기 때문).
 */
export function usePullToRefresh(
  areaRef: RefObject<HTMLElement | null>,
  onRefresh: (() => unknown) | null,
  enabled: boolean,
): { distance: number; state: PullState } {
  const [distance, setDistance] = useState(0);
  const [state, setState] = useState<PullState>('idle');
  const track = useRef<{ startY: number; dist: number } | null>(null);
  const touchMode = useRef(false);
  const busy = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  });

  const run = useCallback(() => {
    const fn = onRefreshRef.current;
    if (!fn) return;
    busy.current = true;
    setState('refreshing');
    setDistance(PULL_INDICATOR);
    let p: Promise<unknown>;
    try {
      p = Promise.resolve(fn());
    } catch {
      p = Promise.resolve();
    }
    void p
      .catch(() => {})
      .finally(() => {
        busy.current = false;
        setState('idle');
        setDistance(0);
      });
  }, []);

  useEffect(() => {
    if (!enabled || !onRefresh || typeof document === 'undefined') return;
    const start = (y: number, target: EventTarget | null) => {
      if (busy.current || scrollTop() > 0) return;
      if (document.body.hasAttribute('data-scroll-lock')) return;
      const area = areaRef.current;
      if (!area || !(target instanceof Node) || !area.contains(target)) return;
      track.current = { startY: y, dist: 0 };
    };
    const move = (y: number, e: Event) => {
      const t = track.current;
      if (!t) return;
      const dy = y - t.startY;
      if (dy <= 0 || scrollTop() > 0) {
        if (t.dist !== 0) {
          t.dist = 0;
          setDistance(0);
          setState('idle');
        }
        return;
      }
      t.dist = Math.min(PULL_MAX, dy / 2);
      setDistance(t.dist);
      setState(t.dist >= PULL_THRESHOLD ? 'armed' : 'pulling');
      // 브라우저 자체 당겨서 새로고침 · 튕김 대신 우리 표시를 써요
      if (e.cancelable) e.preventDefault();
    };
    const end = (cancel: boolean) => {
      const t = track.current;
      track.current = null;
      if (!t) return;
      if (!cancel && t.dist >= PULL_THRESHOLD) {
        run();
        return;
      }
      setDistance(0);
      setState('idle');
    };

    const onTouchStart = (e: TouchEvent) => {
      touchMode.current = true;
      const touch = e.touches[0];
      if (touch && e.touches.length === 1) start(touch.clientY, e.target);
    };
    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) move(touch.clientY, e);
    };
    const onTouchEnd = () => end(false);
    const onTouchCancel = () => end(true);
    const usable = (e: PointerEvent) => !touchMode.current && e.pointerType !== 'mouse' && e.isPrimary !== false;
    const onPointerDown = (e: PointerEvent) => {
      if (usable(e)) start(e.clientY, e.target);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (usable(e)) move(e.clientY, e);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (usable(e)) end(false);
    };
    const onPointerCancel = (e: PointerEvent) => {
      if (usable(e)) end(true);
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('touchcancel', onTouchCancel);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
    return () => {
      track.current = null;
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchCancel);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [enabled, onRefresh, areaRef, run]);

  return { distance, state };
}

const STATE_TEXT: Record<PullState, string> = {
  idle: '',
  pulling: '당겨서 새로 맞추기',
  armed: '놓으면 새로 맞춰요',
  refreshing: '맞추는 중…',
};

/** 당겨서 새로고침 표시 (44px 동그라미). 움직임 줄이기에서는 돌지 않고 제자리에 나타나요 */
export function PullIndicator({ distance, state, busy }: { distance: number; state: PullState; busy?: boolean }) {
  const motion = useMotionAllowed();
  const spinning = state === 'refreshing' || (busy && state !== 'idle');
  const shown = state !== 'idle';
  const progress = Math.min(1, distance / PULL_THRESHOLD);
  const style = {
    '--ptr-y': `${shown ? Math.round(distance) : 0}px`,
    '--ptr-o': shown ? (motion ? progress : 1) : 0,
  } as CSSProperties;
  return (
    <div className={cx('ptr', shown && 'on', state === 'armed' && 'armed', !motion && 'still')} style={style} data-state={state}>
      <span className="ptr-dot" aria-hidden>
        <Icon
          name="refresh"
          size={20}
          className={cx(spinning && 'rf-spin')}
          style={motion && !spinning ? { transform: `rotate(${Math.round(progress * 270)}deg)` } : undefined}
        />
      </span>
      <span className="sr-only" role="status">
        {STATE_TEXT[state]}
      </span>
    </div>
  );
}
