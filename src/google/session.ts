import { GoogleError, isGoogleError } from './errors';
import type { ServerAuth } from './server';

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

/** 어떤 로그인을 쓰는지: server = 로그인 서버(갱신 토큰 쿠키), gis = 브라우저 팝업(예전 방식, 서버 설정이 없을 때) */
export type LoginFlow = 'server' | 'gis';

/** 서버가 로그인이 끝났다고 알린 이유. expired = 갱신 토큰 만료 · 철회, signed_out = 로그인 쿠키 없음 */
export type EndReason = 'expired' | 'signed_out';

export interface GoogleSessionDeps {
  now(): number;
  requestToken(req: TokenRequest): Promise<IssuedToken>;
  fetchUserInfo(accessToken: string): Promise<SessionUser>;
  revoke(accessToken: string): void;
  /**
   * 액세스 토큰 캐시 (localStorage). 만료(1시간)까지 앱을 다시 열어도 바로 쓴다.
   * 로그아웃 · 401 · 로그인 만료 때 지운다
   */
  store: KeyValueStore | null;
  /**
   * 앱을 다시 열어도 남는 저장소 (localStorage). 동의한 계정의 이메일만 둔다.
   * 다음에 열 때 login_hint 로 같은 계정을 고른다
   */
  hintStore?: KeyValueStore | null;
  /** restoreSession 이 기다리는 최대 시간 (ms) */
  restoreTimeoutMs?: number;
  /** 로그인 서버 (/api/auth/*). 없거나 서버가 설정되지 않았으면 팝업(GIS) 로그인 */
  server?: ServerAuth | null;
  /** 미리 갱신 타이머. 기본 setTimeout. 돌려준 함수로 취소 */
  schedule?(fn: () => void, ms: number): () => void;
  /** 로그인 화면에서 돌아올 경로 (기본 '/start') */
  currentPath?(): string;
}

export const STORAGE_KEY = 'budget.google.session';
export const HINT_KEY = 'budget.google.hint';
/** 남은 시간이 이보다 적으면 새로 받는다 (서버 로그인이면 이때 미리 갱신) */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;
export const DEFAULT_RESTORE_TIMEOUT_MS = 10_000;

interface Stored {
  accessToken: string;
  expiresAt: number;
  user: SessionUser;
}

export interface GoogleSession {
  /** 서버 로그인이면 구글 로그인 화면으로 이동(돌아오지 않는 약속), 아니면 팝업 동의 창 */
  signIn(opts?: { returnTo?: string }): Promise<SessionUser>;
  /** forceRefresh: 가진 토큰이 거절됐을 때(401) 캐시를 버리고 새로 받는다 */
  getAccessToken(forceRefresh?: boolean): Promise<string>;
  restoreSession(emailHint: string): Promise<SessionUser | null>;
  /**
   * 로그아웃 상태에서 서버 로그인 쿠키로 이어서 쓰기 (구글 로그인 화면에서 돌아왔을 때 · 다시 열었을 때).
   * force 가 아니면 예전에 로그인한 적이 있을 때만 서버에 묻는다. 만료면 GoogleError('session_expired')
   */
  resumeServerSession(opts?: { force?: boolean }): Promise<SessionUser | null>;
  /** 사용자 클릭 안에서 부른다: 같은 계정으로 토큰을 다시 받는다 (조용한 복구가 막혔을 때) */
  reconnect(emailHint?: string): Promise<SessionUser | null>;
  /** revoke: true 면 앱 권한까지 철회 (다른 기기의 토큰도 끊긴다). 기본은 이 기기의 토큰만 지운다 */
  signOut(opts?: { revoke?: boolean }): void;
  currentUser(): SessionUser | null;
  /** 어떤 로그인을 쓰는지 정한다 (서버 /api/auth/status). 한 번 정하면 기억한다 */
  resolveFlow(): Promise<LoginFlow>;
  /** 정해졌으면 그 값, 아직이면 null */
  flow(): LoginFlow | null;
  /** 서버가 로그인 만료 · 없음을 알리면 불린다 */
  onEnded(listener: (reason: EndReason) => void): () => void;
}

/** 페이지가 바뀌는 동안 기다리는 약속 (끝나지 않는다) */
function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

