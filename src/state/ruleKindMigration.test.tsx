// @vitest-environment jsdom
/**
 * 기존 시트 자동 고치기 (8-1, PLAN 4-15): 열 때 생활비 · 용돈 통장으로 가는 '매달 같은 금액' 배분을
 * '알아서 맞추기'로 한 번에 쓰고 한 번 알려요. 다시 열면 쓰지 않고, 이벤트 · 저축 · 남는 돈 전부는 그대로
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useLayoutEffect, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTO_KIND_NOTICE, createDemoLedger } from '@/domain';
import type { LedgerData } from '@/domain/types';
import { AppProviders, useLedger, type GoogleDeps, type LedgerApi, type StateDeps } from '@/state';
import { SESSION_KEY } from '@/state/storageKeys';
import { createMemoryStorage, LocalBackend } from '@/storage';
import type { LedgerBackend, LedgerRef } from '@/storage/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

afterEach(cleanup);

const ME = { email: 'junho@demo.com', name: '준호', picture: null };

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
  const ruleWrites: string[][] = [];
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
          if (t === 'rules') {
            if (opts.readOnly) throw new Error('403');
            ruleWrites.push(rows.map((x) => (x as { id: string }).id));
          }
          await repo.upsertMany(t, rows);
        },
        updateSettings: (patch) => repo.updateSettings(patch),
      };
    },
    share: async () => {},
    describe: async () => ref,
    listSharing: async () => ({ users: [], complete: false }),
  };
  const storage = createMemoryStorage();
  storage.setItem(SESSION_KEY, JSON.stringify({ mode: 'google', user: ME, recentLedgers: [ref], activeLedgerId: ref.id }));
  const deps: Partial<StateDeps> = {
    google: fakeGoogle(),
    local: new LocalBackend(createMemoryStorage()),
    sheets,
    now: () => new Date(2026, 10, 12, 10),
    storage,
    restoreTimeoutMs: 10,
    demoCouple: false,
  };
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AppProviders deps={deps}>
      <Probe />
      {children}
    </AppProviders>
  );
  await act(async () => {
    render(<div />, { wrapper: Wrapper });
  });
  await waitFor(() => expect(box.ledger?.status).toBe('ready'));
  return { ruleWrites, stored: () => inner.open({ ...ref, source: 'local' }).load() };
}

/** 부부 예시 그대로: 생활비 · 용돈 4개는 매달 같은 금액, 이벤트 · 저축은 매달 같은 금액, 저수지는 남는 돈 전부 */
const sheet = () => createDemoLedger('2026-11-12', '2026-11-12T01:00:00.000Z', { couple: true });
const LIVING_ALLOWANCE = ['demo-acc-living-minji', 'demo-acc-living-junho', 'demo-acc-allowance-minji', 'demo-acc-allowance-junho'];

describe('배분 방식 자동 고치기', () => {
  it('생활비 · 용돈 배분만 한 번에 알아서 맞추기로 쓰고 한 번 알려요. 다시 열면 쓰지 않아요', async () => {
    const before = sheet();
    const s = await setup(before);
    await waitFor(() => expect(s.ruleWrites).toHaveLength(1));
    const into = (id: string) => before.rules.find((r) => r.toAccountId === id)!.id;
    expect(s.ruleWrites[0]!.sort()).toEqual(LIVING_ALLOWANCE.map(into).sort());
    expect(box.ledger!.notice).toBe(AUTO_KIND_NOTICE);

    const stored = await s.stored();
    for (const r of stored.rules) {
      const was = before.rules.find((x) => x.id === r.id)!;
      if (LIVING_ALLOWANCE.includes(r.toAccountId)) expect(r).toMatchObject({ kind: 'auto', amount: 0 });
      else expect(r).toEqual(was);
    }
    expect(box.ledger!.data!.rules.filter((r) => r.kind === 'auto')).toHaveLength(4);

    act(() => box.ledger!.dismissNotice());
    await act(async () => {
      await box.ledger!.reload();
    });
    expect(s.ruleWrites).toHaveLength(1);
    expect(box.ledger!.notice).toBeNull();
  });

  it('보기 권한이라 못 쓰면 그대로 두고 알리지 않아요', async () => {
    const s = await setup(sheet(), { readOnly: true });
    expect(s.ruleWrites).toHaveLength(0);
    expect(box.ledger!.notice).toBeNull();
    expect(box.ledger!.data!.rules.some((r) => r.kind === 'auto')).toBe(false);
  });
});
