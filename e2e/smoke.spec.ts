import { expect, test, type Page } from '@playwright/test';

/** 체험 모드로 들어가요 (이 브라우저에만 저장되는 예시 가계부) */
async function startDemo(page: Page) {
  await page.goto('/start');
  await page.getByRole('button', { name: '체험해 보기' }).click();
  await expect(page.getByText('오늘 내가 써도 되는 돈')).toBeVisible();
}

const SCREENS: { path: string; heading: string }[] = [
  { path: '/history', heading: '내역' },
  { path: '/history?tab=accounts', heading: '내역' },
  { path: '/history/stats', heading: '내역' },
  { path: '/plan', heading: '이벤트' },
  { path: '/plan/trips', heading: '여행' },
  { path: '/plan/usual', heading: '한 번뿐이었던 큰 지출 빼기' },
  { path: '/budget', heading: '예산' },
  { path: '/settings', heading: '설정' },
];

test('체험 모드로 시작하면 홈이 열려요', async ({ page }) => {
  await startDemo(page);
  await expect(page).toHaveURL(/\/$/);
});

test('모든 화면이 오류 없이 열리고 옆으로 넘치지 않아요', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startDemo(page);
  for (const { path, heading } of SCREENS) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading }), path).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} 가로 넘침`).toBeLessThanOrEqual(0);
  }
  expect(errors).toEqual([]);
});

test('자주 쓰는 지출: 누르면 금액 팝업이 뜨고, 기록하면 되돌릴 수 있어요', async ({ page }) => {
  await startDemo(page);
  const today = page.getByRole('region', { name: '오늘 내가 써도 되는 돈' });
  const before = await today.innerText();
  const chip = page.getByRole('region', { name: '자주 쓰는 지출' }).getByRole('button', { name: /원 기록하기$/ }).first();
  const label = (await chip.getAttribute('aria-label'))!.replace(' 기록하기', '');
  await chip.click();
  const form = page.getByRole('dialog', { name: `${label.replace(/ [\d,]+원$/, '')} 기록` });
  await expect(form.getByLabel('금액')).toBeVisible();
  await form.getByRole('button', { name: '기록하기' }).click();
  await expect(page.getByText(`${label} 기록했어요`)).toBeVisible();
  await expect.poll(() => today.innerText()).not.toBe(before);
  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(page.getByText('기록을 되돌렸어요')).toBeVisible();
  await expect.poll(() => today.innerText()).toBe(before);
});

test('[+] 를 누르면 바로 지출 기록이 열리고, 위쪽 탭으로 이체로 바꿔요', async ({ page }) => {
  await startDemo(page);
  await page.getByRole('button', { name: '기록', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: '지출 기록' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: '이체' }).click();
  await expect(page.getByRole('dialog', { name: '이체 기록' })).toBeVisible();
});

test('없는 주소는 안내 화면을 보여 줘요', async ({ page }) => {
  const res = await page.goto('/no-such-page');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: '이 주소에는 화면이 없어요' })).toBeVisible();
  await page.getByRole('link', { name: '홈으로' }).click();
  await expect(page).toHaveURL(/\/start$/);
});

test('보안 머리글이 붙어 있어요', async ({ request }) => {
  const res = await request.get('/start');
  expect(res.headers()['x-frame-options']).toBe('DENY');
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
});
