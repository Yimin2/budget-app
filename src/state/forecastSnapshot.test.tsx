// @vitest-environment jsdom
/**
 * 예측 기록 (PLAN 4-2 · 5장 예측기록): 구글 시트 가계부를 그달 처음 열면 이번 달 + 다음 11개월 예측을 한 번 써요.
 * 이미 그달 기록이 있으면 쓰지 않고, 실패해도 화면은 그대로(조용히 남김), 체험 · 브라우저 가계부는 쓰지 않아요
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useLayoutEffect, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoLedger, forecastId } from '@/domain';
import type { ForecastSnapshot, LedgerData } from '@/domain/types';
import { AppProviders, useLedger, useSession, type GoogleDeps, type LedgerApi, type SessionApi, type StateDeps } from '@/state';
import { SESSION_KEY } from '@/state/storageKeys';
import { createMemoryStorage, LocalBackend } from '@/storage';
import type { LedgerBackend, LedgerRef, TableName } from '@/storage/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ME = { email: 'junho@demo.com', name: '준호', picture: null };
const NOW = new Date(2026, 10, 12, 10);

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

const box: { ledger: LedgerApi | null; session: SessionApi | null } = { ledger: null, session: null };
function Probe() {
  const ledger = useLedger();
  const session = useSession();
  useLayoutEffect(() => {
    box.ledger = ledger;
    box.session = session;
  });
  return null;
}

async function setup(data: LedgerData, opts: { failForecasts?: boolean; slowForecasts?: Promise<void> } = {}) {
  const inner = new LocalBackend(createMemoryStorage());
  const created = await inner.create(data);
  const ref: LedgerRef = { ...created, source: 'sheets' };
  const inserts: { table: TableName; ids: string[] }[] = [];
  const sheets: LedgerBackend = {
    source: 'sheets',
    create: async () => ref,
    open: (r) => {
      const repo = inner.open({ ...r, source: 'local' });
      return {
        ref: r,
        load: () => repo.load(),
        insert: async (t, rows) => {
          if (t === 'forecasts') {
            inserts.push({ table: t, ids: rows.map((x) => (x as { id: string }).id) });
            if (opts.slowForecasts) await opts.slowForecasts;
            if (opts.failForecasts) throw new Error('429');
          }
          await repo.insert(t, rows);
        },
        upsert: (t, row) => repo.upsert(t, row),
        upsertMany: (t, rows) => repo.upsertMany(t, rows),
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
    now: () => NOW,
    storage,
    restoreTimeoutMs: 10,
    demoCouple: false,
    demoHistory: false,
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
  return { inserts, stored: () => inner.open({ ...ref, source: 'local' }).load() };
}

const sheet = () => createDemoLedger('2026-11-12', '2026-11-12T01:00:00.000Z', { claims: true, trips: true });
const old = (p: Partial<ForecastSnapshot> = {}): ForecastSnapshot => ({
  id: forecastId('2026-11', '2026-12'),
  recordedMonth: '2026-11',
  targetMonth: '2026-12',
  expected: 123,
  low: null,
  high: null,
  inflow: null,
  outflow: null,
  recordedAt: '2026-11-01T00:00:00.000Z',
  deleted: false,
  ...p,
});

describe('예측 기록 (구글 시트 가계부)', () => {
  it('그달 기록이 없으면 이번 달 + 다음 11개월을 한 번에 써요 (다른 탭은 그대로). 다시 불러와도 또 쓰지 않아요', async () => {
    const before = sheet();
    const s = await setup(before);
    await waitFor(() => expect(s.inserts).toHaveLength(1));
    expect(s.inserts[0]!.ids).toHaveLength(12);
    expect(s.inserts[0]!.ids[0]).toBe('forecast:2026-11:2026-11');
    const stored = await s.stored();
    expect(stored.forecasts).toHaveLength(12);
    expect(stored.forecasts[0]!.expected).toBe(box.ledger!.eventProjection!.months[0]!.endBalance);
    await waitFor(() => expect(box.ledger!.data!.forecasts).toHaveLength(12));
    await act(async () => {
      await box.ledger!.reload();
    });
    expect(s.inserts).toHaveLength(1);
    expect(box.ledger!.data!.forecasts).toHaveLength(12);
  });

  it('이미 그달 기록이 있으면 덮어쓰지 않아요 (처음 것이 기록)', async () => {
    const s = await setup({ ...sheet(), forecasts: [old()] });
    await act(async () => {
      await box.ledger!.reload();
    });
    expect(s.inserts).toHaveLength(0);
    expect((await s.stored()).forecasts).toEqual([old()]);
  });

  it('쓰기가 느려도 화면은 먼저 준비되고, 실패하면 조용히 남기고 다음 불러오기에서 다시 써요', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const s = await setup(sheet(), { failForecasts: true, slowForecasts: slow });
    expect(box.ledger!.status).toBe('ready');
    expect(s.inserts).toHaveLength(1);
    await act(async () => {
      release();
      await slow;
    });
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(box.ledger!.error).toBeNull();
    expect((await s.stored()).forecasts).toEqual([]);
    await act(async () => {
      await box.ledger!.reload();
    });
    expect(s.inserts).toHaveLength(2);
  });
});

describe('예측 기록 (체험)', () => {
  it('체험 가계부는 시트에 쓰지 않아요 (지난 기록 예시만 들고 있어요)', async () => {
    const storage = createMemoryStorage();
    const local = new LocalBackend(createMemoryStorage());
    const deps: Partial<StateDeps> = {
      google: fakeGoogle(),
      local,
      sheets: {} as LedgerBackend,
      now: () => NOW,
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
    await waitFor(() => expect(box.session?.status).toBe('signedOut'));
    await act(async () => {
      await box.session!.startDemo();
    });
    await waitFor(() => expect(box.ledger?.status).toBe('ready'));
    const forecasts = box.ledger!.data!.forecasts;
    expect(forecasts).toHaveLength(6);
    expect(forecasts.some((f) => f.recordedMonth === '2026-11')).toBe(false);
  });
});
