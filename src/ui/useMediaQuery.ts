'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** 미디어 쿼리가 맞는지 (서버 · matchMedia 가 없는 환경에서는 false) */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  );
}

/** 펼친 사이드바(데스크톱 두 칸 배치) 기준 */
export const WIDE_QUERY = '(min-width: 1280px)';
