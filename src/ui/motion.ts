'use client';

import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from './useMediaQuery';

/**
 * 움직임 도우미 · motion.md (웹 공통 디자인 시스템).
 * CSS 로 되는 움직임은 components.css 에 있고, 여기에는 스크립트가 필요한 것만 둬요.
 * 움직임 줄이기 설정이거나 matchMedia 가 없는 곳(서버 · 테스트)에서는 모두 최종 상태로 바로 가요.
 */

/** 토큰과 같은 값 (ms). 스크립트에서 타이머를 맞출 때 써요 */
export const MOTION_MS = { fast: 120, base: 200, slow: 320 } as const;

const NO_PREFERENCE = '(prefers-reduced-motion: no-preference)';

/** 지금 움직여도 되는지 (움직임 줄이기 꺼짐 + 브라우저) */
export function motionAllowed(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NO_PREFERENCE).matches;
}

/** motionAllowed 의 훅 버전. 설정이 바뀌면 다시 그려요 */
export function useMotionAllowed(): boolean {
  return useMediaQuery(NO_PREFERENCE);
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * 숫자가 바뀌면 이전 값에서 새 값까지 ms 동안 세어 가요 (처음 그릴 때는 바로 최종 값).
 * 움직임을 줄이면 바로 새 값이에요.
 */
export function useAnimatedNumber(value: number, ms: number = MOTION_MS.slow): number {
  const allowed = useMotionAllowed();
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const from = shownRef.current;
    if (!allowed || from === value || typeof requestAnimationFrame !== 'function') {
      shownRef.current = value;
      // 외부 값(value)에 맞추는 동기화라 effect 안에서 상태를 바꿔요
      setShown(value);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const next = t >= 1 ? value : Math.round(from + (value - from) * easeOut(t));
      shownRef.current = next;
      setShown(next);
      frame.current = t >= 1 ? null : requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [value, ms, allowed]);

  return allowed ? shown : value;
}

export type PresenceState = 'enter' | 'stay' | 'leave';

export interface PresenceItem<T> {
  key: string;
  item: T;
  /** enter: 이번에 새로 들어옴(첫 그림 제외) · stay · leave: 빠지는 중(곧 사라져요) */
  state: PresenceState;
}

/**
 * 목록 항목 추가·삭제 움직임. 새 항목은 enter, 빠진 항목은 잠시 leave 로 남겨 접히게 해요.
 * 화면에서는 presenceClass(state) 를 행에 붙이면 돼요. 움직임을 줄이면 빠진 항목은 바로 사라져요.
 */
export function usePresence<T>(items: readonly T[], getKey: (item: T) => string, leaveMs: number = MOTION_MS.fast): PresenceItem<T>[] {
  const allowed = useMotionAllowed();
  const keys = items.map(getKey);
  const sig = keys.join('\u0000');
  const [state, setState] = useState<PresenceTrack<T>>(() => ({ sig, keys, list: items, entering: new Set(), leaving: [] }));

  // 목록이 바뀐 그림에서 바로 계산해요 (props 에서 상태 끌어내기). 그리기 전에 남겨 둬서 깜빡이지 않게
  let track = state;
  if (state.sig !== sig) {
    const now = new Set(keys);
    const before = new Set(state.keys);
    const entering = allowed ? new Set(keys.filter((k) => !before.has(k))) : new Set<string>();
    const gone = allowed
      ? state.keys.flatMap((k, i) => (now.has(k) ? [] : [{ key: k, item: state.list[i]!, index: i }]))
      : [];
    const leaving = [...state.leaving.filter((l) => !now.has(l.key) && !gone.some((g) => g.key === l.key)), ...gone];
    track = { sig, keys, list: items, entering, leaving };
    setState(track);
  }

  // 빠지는 항목은 접히는 시간이 지나면 지워요
  const leavingSig = track.leaving.map((l) => l.key).join('\u0000');
  useEffect(() => {
    if (!leavingSig) return;
    const drop = new Set(leavingSig.split('\u0000'));
    const t = setTimeout(() => {
      setState((s) => ({ ...s, leaving: s.leaving.filter((l) => !drop.has(l.key)) }));
    }, leaveMs + 40);
    return () => clearTimeout(t);
  }, [leavingSig, leaveMs]);

  const result: PresenceItem<T>[] = items.map((item, i) => ({
    key: keys[i]!,
    item,
    state: track.entering.has(keys[i]!) ? 'enter' : 'stay',
  }));
  if (allowed) {
    const present = new Set(keys);
    for (const l of track.leaving) {
      if (present.has(l.key)) continue;
      result.splice(Math.min(l.index, result.length), 0, { key: l.key, item: l.item, state: 'leave' });
    }
  }
  return result;
}

interface PresenceTrack<T> {
  sig: string;
  keys: string[];
  list: readonly T[];
  entering: Set<string>;
  leaving: { key: string; item: T; index: number }[];
}

/** usePresence 상태에 맞는 클래스 */
export function presenceClass(state: PresenceState): string | undefined {
  if (state === 'enter') return 'mo-row-in';
  if (state === 'leave') return 'mo-row-out';
  return undefined;
}

/**
 * 값이 바뀐 순간에만 true 를 돌려줘요 (첫 그림 제외). 정산 완료 · 할부 냄처럼 상태가 바뀐 요소에
 * mo-settle 같은 클래스를 한 번 붙일 때 써요. 움직임을 줄이면 늘 false.
 */
export function useChanged<V>(value: V): boolean {
  const allowed = useMotionAllowed();
  const [state, setState] = useState({ value, changed: false });
  if (!Object.is(state.value, value)) setState({ value, changed: true });
  return allowed && state.changed;
}
