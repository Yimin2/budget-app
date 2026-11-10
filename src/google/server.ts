import { GoogleError } from './errors';
import type { SessionUser } from './session';

/** 로그인 서버(/api/auth/*)를 부르는 브라우저 쪽 어댑터. 구글 전역에는 닿지 않는다 */

export const AUTH_HEADER = 'X-Budget-Auth';

export type ServerTokenResult =
  | { kind: 'ok'; accessToken: string; expiresIn: number; user: SessionUser }
  /** 서버에 비밀 값이 없음 (501) 또는 서버가 없음 (404) → 팝업 로그인으로 */
  | { kind: 'unconfigured' }
  /** 로그인 쿠키가 없음 */
  | { kind: 'signed_out' }
  /** 갱신 토큰이 끝남 (invalid_grant) — 쿠키는 서버가 지웠다 */
  | { kind: 'expired' };

export interface ServerAuth {
  /** GET /api/auth/status → 서버 로그인을 쓸 수 있는지 */
  status(): Promise<boolean>;
  /** POST /api/auth/token. 연결 실패 · 5xx 는 GoogleError('network') */
  fetchToken(): Promise<ServerTokenResult>;
  /** POST /api/auth/logout. everywhere: 구글에 권한 철회까지 */
  logout(everywhere: boolean): Promise<void>;
  /** 구글 로그인 화면으로 이동 (전체 페이지). 돌아오면 returnTo 로 */
  startLogin(opts: { hint?: string; returnTo: string }): void;
}

export function loginUrl(opts: { hint?: string; returnTo: string; consent?: boolean }): string {
  const p = new URLSearchParams({ return: opts.returnTo });
  if (opts.hint) p.set('hint', opts.hint);
  if (opts.consent) p.set('consent', '1');
  return `/api/auth/login?${p.toString()}`;
}

export function createServerAuthClient(deps: { fetch: typeof fetch; navigate(url: string): void }): ServerAuth {
  async function status(): Promise<boolean> {
    let res: Response;
    try {
      res = await deps.fetch('/api/auth/status', { method: 'GET', cache: 'no-store', credentials: 'same-origin' });
    } catch (e) {
      throw new GoogleError('network', `status: ${String(e)}`);
    }
    if (!res.ok) return false;
    try {
      const body = (await res.json()) as { serverLogin?: unknown };
      return body.serverLogin === true;
    } catch {
      return false;
    }
  }

  async function fetchToken(): Promise<ServerTokenResult> {
    let res: Response;
    try {
      res = await deps.fetch('/api/auth/token', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { [AUTH_HEADER]: '1' },
      });
    } catch (e) {
      throw new GoogleError('network', `token: ${String(e)}`);
    }
    if (res.status === 501 || res.status === 404 || res.status === 405) return { kind: 'unconfigured' };
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      // 본문 없음
    }
    if (res.status === 401) return body.error === 'expired' ? { kind: 'expired' } : { kind: 'signed_out' };
    if (!res.ok) throw new GoogleError('network', `token ${res.status}`);
    const user = body.user as Partial<SessionUser> | undefined;
    if (typeof body.accessToken !== 'string' || !user || typeof user.email !== 'string') {
      throw new GoogleError('network', 'token: bad body');
    }
    const expiresIn = Number(body.expiresIn);
    return {
      kind: 'ok',
      accessToken: body.accessToken,
      expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3599,
      user: { email: user.email, name: typeof user.name === 'string' && user.name ? user.name : user.email, picture: user.picture ?? null },
    };
  }

  async function logout(everywhere: boolean): Promise<void> {
    try {
      await deps.fetch('/api/auth/logout', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        keepalive: true,
        headers: { [AUTH_HEADER]: '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ everywhere }),
      });
    } catch {
      // 로그아웃 실패는 화면 로그아웃을 막지 않는다
    }
  }

  function startLogin(opts: { hint?: string; returnTo: string }): void {
    deps.navigate(loginUrl(opts));
  }

  return { status, fetchToken, logout, startLogin };
}
