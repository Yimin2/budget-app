// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGisTokenRequester, fetchUserInfo } from '../gis';
import type { TokenClientConfig } from '../types';

let config: TokenClientConfig | null = null;
const requestAccessToken = vi.fn();

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', '1-x.apps.googleusercontent.com');
  config = null;
  requestAccessToken.mockReset();
  (globalThis as Record<string, unknown>).google = {
    accounts: {
      oauth2: {
        initTokenClient: (c: TokenClientConfig) => {
          config = c;
          return { requestAccessToken };
        },
        revoke: vi.fn(),
      },
    },
  };
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete (globalThis as Record<string, unknown>).google;
});

const SCOPES = ['openid', 'https://www.googleapis.com/auth/drive.file'];

describe('GIS token requester', () => {
  it('토큰 응답을 넘기고 prompt·hint 를 전달한다', async () => {
    const r = createGisTokenRequester(SCOPES);
    const p = r.requestToken({ prompt: 'consent', hint: 'a@gmail.com' });
    await vi.waitFor(() => expect(requestAccessToken).toHaveBeenCalled());
    expect(requestAccessToken).toHaveBeenCalledWith({ prompt: 'consent', login_hint: 'a@gmail.com' });
    expect(config?.scope).toBe(SCOPES.join(' '));
    config!.callback({ access_token: 'T', expires_in: 3599, scope: SCOPES.join(' ') });
    await expect(p).resolves.toEqual({ accessToken: 'T', expiresIn: 3599 });
  });

  it('준비된 뒤에는 같은 틱에서 창을 연다', async () => {
    const r = createGisTokenRequester(SCOPES);
    await r.preload();
    void r.requestToken({ prompt: '' });
    expect(requestAccessToken).toHaveBeenCalledTimes(1);
  });

  it('팝업 차단 / 거절 / drive 권한 누락을 한국어 오류로', async () => {
    const r = createGisTokenRequester(SCOPES);
    await r.preload();
    const a = r.requestToken({ prompt: '' });
    config!.error_callback!({ type: 'popup_failed_to_open' });
    await expect(a).rejects.toMatchObject({ code: 'popup_blocked' });

    const b = r.requestToken({ prompt: '' });
    config!.callback({ error: 'access_denied' });
    await expect(b).rejects.toMatchObject({ code: 'consent_denied', message: expect.stringContaining('권한') });

    const c = r.requestToken({ prompt: '' });
    config!.callback({ access_token: 'T', expires_in: 3599, scope: 'openid email' });
    await expect(c).rejects.toMatchObject({ code: 'consent_denied' });
  });

  it('새 요청이 오면 앞 요청은 닫힘으로 끝난다', async () => {
    const r = createGisTokenRequester(SCOPES);
    await r.preload();
    const a = r.requestToken({ prompt: '' });
    const b = r.requestToken({ prompt: '' });
    await expect(a).rejects.toMatchObject({ code: 'popup_closed' });
    config!.callback({ access_token: 'B', expires_in: 10 });
    await expect(b).resolves.toEqual({ accessToken: 'B', expiresIn: 10 });
  });

  it('설정이 없으면 not_configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', '');
    const r = createGisTokenRequester(SCOPES);
    await expect(r.requestToken({ prompt: '' })).rejects.toMatchObject({ code: 'not_configured' });
  });
});

describe('fetchUserInfo', () => {
  it('Bearer 로 불러와 이름이 없으면 이메일 앞부분', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ email: 'kim@gmail.com' }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    expect(await fetchUserInfo('T')).toEqual({ email: 'kim@gmail.com', name: 'kim', picture: null });
    expect(f).toHaveBeenCalledWith(expect.stringContaining('userinfo'), {
      headers: { Authorization: 'Bearer T' },
    });
  });

  it('실패하면 network 오류', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    await expect(fetchUserInfo('T')).rejects.toMatchObject({ code: 'network' });
  });
});
