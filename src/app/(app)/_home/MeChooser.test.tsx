// @vitest-environment jsdom
/**
 * '나' 찾기 (PLAN 4-8): 열 때 주인 이메일 자동으로 쓰기(한 번 알림, 다시 열면 쓰지 않음) ·
 * 이어지지 않았으면 첫 사람을 '나'로 짐작하지 않고 '누가 나인지 골라 주세요' → 고르면 시트에 써요
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useLayoutEffect, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoLedger } from '@/domain';
import type { LedgerData } from '@/domain/types';
import { AppProviders, useLedger, type GoogleDeps, type LedgerApi, type StateDeps } from '@/state';
import { SESSION_KEY } from '@/state/storageKeys';
import { createMemoryStorage, LocalBackend } from '@/storage';
import type { LedgerBackend, LedgerRef } from '@/storage/types';
import { ToastProvider } from '@/ui';
import { HomeView } from './HomeView';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

afterEach(cleanup);

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

/** 가져온 가계부: 통장 주인 이름만 있고 주인 이메일이 없어요. 기쁜이 첫 생활비 통장 */
function imported(myOwnerName: string): LedgerData {
  const d = createDemoLedger('2026-11-20', '2026-11-20T01:00:00.000Z', { couple: true });
  const ownerOf: Record<string, string> = {
    'demo-acc-income': myOwnerName,
    'demo-acc-living-minji': '기쁜',
    'demo-acc-allowance-minji': '기쁜',
    'demo-acc-living-junho': myOwnerName,
    'demo-acc-allowance-junho': myOwnerName,
  };
  // 생활비 배분은 이미 '알아서 맞추기', 용돈은 매달 같은 금액 (배분 자동 고치기 알림은 따로 시험해요 — state/ruleKindMigration.test)
  const autoInto = new Set(['demo-acc-living-minji', 'demo-acc-living-junho']);
  return {
    ...d,
    rules: d.rules.map((r) => (autoInto.has(r.toAccountId) ? { ...r, kind: 'auto' as const, amount: 0 } : r)),
    accounts: d.accounts.map((a) => ({ ...a, ownerName: ownerOf[a.id] ?? null, ownerEmail: null })),
    members: [{ email: 'gb@example.com', displayName: '기쁜', shared: true, role: 'writer' }],
  };
}

const box: { ledger: LedgerApi | null } = { ledger: null };
function Probe() {
  const ledger = useLedger();
  useLayoutEffect(() => {
    box.ledger = ledger;
  });
  return null;
}

async function setup(data: LedgerData, opts: { readOnly?: boolean } = {}) {
  const inner = new LocalBackend(createMemoryStorage());
  const created = await inner.create(data);
  const ref: LedgerRef = { ...created, source: 'sheets' };
  const accountWrites: string[][] = [];
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
          if (t === 'accounts') {
            if (opts.readOnly) throw new Error('403');
            accountWrites.push(rows.map((x) => (x as { id: string }).id));
          }
          await repo.upsertMany(t, rows);
        },
        updateSettings: (patch) => repo.updateSettings(patch),
      };
    },
    share: async () => {},
    describe: async () => ref,
    listSharing: async () => ({
      users: [
        { email: ME.email, displayName: ME.name, role: 'owner' },
        { email: 'gb@example.com', displayName: '기쁜', role: 'writer' },
      ],
      complete: true,
    }),
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
    demoHistory: false,
  };
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <ToastProvider>
      <AppProviders deps={deps}>
        <Probe />
        {children}
      </AppProviders>
    </ToastProvider>
  );
  await act(async () => {
    render(<HomeView />, { wrapper: Wrapper });
  });
  await waitFor(() => expect(box.ledger?.status).toBe('ready'));
  return { accountWrites, stored: () => inner.open({ ...ref, source: 'local' }).load() };
}

describe("'나' 찾기", () => {
  it('구글 이름이 주인 이름과 맞으면 열 때 주인 이메일을 한 번에 써 두고 한 번 알려요. 다시 열면 쓰지 않아요', async () => {
    const s = await setup(imported('나다'));
    await waitFor(() => expect(box.ledger!.myLivingAccountId).toBe('demo-acc-living-junho'));
    expect(s.accountWrites).toHaveLength(1);
    expect(s.accountWrites[0]!.sort()).toEqual(
      ['demo-acc-allowance-junho', 'demo-acc-allowance-minji', 'demo-acc-income', 'demo-acc-living-junho', 'demo-acc-living-minji'].sort(),
    );
    expect(box.ledger!.notice).toBe('통장 주인을 멤버와 이었어요');
    const stored = await s.stored();
    expect(stored.accounts.filter((a) => a.ownerName === '나다').every((a) => a.ownerEmail === ME.email)).toBe(true);
    expect(stored.accounts.filter((a) => a.ownerName === '기쁜').every((a) => a.ownerEmail === 'gb@example.com')).toBe(true);
    expect(screen.queryByRole('region', { name: '누가 나인지 골라 주세요' })).toBeNull();
    act(() => box.ledger!.dismissNotice());
    await act(async () => {
      await box.ledger!.reload();
    });
    expect(s.accountWrites).toHaveLength(1);
    expect(box.ledger!.notice).toBeNull();
  });

  it('이름으로 못 이으면 첫 사람(기쁜)을 나로 짐작하지 않고 모두 합친 화면 + 고르기, 고르면 내 통장이 이어져요', async () => {
    const s = await setup(imported('민구'));
    // 기쁜만 자동으로 이어지고, 민구는 이름이 달라(가나다) 남아요
    expect(box.ledger!.myLivingAccountId).toBeNull();
    expect(box.ledger!.meChoices).toEqual(['민구']);
    const chooser = await screen.findByRole('region', { name: '누가 나인지 골라 주세요' });
    // 모두 합친 화면: 사람 고르기 · '(나)' 없이 '오늘 써도 되는 돈'
    expect(screen.queryByText(/\(나\)/)).toBeNull();
    expect(screen.getByRole('region', { name: '오늘 써도 되는 돈' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(chooser).getByRole('button', { name: '민구' }));
    });
    await waitFor(() => expect(box.ledger!.myLivingAccountId).toBe('demo-acc-living-junho'));
    expect(box.ledger!.meChoices).toEqual([]);
    expect(screen.queryByRole('region', { name: '누가 나인지 골라 주세요' })).toBeNull();
    expect(screen.getByRole('radio', { name: '민구 (나)' })).toBeTruthy();
    const stored = await s.stored();
    expect(stored.accounts.filter((a) => a.ownerName === '민구').map((a) => a.ownerEmail)).toEqual([ME.email, ME.email, ME.email]);
  });

  it('보기 권한이라 못 써도 화면에서는 이어 보여 주고 알림은 띄우지 않아요', async () => {
    await setup(imported('나다'), { readOnly: true });
    await waitFor(() => expect(box.ledger!.myLivingAccountId).toBe('demo-acc-living-junho'));
    expect(box.ledger!.notice).toBeNull();
  });
});
