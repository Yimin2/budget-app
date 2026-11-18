import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

/**
 * 화면 흐름 확인 (체험 모드 — 구글 로그인 없이). 먼저 `npm run build` 를 해 두고 `npm run e2e` 로 돌려요.
 * 단위 · 화면 조각 테스트는 vitest (`npm test`) 가 맡아요.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'off',
    // 화면 파일 보관(서비스 워커)이 테스트 사이에 섞이지 않게
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/start`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
