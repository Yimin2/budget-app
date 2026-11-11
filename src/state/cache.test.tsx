// @vitest-environment jsdom
/**
 * 보관(캐시) + 새로고침 (PLAN 7): 보관한 내용으로 먼저 그리기 · 뒤에서 바꾸기 · 연결 안 됨이면 읽기 전용 · 쓰기 막기 ·
 * 쓰면 보관도 바꾸기 · 로그아웃 · 계정 바뀜 · 버전 다름 · 자동 새로고침 1분 간격 · 창이 열려 있으면 미루기
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLedger } from '@/domain';
import type { LedgerData } from '@/domain/types';
import { createMemoryCacheStore, LedgerCache, LocalBackend, createMemoryStorage, StorageError, type CacheStore } from '@/storage';
import type { LedgerBackend, LedgerRef } from '@/storage/types';
import { Dialog } from '@/ui';
import { holdRefresh } from '@/ui/refreshGate';
import { AppProviders } from './Providers';
import { AUTO_REFRESH_MS, OFFLINE_MESSAGE, OFFLINE_WRITE_MESSAGE, useLedger } from './ledger';
import { useSession, type GoogleDeps, type StateDeps } from './session';
import { SESSION_KEY } from './storageKeys';
import type { LedgerApi, SessionApi } from './types';

const ME = { email: 'me@example.com', name: '가나다', picture: null };

afterEach(cleanup);

function fakeGoogle(signInAs = ME): GoogleDeps {
  return {
    isGoogleConfigured: () => true,
    signIn: async () => signInAs,
    signOut: () => {},
    restoreSession: () => new Promise(() => {}),
    pickSpreadsheet: async () => null,
    getAccessToken: async () => 'token',
  };
}

type LoadMode = { kind: 'ok' } | { kind: 'fail'; error: unknown } | { kind: 'defer' };

function ledgerNamed(name: string): LedgerData {
  return createDefaultLedger('shared', name, '2026-11-20', '2026-11-20T00:00:00Z', ME.email, ME.name);
}

interface Setup {
  probe: { current: { ledger: LedgerApi; session: SessionApi } | null };
  store: CacheStore;
  cache: LedgerCache;
  ref: LedgerRef;
  loads: () => number;
  setLoad(mode: LoadMode): void;
  releaseDeferred(): void;
  clock: { now: Date };
  rerenderDialog(open: boolean): void;
}

async function setup(opts: { cached?: LedgerData | null; load?: LoadMode; storeEntry?: (cache: LedgerCache, ref: LedgerRef, store: CacheStore) => Promise<void> } = {}): Promise<Setup> {
  const inner = new LocalBackend(createMemoryStorage());
  const created = await inner.create(ledgerNamed('시트 이름'));
  const ref: LedgerRef = { ...created, source: 'sheets' };
  let mode: LoadMode = opts.load ?? { kind: 'ok' };
  let loadCount = 0;
  let deferred: Array<() => void> = [];
  const sheets: LedgerBackend = {
    source: 'sheets',
    create: async () => ref,
    open: (r) => {
      const repo = inner.open({ ...r, source: 'local' });
      return {
        ref: r,
        load: async () => {
          loadCount += 1;
          const m = mode;
          if (m.kind === 'fail') throw m.error;
          if (m.kind === 'defer') await new Promise<void>((resolve) => deferred.push(resolve));
          return repo.load();
        },
        insert: (t, rows) => repo.insert(t, rows),
        upsert: (t, row) => repo.upsert(t, row),
        upsertMany: (t, rows) => repo.upsertMany(t, rows),
        updateSettings: (patch) => repo.updateSettings(patch),
      };
    },
    share: async () => {},
    describe: async () => ref,
  };
  const store = createMemoryCacheStore();
  const cache = new LedgerCache(store);
  if (opts.cached) await cache.write(ME.email, ref.id, opts.cached, '2026-11-20T00:30:00.000Z');
  if (opts.storeEntry) await opts.storeEntry(cache, ref, store);
  const storage = createMemoryStorage();
  storage.setItem(SESSION_KEY, JSON.stringify({ mode: 'google', user: ME, recentLedgers: [ref], activeLedgerId: ref.id }));
  const clock = { now: new Date(2026, 10, 20, 10) };
  const deps: Partial<StateDeps> = {
    google: fakeGoogle({ email: 'other@example.com', name: '다른 사람', picture: null }),
    local: new LocalBackend(createMemoryStorage()),
    sheets,
    now: () => clock.now,
    storage,
    restoreTimeoutMs: 10,
    demoCouple: false,
    demoHistory: false,
    cache,
  };
  const probe: Setup['probe'] = { current: null };
  function Probe() {
    // eslint-disable-next-line react-hooks/immutability -- 테스트에서 최신 값을 읽으려고 씀
    probe.current = { ledger: useLedger(), session: useSession() };
    return null;
  }
  const ui = (open: boolean) => (
    <AppProviders deps={deps}>
      <Probe />
      <Dialog open={open} onClose={() => {}} title="창">
        <p>내용</p>
      </Dialog>
    </AppProviders>
  );
  const view = render(ui(false));
  return {
    probe,
    store,
    cache,
    ref,
    loads: () => loadCount,
    setLoad: (m) => {
      mode = m;
    },
    releaseDeferred: () => {
      const list = deferred;
      deferred = [];
      list.forEach((r) => r());
    },
    clock,
    rerenderDialog: (open) => view.rerender(ui(open)),
  };
}

const L = (s: Setup) => s.probe.current!.ledger;

describe('보관한 내용으로 먼저 그리기', () => {
  it('보관한 내용이 있으면 시트를 읽기 전에 그리고 "맞추는 중", 읽으면 조용히 바꾸고 보관도 바꿔요', async () => {
    const s = await setup({ cached: ledgerNamed('보관한 이름'), load: { kind: 'defer' } });
    await waitFor(() => expect(L(s).data?.settings.name).toBe('보관한 이름'));
    expect(L(s).status).toBe('ready');
    expect(L(s).sync).toMatchObject({ syncing: true, fromCache: true, offline: false, syncedAt: '2026-11-20T00:30:00.000Z' });
    await act(async () => s.releaseDeferred());
    await waitFor(() => expect(L(s).data?.settings.name).toBe('시트 이름'));
    expect(L(s).sync).toMatchObject({ syncing: false, fromCache: false, offline: false, syncedAt: s.clock.now.toISOString() });
    await waitFor(async () => expect((await s.cache.read(ME.email, s.ref.id))?.data.settings.name).toBe('시트 이름'));
  });

  it('보관한 내용이 없으면 처음 읽기를 기다리고, 읽은 내용을 보관해요', async () => {
    const s = await setup({ load: { kind: 'defer' } });
    await waitFor(() => expect(L(s).status).toBe('loading'));
    expect(L(s).data).toBeNull();
    await act(async () => s.releaseDeferred());
    await waitFor(() => expect(L(s).status).toBe('ready'));
    await waitFor(async () => expect(await s.cache.read(ME.email, s.ref.id)).not.toBeNull());
  });

  it('보관한 버전이 앱과 다르면 쓰지 않고 지워요', async () => {
    const s = await setup({
      load: { kind: 'defer' },
      storeEntry: async (cache, ref, store) => {
        // 같은 열쇠에 다른 버전 모양이 남아 있어요
        const stale = { version: cache.version + 1, email: ME.email, ledgerId: ref.id, savedAt: 't', data: ledgerNamed('예전 모양') };
        await store.set(cache.key(ME.email, ref.id), stale);
      },
    });
    await waitFor(() => expect(L(s).status).toBe('loading'));
    // 보관한 내용이 쓰이지 않아요
    await act(async () => {
      await Promise.resolve();
    });
    expect(L(s).data).toBeNull();
    expect(await s.store.get(s.cache.key(ME.email, s.ref.id))).toBeUndefined();
    await act(async () => s.releaseDeferred());
    await waitFor(() => expect(L(s).data?.settings.name).toBe('시트 이름'));
  });
});

describe('연결이 안 될 때', () => {
  it('시트를 못 읽으면 보관한 내용을 읽기 전용으로 보여 주고, 쓰기는 "연결되면 다시 시도해 주세요"', async () => {
    const s = await setup({ cached: ledgerNamed('보관한 이름'), load: { kind: 'fail', error: new StorageError('인터넷 연결을 확인해 주세요', 0) } });
    await waitFor(() => expect(L(s).sync.offline).toBe(true));
    expect(L(s).data?.settings.name).toBe('보관한 이름');
    expect(L(s).status).toBe('ready');
    expect(L(s).error).toBe(OFFLINE_MESSAGE);
    const before = L(s).data!.expenses.length;
    const accountId = L(s).activeAccounts[0]!.id;
    // 화면을 바꾸기 전에 막아요
    await expect(L(s).addExpense({ date: '2026-11-20', amount: 1000, accountId, categoryId: null })).rejects.toThrow(OFFLINE_WRITE_MESSAGE);
    expect(L(s).data!.expenses.length).toBe(before);
    await expect(L(s).renameLedger('새 이름')).rejects.toThrow(OFFLINE_WRITE_MESSAGE);

    // 다시 연결되면(새로고침 성공) 읽기 전용이 풀려요
    s.setLoad({ kind: 'ok' });
    await act(async () => {
      await L(s).reload();
    });
    expect(L(s).sync.offline).toBe(false);
    expect(L(s).error).toBeNull();
    expect(L(s).data?.settings.name).toBe('시트 이름');
  });

  it('보관한 내용도 없으면 오류 화면 (읽기 전용 아님)', async () => {
    const s = await setup({ load: { kind: 'fail', error: new StorageError('인터넷 연결을 확인해 주세요', 0) } });
    await waitFor(() => expect(L(s).status).toBe('error'));
    expect(L(s).sync.offline).toBe(false);
  });
});

describe('쓰기 · 로그아웃 · 계정', () => {
  it('시트에 먼저 쓰고, 저장되면 보관한 내용도 바꿔요', async () => {
    const s = await setup();
    await waitFor(() => expect(L(s).status).toBe('ready'));
    await act(() => L(s).renameLedger('바꾼 이름'));
    await waitFor(async () => expect((await s.cache.read(ME.email, s.ref.id))?.data.settings.name).toBe('바꾼 이름'));
  });

  it('로그아웃하면 보관한 내용을 모두 지워요', async () => {
    const s = await setup();
    await waitFor(async () => expect(await s.cache.read(ME.email, s.ref.id)).not.toBeNull());
    await s.cache.write('someone@example.com', 'x', ledgerNamed('다른 가계부'), 't');
    act(() => s.probe.current!.session.signOut());
    await waitFor(async () => expect(await s.store.keys()).toEqual([]));
  });

  it('다른 계정으로 로그인하면 이전 계정의 보관 내용을 지워요', async () => {
    const s = await setup();
    await waitFor(async () => expect(await s.cache.read(ME.email, s.ref.id)).not.toBeNull());
    await act(() => s.probe.current!.session.signInWithGoogle());
    await waitFor(() => expect(s.probe.current!.session.user?.email).toBe('other@example.com'));
    await waitFor(async () => expect(await s.cache.read(ME.email, s.ref.id)).toBeNull());
  });
});

describe('자동 새로고침', () => {
  const focus = () => act(() => void window.dispatchEvent(new Event('focus')));

  it('창으로 돌아오면 다시 읽어요. 1분에 한 번까지', async () => {
    const s = await setup();
    await waitFor(() => expect(L(s).status).toBe('ready'));
    const first = s.loads();
    s.clock.now = new Date(s.clock.now.getTime() + 30_000);
    await focus();
    expect(s.loads()).toBe(first);
    s.clock.now = new Date(s.clock.now.getTime() + AUTO_REFRESH_MS);
    await focus();
    await waitFor(() => expect(s.loads()).toBe(first + 1));
    // 바로 다시 와도(보이기 + 포커스가 함께 와도) 한 번만
    await act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await focus();
    expect(s.loads()).toBe(first + 1);
    await waitFor(() => expect(L(s).sync.syncing).toBe(false));
    expect(L(s).sync.syncedAt).toBe(s.clock.now.toISOString());
  });

  it('창 · 시트가 열려 있으면 미루고, 닫히면 다시 읽어요', async () => {
    const s = await setup();
    await waitFor(() => expect(L(s).status).toBe('ready'));
    const first = s.loads();
    s.rerenderDialog(true);
    s.clock.now = new Date(s.clock.now.getTime() + AUTO_REFRESH_MS + 1);
    await focus();
    expect(s.loads()).toBe(first);
    act(() => s.rerenderDialog(false));
    await waitFor(() => expect(s.loads()).toBe(first + 1));
  });

  it('고치던 양식이 있으면(useRefreshHold · holdRefresh) 미뤄요', async () => {
    const s = await setup();
    await waitFor(() => expect(L(s).status).toBe('ready'));
    const first = s.loads();
    const release = holdRefresh();
    s.clock.now = new Date(s.clock.now.getTime() + AUTO_REFRESH_MS + 1);
    await focus();
    expect(s.loads()).toBe(first);
    act(() => release());
    await waitFor(() => expect(s.loads()).toBe(first + 1));
  });

  it('새로고침 중에 저장한 기록은 사라지지 않아요 (불러온 내용 위에 다시 얹어요)', async () => {
    const s = await setup();
    await waitFor(() => expect(L(s).status).toBe('ready'));
    s.setLoad({ kind: 'defer' });
    let reloading: Promise<void> = Promise.resolve();
    act(() => {
      reloading = L(s).reload();
    });
    const accountId = L(s).activeAccounts[0]!.id;
    await act(() => L(s).addExpense({ date: '2026-11-20', amount: 4321, accountId, categoryId: null, memo: '새로고침 중' }));
    await act(async () => {
      s.releaseDeferred();
      await reloading;
    });
    expect(L(s).data!.expenses.some((e) => e.memo === '새로고침 중')).toBe(true);
  });
});

describe('체험 · 브라우저 저장 가계부', () => {
  it('보관하지 않아요', async () => {
    const store = createMemoryCacheStore();
    const spy = vi.spyOn(store, 'set');
    const deps: Partial<StateDeps> = {
      google: fakeGoogle(),
      local: new LocalBackend(createMemoryStorage()),
      sheets: {} as LedgerBackend,
      now: () => new Date(2026, 10, 20, 10),
      storage: createMemoryStorage(),
      restoreTimeoutMs: 10,
      demoCouple: false,
      demoHistory: false,
      cache: new LedgerCache(store),
    };
    const probe: { current: { ledger: LedgerApi; session: SessionApi } | null } = { current: null };
    function Probe() {
      // eslint-disable-next-line react-hooks/immutability -- 테스트에서 최신 값을 읽으려고 씀
      probe.current = { ledger: useLedger(), session: useSession() };
      return null;
    }
    render(
      <AppProviders deps={deps}>
        <Probe />
      </AppProviders>,
    );
    await waitFor(() => expect(probe.current?.session.status).toBe('signedOut'));
    await act(() => probe.current!.session.startDemo());
    await waitFor(() => expect(probe.current?.ledger.status).toBe('ready'));
    expect(probe.current!.ledger.sync.syncedAt).not.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
