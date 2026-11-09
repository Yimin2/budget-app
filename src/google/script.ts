import { GoogleError } from './errors';

export const GSI_SRC = 'https://accounts.google.com/gsi/client';
export const GAPI_SRC = 'https://apis.google.com/js/api.js';

const pending = new Map<string, Promise<void>>();

/**
 * 외부 스크립트를 한 번만 불러온다. 같은 src 를 동시에 불러도 요청은 하나.
 * isReady 가 true 면 바로 끝낸다. 실패하면 다음 호출에서 다시 시도한다.
 */
export function loadScript(src: string, isReady?: () => boolean): Promise<void> {
  if (isReady?.()) return Promise.resolve();
  if (typeof document === 'undefined') {
    return Promise.reject(new GoogleError('script_failed', 'no document (SSR)'));
  }
  const existing = pending.get(src);
  if (existing) return existing;

  const p = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => {
      pending.delete(src);
      el.remove();
      reject(new GoogleError('script_failed', src));
    };
    document.head.appendChild(el);
  });
  pending.set(src, p);
  return p;
}

/** 테스트용 */
export function resetScriptCache(): void {
  pending.clear();
}
