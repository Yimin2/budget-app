/**
 * 로그인 서버 (구글 인증 코드 흐름 + 갱신 토큰). 라우트 파일(src/app/api/auth/*)은 이 함수들만 부른다.
 * 가계부 데이터는 다루지 않는다 — 갱신 토큰을 암호화 쿠키에 두고, 브라우저가 부르면 새 액세스 토큰을 내준다.
 * 표준 Request → Response 라서 단위 테스트에서 fetch 만 바꿔 끼워 확인한다.
 */
import { readServerAuthConfig, type AuthEnv, type ServerAuthConfig } from './config';
import { pkceChallenge, randomToken, safeEqual, seal, unseal } from './crypto';
import {
  AUTH_SCOPES,
  GOOGLE_AUTH_URL,
  GoogleTokenError,
  exchangeCode,
  hasDriveScope,
  refreshAccessToken,
  revokeToken,
  verifyIdToken,
  type IdTokenClaims,
} from './google';

export interface AuthDeps {
  env: AuthEnv;
  fetch: typeof fetch;
  now(): number;
}

/** 브라우저가 /api/auth/token · logout 에 꼭 붙이는 머리글 (다른 사이트의 폼 · 단순 요청을 막는다) */
export const AUTH_HEADER = 'x-budget-auth';
export const CALLBACK_PATH = '/api/auth/callback';
export const DEFAULT_RETURN = '/start';
export const EXPIRED_MESSAGE = '로그인이 만료됐어요. 다시 로그인해 주세요';

/** 로그인 흐름 쿠키 (state · PKCE) 수명 */
export const FLOW_MAX_AGE_S = 600;
/** 세션 쿠키 수명. 부를 때마다 다시 늘린다 (구글은 6개월 안 쓰면 갱신 토큰을 끝낸다) */
export const SESSION_MAX_AGE_S = 180 * 24 * 60 * 60;

export interface FlowCookie {
  /** state */
  s: string;
  /** PKCE code_verifier */
  v: string;
  /** OIDC nonce */
  n: string;
  /** 로그인 뒤 돌아갈 경로 */
  r: string;
  /** 동의 창을 강제로 띄운 요청인지 (갱신 토큰을 못 받았을 때 한 번만 다시) */
  c: boolean;
  /** 만든 시각 ms */
  t: number;
}

export interface SessionCookie {
  rt: string;
  sub: string;
  email: string;
  name: string;
  picture: string | null;
  t: number;
}

/* ---------- 쿠키 ---------- */

export function isSecureRequest(req: Request): boolean {
  return new URL(req.url).protocol === 'https:';
}

/** https 에서는 __Host- 접두사 (Secure · Path=/ · Domain 없음을 브라우저가 강제). http://localhost 개발용은 접두사 없이 */
export function cookieNames(secure: boolean): { session: string; flow: string } {
  return secure ? { session: '__Host-budget_session', flow: '__Host-budget_oauth' } : { session: 'budget_session', flow: 'budget_oauth' };
}

