import { describe, expect, it, vi } from 'vitest';
import type { ServerAuth, ServerTokenResult } from '../server';
import {
  createGoogleSession,
  HINT_KEY,
  STORAGE_KEY,
  TOKEN_REFRESH_MARGIN_MS,
  type GoogleSessionDeps,
  type IssuedToken,
  type KeyValueStore,
  type SessionUser,
} from '../session';

const USER: SessionUser = { email: 'a@gmail.com', name: '가나', picture: null };

function memStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v), remove: (k) => void data.delete(k) };
}

function fakeServer(opts: { on?: boolean; results?: ServerTokenResult[] } = {}) {
  let n = 0;
  const queue = [...(opts.results ?? [])];
  const server = {
    status: vi.fn(async () => opts.on ?? true),
    fetchToken: vi.fn(async (): Promise<ServerTokenResult> => {
      const next = queue.shift();
      if (next) return next;
      n += 1;
      return { kind: 'ok', accessToken: `srv${n}`, expiresIn: 3600, user: USER };
    }),
    logout: vi.fn(async () => {}),
    startLogin: vi.fn(),
  } satisfies ServerAuth;
  return server;
}

function setup(server: ReturnType<typeof fakeServer> | null, over: Partial<GoogleSessionDeps> = {}) {
  let clock = 1_000_000;
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const store = memStore();
  const hintStore = memStore();
  const deps: GoogleSessionDeps = {
    now: () => clock,
    requestToken: vi.fn(async (): Promise<IssuedToken> => ({ accessToken: 'gis', expiresIn: 3600 })),
    fetchUserInfo: vi.fn(async () => USER),
    revoke: vi.fn(),
    store,
    hintStore,
    restoreTimeoutMs: 50,
    server,
    currentPath: () => '/history?tab=accounts',
    schedule: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return () => void (t.cancelled = true);
    },
    ...over,
  };
  const s = createGoogleSession(deps);
  return { s, deps, store, hintStore, timers, advance: (ms: number) => void (clock += ms) };
}

describe('로그인 고르기 (서버 vs 팝업)', () => {
  it('서버가 켜져 있으면 서버 토큰을 쓰고 팝업은 열지 않는다', async () => {
    const server = fakeServer({ on: true });
    const { s, deps } = setup(server);
    expect(await s.resolveFlow()).toBe('server');
    expect(await s.getAccessToken()).toBe('srv1');
    expect(deps.requestToken).not.toHaveBeenCalled();
    expect(s.currentUser()).toEqual(USER);
  });

  it('서버가 꺼져 있으면 (status false) 팝업 로그인', async () => {
    const server = fakeServer({ on: false });
    const { s, deps } = setup(server);
    expect(await s.resolveFlow()).toBe('gis');
    expect(await s.getAccessToken()).toBe('gis');
    expect(server.fetchToken).not.toHaveBeenCalled();
    expect(deps.requestToken).toHaveBeenCalledTimes(1);
  });

  it('서버 어댑터가 없으면 팝업', async () => {
    const { s } = setup(null);
    expect(s.flow()).toBe('gis');
    expect(await s.getAccessToken()).toBe('gis');
  });

  it('status 는 켜져 있는데 토큰이 501 이면 팝업으로 바꿔 이어서', async () => {
    const server = fakeServer({ on: true, results: [{ kind: 'unconfigured' }] });
    const { s, deps } = setup(server);
    expect(await s.getAccessToken()).toBe('gis');
    expect(s.flow()).toBe('gis');
    expect(deps.requestToken).toHaveBeenCalledTimes(1);
  });

  it('status 를 못 읽으면 이번엔 팝업, 다음에 다시 묻는다', async () => {
    const server = fakeServer();
    server.status.mockRejectedValueOnce(new Error('offline'));
    const { s } = setup(server);
    expect(await s.resolveFlow()).toBe('gis');
    expect(s.flow()).toBeNull();
    expect(await s.resolveFlow()).toBe('server');
  });
});

