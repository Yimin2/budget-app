// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { current, fakeGoogle, renderApp } from '@/app/(app)/_components/__tests__/harness';

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => nav.router, usePathname: () => '/start' }));

import type { LedgerBackend, LedgerRef } from '@/storage/types';
import StartPage from './page';

const SHEET_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
const SHARED_REF: LedgerRef = { id: SHEET_ID, name: '민지·준호 가계부', kind: 'shared', source: 'sheets' };

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  kakaoIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.9.0',
  kakaoAndroid:
    'Mozilla/5.0 (Linux; Android 15; SM-S928N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36;KAKAOTALK 2410960',
  instagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 357.0.0.25.101 (iPhone16,1; iOS 18_1; ko_KR)',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
};

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function fakeSheets(allowed: Set<string>): LedgerBackend {
  return {
    source: 'sheets',
    create: async () => Promise.reject(new Error('unused')),
    open: (ref) => ({
      ref,
      load: () => new Promise(() => {}),
      insert: async () => {},
      upsert: async () => {},
      upsertMany: async () => {},
      updateSettings: async () => {},
    }),
    share: async () => {},
    describe: vi.fn(async (id: string) => {
      if (!allowed.has(id)) throw new HttpError('권한이 없어요', 404);
      return { ...SHARED_REF, id };
    }),
  };
}

function setEnv(userAgent: string, standalone = false) {
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(window.navigator, 'standalone', { value: standalone, configurable: true });
}

const writeText = vi.fn(async (_text: string) => {});

function setSearch(search: string) {
  window.history.replaceState({}, '', `/start${search}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
  cleanup();
  setSearch('');
  const n = window.navigator as unknown as Record<string, unknown>;
  delete n.userAgent;
  delete n.standalone;
  delete n.clipboard;
});

async function signInGoogle(opts: { allowed?: Set<string>; pickSpreadsheet?: ReturnType<typeof vi.fn> } = {}) {
  const pickSpreadsheet = opts.pickSpreadsheet ?? vi.fn(async () => null);
  const h = renderApp(<StartPage />, {
    google: fakeGoogle({ isGoogleConfigured: () => true, pickSpreadsheet }),
    sheets: fakeSheets(opts.allowed ?? new Set()),
  });
  return { h, pickSpreadsheet };
}

describe('아이폰 홈 화면 앱', () => {
  it('공유받은 가계부 열기 → 선택 창 대신 초대 링크 붙여넣기 → 바로 열려요', async () => {
    setEnv(UA.iphone, true);
    const { h, pickSpreadsheet } = await signInGoogle({ allowed: new Set([SHEET_ID]) });
    fireEvent.click(await screen.findByRole('button', { name: '구글로 시작하기' }));
    const open = await screen.findByRole('button', { name: '공유받은 가계부 열기' });
    expect(screen.getByText(/받은 초대 링크를 붙여 넣어 열어 주세요/)).toBeTruthy();
    expect(open.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(open);
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(pickSpreadsheet).not.toHaveBeenCalled();

    const input = screen.getByLabelText('초대 링크 붙여넣기');
    // 이상한 글이면 그 자리에서 알려요
    fireEvent.change(input, { target: { value: '아무 글' } });
    fireEvent.click(screen.getByRole('button', { name: '열기' }));
    expect(await screen.findByText('초대 링크나 구글 시트 주소를 확인해 주세요')).toBeTruthy();

    fireEvent.change(input, { target: { value: `가계부 같이 써요 https://budget.example/start?open=${SHEET_ID}` } });
    fireEvent.click(screen.getByRole('button', { name: '열기' }));
    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith('/'));
    expect(pickSpreadsheet).not.toHaveBeenCalled();
    expect(current(h).session.activeLedger).toEqual(SHARED_REF);
  });

  it('권한이 없으면 "Safari에서 한 번만 열어 주세요" + [Safari로 열기] (링크 복사 · x-safari-https)', async () => {
    setEnv(UA.iphone, true);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    // jsdom 은 x-safari-https:// 로 가는 주소 이동을 하지 못해 콘솔에 알려요 (실제 아이폰에서는 Safari 로 넘어가요)
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { h, pickSpreadsheet } = await signInGoogle();
    fireEvent.click(await screen.findByRole('button', { name: '구글로 시작하기' }));
    fireEvent.click(await screen.findByRole('button', { name: '공유받은 가계부 열기' }));
    fireEvent.change(screen.getByLabelText('초대 링크 붙여넣기'), { target: { value: SHEET_ID } });
    fireEvent.click(screen.getByRole('button', { name: '열기' }));

    expect(await screen.findByText('Safari에서 한 번만 열어 주세요')).toBeTruthy();
    expect(screen.getByText(/Safari에서 초대 링크를 열고 가계부를 고르면, 그다음부터 이 앱에서도 열려요/)).toBeTruthy();
    expect(current(h).session.activeLedger).toBeNull();
    expect(pickSpreadsheet).not.toHaveBeenCalled();

    try {
      fireEvent.click(screen.getByRole('button', { name: 'Safari로 열기' }));
      const link = `${window.location.origin}/start?open=${SHEET_ID}`;
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(link));
      expect(await screen.findByText('링크를 복사했어요. Safari에 붙여넣어 주세요')).toBeTruthy();
      // Safari 로 넘어가지 않았으면 (화면이 그대로) window.open 으로 다시
      await waitFor(() => expect(openSpy).toHaveBeenCalledWith(link, '_blank', 'noopener'), { timeout: 2000 });
    } finally {
      openSpy.mockRestore();
      quiet.mockRestore();
    }
  });

  it('?open= 링크로 들어와도 선택 창 없이 바로 열어 보고, 안 되면 Safari 안내', async () => {
    setEnv(UA.iphone, true);
    setSearch(`?open=${SHEET_ID}`);
    const { pickSpreadsheet } = await signInGoogle();
    fireEvent.click(await screen.findByRole('button', { name: '구글로 로그인하고 열기' }));
    expect(await screen.findByText('Safari에서 한 번만 열어 주세요')).toBeTruthy();
    expect(pickSpreadsheet).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '다른 가계부 고르기' })).toBeTruthy();
  });

  it('?open= 링크: 이미 고른 적 있으면 바로 홈으로', async () => {
    setEnv(UA.iphone, true);
    setSearch(`?open=${SHEET_ID}`);
    const { h, pickSpreadsheet } = await signInGoogle({ allowed: new Set([SHEET_ID]) });
    fireEvent.click(await screen.findByRole('button', { name: '구글로 로그인하고 열기' }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/'));
    expect(pickSpreadsheet).not.toHaveBeenCalled();
    expect(current(h).session.activeLedger?.id).toBe(SHEET_ID);
  });
});

