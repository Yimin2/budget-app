import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SITE_HOST,
  canonicalHostRedirects,
  canonicalRedirectTarget,
  normalizeHost,
} from '../canonicalHost';

const prod = { VERCEL_ENV: 'production' };

describe('canonicalRedirectTarget', () => {
  it('Production 별칭은 실서비스 주소로 옮겨요 (경로 · 쿼리 그대로)', () => {
    expect(
      canonicalRedirectTarget(
        { host: 'budget-app-yimin-s-projects1.vercel.app', pathAndQuery: '/history?month=2026-11&tab=accounts' },
        prod,
      ),
    ).toBe('https://budget-app-mocha-pi.vercel.app/history?month=2026-11&tab=accounts');
    expect(
      canonicalRedirectTarget({ host: 'budget-app-git-main-yimin-s-projects1.vercel.app', pathAndQuery: '/' }, prod),
    ).toBe('https://budget-app-mocha-pi.vercel.app/');
    expect(
      canonicalRedirectTarget({ host: 'budget-app-git-main-yimin-s-projects1.vercel.app', pathAndQuery: '/start?open=abc' }, prod),
    ).toBe('https://budget-app-mocha-pi.vercel.app/start?open=abc');
  });

  it('미리보기 배포는 옮기지 않아요', () => {
    expect(
      canonicalRedirectTarget(
        { host: 'budget-app-git-feature-yimin-s-projects1.vercel.app', pathAndQuery: '/' },
        { VERCEL_ENV: 'preview' },
      ),
    ).toBeNull();
    expect(canonicalRedirectTarget({ host: 'budget-app-abc123.vercel.app', pathAndQuery: '/' }, {})).toBeNull();
  });

  it('localhost 는 옮기지 않아요 (Production 빌드여도)', () => {
    expect(canonicalRedirectTarget({ host: 'localhost:3000', pathAndQuery: '/' }, {})).toBeNull();
    expect(canonicalRedirectTarget({ host: 'localhost:3000', pathAndQuery: '/' }, prod)).toBeNull();
    expect(canonicalRedirectTarget({ host: '127.0.0.1:3000', pathAndQuery: '/' }, prod)).toBeNull();
  });

  it('실서비스 주소 자체는 옮기지 않아요 (로그인 콜백 포함)', () => {
    expect(canonicalRedirectTarget({ host: DEFAULT_SITE_HOST, pathAndQuery: '/' }, prod)).toBeNull();
    expect(
      canonicalRedirectTarget({ host: 'Budget-App-Mocha-Pi.vercel.app:443', pathAndQuery: '/api/auth/callback?code=x&state=y' }, prod),
    ).toBeNull();
  });

  it('SITE_HOST 로 실서비스 주소를 바꿀 수 있어요', () => {
    const env = { VERCEL_ENV: 'production', SITE_HOST: 'https://budget.example.com/' };
    expect(canonicalRedirectTarget({ host: 'budget.example.com', pathAndQuery: '/' }, env)).toBeNull();
    expect(canonicalRedirectTarget({ host: DEFAULT_SITE_HOST, pathAndQuery: '/plan?id=1' }, env)).toBe(
      'https://budget.example.com/plan?id=1',
    );
  });

  it('Host 가 없으면 옮기지 않아요', () => {
    expect(canonicalRedirectTarget({ host: undefined, pathAndQuery: '/' }, prod)).toBeNull();
  });
});

describe('normalizeHost', () => {
  it('스킴 · 경로 · 포트를 떼고 소문자로', () => {
    expect(normalizeHost(' HTTPS://Example.com:8443/path ')).toBe('example.com');
    expect(normalizeHost('')).toBe('');
  });
});

describe('canonicalHostRedirects (next.config redirects 항목)', () => {
  it('미리보기 · 로컬 빌드에서는 항목이 없어요', () => {
    expect(canonicalHostRedirects({ VERCEL_ENV: 'preview' })).toEqual([]);
    expect(canonicalHostRedirects({ VERCEL_ENV: 'development' })).toEqual([]);
    expect(canonicalHostRedirects({})).toEqual([]);
  });

  it('Production 빌드는 실서비스 주소 · 로컬이 아닌 Host 만 308 로 옮겨요', () => {
    const [rule, ...rest] = canonicalHostRedirects(prod);
    expect(rest).toEqual([]);
    expect(rule).toMatchObject({
      source: '/:path*',
      destination: 'https://budget-app-mocha-pi.vercel.app/:path*',
      permanent: true,
    });

    // Next 는 missing host 값을 `^값$` 정규식으로, 포트를 뗀 Host 에 맞춰 봐요 (모두 안 맞아야 옮김)
    const redirects = (host: string) =>
      rule!.missing.every((item) => !new RegExp(`^${item.value}$`).test(host));
    expect(redirects('budget-app-mocha-pi.vercel.app')).toBe(false);
    expect(redirects('budget-app-mocha-pixvercel.app')).toBe(true); // 점은 이스케이프됨 → 옮김
    expect(redirects('budget-app-yimin-s-projects1.vercel.app')).toBe(true);
    expect(redirects('budget-app-git-main-yimin-s-projects1.vercel.app')).toBe(true);
    expect(redirects('localhost')).toBe(false);
    expect(redirects('app.localhost')).toBe(false);
    expect(redirects('127.0.0.1')).toBe(false);
    expect(redirects('evil-localhost.example.com')).toBe(true);
  });
});
