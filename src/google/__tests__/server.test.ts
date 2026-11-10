import { describe, expect, it, vi } from 'vitest';
import { createServerAuthClient, loginUrl } from '../server';

function res(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function client(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const navigate = vi.fn();
  return { c: createServerAuthClient({ fetch: fetchMock as unknown as typeof fetch, navigate }), fetchMock, navigate };
}

describe('로그인 서버 어댑터 (브라우저)', () => {
  it('fetchToken: POST + 우리 머리글, 성공이면 토큰과 사용자', async () => {
    const { c, fetchMock } = client(res(200, { accessToken: 'ya29', expiresIn: 3599, user: { email: 'a@gmail.com', name: '가나', picture: null } }));
    expect(await c.fetchToken()).toEqual({ kind: 'ok', accessToken: 'ya29', expiresIn: 3599, user: { email: 'a@gmail.com', name: '가나', picture: null } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/token');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Budget-Auth']).toBe('1');
    expect(init.credentials).toBe('same-origin');
  });

  it('401 expired → expired, 401 그 밖 → signed_out', async () => {
    expect(await client(res(401, { error: 'expired' })).c.fetchToken()).toEqual({ kind: 'expired' });
    expect(await client(res(401, { error: 'no_session' })).c.fetchToken()).toEqual({ kind: 'signed_out' });
  });

  it('501 · 404 → unconfigured (팝업 로그인으로)', async () => {
    expect(await client(res(501, { error: 'unconfigured' })).c.fetchToken()).toEqual({ kind: 'unconfigured' });
    expect(await client(res(404)).c.fetchToken()).toEqual({ kind: 'unconfigured' });
  });

  it('502 · 연결 끊김 → GoogleError network', async () => {
    await expect(client(res(502, { error: 'upstream' })).c.fetchToken()).rejects.toMatchObject({ code: 'network' });
    await expect(client(new TypeError('Failed to fetch')).c.fetchToken()).rejects.toMatchObject({ code: 'network' });
  });

  it('status: serverLogin 을 읽고, 서버가 없으면 false', async () => {
    expect(await client(res(200, { serverLogin: true })).c.status()).toBe(true);
    expect(await client(res(200, { serverLogin: false })).c.status()).toBe(false);
    expect(await client(res(404)).c.status()).toBe(false);
  });

  it('logout: 본문에 everywhere, 실패해도 던지지 않는다', async () => {
    const { c, fetchMock } = client(res(200, { ok: true }));
    await c.logout(true);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({ everywhere: true });
    expect(init.keepalive).toBe(true);
    await expect(client(new TypeError('offline')).c.logout(false)).resolves.toBeUndefined();
  });

  it('startLogin: 전체 페이지로 /api/auth/login 에 돌아올 곳과 힌트', () => {
    const { c, navigate } = client(res(200));
    c.startLogin({ hint: 'a@gmail.com', returnTo: '/start?open=abc' });
    expect(navigate).toHaveBeenCalledWith('/api/auth/login?return=%2Fstart%3Fopen%3Dabc&hint=a%40gmail.com');
    expect(loginUrl({ returnTo: '/', consent: true })).toBe('/api/auth/login?return=%2F&consent=1');
  });
});
