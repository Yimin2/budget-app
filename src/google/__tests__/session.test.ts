import { describe, expect, it, vi } from 'vitest';
import { GoogleError } from '../errors';
import {
  createGoogleSession,
  HINT_KEY,
  STORAGE_KEY,
  type GoogleSessionDeps,
  type IssuedToken,
  type KeyValueStore,
  type SessionUser,
  type TokenRequest,
} from '../session';

const USER: SessionUser = { email: 'a@gmail.com', name: '가나', picture: null };

function memStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v), remove: (k) => void data.delete(k) };
}

function setup(over: Partial<GoogleSessionDeps> = {}) {
  let clock = 1_000_000;
  let n = 0;
  const requests: TokenRequest[] = [];
  const store = memStore();
  const deps: GoogleSessionDeps = {
    now: () => clock,
    requestToken: vi.fn(async (req: TokenRequest): Promise<IssuedToken> => {
      requests.push(req);
      n += 1;
      return { accessToken: `tok${n}`, expiresIn: 3600 };
    }),
    fetchUserInfo: vi.fn(async () => USER),
    revoke: vi.fn(),
    store,
    restoreTimeoutMs: 50,
    ...over,
  };
  const s = createGoogleSession(deps);
  return { s, deps, requests, store, advance: (ms: number) => void (clock += ms) };
}

describe('signIn', () => {
  it('처음엔 consent, 다음엔 빈 prompt', async () => {
    const { s, requests, store } = setup();
    expect(await s.signIn()).toEqual(USER);
    expect(requests[0]).toEqual({ prompt: 'consent', hint: undefined });
    expect(JSON.parse(store.data.get(STORAGE_KEY)!)).toMatchObject({ accessToken: 'tok1', user: USER });
    await s.signIn();
    expect(requests[1]).toEqual({ prompt: '', hint: USER.email });
  });

  it('오류를 그대로 넘긴다', async () => {
    const { s } = setup({ requestToken: vi.fn(() => Promise.reject(new GoogleError('popup_blocked'))) });
    await expect(s.signIn()).rejects.toMatchObject({ code: 'popup_blocked', message: expect.stringContaining('팝업') });
    expect(s.currentUser()).toBeNull();
  });
});

describe('getAccessToken', () => {
  it('5분 넘게 남으면 재사용, 그 이하면 새로 받는다', async () => {
    const { s, deps, requests, advance } = setup();
    await s.signIn();
    expect(await s.getAccessToken()).toBe('tok1');
    advance((3600 - 301) * 1000);
    expect(await s.getAccessToken()).toBe('tok1');
    expect(deps.requestToken).toHaveBeenCalledTimes(1);
    advance(2000);
    expect(await s.getAccessToken()).toBe('tok2');
    expect(requests[1]).toEqual({ prompt: '', hint: USER.email });
  });

  it('동시에 불러도 요청은 하나', async () => {
    let release!: (t: IssuedToken) => void;
    const requestToken = vi.fn(
      () => new Promise<IssuedToken>((r) => (release = r)),
    );
    const { s } = setup({ requestToken });
    const all = Promise.all([s.getAccessToken(), s.getAccessToken(), s.getAccessToken()]);
    expect(requestToken).toHaveBeenCalledTimes(1);
    release({ accessToken: 'shared', expiresIn: 3600 });
    expect(await all).toEqual(['shared', 'shared', 'shared']);
    expect(await s.getAccessToken()).toBe('shared');
    expect(requestToken).toHaveBeenCalledTimes(1);
  });

  it('실패하면 다음 호출에서 다시 시도', async () => {
    const requestToken = vi
      .fn<(r: TokenRequest) => Promise<IssuedToken>>()
      .mockRejectedValueOnce(new GoogleError('popup_closed'))
      .mockResolvedValueOnce({ accessToken: 'ok', expiresIn: 3600 });
    const { s } = setup({ requestToken });
    await expect(s.getAccessToken()).rejects.toMatchObject({ code: 'popup_closed' });
    expect(await s.getAccessToken()).toBe('ok');
  });

  it('새로고침 뒤 저장된 토큰을 쓴다', async () => {
    const first = setup();
    await first.s.signIn();
    const second = setup({ store: first.store });
    expect(await second.s.getAccessToken()).toBe('tok1');
    expect(second.deps.requestToken).not.toHaveBeenCalled();
  });

  it('로그아웃 중 받은 토큰은 버린다', async () => {
    let release!: (t: IssuedToken) => void;
    const { s } = setup({ requestToken: vi.fn(() => new Promise<IssuedToken>((r) => (release = r))) });
    const p = s.getAccessToken();
    s.signOut();
    release({ accessToken: 'late', expiresIn: 3600 });
    await expect(p).rejects.toMatchObject({ code: 'not_signed_in' });
  });
});