describe('앱 안 브라우저', () => {
  it('카카오톡 (아이폰): 로그인 전에 안내 + 카카오톡에서 Safari 로 여는 링크, 로그인 버튼은 그대로', async () => {
    setEnv(UA.kakaoIos);
    await signInGoogle();
    const google = (await screen.findByRole('button', { name: '구글로 시작하기' })) as HTMLButtonElement;
    expect(google.disabled).toBe(false);
    expect(screen.getByText('카카오톡 같은 앱 안에서는 구글 로그인이 막혀요. Chrome이나 Safari로 열어 주세요')).toBeTruthy();
    expect(screen.getByText(/오른쪽 아래 ··· → Safari로 열기/)).toBeTruthy();
    const safari = screen.getByRole('link', { name: 'Safari로 열기' });
    expect(safari.getAttribute('href')).toBe(`kakaotalk://web/openExternal?url=${encodeURIComponent(window.location.href)}`);
    expect(screen.queryByRole('link', { name: 'Chrome으로 열기' })).toBeNull();
  });

  it('카카오톡 (안드로이드): Chrome 으로 여는 intent 링크', async () => {
    setEnv(UA.kakaoAndroid);
    await signInGoogle();
    await screen.findByRole('button', { name: '구글로 시작하기' });
    const u = new URL(window.location.href);
    const chrome = screen.getByRole('link', { name: 'Chrome으로 열기' });
    expect(chrome.getAttribute('href')).toBe(`intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.slice(0, -1)};package=com.android.chrome;end`);
    expect(screen.queryByRole('link', { name: 'Safari로 열기' })).toBeNull();
  });

  it('인스타그램 (아이폰): 링크 복사 + 방법 안내', async () => {
    setEnv(UA.instagram);
    await signInGoogle();
    await screen.findByRole('button', { name: '구글로 시작하기' });
    expect(screen.getByText(/··· 메뉴 → Safari로 열기/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Safari로 열기' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '링크 복사' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
    expect(await screen.findByText('링크를 복사했어요. Safari에 붙여넣어 주세요')).toBeTruthy();
  });

  it('복사가 안 되면 주소를 그 자리에 보여 줘요', async () => {
    setEnv(UA.instagram);
    writeText.mockRejectedValueOnce(new Error('denied'));
    await signInGoogle();
    await screen.findByRole('button', { name: '구글로 시작하기' });
    fireEvent.click(screen.getByRole('button', { name: '링크 복사' }));
    const field = (await screen.findByLabelText('이 주소를 길게 눌러 복사해 주세요')) as HTMLInputElement;
    expect(field.value).toBe(window.location.href);
  });

  it('초대 링크(로그인함): 바로 열리지 않으면 안내 + [그래도 파일 선택 창 열기]', async () => {
    setEnv(UA.kakaoAndroid);
    setSearch(`?open=${SHEET_ID}`);
    const pickSpreadsheet = vi.fn(async () => null);
    await signInGoogle({ pickSpreadsheet });
    expect(screen.getAllByText('카카오톡 같은 앱 안에서는 구글 로그인이 막혀요. Chrome이나 Safari로 열어 주세요')).toHaveLength(1);
    fireEvent.click(await screen.findByRole('button', { name: '구글로 로그인하고 열기' }));
    expect(await screen.findByRole('button', { name: '그래도 파일 선택 창 열기' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Chrome으로 열기' }).getAttribute('href')).toContain(`/start?open=${SHEET_ID}#Intent;`);
    expect(pickSpreadsheet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '그래도 파일 선택 창 열기' }));
    await waitFor(() => expect(pickSpreadsheet).toHaveBeenCalledWith({ fileId: SHEET_ID }));
  });
});

describe('안드로이드 Chrome', () => {
  it('안내 없이 그대로 (공유받은 가계부 열기 = 구글 파일 선택 창)', async () => {
    setEnv(UA.androidChrome, false);
    const { pickSpreadsheet } = await signInGoogle();
    fireEvent.click(await screen.findByRole('button', { name: '구글로 시작하기' }));
    fireEvent.click(await screen.findByRole('button', { name: '공유받은 가계부 열기' }));
    await waitFor(() => expect(pickSpreadsheet).toHaveBeenCalled());
    expect(screen.queryByTestId('in-app-notice')).toBeNull();
    expect(screen.queryByLabelText('초대 링크 붙여넣기')).toBeNull();
  });
});
