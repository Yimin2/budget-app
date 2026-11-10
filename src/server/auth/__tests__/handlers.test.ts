import { describe, expect, it, vi } from 'vitest';
import { decodeSecret, pkceChallenge, seal } from '../crypto';
import { GOOGLE_REVOKE_URL, GOOGLE_TOKEN_URL, DRIVE_FILE_SCOPE, verifyIdToken } from '../google';
import {
  checkSameOrigin,
  handleCallback,
  handleLogin,
  handleLogout,
  handleStatus,
  handleToken,
  safeReturnPath,
  validateFlow,
  type AuthDeps,
  type FlowCookie,
  type SessionCookie,
} from '../handlers';

const ORIGIN = 'https://budget.example.app';
const CLIENT_ID = '123-abc.apps.googleusercontent.com';
const SECRET_B64 = Buffer.alloc(32, 3).toString('base64');
const cookieSecret = decodeSecret(SECRET_B64)!;
const ENV = { NEXT_PUBLIC_GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 'shh', AUTH_COOKIE_SECRET: SECRET_B64 };
const T0 = 1_800_000_000_000;

function b64url(v: unknown): string {
  return Buffer.from(JSON.stringify(v)).toString('base64url');
}

function idToken(claims: Record<string, unknown> = {}): string {
  const base = {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: 'sub-1',
    email: 'a@gmail.com',
    email_verified: true,
    name: '가나',
    picture: 'https://lh3.googleusercontent.com/p',
    iat: Math.floor(T0 / 1000),
    exp: Math.floor(T0 / 1000) + 3600,
  };
  return `${b64url({ alg: 'RS256' })}.${b64url({ ...base, ...claims })}.sig`;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function makeDeps(over: Partial<AuthDeps> = {}, fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>) {
  let now = T0;
  const fetchMock = vi.fn(fetchImpl ?? (async () => jsonResponse(500, {})));
  const deps: AuthDeps = { env: ENV, fetch: fetchMock as unknown as typeof fetch, now: () => now, ...over };
  return { deps, fetchMock, advance: (ms: number) => void (now += ms) };
}

function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

function cookieValue(res: Response, name: string): string | null {
  const c = setCookies(res).find((x) => x.startsWith(`${name}=`));
  return c ? c.slice(name.length + 1).split(';')[0]! : null;
}

async function sessionCookieHeader(s: Partial<SessionCookie> = {}): Promise<string> {
  const value: SessionCookie = { rt: '1//refresh', sub: 'sub-1', email: 'a@gmail.com', name: '가나', picture: null, t: T0, ...s };
  return `__Host-budget_session=${await seal(value, cookieSecret, 'session')}`;
}

function post(path: string, headers: Record<string, string> = {}, body?: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'x-budget-auth': '1', origin: ORIGIN, 'sec-fetch-site': 'same-origin', ...headers },
    body,
  });
}

/* ---------- status ---------- */

