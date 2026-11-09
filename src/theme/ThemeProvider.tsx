'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { isThemeMode, THEME_COLORS, THEME_STORAGE_KEY, type ResolvedTheme, type ThemeMode } from './script';

export interface ThemeApi {
  /** 사용자가 고른 값 */
  mode: ThemeMode;
  /** 실제로 보이는 테마 */
  resolved: ResolvedTheme;
  setMode(mode: ThemeMode): void;
}

const ThemeContext = createContext<ThemeApi | null>(null);

const fallback: ThemeApi = { mode: 'system', resolved: 'light', setMode: () => {} };

export function useTheme(): ThemeApi {
  return useContext(ThemeContext) ?? fallback;
}

/* ── 저장된 테마 (localStorage) ── */
const CHANGE_EVENT = 'budget:theme-change';
let memoryMode: ThemeMode | null = null; // 저장이 막힌 브라우저용

function readMode(): ThemeMode {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeMode(v)) return v;
  } catch {
    /* 저장소를 못 쓰면 메모리 값 */
  }
  return memoryMode ?? 'system';
}

function subscribeMode(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === THEME_STORAGE_KEY) cb();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, cb);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, cb);
  };
}

/* ── 시스템 다크 모드 ── */
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readSystemDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

function subscribeSystem(cb: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

function resolve(mode: ThemeMode, systemDark: boolean): ResolvedTheme {
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
}

function apply(mode: ThemeMode, resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  // 브라우저 위쪽 막대 색도 맞춰요
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    if (mode === 'system') {
      const media = m.getAttribute('media') ?? '';
      m.content = media.includes('dark') ? THEME_COLORS.dark : THEME_COLORS.light;
    } else {
      m.content = THEME_COLORS[resolved];
    }
  });
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // 서버 렌더와 첫 하이드레이션은 'system' 으로 그리고, 바로 저장값으로 바꿔요
  const mode = useSyncExternalStore(subscribeMode, readMode, () => 'system' as ThemeMode);
  const systemDark = useSyncExternalStore(subscribeSystem, readSystemDark, () => false);
  const resolved = resolve(mode, systemDark);

  useEffect(() => {
    // 하이드레이션 중 렌더 값('system')이 아니라 실제 저장값으로 적용해요 (인라인 스크립트가 정한 값을 지우지 않게)
    const actual = readMode();
    apply(actual, resolve(actual, readSystemDark()));
  }, [mode, resolved]);

  const setMode = useCallback((next: ThemeMode) => {
    memoryMode = next;
    try {
      if (next === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* 저장이 막혀도 이번 화면에서는 바뀌어요 */
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const api = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);
  return <ThemeContext.Provider value={api}>{children}</ThemeContext.Provider>;
}