describe('서버 로그인', () => {
  it('signIn 은 구글 로그인 화면으로 이동 (돌아올 곳 · 힌트)', async () => {
    const server = fakeServer();
    const { s, hintStore, deps } = setup(server);
    hintStore.set(HINT_KEY, 'a@gmail.com');
    await s.resolveFlow();
    void s.signIn({ returnTo: '/start?open=abc' });
    await Promise.resolve();
    expect(server.startLogin).toHaveBeenCalledWith({ hint: 'a@gmail.com', returnTo: '/start?open=abc' });
    expect(deps.requestToken).not.toHaveBeenCalled();
  });

  it('받은 토큰은 만료까지 localStorage 에 두고, 다시 열면 요청 없이 쓴다', async () => {
    const server = fakeServer();
    const first = setup(server);
    await first.s.getAccessToken();
    expect(JSON.parse(first.store.data.get(STORAGE_KEY)!)).toMatchObject({ accessToken: 'srv1', user: USER });
    const second = setup(server, { store: first.store });
    expect(await second.s.restoreSession(USER.email)).toEqual(USER);
    expect(await second.s.getAccessToken()).toBe('srv1');
    expect(server.fetchToken).toHaveBeenCalledTimes(1);
  });

  it('만료 5분 전에 미리 갱신 (타이머)', async () => {
    const server = fakeServer();
    const { s, timers, advance } = setup(server);
    await s.getAccessToken();
    const t = timers.at(-1)!;
    expect(t.ms).toBe(3600_000 - TOKEN_REFRESH_MARGIN_MS + 1000);
    advance(t.ms);
    t.fn();
    await vi.waitFor(() => expect(server.fetchToken).toHaveBeenCalledTimes(2));
    expect(await s.getAccessToken()).toBe('srv2');
  });

  it('동시에 불러도 서버 요청은 하나 (single-flight)', async () => {
    let release!: (r: ServerTokenResult) => void;
    const server = fakeServer();
    server.fetchToken.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const { s } = setup(server);
    await s.resolveFlow();
    const all = Promise.all([s.getAccessToken(), s.getAccessToken(), s.getAccessToken(true)]);
    release({ kind: 'ok', accessToken: 'one', expiresIn: 3600, user: USER });
    expect(await all).toEqual(['one', 'one', 'one']);
    expect(server.fetchToken).toHaveBeenCalledTimes(1);
  });

  it('401 (forceRefresh) 이면 캐시를 버리고 서버에서 새로', async () => {
    const server = fakeServer();
    const { s, store } = setup(server);
    await s.getAccessToken();
    expect(await s.getAccessToken(true)).toBe('srv2');
    expect(JSON.parse(store.data.get(STORAGE_KEY)!).accessToken).toBe('srv2');
  });

  it('로그인 만료 (invalid_grant) → 캐시를 지우고 알린다', async () => {
    const server = fakeServer({ results: [{ kind: 'ok', accessToken: 'a', expiresIn: 3600, user: USER }, { kind: 'expired' }] });
    const { s, store } = setup(server);
    const ended = vi.fn();
    s.onEnded(ended);
    await s.getAccessToken();
    await expect(s.getAccessToken(true)).rejects.toMatchObject({ code: 'session_expired', message: '로그인이 만료됐어요. 다시 로그인해 주세요' });
    expect(ended).toHaveBeenCalledWith('expired');
    expect(store.data.has(STORAGE_KEY)).toBe(false);
    expect(s.currentUser()).toBeNull();
  });

  it('resumeServerSession: 돌아왔으면(force) 묻고, 로그인한 적 없으면 묻지 않는다', async () => {
    const server = fakeServer();
    const a = setup(server);
    expect(await a.s.resumeServerSession()).toBeNull();
    expect(server.status).not.toHaveBeenCalled();
    expect(await a.s.resumeServerSession({ force: true })).toEqual(USER);
    expect(a.hintStore.data.get(HINT_KEY)).toBe(USER.email);
  });

  it('resumeServerSession: 만료면 session_expired, 쿠키 없으면 null (알리지 않음)', async () => {
    const expired = setup(fakeServer({ results: [{ kind: 'expired' }] }));
    const ended = vi.fn();
    expired.s.onEnded(ended);
    await expect(expired.s.resumeServerSession({ force: true })).rejects.toMatchObject({ code: 'session_expired' });
    expect(ended).not.toHaveBeenCalled();
    const none = setup(fakeServer({ results: [{ kind: 'signed_out' }] }));
    expect(await none.s.resumeServerSession({ force: true })).toBeNull();
  });

  it('다시 연결: 쿠키가 끝났으면 구글 로그인 화면으로 (지금 주소로 돌아온다)', async () => {
    const server = fakeServer({ results: [{ kind: 'ok', accessToken: 'a', expiresIn: 3600, user: USER }, { kind: 'expired' }] });
    const { s } = setup(server);
    await s.getAccessToken();
    void s.reconnect(USER.email);
    await vi.waitFor(() => expect(server.startLogin).toHaveBeenCalledWith({ hint: USER.email, returnTo: '/history?tab=accounts' }));
  });

  it('로그아웃: 서버 쿠키를 지우고, 모든 기기면 철회를 서버에 맡긴다', async () => {
    const server = fakeServer();
    const { s, deps, timers } = setup(server);
    await s.getAccessToken();
    s.signOut();
    expect(server.logout).toHaveBeenLastCalledWith(false);
    expect(timers.at(-1)!.cancelled).toBe(true);
    await s.getAccessToken();
    s.signOut({ revoke: true });
    expect(server.logout).toHaveBeenLastCalledWith(true);
    expect(deps.revoke).not.toHaveBeenCalled();
  });
});
