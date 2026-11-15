/*
 * 서비스 워커 — 인터넷이 끊겨도 앱이 열리게 화면 파일을 보관해요.
 * 가계부 데이터는 여기서 다루지 않아요 (구글 시트 요청 · /api/ 는 그대로 지나가요).
 *
 * - /_next/static/ (이름에 해시가 든 파일): 보관한 것을 먼저
 * - 그 밖의 같은 사이트 GET (화면 · 아이콘): 인터넷 먼저, 안 되면 보관한 것
 */
const VERSION = 'v1';
const STATIC = `budget-static-${VERSION}`;
const PAGES = `budget-pages-${VERSION}`;
const STATIC_LIMIT = 200;
const PAGES_LIMIT = 60;

/** 설치할 때 미리 받아 두는 화면 (한 번도 안 연 화면도 인터넷 없이 열리게) */
const PRECACHE = ['/', '/start', '/history', '/history/stats', '/plan', '/plan/settle', '/plan/trips', '/budget', '/settings', '/check'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGES);
      // 하나가 실패해도 나머지는 받아 둬요
      await Promise.allSettled(
        PRECACHE.map(async (path) => {
          const res = await fetch(path, { credentials: 'same-origin' });
          if (res.ok && !res.redirected) await cache.put(path, res);
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith('budget-') && n !== STATIC && n !== PAGES).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  // 오래된 것부터 지워요 (배포가 바뀌면 예전 파일이 쌓여요)
  await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map((k) => cache.delete(k)));
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    void trim(STATIC, STATIC_LIMIT);
  }
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic' && !res.redirected) {
      await cache.put(request, res.clone());
      void trim(PAGES, PAGES_LIMIT);
    }
    return res;
  } catch (e) {
    const hit = await cache.match(request);
    if (hit) return hit;
    // ?month= 같은 값이 붙은 주소는 값 없이 보관한 같은 화면으로 열어요 (값은 앱이 주소에서 읽어요)
    if (request.mode === 'navigate') {
      const page = await cache.match(new URL(request.url).pathname);
      if (page) return page;
    }
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(networkFirst(request));
});
