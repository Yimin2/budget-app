import { base64UrlDecode } from './crypto';
import type { ServerAuthConfig } from './config';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/** 브라우저 팝업 로그인과 같은 권한 범위 */
export const AUTH_SCOPES = ['openid', 'email', 'profile', DRIVE_FILE_SCOPE];

const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
/** 서버 시계 차이 허용 (초) */
const CLOCK_SKEW_S = 120;

export interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export interface IdTokenClaims {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

export class GoogleTokenError extends Error {
  /** invalid_grant: 갱신 토큰이 끝났다 (철회 · 테스트 앱 7일 만료 · 6개월 미사용 · 비밀번호 변경) */
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'GoogleTokenError';
    this.code = code;
    this.status = status;
  }
}

async function postForm(fetchImpl: typeof fetch, url: string, form: Record<string, string>): Promise<GoogleTokenResponse> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
      cache: 'no-store',
    });
  } catch (e) {
    throw new GoogleTokenError('network', 0, String(e));
  }
  let body: GoogleTokenResponse = {};
  try {
    body = (await res.json()) as GoogleTokenResponse;
  } catch {
    // 본문이 JSON 이 아님
  }
  if (!res.ok || body.error) {
    throw new GoogleTokenError(body.error ?? `http_${res.status}`, res.status, body.error_description);
  }
  return body;
}

export function exchangeCode(
  fetchImpl: typeof fetch,
  config: ServerAuthConfig,
  args: { code: string; codeVerifier: string; redirectUri: string },
): Promise<GoogleTokenResponse> {
  return postForm(fetchImpl, GOOGLE_TOKEN_URL, {
    code: args.code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: args.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: args.codeVerifier,
  });
}

export function refreshAccessToken(fetchImpl: typeof fetch, config: ServerAuthConfig, refreshToken: string): Promise<GoogleTokenResponse> {
  return postForm(fetchImpl, GOOGLE_TOKEN_URL, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
}

/** 갱신 토큰을 철회하면 이 앱에 준 권한 전체가 끊긴다 (모든 기기) */
export async function revokeToken(fetchImpl: typeof fetch, token: string): Promise<boolean> {
  try {
    const res = await fetchImpl(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function hasDriveScope(scope: string | undefined): boolean {
  if (!scope) return false;
  return scope.split(/\s+/).includes(DRIVE_FILE_SCOPE);
}

/**
 * id_token 의 클레임 확인: aud · azp · iss · exp · iat · email_verified · (있으면) nonce.
 * 서명은 확인하지 않는다 — 이 토큰은 브라우저를 거치지 않고 구글 토큰 엔드포인트에서 TLS 로 직접 받은 것이라
 * OpenID Connect Core 3.1.3.7 에 따라 TLS 서버 확인이 서명 확인을 대신한다.
 * 틀리면 이유를 담은 Error 를 던진다
 */
export function verifyIdToken(
  idToken: string | undefined,
  opts: { clientId: string; nowMs: number; nonce?: string; expectedSub?: string },
): IdTokenClaims {
  if (!idToken) throw new Error('id_token missing');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('id_token malformed');
  const raw = base64UrlDecode(parts[1] ?? '');
  if (!raw) throw new Error('id_token malformed');
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
  } catch {
    throw new Error('id_token malformed');
  }
  const now = Math.floor(opts.nowMs / 1000);
  const aud = c.aud;
  const audOk = aud === opts.clientId || (Array.isArray(aud) && aud.includes(opts.clientId));
  if (!audOk) throw new Error('id_token aud');
  if (Array.isArray(aud) && aud.length > 1 && c.azp !== opts.clientId) throw new Error('id_token azp');
  if (typeof c.iss !== 'string' || !ISSUERS.includes(c.iss)) throw new Error('id_token iss');
  if (typeof c.exp !== 'number' || c.exp + CLOCK_SKEW_S < now) throw new Error('id_token exp');
  if (typeof c.iat === 'number' && c.iat - CLOCK_SKEW_S > now) throw new Error('id_token iat');
  if (c.email_verified !== true && c.email_verified !== 'true') throw new Error('id_token email_verified');
  if (opts.nonce !== undefined && c.nonce !== opts.nonce) throw new Error('id_token nonce');
  if (typeof c.sub !== 'string' || !c.sub) throw new Error('id_token sub');
  if (opts.expectedSub !== undefined && c.sub !== opts.expectedSub) throw new Error('id_token sub changed');
  const email = typeof c.email === 'string' ? c.email : '';
  if (!email) throw new Error('id_token email');
  const name = typeof c.name === 'string' && c.name.trim() ? c.name.trim() : email.split('@')[0] || email;
  const picture = typeof c.picture === 'string' && c.picture ? c.picture : null;
  return { sub: c.sub, email, name, picture };
}
