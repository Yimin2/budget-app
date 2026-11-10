// @vitest-environment jsdom
/** 멤버 = 구글 시트 공유 목록 (PLAN 4-8): 불러올 때 맞추기 · 나 넣기 · 못 읽어도 그대로 · 혼자일 때 사람 고르기 · 체험 모드는 그대로 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { createDefaultLedger, DEMO_MEMBERS, ledgerPeople, type SharingList } from '@/domain';
import type { LedgerData } from '@/domain/types';
import { createMemoryStorage, LocalBackend } from '@/storage';
import type { LedgerBackend, LedgerRef } from '@/storage/types';
import { peopleOptions } from '@/app/(app)/_components/PersonPicker';
import { AppProviders } from './Providers';
import { useLedger } from './ledger';
import { useSession, type GoogleDeps, type StateDeps } from './session';
import { SESSION_KEY } from './storageKeys';

const ME = { email: 'me@example.com', name: '가나다', picture: null };

function fakeGoogle(): GoogleDeps {
  return {
    isGoogleConfigured: () => true,
    signIn: async () => ME,
    signOut: () => {},
    restoreSession: () => new Promise(() => {}),
    pickSpreadsheet: async () => null,
    getAccessToken: async () => 'token',
  };
}

/** 브라우저 저장소로 시트 백엔드를 흉내 내요 (source 만 sheets) + 가짜 공유 목록 */
async function setupSheets(data: LedgerData, listSharing: () => Promise<SharingList>) {
  const inner = new LocalBackend(createMemoryStorage());
  const created = await inner.create(data);
  const ref: LedgerRef = { ...created, source: 'sheets' };
  const writes: { emails: string[] }[] = [];
  const sharingCalls = vi.fn(listSharing);
  const sheets: LedgerBackend = {
    source: 'sheets',
    create: async () => ref,
    open: (r) => {
      const repo = inner.open({ ...r, source: 'local' });
      return {
        ref: r,
        load: () => repo.load(),
        insert: (t, rows) => repo.insert(t, rows),
        upsert: (t, row) => repo.upsert(t, row),
        upsertMany: async (t, rows) => {
          if (t === 'members') writes.push({ emails: rows.map((x) => (x as { email: string }).email) });
          await repo.upsertMany(t, rows);
        },
        updateSettings: (patch) => repo.updateSettings(patch),
      };
    },
    share: async () => {},
    describe: async () => ref,
    listSharing: sharingCalls,
  };
  const storage = createMemoryStorage();
  storage.setItem(SESSION_KEY, JSON.stringify({ mode: 'google', user: ME, recentLedgers: [ref], activeLedgerId: ref.id }));
  const deps: Partial<StateDeps> = {
    google: fakeGoogle(),
    local: new LocalBackend(createMemoryStorage()),
    sheets,
    now: () => new Date(2026, 10, 20, 10),
    storage,
    restoreTimeoutMs: 10,
    demoCouple: false,
  };
  const wrapper = ({ children }: { children: ReactNode }) => <AppProviders deps={deps}>{children}</AppProviders>;
  const r = renderHook(() => ({ session: useSession(), ledger: useLedger() }), { wrapper });
  await waitFor(() => expect(r.result.current.ledger.status).toBe('ready'));
  return { r, writes, sharingCalls, stored: () => inner.open({ ...ref, source: 'local' }).load() };
}

function ledgerWith(members: LedgerData['members']): LedgerData {
  const d = createDefaultLedger('shared', '우리집', '2026-11-20', '2026-11-20T00:00:00Z', ME.email, ME.name);
  return { ...d, members };
}