export function serializeCookie(name: string, value: string, maxAgeS: number, secure: boolean): string {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.max(0, Math.floor(maxAgeS))}`];
  if (maxAgeS <= 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

/* ---------- 응답 ---------- */

const NO_STORE = 'no-store, max-age=0';

function json(status: number, body: unknown, cookies: string[] = []): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': NO_STORE, Pragma: 'no-cache' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': NO_STORE, 'Referrer-Policy': 'no-referrer' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 303, headers });
}

/* ---------- 입력 확인 ---------- */

/** 로그인 뒤 돌아갈 경로는 이 사이트 안의 경로만 (열린 리디렉션 막기) */
export function safeReturnPath(raw: string | null | undefined): string {
  if (!raw || raw.length > 1024) return DEFAULT_RETURN;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /[\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_RETURN;
  try {
    const u = new URL(raw, 'http://local.invalid');
    if (u.origin !== 'http://local.invalid' || u.pathname.startsWith('/api/')) return DEFAULT_RETURN;
    u.searchParams.delete('auth');
    u.searchParams.delete('auth_error');
    return u.pathname + u.search + u.hash;
  } catch {
    return DEFAULT_RETURN;
  }
}

function withParam(path: string, key: string, value: string): string {
  const u = new URL(path, 'http://local.invalid');
  u.searchParams.set(key, value);
  return u.pathname + u.search + u.hash;
}

function safeHint(raw: string | null): string | null {
  const v = (raw ?? '').trim();
  return /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(v) ? v : null;
}

/** state · 만든 시각 확인. 문제가 없으면 null, 있으면 이유 */
export function validateFlow(flow: FlowCookie | null, state: string | null, nowMs: number): string | null {
  if (!flow || typeof flow.s !== 'string' || typeof flow.v !== 'string' || typeof flow.t !== 'number') return 'flow_missing';
  if (!state || !safeEqual(flow.s, state)) return 'state_mismatch';
  if (nowMs - flow.t > FLOW_MAX_AGE_S * 1000 || flow.t - nowMs > 60_000) return 'flow_expired';
  return null;
}

/**
 * 토큰 · 로그아웃 요청의 CSRF 확인: 우리 머리글 + 같은 사이트에서 온 요청(Origin · Sec-Fetch-Site).
 * 문제가 없으면 null
 */
export function checkSameOrigin(req: Request): string | null {
  if (req.method !== 'POST') return 'method';
  if (req.headers.get(AUTH_HEADER) !== '1') return 'header';
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return 'site';
  const origin = req.headers.get('origin');
  if (origin) {
    if (origin !== new URL(req.url).origin) return 'origin';
  } else if (site !== 'same-origin') {
    return 'origin';
  }
  return null;
}

async function readSession(req: Request, config: ServerAuthConfig, secure: boolean): Promise<SessionCookie | null> {
  const raw = readCookie(req, cookieNames(secure).session);
  const s = await unseal<SessionCookie>(raw, config.cookieSecret, 'session');
  if (!s || typeof s.rt !== 'string' || !s.rt || typeof s.sub !== 'string' || typeof s.email !== 'string') return null;
  return s;
}

function clearSessionCookie(secure: boolean): string {
  return serializeCookie(cookieNames(secure).session, '', 0, secure);
}

function clearFlowCookie(secure: boolean): string {
  return serializeCookie(cookieNames(secure).flow, '', 0, secure);
}

async function sessionCookie(config: ServerAuthConfig, s: SessionCookie, secure: boolean): Promise<string> {
  return serializeCookie(cookieNames(secure).session, await seal(s, config.cookieSecret, 'session'), SESSION_MAX_AGE_S, secure);
}

/* ---------- GET /api/auth/status ---------- */

export function handleStatus(_req: Request, deps: AuthDeps): Response {
  return json(200, { serverLogin: readServerAuthConfig(deps.env) !== null });
}

/* ---------- GET /api/auth/login ---------- */

/**
 * 구글 로그인 화면으로 보낸다. ?return=<경로> · ?hint=<이메일> · ?consent=1
 * 갱신 토큰을 아직 갖고 있지 않을 때만 prompt=consent (구글은 동의할 때만 갱신 토큰을 준다)
 */
export async function handleLogin(req: Request, deps: AuthDeps): Promise<Response> {
  const url = new URL(req.url);
  const config = readServerAuthConfig(deps.env);
  const returnTo = safeReturnPath(url.searchParams.get('return'));
  if (!config) return redirect(`${url.origin}${withParam(returnTo, 'auth_error', 'unconfigured')}`);
  const secure = isSecureRequest(req);

  const forceConsent = url.searchParams.get('consent') === '1';
  const existing = forceConsent ? null : await readSession(req, config, secure);
  const hint = safeHint(url.searchParams.get('hint')) ?? existing?.email ?? null;

  const flow: FlowCookie = { s: randomToken(), v: randomToken(48), n: randomToken(16), r: returnTo, c: forceConsent || !existing, t: deps.now() };
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: `${url.origin}${CALLBACK_PATH}`,
    response_type: 'code',
    scope: AUTH_SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    state: flow.s,
    nonce: flow.n,
    code_challenge: await pkceChallenge(flow.v),
    code_challenge_method: 'S256',
  });
  if (hint) params.set('login_hint', hint);
  if (flow.c) params.set('prompt', 'consent');

  const cookie = serializeCookie(cookieNames(secure).flow, await seal(flow, config.cookieSecret, 'oauth'), FLOW_MAX_AGE_S, secure);
  return redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`, [cookie]);
}

/* ---------- GET /api/auth/callback ---------- */

