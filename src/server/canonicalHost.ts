/**
 * 실서비스(Production) 배포를 다른 주소로 열면 실서비스 주소로 옮기기.
 *
 * Vercel Production 배포는 budget-app-mocha-pi.vercel.app 말고도
 * budget-app-<팀>.vercel.app · budget-app-git-main-<팀>.vercel.app 같은 별칭으로도 열려요.
 * 구글 OAuth 원본 · API 키 웹사이트 제한은 실서비스 주소만 허용하므로, 다른 주소로 열면
 * 로그인 · 선택 창이 막혀요. 그래서 같은 경로 · 같은 쿼리로 실서비스 주소에 308로 보냅니다.
 *
 * - 미리보기(VERCEL_ENV !== 'production') · 로컬(localhost, VERCEL_ENV 없음)은 옮기지 않아요
 * - 실서비스 주소 자체는 옮기지 않아요 → /api/auth/callback 등 로그인 흐름은 그대로
 * - 실서비스 주소는 `SITE_HOST` 로 바꿀 수 있어요 (기본 budget-app-mocha-pi.vercel.app)
 *
 * next.config.ts 의 redirects() 가 이 파일을 불러 쓰므로, 상대 경로 import 만 쓰고 외부 의존이 없어야 해요.
 */

export const DEFAULT_SITE_HOST = 'budget-app-mocha-pi.vercel.app';

export interface CanonicalHostEnv {
  /** Vercel 이 넣는 배포 종류: 'production' | 'preview' | 'development' (로컬은 없음) */
  VERCEL_ENV?: string;
  /** 실서비스 주소(호스트). 비우면 DEFAULT_SITE_HOST */
  SITE_HOST?: string;
}

/** 'https://Example.com/' · 'example.com:443' 같은 값도 'example.com' 으로 맞춰요 */
export function normalizeHost(value: string | undefined | null): string {
  if (!value) return '';
  let host = value.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  host = host.split('/', 1)[0] ?? '';
  host = host.split(':', 1)[0] ?? '';
  return host;
}

/** 실서비스 주소. SITE_HOST 가 비었거나 이상하면 기본값 */
export function siteHost(env: CanonicalHostEnv): string {
  return normalizeHost(env.SITE_HOST) || DEFAULT_SITE_HOST;
}

/**
 * 로컬 주소 정규식. Next 는 포트를 뗀 Host 에 `^값$` 로 맞춰 보므로 통째로 괄호로 묶어요
 * (안 묶으면 `^a|b$` 가 되어 앞뒤 고정이 풀려요)
 */
const LOCAL_HOST_PATTERN = '(?:(?:.+\\.)?localhost|127\\.0\\.0\\.1)';

function isLocalHost(host: string): boolean {
  return new RegExp(`^${LOCAL_HOST_PATTERN}$`).test(host);
}

/**
 * 옮길 주소를 돌려줘요. 옮기지 않으면 null.
 * @param host 요청의 Host 머리글 (포트가 붙어 있어도 됨)
 * @param pathAndQuery '/history?month=2026-11' 처럼 경로 + 쿼리
 */
export function canonicalRedirectTarget(
  input: { host: string | undefined | null; pathAndQuery: string },
  env: CanonicalHostEnv,
): string | null {
  if (env.VERCEL_ENV !== 'production') return null;
  const host = normalizeHost(input.host);
  if (!host || isLocalHost(host)) return null;
  const canonical = siteHost(env);
  if (host === canonical) return null;
  const path = input.pathAndQuery.startsWith('/') ? input.pathAndQuery : `/${input.pathAndQuery}`;
  return `https://${canonical}${path}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * next.config.ts redirects() 에 넣을 항목. canonicalRedirectTarget 과 같은 규칙을
 * Next.js · Vercel 라우팅 규칙으로 옮긴 것이에요 (함수 실행 없이 엣지에서 처리).
 * - Production 빌드에서만 항목이 생겨요 → 미리보기 · 로컬은 빈 배열
 * - Host 가 실서비스 주소도 로컬도 아닐 때만 맞아요 (`missing` host, 값은 ^…$ 정규식이라 점을 이스케이프)
 * - Next 는 Host 의 포트를 떼고 소문자로 비교하고, 쿼리는 저절로 그대로 넘겨요
 * - permanent: true → 308 (POST 도 방법 · 본문 그대로)
 */
export function canonicalHostRedirects(env: CanonicalHostEnv) {
  if (env.VERCEL_ENV !== 'production') return [];
  const canonical = siteHost(env);
  return [
    {
      source: '/:path*',
      missing: [
        { type: 'host' as const, value: escapeRegExp(canonical) },
        // 로컬에서 Production 빌드를 띄워도 옮기지 않게 (isLocalHost 와 같은 목록)
        { type: 'host' as const, value: LOCAL_HOST_PATTERN },
      ],
      destination: `https://${canonical}/:path*`,
      permanent: true,
    },
  ];
}