describe('멤버 — 구글 시트 공유 목록에서', () => {
  it('불러올 때 더하고 · 이름을 고치고 · 빠진 사람은 공유 안 됨으로 한 번에 쓰고, 다시 불러와도 바뀐 게 없으면 쓰지 않아요', async () => {
    const data = ledgerWith([
      { email: 'me@example.com', displayName: '가나다' },
      { email: 'partner@example.com', displayName: '예전이름' },
      { email: 'gone@example.com', displayName: '라마' },
    ]);
    const { r, writes, sharingCalls, stored } = await setupSheets(data, async () => ({
      complete: true,
      users: [
        { email: 'me@example.com', displayName: '가나다', role: 'owner' },
        { email: 'partner@example.com', displayName: '바사아', role: 'writer' },
        { email: 'viewer@example.com', displayName: '자차카', role: 'reader' },
      ],
    }));
    expect(sharingCalls).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.emails.sort()).toEqual(['gone@example.com', 'me@example.com', 'partner@example.com', 'viewer@example.com']);
    const d = r.result.current.ledger.data!;
    expect(d.members.find((m) => m.email === 'gone@example.com')).toMatchObject({ shared: false, displayName: '라마' });
    expect(ledgerPeople(d).map((p) => p.email).sort()).toEqual(['me@example.com', 'partner@example.com', 'viewer@example.com']);
    expect(peopleOptions(d).map((p) => p.email)).not.toContain('gone@example.com');
    expect(r.result.current.ledger.claimPayers).not.toContain('라마');
    expect(r.result.current.ledger.displayName('gone@example.com')).toBe('라마');
    expect(r.result.current.ledger.displayName('partner@example.com')).toBe('바사아');
    expect((await stored()).members.find((m) => m.email === 'viewer@example.com')).toMatchObject({ role: 'reader', shared: true });

    let result: string | undefined;
    await act(async () => {
      result = await r.result.current.ledger.refreshSharing();
    });
    expect(result).toBe('synced');
    expect(sharingCalls).toHaveBeenCalledTimes(2);
    expect(writes).toHaveLength(1);
  });

  it('공유 목록을 못 읽으면(보기 권한 403) 멤버는 그대로 두고 나만 넣어요', async () => {
    const data = ledgerWith([{ email: 'owner@example.com', displayName: '라마' }]);
    const { r, writes } = await setupSheets(data, async () => {
      throw Object.assign(new Error('forbidden'), { status: 403 });
    });
    expect(r.result.current.ledger.status).toBe('ready');
    expect(r.result.current.ledger.data!.members).toEqual([
      { email: 'owner@example.com', displayName: '라마' },
      { email: 'me@example.com', displayName: '가나다', shared: true, role: null },
    ]);
    expect(writes).toEqual([{ emails: ['me@example.com'] }]);
    let result: string | undefined;
    await act(async () => {
      result = await r.result.current.ledger.refreshSharing();
    });
    expect(result).toBe('unavailable');
    expect(writes).toHaveLength(1);
  });

  it('나만 공유돼 있으면 사람 고르기 · 낸 사람 · 생활비 이름 모두 나(구글 이름) 하나', async () => {
    const data = ledgerWith([{ email: 'me@example.com', displayName: '' }]);
    const { r } = await setupSheets(data, async () => ({
      complete: true,
      users: [{ email: 'me@example.com', displayName: '가나다', role: 'owner' }],
    }));
    const ledger = r.result.current.ledger;
    expect(ledger.data!.members).toEqual([{ email: 'me@example.com', displayName: '가나다', shared: true, role: 'owner' }]);
    expect(peopleOptions(ledger.data)).toEqual([{ name: '가나다', email: 'me@example.com' }]);
    expect(ledger.claimPayers).toEqual(['가나다']);
    expect(ledger.spenders.map((s) => s.name)).toEqual(['가나다']);
    expect(ledger.livingViews.length).toBeLessThanOrEqual(1);
    for (const v of ledger.livingViews) expect(v.name).toBe('가나다');
  });
});

describe('체험 모드(브라우저 저장)는 그대로', () => {
  it('체험 멤버를 바꾸지 않고 공유 목록도 읽지 않아요', async () => {
    const deps: Partial<StateDeps> = {
      google: { ...fakeGoogle(), isGoogleConfigured: () => false },
      local: new LocalBackend(createMemoryStorage()),
      sheets: {} as LedgerBackend,
      now: () => new Date(2026, 10, 20, 10),
      storage: createMemoryStorage(),
      restoreTimeoutMs: 10,
      demoCouple: false,
    };
    const wrapper = ({ children }: { children: ReactNode }) => <AppProviders deps={deps}>{children}</AppProviders>;
    const r = renderHook(() => ({ session: useSession(), ledger: useLedger() }), { wrapper });
    await waitFor(() => expect(r.result.current.session.status).toBe('signedOut'));
    await act(async () => {
      await r.result.current.session.startDemo();
    });
    await waitFor(() => expect(r.result.current.ledger.status).toBe('ready'));
    expect(r.result.current.ledger.data!.members).toEqual(DEMO_MEMBERS.map((m) => ({ ...m })));
    let result: string | undefined;
    await act(async () => {
      result = await r.result.current.ledger.refreshSharing();
    });
    expect(result).toBe('unavailable');
    expect(r.result.current.ledger.data!.members).toEqual(DEMO_MEMBERS.map((m) => ({ ...m })));
  });
});
