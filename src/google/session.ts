import { GoogleError, isGoogleError } from './errors';

/** 이 파일은 구글 전역에 직접 닿지 않는다 (의존성 주입 → 단위 테스트 가능) */
export interface SessionUser {
  email: string;
  name: string;
  picture: string | null;
}

export interface TokenRequest {
  prompt: '' | 'consent' | 'select_account';
  hint?: string;
}

export interface IssuedToken {
  accessToken: string;
  /** 초 */
  expiresIn: number;
}

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface GoogleSessionDeps {
  now(): number;
  requestToken(req: TokenRequest): Promise<IssuedToken>;
  fetchUserInfo(accessToken: string): Promise<SessionUser>;
  revoke(accessToken: string): void;
  /** 새로고침해도 한 시간 안에는 토큰을 다시 쓰기 위한 저장소 (sessionStorage) */
  store: KeyValueStore | null;
  /**
   * 앱을 다시 열어도 남는 저장소 (localStorage). 동의한 계정의 이메일만 둔다 (토큰은 두지 않음).
   * 다음에 열 때 동의 창 대신 조용한 요청 + login_hint 로 같은 계정 토큰을 받는다
   */
  hintStore?: KeyValueStore | null;
  /** restoreSession 이 기다리는 최대 시간 (ms) */
  restoreTimeoutMs?: number;
}

export const STORAGE_KEY = 'budget.google.session';
export const HINT_KEY = 'budget.google.hint';
/** 남은 시간이 이보다 적으면 새로 받는다 */
export const TOKEN_REFRESH_MARGIN_MS = 60_000;
export const DEFAULT_RESTORE_TIMEOUT_MS = 10_000;

interface Stored {
  accessToken: string;
  expiresAt: number;
  user: SessionUser;
}

export interface GoogleSession {
  signIn(): Promise<SessionUser>;
  /** forceRefresh: 가진 토큰이 거절됐을 때(401) 캐시를 버리고 새로 받는다 */
  getAccessToken(forceRefresh?: boolean): Promise<string>;
  restoreSession(emailHint: string): Promise<SessionUser | null>;
  /** 사용자 클릭 안에서 부른다: 같은 계정으로 토큰을 다시 받는다 (조용한 복구가 막혔을 때) */
  reconnect(emailHint?: string): Promise<SessionUser | null>;
  /** revoke: true 면 앱 권한까지 철회 (다른 기기의 토큰도 끊긴다). 기본은 이 기기의 토큰만 지운다 */
  signOut(opts?: { revoke?: boolean }): void;
  currentUser(): SessionUser | null;
}

