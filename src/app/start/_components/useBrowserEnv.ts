'use client';

import { useSyncExternalStore } from 'react';
import { NORMAL_ENV, detectBrowserEnv, type BrowserEnv } from '@/state';

const STANDALONE_QUERY = '(display-mode: standalone)';

let cache: { key: string; env: BrowserEnv } | null = null;

function readEnv(): BrowserEnv {
  if (typeof navigator === 'undefined') return NORMAL_ENV;
  const nav = navigator as Navigator & { standalone?: boolean };
  const userAgent = nav.userAgent ?? '';
  const navigatorStandalone = nav.standalone === true;
  const displayModeStandalone =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(STANDALONE_QUERY).matches;
  const maxTouchPoints = nav.maxTouchPoints ?? 0;
  const key = `${userAgent}|${navigatorStandalone}|${displayModeStandalone}|${maxTouchPoints}`;
  // 같은 값이면 같은 객체 (useSyncExternalStore 가 다시 그리지 않게)
  if (cache?.key !== key) cache = { key, env: detectBrowserEnv({ userAgent, navigatorStandalone, displayModeStandalone, maxTouchPoints }) };
  return cache.env;
}

const noSubscribe = () => () => {};
const serverEnv = () => NORMAL_ENV;

/** 지금 환경 (아이폰 홈 화면 앱 · 앱 안 브라우저 · 보통). 서버 렌더에서는 보통 */
export function useBrowserEnv(): BrowserEnv {
  return useSyncExternalStore(noSubscribe, readEnv, serverEnv);
}