describe('GET /api/auth/status', () => {
  it('환경 변수가 모두 있으면 serverLogin: true', async () => {
    const res = handleStatus(new Request(`${ORIGIN}/api/auth/status`), makeDeps().deps);
    expect(await res.json()).toEqual({ serverLogin: true });
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it.each(['NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'AUTH_COOKIE_SECRET'])('%s 가 없으면 false', async (key) => {
    const env = { ...ENV, [key]: '' };
    const res = handleStatus(new Request(`${ORIGIN}/api/auth/status`), makeDeps({ env }).deps);
    expect(await res.json()).toEqual({ serverLogin: false });
  });

  it('쿠키 키가 32바이트보다 짧으면 false', async () => {
    const env = { ...ENV, AUTH_COOKIE_SECRET: Buffer.alloc(16).toString('base64') };
    expect(await handleStatus(new Request(`${ORIGIN}/api/auth/status`), makeDeps({ env }).deps).json()).toEqual({ serverLogin: false });
  });
});

/* ---------- login ---------- */

async function startLogin(deps: AuthDeps, query = '', cookie?: string) {
  const res = await handleLogin(new Request(`${ORIGIN}/api/auth/login${query}`, { headers: cookie ? { cookie } : {} }), deps);
  const location = new URL(res.headers.get('location')!);
  return { res, location, params: location.searchParams, flowCookie: cookieValue(res, '__Host-budget_oauth') };
}

describe('GET /api/auth/login', () => {
  it('구글로 보낸다: offline · PKCE S256 · state · nonce · 같은 권한 · 처음이면 동의 창', async () => {
    const { deps } = makeDeps();
    const { res, location, params, flowCookie } = await startLogin(deps, '?return=%2Fstart%3Fopen%3Dabc&hint=a%40gmail.com');
    expect(res.status).toBe(303);
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(params.get('client_id')).toBe(CLIENT_ID);
    expect(params.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback`);
    expect(params.get('response_type')).toBe('code');
    expect(params.get('access_type')).toBe('offline');
    expect(params.get('include_granted_scopes')).toBe('true');
    expect(params.get('scope')).toBe(`openid email profile ${DRIVE_FILE_SCOPE}`);
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get('nonce')).toBeTruthy();
    expect(params.get('login_hint')).toBe('a@gmail.com');
    expect(params.get('prompt')).toBe('consent');
    expect(params.has('client_secret')).toBe(false);

    const raw = setCookies(res).find((c) => c.startsWith('__Host-budget_oauth='))!;
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('Secure');
    expect(raw).toContain('SameSite=Lax');
    expect(raw).toContain('Path=/');
    expect(raw).toContain('Max-Age=600');
    expect(flowCookie).toMatch(/^v1\./);
  });

  it('갱신 토큰 쿠키가 이미 있으면 동의 창을 띄우지 않고 그 계정을 힌트로', async () => {
    const { deps } = makeDeps();
    const { params } = await startLogin(deps, '', await sessionCookieHeader());
    expect(params.has('prompt')).toBe(false);
    expect(params.get('login_hint')).toBe('a@gmail.com');
  });

  it('consent=1 이면 쿠키가 있어도 동의 창', async () => {
    const { deps } = makeDeps();
    const { params } = await startLogin(deps, '?consent=1', await sessionCookieHeader());
    expect(params.get('prompt')).toBe('consent');
  });

  it('http://localhost 에서는 __Host- 없이 Secure 도 빼요', async () => {
    const { deps } = makeDeps();
    const res = await handleLogin(new Request('http://localhost:3000/api/auth/login'), deps);
    const raw = setCookies(res)[0]!;
    expect(raw.startsWith('budget_oauth=')).toBe(true);
    expect(raw).not.toContain('Secure');
    expect(new URL(res.headers.get('location')!).searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/callback');
  });

  it('설정이 없으면 시작 화면으로 돌려보내요', async () => {
    const { deps } = makeDeps({ env: {} });
    const res = await handleLogin(new Request(`${ORIGIN}/api/auth/login`), deps);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/start?auth_error=unconfigured`);
  });
});

describe('safeReturnPath', () => {
  it.each([
    ['/start?open=abc', '/start?open=abc'],
    ['/', '/'],
    ['/history?tab=accounts&auth=1', '/history?tab=accounts'],
    ['//evil.com/x', '/start'],
    ['/\\evil.com', '/start'],
    ['https://evil.com', '/start'],
    ['javascript:alert(1)', '/start'],
    ['/api/auth/logout', '/start'],
    ['', '/start'],
    [null, '/start'],
  ])('%s → %s', (input, out) => {
    expect(safeReturnPath(input)).toBe(out);
  });
});

/* ---------- callback ---------- */

async function loginThenCallback(opts: {
  tokenBody?: Record<string, unknown> | ((nonce: string) => Record<string, unknown>);
  tokenStatus?: number;
  state?: (real: string) => string | null;
  advanceMs?: number;
  extraCookie?: string;
  loginCookie?: string;
  loginQuery?: string;
  callbackQuery?: string;
} = {}) {
  let nonce = '';
  const { deps, fetchMock, advance } = makeDeps({}, async (url) => {
    if (url === GOOGLE_TOKEN_URL) {
      const body = typeof opts.tokenBody === 'function' ? opts.tokenBody(nonce) : opts.tokenBody;
      return jsonResponse(opts.tokenStatus ?? 200, body ?? {
        access_token: 'ya29.access',
        expires_in: 3599,
        refresh_token: '1//new-refresh',
        scope: `openid ${DRIVE_FILE_SCOPE} https://www.googleapis.com/auth/userinfo.email`,
        id_token: idToken({ nonce }),
      });
    }
    return jsonResponse(404, {});
  });
  const login = await startLogin(deps, opts.loginQuery ?? '?return=%2Fstart%3Fopen%3Dabc', opts.loginCookie);
  nonce = login.params.get('nonce')!;
  if (opts.advanceMs) advance(opts.advanceMs);
  const realState = login.params.get('state')!;
  const state = opts.state ? opts.state(realState) : realState;
  const q = new URLSearchParams(opts.callbackQuery ?? 'code=4/auth-code');
  if (state !== null) q.set('state', state);
  const cookies = [login.flowCookie ? `__Host-budget_oauth=${login.flowCookie}` : '', opts.extraCookie ?? ''].filter(Boolean).join('; ');
  const res = await handleCallback(new Request(`${ORIGIN}/api/auth/callback?${q.toString()}`, { headers: cookies ? { cookie: cookies } : {} }), deps);
  return { res, fetchMock, login, deps };
}

describe('GET /api/auth/callback', () => {
  it('성공: 코드 교환(PKCE) → id_token 확인 → 암호화한 갱신 토큰 쿠키 → 돌아갈 곳으로', async () => {
    const { res, fetchMock, login } = await loginThenCallback();
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/start?open=abc&auth=1`);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(GOOGLE_TOKEN_URL);
    const form = new URLSearchParams(String(init!.body));
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('4/auth-code');
    expect(form.get('client_secret')).toBe('shh');
    expect(form.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback`);
    expect(await pkceChallenge(form.get('code_verifier')!)).toBe(login.params.get('code_challenge'));

    const session = setCookies(res).find((c) => c.startsWith('__Host-budget_session='))!;
    expect(session).toContain('HttpOnly');
    expect(session).toContain('Secure');
    expect(session).toContain('SameSite=Lax');
    expect(session).not.toContain('1//new-refresh');
    // 흐름 쿠키는 지운다
    expect(setCookies(res).find((c) => c.startsWith('__Host-budget_oauth='))).toContain('Max-Age=0');
  });

  it('state 가 다르면 교환하지 않고 거절', async () => {
    const { res, fetchMock } = await loginThenCallback({ state: (s) => s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A') });
    expect(res.headers.get('location')).toBe(`${ORIGIN}/start?open=abc&auth_error=state`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('state 가 없으면 거절', async () => {
    const { res, fetchMock } = await loginThenCallback({ state: () => null });
    expect(res.headers.get('location')).toContain('auth_error=state');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('흐름 쿠키가 10분 넘게 지났으면 거절', async () => {
    const { res, fetchMock } = await loginThenCallback({ advanceMs: 11 * 60_000 });
    expect(res.headers.get('location')).toContain('auth_error=state');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('흐름 쿠키가 없으면 거절 (다른 브라우저에서 연 콜백)', async () => {
    const { deps, fetchMock } = makeDeps();
    const res = await handleCallback(new Request(`${ORIGIN}/api/auth/callback?code=x&state=y`), deps);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/start?auth_error=state`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('구글에서 거절(access_denied) → consent_denied', async () => {
    const { res } = await loginThenCallback({ callbackQuery: 'error=access_denied' });
    expect(res.headers.get('location')).toContain('auth_error=consent_denied');
  });

  it('drive.file 을 체크하지 않았으면 consent_denied', async () => {
    const { res } = await loginThenCallback({
      tokenBody: (nonce) => ({ access_token: 'a', refresh_token: 'r', scope: 'openid email', id_token: idToken({ nonce }) }),
    });
    expect(res.headers.get('location')).toContain('auth_error=consent_denied');
    expect(cookieValue(res, '__Host-budget_session')).toBeNull();
  });

  it.each([
    ['aud', { aud: 'someone-else' }],
    ['iss', { iss: 'https://evil.example' }],
    ['exp', { exp: Math.floor(T0 / 1000) - 3600 }],
    ['email_verified', { email_verified: false }],
    ['nonce', { nonce: 'wrong' }],
  ])('id_token %s 가 틀리면 실패', async (_name, bad) => {
    const { res } = await loginThenCallback({
      tokenBody: (nonce) => ({ access_token: 'a', refresh_token: 'r', scope: DRIVE_FILE_SCOPE, id_token: idToken({ nonce, ...bad }) }),
    });
    expect(res.headers.get('location')).toContain('auth_error=failed');
    expect(cookieValue(res, '__Host-budget_session')).toBeNull();
  });

  it('코드 교환이 실패하면 failed', async () => {
    const { res } = await loginThenCallback({ tokenStatus: 400, tokenBody: { error: 'invalid_grant' } });
    expect(res.headers.get('location')).toContain('auth_error=failed');
  });

  it('갱신 토큰이 안 왔고 같은 계정 쿠키도 없으면 동의 창으로 한 번 더', async () => {
    const cookie = await sessionCookieHeader();
    const { res, login } = await loginThenCallback({
      loginQuery: '?return=%2F',
      loginCookie: cookie, // 쿠키가 있어 동의 창 없이 갔는데 다른 계정을 골랐다
      extraCookie: cookie,
      tokenBody: (nonce) => ({ access_token: 'a', scope: DRIVE_FILE_SCOPE, id_token: idToken({ nonce, sub: 'other-sub', email: 'b@gmail.com' }) }),
    });
    expect(login.params.has('prompt')).toBe(false);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/api/auth/login');
    expect(loc.searchParams.get('consent')).toBe('1');
    expect(loc.searchParams.get('hint')).toBe('b@gmail.com');
    expect(loc.searchParams.get('return')).toBe('/');
  });

  it('동의 창을 띄웠는데도 갱신 토큰이 안 오면 실패 (다시 돌지 않는다)', async () => {
    const { res } = await loginThenCallback({
      tokenBody: (nonce) => ({ access_token: 'a', scope: DRIVE_FILE_SCOPE, id_token: idToken({ nonce }) }),
    });
    expect(res.headers.get('location')).toContain('auth_error=failed');
  });

  it('갱신 토큰이 안 왔어도 같은 계정 쿠키가 있으면 그 토큰을 그대로', async () => {
    const cookie = await sessionCookieHeader();
    const { res } = await loginThenCallback({
      loginQuery: '?return=%2F',
      loginCookie: cookie,
      extraCookie: cookie,
      tokenBody: (nonce) => ({ access_token: 'a', scope: DRIVE_FILE_SCOPE, id_token: idToken({ nonce }) }),
    });
    expect(res.headers.get('location')).toBe(`${ORIGIN}/?auth=1`);
    expect(cookieValue(res, '__Host-budget_session')).toMatch(/^v1\./);
  });
});

describe('validateFlow', () => {
  const flow: FlowCookie = { s: 'state-abc', v: 'v', n: 'n', r: '/', c: true, t: T0 };
  it('맞으면 null', () => expect(validateFlow(flow, 'state-abc', T0 + 1000)).toBeNull());
  it('다르면 state_mismatch', () => expect(validateFlow(flow, 'state-abd', T0)).toBe('state_mismatch'));
  it('없으면 flow_missing', () => expect(validateFlow(null, 'state-abc', T0)).toBe('flow_missing'));
  it('오래되면 flow_expired', () => expect(validateFlow(flow, 'state-abc', T0 + 601_000)).toBe('flow_expired'));
});

describe('verifyIdToken', () => {
  it('클레임을 꺼낸다', () => {
    expect(verifyIdToken(idToken(), { clientId: CLIENT_ID, nowMs: T0 })).toEqual({
      sub: 'sub-1',
      email: 'a@gmail.com',
      name: '가나',
      picture: 'https://lh3.googleusercontent.com/p',
    });
  });
  it('email_verified 가 문자열 "true" 여도 받는다', () => {
    expect(verifyIdToken(idToken({ email_verified: 'true' }), { clientId: CLIENT_ID, nowMs: T0 }).email).toBe('a@gmail.com');
  });
  it('sub 가 바뀌면 거절', () => {
    expect(() => verifyIdToken(idToken(), { clientId: CLIENT_ID, nowMs: T0, expectedSub: 'x' })).toThrow();
  });
});

/* ---------- token ---------- */

describe('POST /api/auth/token', () => {
  function refreshFetch(status: number, body: unknown) {
    return async (url: string) => (url === GOOGLE_TOKEN_URL ? jsonResponse(status, body) : jsonResponse(404, {}));
  }

  it('성공: 갱신 토큰으로 새 액세스 토큰 + 사용자, 쿠키 연장, 캐시 금지', async () => {
    const { deps, fetchMock } = makeDeps({}, refreshFetch(200, { access_token: 'ya29.new', expires_in: 3599, scope: DRIVE_FILE_SCOPE, id_token: idToken({ name: '새 이름' }) }));
    const res = await handleToken(post('/api/auth/token', { cookie: await sessionCookieHeader() }), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      accessToken: 'ya29.new',
      expiresIn: 3599,
      user: { email: 'a@gmail.com', name: '새 이름', picture: 'https://lh3.googleusercontent.com/p' },
    });
    expect(res.headers.get('cache-control')).toContain('no-store');
    const form = new URLSearchParams(String(fetchMock.mock.calls[0]![1]!.body));
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('1//refresh');
    expect(form.get('client_secret')).toBe('shh');
    expect(setCookies(res).find((c) => c.startsWith('__Host-budget_session='))).toContain(`Max-Age=${180 * 86400}`);
  });

  it('invalid_grant (테스트 앱 7일 만료 등) → 401 expired + 쿠키 지움', async () => {
    const { deps } = makeDeps({}, refreshFetch(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }));
    const res = await handleToken(post('/api/auth/token', { cookie: await sessionCookieHeader() }), deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'expired', message: '로그인이 만료됐어요. 다시 로그인해 주세요' });
    const cleared = setCookies(res).find((c) => c.startsWith('__Host-budget_session='))!;
    expect(cleared).toContain('Max-Age=0');
    expect(cleared.split(';')[0]).toBe('__Host-budget_session=');
  });

  it('구글이 잠깐 안 되면 502, 쿠키는 그대로', async () => {
    const { deps } = makeDeps({}, refreshFetch(503, { error: 'backendError' }));
    const res = await handleToken(post('/api/auth/token', { cookie: await sessionCookieHeader() }), deps);
    expect(res.status).toBe(502);
    expect(setCookies(res)).toEqual([]);
  });

  it('환경 변수가 없으면 501 (브라우저는 팝업 로그인으로)', async () => {
    const { deps, fetchMock } = makeDeps({ env: { NEXT_PUBLIC_GOOGLE_CLIENT_ID: CLIENT_ID } });
    const res = await handleToken(post('/api/auth/token', { cookie: await sessionCookieHeader() }), deps);
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: 'unconfigured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('쿠키가 없으면 401 no_session', async () => {
    const { deps, fetchMock } = makeDeps();
    const res = await handleToken(post('/api/auth/token'), deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'no_session' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('고친 쿠키는 401 + 지움', async () => {
    const { deps, fetchMock } = makeDeps();
    const good = await sessionCookieHeader();
    const res = await handleToken(post('/api/auth/token', { cookie: good.slice(0, -3) + 'AAA' }), deps);
    expect(res.status).toBe(401);
    expect(setCookies(res)[0]).toContain('Max-Age=0');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['우리 머리글 없음', { 'x-budget-auth': '' }],
    ['다른 사이트 Origin', { origin: 'https://evil.example' }],
    ['Sec-Fetch-Site: cross-site', { 'sec-fetch-site': 'cross-site' }],
  ])('CSRF: %s → 403', async (_name, headers) => {
    const { deps, fetchMock } = makeDeps();
    const res = await handleToken(post('/api/auth/token', { cookie: await sessionCookieHeader(), ...headers }), deps);
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checkSameOrigin: POST · 머리글 · 같은 출처만', () => {
    expect(checkSameOrigin(post('/x'))).toBeNull();
    expect(checkSameOrigin(new Request(`${ORIGIN}/x`, { headers: { 'x-budget-auth': '1', origin: ORIGIN } }))).toBe('method');
    // Origin 이 없으면 Sec-Fetch-Site: same-origin 이 있어야
    expect(checkSameOrigin(new Request(`${ORIGIN}/x`, { method: 'POST', headers: { 'x-budget-auth': '1' } }))).toBe('origin');
    expect(checkSameOrigin(new Request(`${ORIGIN}/x`, { method: 'POST', headers: { 'x-budget-auth': '1', 'sec-fetch-site': 'same-origin' } }))).toBeNull();
  });
});

/* ---------- logout ---------- */

describe('POST /api/auth/logout', () => {
  it('쿠키를 지우고 철회는 하지 않는다 (기본)', async () => {
    const { deps, fetchMock } = makeDeps();
    const res = await handleLogout(post('/api/auth/logout', { cookie: await sessionCookieHeader() }, '{}'), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, revoked: false });
    expect(setCookies(res)[0]).toContain('Max-Age=0');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('모든 기기에서 로그아웃: 갱신 토큰을 철회한다', async () => {
    const { deps, fetchMock } = makeDeps({}, async () => new Response('', { status: 200 }));
    const res = await handleLogout(post('/api/auth/logout', { cookie: await sessionCookieHeader() }, JSON.stringify({ everywhere: true })), deps);
    expect(await res.json()).toEqual({ ok: true, revoked: true });
    expect(fetchMock.mock.calls[0]![0]).toBe(GOOGLE_REVOKE_URL);
    expect(new URLSearchParams(String(fetchMock.mock.calls[0]![1]!.body)).get('token')).toBe('1//refresh');
  });

  it('다른 사이트에서 부르면 403', async () => {
    const { deps } = makeDeps();
    const res = await handleLogout(post('/api/auth/logout', { origin: 'https://evil.example' }), deps);
    expect(res.status).toBe(403);
  });
});