export function createGoogleSession(deps: GoogleSessionDeps): GoogleSession {
  let token: { accessToken: string; expiresAt: number } | null = null;
  let user: SessionUser | null = null;
  let consented = false;
  let inflight: Promise<string> | null = null;
  /** 로그아웃할 때마다 올린다. 로그아웃 뒤 늦게 도착한 토큰은 버린다 */
  let generation = 0;

  const restoreTimeoutMs = deps.restoreTimeoutMs ?? DEFAULT_RESTORE_TIMEOUT_MS;

  function isFresh(t: { expiresAt: number } | null): t is { accessToken: string; expiresAt: number } {
    return !!t && t.expiresAt - deps.now() > TOKEN_REFRESH_MARGIN_MS;
  }

  function persist(): void {
    if (!deps.store) return;
    try {
      if (token && user) {
        const v: Stored = { accessToken: token.accessToken, expiresAt: token.expiresAt, user };
        deps.store.set(STORAGE_KEY, JSON.stringify(v));
      } else {
        deps.store.remove(STORAGE_KEY);
      }
    } catch {
      // 저장소를 못 써도 메모리로 계속 동작
    }
  }

  function readStored(): Stored | null {
    if (!deps.store) return null;
    try {
      const raw = deps.store.get(STORAGE_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw) as Partial<Stored>;
      if (typeof v.accessToken !== 'string' || typeof v.expiresAt !== 'number' || !v.user || typeof v.user.email !== 'string') {
        return null;
      }
      return { accessToken: v.accessToken, expiresAt: v.expiresAt, user: v.user };
    } catch {
      return null;
    }
  }

  function accept(issued: IssuedToken): { accessToken: string; expiresAt: number } {
    const t = { accessToken: issued.accessToken, expiresAt: deps.now() + issued.expiresIn * 1000 };
    token = t;
    consented = true;
    return t;
  }

  const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  /** restoreSession 이 받은 이메일 (저장 전이라도 다음 요청의 login_hint 로 쓴다) */
  let lastHint: string | null = null;

  function readHint(): string | null {
    try {
      const v = deps.hintStore?.get(HINT_KEY);
      return v && v.includes('@') ? v : null;
    } catch {
      return null;
    }
  }
  function rememberHint(email: string | null): void {
    try {
      if (!deps.hintStore) return;
      if (email) deps.hintStore.set(HINT_KEY, email);
      else deps.hintStore.remove(HINT_KEY);
    } catch {
      // 무시
    }
  }

  async function signIn(): Promise<SessionUser> {
    const gen = generation;
    // 사용자 클릭 안에서 바로 창을 열어야 팝업이 막히지 않는다 → await 전에 요청
    const issued = await deps.requestToken({ prompt: consented ? '' : 'consent', hint: user?.email });
    if (gen !== generation) throw new GoogleError('not_signed_in', 'signed out during sign-in');
    const t = accept(issued);
    const info = await deps.fetchUserInfo(t.accessToken);
    if (gen !== generation) throw new GoogleError('not_signed_in', 'signed out during sign-in');
    user = info;
    persist();
    rememberHint(info.email);
    return info;
  }

  /**
   * 토큰 요청 하나 (동시에 부르면 같은 요청을 함께 기다린다 — 조용한 복구와 첫 불러오기가 서로를 취소하지 않게).
   * hint 가 있으면 받은 토큰의 계정을 확인해 다르면 버린다. requireUser 면 사용자 정보를 꼭 받아야 성공.
   * fresh: 기다리는 요청이 있어도 새로 연다 (사용자 클릭 안의 다시 연결)
   */
  function acquire(prompt: TokenRequest['prompt'], hint: string | undefined, opts: { requireUser?: boolean; fresh?: boolean } = {}): Promise<string> {
    if (inflight && !opts.fresh) return inflight;
    const gen = generation;
    const p: Promise<string> = deps
      .requestToken({ prompt, hint })
      .then(async (issued) => {
        if (gen !== generation) throw new GoogleError('not_signed_in', 'signed out while refreshing');
        const t = accept(issued);
        const needInfo = opts.requireUser || (!!hint && (!user || !sameEmail(user.email, hint)));
        if (needInfo) {
          let info: SessionUser | null = null;
          try {
            info = await deps.fetchUserInfo(t.accessToken);
          } catch (e) {
            if (opts.requireUser) {
              if (token === t) token = null;
              persist();
              throw e;
            }
            // 계정을 확인하지 못해도 토큰은 쓴다 (확인할 수 있을 때만 막는다)
          }
          if (gen !== generation) throw new GoogleError('not_signed_in', 'signed out while refreshing');
          if (info) {
            if (hint && !sameEmail(info.email, hint)) {
              if (token === t) token = null;
              persist();
              throw new GoogleError('account_mismatch', `${info.email} ≠ ${hint}`);
            }
            user = info;
          }
        }
        persist();
        if (user) rememberHint(user.email);
        return t.accessToken;
      })
      .finally(() => {
        if (inflight === p) inflight = null;
      });
    inflight = p;
    return p;
  }

  function getAccessToken(forceRefresh = false): Promise<string> {
    if (forceRefresh) {
      // 거절된 토큰: 메모리와 sessionStorage 에서 버리고 새로 받는다
      if (inflight) return inflight;
      token = null;
      persist();
    } else {
      if (isFresh(token)) return Promise.resolve(token.accessToken);
      if (inflight) return inflight;
      if (!user) {
        // 저장된 토큰이 아직 쓸 만하면 그대로
        const s = readStored();
        if (s && isFresh(s)) {
          token = { accessToken: s.accessToken, expiresAt: s.expiresAt };
          user = s.user;
          consented = true;
          return Promise.resolve(s.accessToken);
        }
      }
    }
    const hint = user?.email ?? lastHint ?? readHint() ?? undefined;
    // 예전에 동의한 계정이면 동의 창 대신 조용한 요청 + login_hint
    return acquire(consented || hint ? '' : 'consent', hint);
  }

  async function restoreSession(emailHint: string): Promise<SessionUser | null> {
    const hint = emailHint.trim();
    if (hint) lastHint = hint;
    if (isFresh(token) && user && (!hint || sameEmail(user.email, hint))) return user;

    const s = readStored();
    if (s && isFresh(s) && (!hint || sameEmail(s.user.email, hint))) {
      token = { accessToken: s.accessToken, expiresAt: s.expiresAt };
      user = s.user;
      consented = true;
      return s.user;
    }

    const gen = generation;
    try {
      await withTimeout(acquire('', hint || undefined, { requireUser: true }), restoreTimeoutMs);
      if (gen !== generation || !user) return null;
      const u: SessionUser = user;
      return !hint || sameEmail(u.email, hint) ? u : null;
    } catch {
      return null;
    }
  }

  async function reconnect(emailHint?: string): Promise<SessionUser | null> {
    const hint = emailHint?.trim() || user?.email || lastHint || readHint() || undefined;
    // await 전에 요청 → 클릭 안에서 창이 열린다
    const p = acquire(consented || hint ? '' : 'consent', hint, { fresh: true, requireUser: !user });
    await p;
    return user;
  }

  function signOut(opts?: { revoke?: boolean }): void {
    generation++;
    const t = token?.accessToken ?? readStored()?.accessToken ?? null;
    token = null;
    user = null;
    consented = false;
    inflight = null;
    lastHint = null;
    persist();
    rememberHint(null);
    if (deps.store) {
      try {
        deps.store.remove(STORAGE_KEY);
      } catch {
        // 무시
      }
    }
    // 앱 권한 철회는 같은 계정의 다른 기기 토큰까지 끊으므로, 명시적으로 원할 때만
    if (t && opts?.revoke) {
      try {
        deps.revoke(t);
      } catch {
        // 철회 실패는 로그아웃을 막지 않는다
      }
    }
  }

  return { signIn, getAccessToken, restoreSession, reconnect, signOut, currentUser: () => user };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new GoogleError('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(id);
        reject(isGoogleError(e) ? e : new GoogleError('unknown', String(e)));
      },
    );
  });
}