export function createGoogleSession(deps: GoogleSessionDeps): GoogleSession {
  let token: { accessToken: string; expiresAt: number } | null = null;
  let user: SessionUser | null = null;
  let consented = false;
  let inflight: Promise<string> | null = null;
  /** 로그아웃할 때마다 올린다. 로그아웃 뒤 늦게 도착한 토큰은 버린다 */
  let generation = 0;
  let loginFlow: LoginFlow | null = deps.server ? null : 'gis';
  let flowPromise: Promise<LoginFlow> | null = null;
  let cancelTimer: (() => void) | null = null;
  const listeners = new Set<(reason: EndReason) => void>();

  const restoreTimeoutMs = deps.restoreTimeoutMs ?? DEFAULT_RESTORE_TIMEOUT_MS;
  const schedule =
    deps.schedule ??
    ((fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    });
  const currentPath = () => {
    try {
      return deps.currentPath?.() || '/start';
    } catch {
      return '/start';
    }
  };

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

  function stopTimer(): void {
    cancelTimer?.();
    cancelTimer = null;
  }

  /** 서버 로그인이면 만료 5분 전에 조용히 새로 받아 둔다 (화면이 기다리지 않게) */
  function scheduleRefresh(): void {
    stopTimer();
    if (loginFlow !== 'server' || !token) return;
    const delay = token.expiresAt - deps.now() - TOKEN_REFRESH_MARGIN_MS + 1000;
    if (delay <= 0) return;
    const gen = generation;
    cancelTimer = schedule(() => {
      cancelTimer = null;
      if (gen !== generation || !user) return;
      getAccessToken().catch(() => {});
    }, delay);
  }

  function accept(issued: IssuedToken): { accessToken: string; expiresAt: number } {
    const t = { accessToken: issued.accessToken, expiresAt: deps.now() + issued.expiresIn * 1000 };
    token = t;
    consented = true;
    return t;
  }

  /** 저장된 토큰이 아직 쓸 만하면 꺼내 쓴다 (그 토큰, 아니면 null) */
  function takeStored(emailHint?: string): string | null {
    const s = readStored();
    if (!s || !isFresh(s) || (emailHint && !sameEmail(s.user.email, emailHint))) return null;
    token = { accessToken: s.accessToken, expiresAt: s.expiresAt };
    user = s.user;
    consented = true;
    scheduleRefresh();
    return s.accessToken;
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

  function resolveFlow(): Promise<LoginFlow> {
    if (loginFlow) return Promise.resolve(loginFlow);
    const server = deps.server;
    if (!server) {
      loginFlow = 'gis';
      return Promise.resolve(loginFlow);
    }
    flowPromise ??= server.status().then(
      (on) => {
        loginFlow ??= on ? 'server' : 'gis';
        return loginFlow;
      },
      () => {
        // 상태를 못 읽으면 (연결 끊김) 이번엔 팝업으로, 다음에 다시 묻는다
        flowPromise = null;
        return 'gis' as const;
      },
    );
    return flowPromise;
  }

  /** 서버가 로그인 끝을 알렸다: 토큰 · 캐시를 지운다. 계정 힌트는 남겨 다시 로그인할 때 같은 계정을 고르게 한다 */
  function endSession(reason: EndReason, notify: boolean): void {
    generation++;
    stopTimer();
    token = null;
    user = null;
    consented = false;
    persist();
    if (!notify) return;
    for (const l of [...listeners]) {
      try {
        l(reason);
      } catch {
        // 무시
      }
    }
  }

  /** 로그인 서버에서 새 액세스 토큰 (동시에 부르면 하나만 보낸다) */
  function serverAcquire(opts: { notify?: boolean } = {}): Promise<string> {
    if (inflight) return inflight;
    const server = deps.server;
    if (!server) return gisAcquireDefault();
    const gen = generation;
    const p: Promise<string> = server
      .fetchToken()
      .then((r) => {
        if (gen !== generation) throw new GoogleError('not_signed_in', 'signed out while refreshing');
        if (r.kind === 'ok') {
          accept(r);
          user = r.user;
          persist();
          rememberHint(r.user.email);
          scheduleRefresh();
          return r.accessToken;
        }
        if (r.kind === 'unconfigured') {
          // 서버에 비밀 값이 없다 → 팝업 로그인으로 바꿔 이어서
          loginFlow = 'gis';
          if (inflight === p) inflight = null;
          return gisAcquireDefault();
        }
        endSession(r.kind, opts.notify !== false);
        throw r.kind === 'expired' ? new GoogleError('session_expired') : new GoogleError('not_signed_in', 'no server session');
      })
      .finally(() => {
        if (inflight === p) inflight = null;
      });
    inflight = p;
    return p;
  }

  async function signIn(opts?: { returnTo?: string }): Promise<SessionUser> {
    if (loginFlow === null && deps.server) await resolveFlow();
    if (loginFlow === 'server' && deps.server) {
      deps.server.startLogin({ hint: user?.email ?? lastHint ?? readHint() ?? undefined, returnTo: opts?.returnTo ?? currentPath() });
      return never<SessionUser>();
    }
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
   * 팝업(GIS) 토큰 요청 하나 (동시에 부르면 같은 요청을 함께 기다린다 — 조용한 복구와 첫 불러오기가 서로를 취소하지 않게).
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

  /** 예전에 동의한 계정이면 동의 창 대신 조용한 요청 + login_hint */
  function gisAcquireDefault(): Promise<string> {
    const hint = user?.email ?? lastHint ?? readHint() ?? undefined;
    return acquire(consented || hint ? '' : 'consent', hint);
  }

  function getAccessToken(forceRefresh = false): Promise<string> {
    if (forceRefresh) {
      // 거절된 토큰: 메모리와 저장소에서 버리고 새로 받는다
      if (inflight) return inflight;
      token = null;
      persist();
    } else {
      if (isFresh(token)) return Promise.resolve(token.accessToken);
      if (inflight) return inflight;
      const stored = user ? null : takeStored();
      if (stored) return Promise.resolve(stored);
    }
    if (loginFlow === 'server') return serverAcquire();
    if (loginFlow === null && deps.server) {
      return resolveFlow().then((f) => (f === 'server' ? serverAcquire() : inflight ?? gisAcquireDefault()));
    }
    return gisAcquireDefault();
  }

  async function restoreSession(emailHint: string): Promise<SessionUser | null> {
    const hint = emailHint.trim();
    if (hint) lastHint = hint;
    if (isFresh(token) && user && (!hint || sameEmail(user.email, hint))) return user;
    if (takeStored(hint || undefined)) return user;

    const gen = generation;
    try {
      const flow = await resolveFlow();
      if (gen !== generation) return null;
      if (flow === 'server') {
        // 서버 쿠키가 기준이다 (다른 계정이면 그 계정을 돌려주고, 화면이 판단한다)
        await withTimeout(serverAcquire(), restoreTimeoutMs);
        return gen === generation ? user : null;
      }
      await withTimeout(acquire('', hint || undefined, { requireUser: true }), restoreTimeoutMs);
      if (gen !== generation || !user) return null;
      const u: SessionUser = user;
      return !hint || sameEmail(u.email, hint) ? u : null;
    } catch {
      return null;
    }
  }

  async function resumeServerSession(opts?: { force?: boolean }): Promise<SessionUser | null> {
    if (!deps.server) return null;
    if (!opts?.force && !readHint()) return null;
    if ((await resolveFlow()) !== 'server') return null;
    if (isFresh(token) && user) return user;
    if (takeStored()) return user;
    try {
      await withTimeout(serverAcquire({ notify: false }), restoreTimeoutMs);
      return user;
    } catch (e) {
      if (isGoogleError(e) && e.code === 'session_expired') throw e;
      return null;
    }
  }

  async function reconnect(emailHint?: string): Promise<SessionUser | null> {
    const hint = emailHint?.trim() || user?.email || lastHint || readHint() || undefined;
    if (loginFlow === 'server' && deps.server) {
      token = null;
      persist();
      try {
        await serverAcquire({ notify: false });
        return user;
      } catch (e) {
        if (isGoogleError(e) && (e.code === 'session_expired' || e.code === 'not_signed_in')) {
          // 쿠키가 끝났다 → 구글 로그인 화면으로 (돌아오면 같은 화면)
          deps.server.startLogin({ hint, returnTo: currentPath() });
          return never<SessionUser | null>();
        }
        throw e;
      }
    }
    // await 전에 요청 → 클릭 안에서 창이 열린다
    const p = acquire(consented || hint ? '' : 'consent', hint, { fresh: true, requireUser: !user });
    await p;
    return user;
  }

  function signOut(opts?: { revoke?: boolean }): void {
    generation++;
    stopTimer();
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
    if (deps.server && loginFlow !== 'gis') {
      // 로그인 쿠키를 지운다. revoke 면 서버가 구글에 갱신 토큰 철회도 보낸다 (모든 기기)
      void deps.server.logout(opts?.revoke === true);
      return;
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

  function onEnded(listener: (reason: EndReason) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    signIn,
    getAccessToken,
    restoreSession,
    resumeServerSession,
    reconnect,
    signOut,
    currentUser: () => user,
    resolveFlow,
    flow: () => loginFlow,
    onEnded,
  };
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
