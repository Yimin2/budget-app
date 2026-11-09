import { getGoogleConfig } from './config';
import { GoogleError } from './errors';
import { GSI_SRC, loadScript } from './script';
import type { IssuedToken, SessionUser, TokenRequest } from './session';
import { googleGlobals, type TokenClient, type TokenClientError, type TokenResponse } from './types';

export const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
export const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

interface Waiter {
  resolve(t: IssuedToken): void;
  reject(e: GoogleError): void;
}

export function mapTokenError(resp: TokenResponse): GoogleError {
  const err = resp.error ?? '';
  if (err === 'access_denied') return new GoogleError('consent_denied', resp.error_description ?? err);
  if (err === 'popup_closed_by_user' || err === 'user_cancelled') return new GoogleError('popup_closed', err);
  if (err === 'interaction_required' || err === 'login_required' || err === 'consent_required') {
    return new GoogleError('not_signed_in', err);
  }
  return new GoogleError('unknown', resp.error_description ?? err);
}

export function mapClientError(e: TokenClientError): GoogleError {
  if (e.type === 'popup_failed_to_open') return new GoogleError('popup_blocked', e.message);
  if (e.type === 'popup_closed') return new GoogleError('popup_closed', e.message);
  return new GoogleError('unknown', e.message ?? e.type);
}

/** 구글이 준 권한에 drive.file 이 빠졌으면 (체크박스 해제) 거절로 본다 */
function hasDriveScope(resp: TokenResponse): boolean {
  if (!resp.scope) return true;
  return resp.scope.split(' ').includes('https://www.googleapis.com/auth/drive.file');
}

/**
 * GIS 토큰 클라이언트 어댑터. 클라이언트는 한 번만 만들고, 응답은 지금 기다리는 요청에 넘긴다.
 * 새 요청이 오면 앞 요청은 닫힌 것으로 끝낸다.
 */
export function createGisTokenRequester(scopes: readonly string[]): {
  requestToken(req: TokenRequest): Promise<IssuedToken>;
  preload(): Promise<void>;
} {
  let client: TokenClient | null = null;
  let waiter: Waiter | null = null;

  function settle(fn: (w: Waiter) => void): void {
    const w = waiter;
    waiter = null;
    if (w) fn(w);
  }

  function makeClient(): TokenClient {
    const { clientId } = getGoogleConfig();
    if (!clientId) throw new GoogleError('not_configured');
    const oauth2 = googleGlobals().google?.accounts?.oauth2;
    if (!oauth2) throw new GoogleError('script_failed', 'google.accounts.oauth2 missing');
    return oauth2.initTokenClient({
      client_id: clientId,
      scope: scopes.join(' '),
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          settle((w) => w.reject(mapTokenError(resp.error ? resp : { error: 'no_token' })));
          return;
        }
        if (!hasDriveScope(resp)) {
          settle((w) => w.reject(new GoogleError('consent_denied', 'drive.file not granted')));
          return;
        }
        const expiresIn = Number(resp.expires_in ?? 3599);
        const accessToken = resp.access_token;
        settle((w) => w.resolve({ accessToken, expiresIn: Number.isFinite(expiresIn) ? expiresIn : 3599 }));
      },
      error_callback: (e) => settle((w) => w.reject(mapClientError(e))),
    });
  }

  async function ensureClient(): Promise<TokenClient> {
    if (client) return client;
    if (!getGoogleConfig().clientId) throw new GoogleError('not_configured');
    await loadScript(GSI_SRC, () => !!googleGlobals().google?.accounts?.oauth2);
    client ??= makeClient();
    return client;
  }

  function send(c: TokenClient, req: TokenRequest): Promise<IssuedToken> {
    return new Promise<IssuedToken>((resolve, reject) => {
      settle((w) => w.reject(new GoogleError('popup_closed', 'superseded')));
      waiter = { resolve, reject };
      try {
        c.requestAccessToken({ prompt: req.prompt, ...(req.hint ? { login_hint: req.hint } : {}) });
      } catch (e) {
        settle((w) => w.reject(new GoogleError('unknown', String(e))));
      }
    });
  }

  function requestToken(req: TokenRequest): Promise<IssuedToken> {
    // 클라이언트가 준비돼 있으면 같은 틱에서 창을 연다 (사용자 클릭 유지 → 팝업 차단 방지)
    if (client) return send(client, req);
    return ensureClient().then((c) => send(c, req));
  }

  async function preload(): Promise<void> {
    await ensureClient();
  }

  return { requestToken, preload };
}

export async function fetchUserInfo(accessToken: string): Promise<SessionUser> {
  let res: Response;
  try {
    res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch (e) {
    throw new GoogleError('network', String(e));
  }
  if (!res.ok) throw new GoogleError('network', `userinfo ${res.status}`);
  const body = (await res.json()) as { email?: string; name?: string; picture?: string };
  const email = body.email ?? '';
  if (!email) throw new GoogleError('network', 'userinfo without email');
  return {
    email,
    name: body.name?.trim() || email.split('@')[0] || email,
    picture: body.picture || null,
  };
}

export function revokeToken(accessToken: string): void {
  const oauth2 = googleGlobals().google?.accounts?.oauth2;
  if (oauth2) {
    oauth2.revoke(accessToken, () => {});
    return;
  }
  if (typeof fetch === 'function') {
    void fetch(`${REVOKE_URL}?token=${encodeURIComponent(accessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).catch(() => {});
  }
}