describe('restoreSession', () => {
  it('저장된 토큰이 같은 계정이고 유효하면 요청 없이 복구', async () => {
    const first = setup();
    await first.s.signIn();
    const second = setup({ store: first.store });
    expect(await second.s.restoreSession(USER.email)).toEqual(USER);
    expect(second.deps.requestToken).not.toHaveBeenCalled();
  });

  it('다른 계정 힌트면 조용히 새 토큰을 받는다', async () => {
    const first = setup();
    await first.s.signIn();
    const second = setup({ store: first.store });
    await second.s.restoreSession('b@gmail.com');
    expect(second.requests[0]).toEqual({ prompt: '', hint: 'b@gmail.com' });
  });

  it('조용한 요청이 실패하면 null', async () => {
    const { s } = setup({ requestToken: vi.fn(() => Promise.reject(new GoogleError('popup_blocked'))) });
    expect(await s.restoreSession(USER.email)).toBeNull();
    expect(s.currentUser()).toBeNull();
  });

  it('응답이 없으면 시간 초과로 null', async () => {
    const { s } = setup({ requestToken: vi.fn(() => new Promise<IssuedToken>(() => {})) });
    expect(await s.restoreSession(USER.email)).toBeNull();
  });

  it('사용자 정보가 실패하면 null 이고 토큰도 지운다', async () => {
    const { s, deps } = setup({ fetchUserInfo: vi.fn(() => Promise.reject(new GoogleError('network'))) });
    expect(await s.restoreSession(USER.email)).toBeNull();
    await s.getAccessToken();
    expect(deps.requestToken).toHaveBeenCalledTimes(2);
  });
});

describe('signOut', () => {
  it('이 기기의 토큰만 지우고(철회하지 않음) 저장소를 비운다', async () => {
    const { s, deps, store, requests } = setup();
    await s.signIn();
    s.signOut();
    expect(deps.revoke).not.toHaveBeenCalled();
    expect(store.data.has(STORAGE_KEY)).toBe(false);
    expect(s.currentUser()).toBeNull();
    await s.signIn();
    expect(requests[1]?.prompt).toBe('consent');
  });

  it('revoke: true 면 앱 권한도 철회한다', async () => {
    const { s, deps } = setup();
    await s.signIn();
    s.signOut({ revoke: true });
    expect(deps.revoke).toHaveBeenCalledWith('tok1');
  });

  it('로그인 전이면 철회하지 않는다', () => {
    const { s, deps } = setup();
    s.signOut();
    expect(deps.revoke).not.toHaveBeenCalled();
  });
});

describe('검증된 결함 회귀', () => {
  it('forceRefresh 는 캐시된 토큰과 저장본을 버리고 새로 받는다 (401 뒤)', async () => {
    const { s, store, requests } = setup();
    await s.signIn();
    expect(await s.getAccessToken()).toBe('tok1');
    expect(await s.getAccessToken(true)).toBe('tok2');
    expect(requests[1]).toEqual({ prompt: '', hint: USER.email });
    expect(JSON.parse(store.data.get(STORAGE_KEY)!).accessToken).toBe('tok2');
  });

  it('조용한 복구와 첫 불러오기는 같은 요청을 함께 기다린다', async () => {
    let release!: (t: IssuedToken) => void;
    const requestToken = vi.fn(() => new Promise<IssuedToken>((r) => (release = r)));
    const { s } = setup({ requestToken });
    const restored = s.restoreSession(USER.email);
    const token = s.getAccessToken();
    expect(requestToken).toHaveBeenCalledTimes(1);
    expect(requestToken).toHaveBeenCalledWith({ prompt: '', hint: USER.email });
    release({ accessToken: 'shared', expiresIn: 3600 });
    expect(await token).toBe('shared');
    expect(await restored).toEqual(USER);
  });

  it('다시 열 때는 동의 창 대신 기억한 계정으로 조용히 요청한다', async () => {
    const hintStore = memStore();
    const first = setup({ hintStore });
    await first.s.signIn();
    expect(hintStore.data.get(HINT_KEY)).toBe(USER.email);
    const second = setup({ hintStore }); // sessionStorage 비어 있음 (새로 연 앱)
    expect(await second.s.getAccessToken()).toBe('tok1');
    expect(second.requests[0]).toEqual({ prompt: '', hint: USER.email });
  });

  it('다른 계정 토큰이 오면 버리고 오류', async () => {
    const hintStore = memStore();
    hintStore.set(HINT_KEY, USER.email);
    const { s } = setup({ hintStore, fetchUserInfo: vi.fn(async () => ({ email: 'b@gmail.com', name: 'B', picture: null })) });
    await expect(s.getAccessToken()).rejects.toMatchObject({ code: 'account_mismatch' });
    expect(s.currentUser()).toBeNull();
  });

  it('다시 연결은 기다리는 요청이 있어도 새로 연다', async () => {
    const pending = new Promise<IssuedToken>(() => {});
    const requestToken = vi
      .fn<(r: TokenRequest) => Promise<IssuedToken>>()
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce({ accessToken: 'again', expiresIn: 3600 });
    const { s } = setup({ requestToken });
    void s.getAccessToken().catch(() => {});
    expect(await s.reconnect(USER.email)).toEqual(USER);
    expect(requestToken).toHaveBeenCalledTimes(2);
    expect(await s.getAccessToken()).toBe('again');
  });
});