export async function handleCallback(req: Request, deps: AuthDeps): Promise<Response> {
  const url = new URL(req.url);
  const config = readServerAuthConfig(deps.env);
  const secure = isSecureRequest(req);
  const fail = (returnTo: string, code: string, extra: string[] = []) =>
    redirect(`${url.origin}${withParam(returnTo, 'auth_error', code)}`, [clearFlowCookie(secure), ...extra]);

  if (!config) return fail(DEFAULT_RETURN, 'unconfigured');

  const flow = await unseal<FlowCookie>(readCookie(req, cookieNames(secure).flow), config.cookieSecret, 'oauth');
  const returnTo = safeReturnPath(flow?.r);

  const googleError = url.searchParams.get('error');
  if (googleError) return fail(returnTo, googleError === 'access_denied' ? 'consent_denied' : 'failed');

  const flowError = validateFlow(flow, url.searchParams.get('state'), deps.now());
  if (flowError || !flow) return fail(returnTo, 'state');

  const code = url.searchParams.get('code');
  if (!code) return fail(returnTo, 'failed');

  let claims: IdTokenClaims;
  let refreshToken: string | null;
  try {
    const tokens = await exchangeCode(deps.fetch, config, { code, codeVerifier: flow.v, redirectUri: `${url.origin}${CALLBACK_PATH}` });
    claims = verifyIdToken(tokens.id_token, { clientId: config.clientId, nowMs: deps.now(), nonce: flow.n });
    if (!hasDriveScope(tokens.scope)) return fail(returnTo, 'consent_denied');
    refreshToken = tokens.refresh_token ?? null;
  } catch {
    return fail(returnTo, 'failed');
  }

  if (!refreshToken) {
    // 이미 동의한 계정이면 구글이 갱신 토큰을 다시 주지 않는다 → 같은 계정 쿠키의 것을 그대로 쓰거나, 동의 창으로 한 번 더
    const existing = await readSession(req, config, secure);
    if (existing && existing.sub === claims.sub) {
      refreshToken = existing.rt;
    } else if (!flow.c) {
      const again = new URLSearchParams({ consent: '1', return: returnTo, hint: claims.email });
      return redirect(`${url.origin}/api/auth/login?${again.toString()}`, [clearFlowCookie(secure)]);
    } else {
      return fail(returnTo, 'failed');
    }
  }

  const session: SessionCookie = { rt: refreshToken, sub: claims.sub, email: claims.email, name: claims.name, picture: claims.picture, t: deps.now() };
  return redirect(`${url.origin}${withParam(returnTo, 'auth', '1')}`, [clearFlowCookie(secure), await sessionCookie(config, session, secure)]);
}

/* ---------- POST /api/auth/token ---------- */

export interface TokenResponseBody {
  accessToken: string;
  /** 초 */
  expiresIn: number;
  user: { email: string; name: string; picture: string | null };
}

export async function handleToken(req: Request, deps: AuthDeps): Promise<Response> {
  const config = readServerAuthConfig(deps.env);
  if (!config) return json(501, { error: 'unconfigured' });
  const csrf = checkSameOrigin(req);
  if (csrf) return json(403, { error: 'forbidden' });
  const secure = isSecureRequest(req);

  const hadCookie = readCookie(req, cookieNames(secure).session) !== null;
  const session = await readSession(req, config, secure);
  if (!session) {
    // 쿠키가 없거나 (위조 · 키 변경으로) 읽을 수 없으면 지우고 로그인부터
    return json(401, { error: 'no_session' }, hadCookie ? [clearSessionCookie(secure)] : []);
  }

  try {
    const tokens = await refreshAccessToken(deps.fetch, config, session.rt);
    if (!tokens.access_token) throw new GoogleTokenError('no_access_token', 502);
    let profile: IdTokenClaims = { sub: session.sub, email: session.email, name: session.name, picture: session.picture };
    if (tokens.id_token) {
      try {
        profile = verifyIdToken(tokens.id_token, { clientId: config.clientId, nowMs: deps.now(), expectedSub: session.sub });
      } catch {
        // 갱신 응답의 id_token 은 이름 · 사진을 새로 받는 용도라, 틀리면 쿠키의 값을 그대로 쓴다
      }
    }
    const next: SessionCookie = { ...session, rt: tokens.refresh_token ?? session.rt, email: profile.email, name: profile.name, picture: profile.picture };
    const expiresIn = Number(tokens.expires_in);
    const body: TokenResponseBody = {
      accessToken: tokens.access_token,
      expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3599,
      user: { email: next.email, name: next.name, picture: next.picture },
    };
    return json(200, body, [await sessionCookie(config, next, secure)]);
  } catch (e) {
    if (e instanceof GoogleTokenError && (e.code === 'invalid_grant' || e.code === 'unauthorized_client')) {
      return json(401, { error: 'expired', message: EXPIRED_MESSAGE }, [clearSessionCookie(secure)]);
    }
    return json(502, { error: 'upstream' });
  }
}

/* ---------- POST /api/auth/logout ---------- */

/** 쿠키를 지운다. 본문 { everywhere: true } 면 구글에 갱신 토큰 철회도 보낸다 (이 앱 권한 전체 — 다른 기기도 다시 로그인) */
export async function handleLogout(req: Request, deps: AuthDeps): Promise<Response> {
  const csrf = checkSameOrigin(req);
  if (csrf) return json(403, { error: 'forbidden' });
  const secure = isSecureRequest(req);
  let everywhere = false;
  try {
    const body = (await req.json()) as { everywhere?: unknown };
    everywhere = body?.everywhere === true;
  } catch {
    // 본문 없음
  }
  let revoked = false;
  const config = readServerAuthConfig(deps.env);
  if (everywhere && config) {
    const session = await readSession(req, config, secure);
    if (session) revoked = await revokeToken(deps.fetch, session.rt);
  }
  return json(200, { ok: true, revoked }, [clearSessionCookie(secure)]);
}
