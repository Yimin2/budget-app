import type { NextConfig } from 'next';
import { canonicalHostRedirects } from './src/server/canonicalHost';

/**
 * 모든 응답에 붙이는 보안 머리글.
 * - 다른 사이트가 이 앱을 iframe 에 넣지 못하게 (클릭 가로채기 막기)
 * - 구글 로그인 창(팝업)과 통신해야 해서 Cross-Origin-Opener-Policy 는 두지 않아요
 */
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
  /**
   * 예전 주소도 계속 열리게 (메뉴를 홈 · 내역 · 예산 · 계획으로 바꾸기 전 주소).
   * 주소 뒤 ?month= · ?account= · ?id= 같은 값은 그대로 넘어가요
   */
  async redirects() {
    return [
      // Production 배포를 다른 주소(별칭)로 열면 실서비스 주소로 308 (미리보기 · 로컬은 없음)
      ...canonicalHostRedirects({ VERCEL_ENV: process.env.VERCEL_ENV, SITE_HOST: process.env.SITE_HOST }),
      { source: '/expenses', destination: '/history', permanent: false },
      { source: '/accounts', destination: '/history?tab=accounts', permanent: false },
      { source: '/events', destination: '/plan', permanent: false },
      { source: '/events/trips', destination: '/plan/trips', permanent: false },
      // 정산은 이벤트 화면의 달별 내역으로 합쳤어요 (2026-11)
      { source: '/plan/settle', destination: '/plan#paid', permanent: false },
      { source: '/members', destination: '/settings#members', permanent: false },
    ];
  },
};

export default nextConfig;
