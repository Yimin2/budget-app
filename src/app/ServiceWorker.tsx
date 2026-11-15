'use client';

import { useEffect } from 'react';

/** 서비스 워커 등록 (실서비스 빌드에서만). 인터넷이 끊겨도 앱 화면이 열리게 해요 — public/sw.js */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // 등록하지 못해도 앱은 그대로 써요 (사생활 보호 모드 등)
    });
  }, []);
  return null;
}
