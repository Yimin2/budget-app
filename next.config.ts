import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * 예전 주소도 계속 열리게 (메뉴를 홈 · 내역 · 예산 · 계획으로 바꾸기 전 주소).
   * 주소 뒤 ?month= · ?account= · ?id= 같은 값은 그대로 넘어가요
   */
  async redirects() {
    return [
      { source: '/expenses', destination: '/history', permanent: false },
      { source: '/accounts', destination: '/history?tab=accounts', permanent: false },
      { source: '/events', destination: '/plan', permanent: false },
      { source: '/events/trips', destination: '/plan/trips', permanent: false },
      { source: '/members', destination: '/settings#members', permanent: false },
    ];
  },
};

export default nextConfig;
