// @vitest-environment jsdom
/** 검증된 결함 회귀 테스트 (상태 계층) */
import { act, renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import type { ReactNode } from 'react';
import { createMemoryStorage, LocalBackend } from '@/storage';
import type { LedgerData } from '@/domain/types';
import type { LedgerBackend, LedgerRef, LedgerRepository, TableName, TableRows } from '@/storage/types';
import { AppProviders } from './Providers';
import { useLedger } from './ledger';
import { useSession, type GoogleDeps, type StateDeps } from './session';

function fakeGoogle(): GoogleDeps {
  return {
    isGoogleConfigured: () => false,
    signIn: async () => ({ email: 'a@b.c', name: 'A', picture: null }),
    signOut: () => {},
    restoreSession: () => new Promise(() => {}),
    pickSpreadsheet: async () => null,
    getAccessToken: async () => 'token',
  };
}

type Op = `${'insert' | 'upsert'}:${TableName}`;

/** 정한 쓰기를 한 번 실패시키거나, load 를 붙잡아 둘 수 있는 로컬 백엔드 */
class FlakyLocal extends LocalBackend {
  failOnce: Op | null = null;
  ops: Op[] = [];
  gate: Promise<void> | null = null;
  open(ref: LedgerRef): LedgerRepository {
    const repo = super.open(ref);
    const self = this;
    const run = async <R,>(op: Op, fn: () => Promise<R>): Promise<R> => {
      self.ops.push(op);
      if (self.failOnce === op) {
        self.failOnce = null;
        throw new Error('네트워크 오류');
      }
      return fn();
    };
    return {
      ref: repo.ref,
      load: async () => {
        const snapshot: LedgerData = await repo.load();
        if (self.gate) await self.gate;
        return snapshot;
      },
      insert: <T extends TableName>(t: T, rows: TableRows[T][]) => run(`insert:${t}` as Op, () => repo.insert(t, rows)),
      upsert: <T extends TableName>(t: T, row: TableRows[T]) => run(`upsert:${t}` as Op, () => repo.upsert(t, row)),
      upsertMany: <T extends TableName>(t: T, rows: TableRows[T][]) => repo.upsertMany(t, rows),
      updateSettings: repo.updateSettings.bind(repo),
    };
  }
}

function setup() {
  const clock = { now: new Date(2026, 10, 20, 10, 0, 0) };
  const local = new FlakyLocal(createMemoryStorage());
  const deps: Partial<StateDeps> = {
    google: fakeGoogle(),
    local,
    sheets: {} as LedgerBackend,
    now: () => clock.now,
    storage: createMemoryStorage(),
    restoreTimeoutMs: 50,
    demoCouple: false,
  };
  const wrapper = ({ children }: { children: ReactNode }) => <AppProviders deps={deps}>{children}</AppProviders>;
  const hook = renderHook(() => ({ session: useSession(), ledger: useLedger() }), { wrapper });
  return { ...hook, clock, local };
}

async function startDemo(r: ReturnType<typeof setup>) {
  await waitFor(() => expect(r.result.current.session.status).toBe('signedOut'));
  await act(async () => {
    await r.result.current.session.startDemo();
  });
  await waitFor(() => expect(r.result.current.ledger.status).toBe('ready'));
}

async function moveTo(r: ReturnType<typeof setup>, d: Date) {
  r.clock.now = d;
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await waitFor(() => expect(r.result.current.ledger.today).toBe(iso));
}

const stored = (r: ReturnType<typeof setup>) => r.local.open(r.result.current.ledger.ref!).load();

describe('fix ① applied twice', () => {
  it('changes the successor rule instead of adding a parallel one', async () => {
    const r = setup();
    await startDemo(r);
    const L = () => r.result.current.ledger;
    await moveTo(r, new Date(2026, 11, 5, 9, 0, 0));
    await waitFor(() => expect(L().data!.transfers.some((t) => t.id === 'auto:demo-rule-event:2026-12')).toBe(true));
    const fix1 = L().shortageFix!.increaseMonthly!;
    expect(fix1.fromMonth).toBe('2027-01');
    await act(async () => {
      await L().applyIncreaseMonthly(fix1);
    });
    await act(async () => {
      await L().addEvent({ date: '2027-07-10', name: '큰 일정', amount: 1_500_000 });
    });
    const fix2 = L().shortageFix!.increaseMonthly!;
    await act(async () => {
      await L().applyIncreaseMonthly(fix2);
    });
    const active = L().data!.rules.filter(
      (x) => !x.deleted && x.toAccountId === 'demo-acc-event' && (x.endMonth === null || x.endMonth >= '2027-01') && x.startMonth <= '2027-01',
    );
    expect(active).toHaveLength(1);
    expect(active[0]!.amount).toBe(300_000 + fix1.amount + fix2.amount);
    expect(L().eventProjection!.months[1]!.contributions).toBe(300_000 + fix1.amount + fix2.amount);
  });
});

describe('cancel one occurrence of a repeating event', () => {
  it('keeps the series going', async () => {
    const r = setup();
    await startDemo(r);
    const L = () => r.result.current.ledger;
    let ev = L().data!.events[0]!;
    await act(async () => {
      ev = await L().addEvent({ date: '2026-10-15', name: '부모님 용돈', amount: 100_000, repeat: 'monthly' });
    });
    await act(async () => {
      await L().cancelEvent(ev.id);
    });
    const events = L().data!.events.filter((e) => e.name === '부모님 용돈');
    expect(events.find((e) => e.id === ev.id)?.status).toBe('canceled');
    const next = events.find((e) => e.status === 'planned');
    expect(next).toMatchObject({ date: '2026-11-15', repeat: 'monthly', id: `${ev.id}@2026-11-15` });
    expect(L().eventProjection!.months.every((m) => m.events.some((x) => x.name === '부모님 용돈'))).toBe(true);
  });
});

describe('multi-step writes are safe to retry', () => {
  it('completeEvent: partial failure then retry → one expense, next occurrence kept', async () => {
    const r = setup();
    await startDemo(r);
    const L = () => r.result.current.ledger;
    const ev = L().data!.events.find((e) => e.id === 'demo-event-anniversary')!;
    r.local.failOnce = 'upsert:events';
    await act(async () => {
      await expect(L().completeEvent(ev.id, 100_000)).rejects.toThrow();
    });
    // 저장본으로 다시 맞춰짐: 지출은 저장됨, 일정은 아직 예정
    await waitFor(async () => expect((await stored(r)).expenses.filter((e) => e.eventId === ev.id)).toHaveLength(1));
    await act(async () => {
      await L().completeEvent(ev.id, 100_000);
    });
    const s = await stored(r);
    expect(s.expenses.filter((e) => e.eventId === ev.id)).toHaveLength(1);
    expect(s.events.find((e) => e.id === ev.id)?.status).toBe('done');
    expect(s.events.filter((e) => e.id.startsWith(`${ev.id}@`) && e.status === 'planned')).toHaveLength(1);
  });

  it('decideMonthEnd: transfer saved but month-end row failed → retry completes it', async () => {
    const r = setup();
    await startDemo(r);
    const L = () => r.result.current.ledger;
    await moveTo(r, new Date(2026, 11, 2, 9, 0, 0));
    await waitFor(() => expect(L().pendingMonthEnd?.month).toBe('2026-11'));
    const reservoirBefore = L().balances['demo-acc-reservoir']!;
    r.local.failOnce = 'upsert:monthEnds';
    await act(async () => {
      await expect(L().decideMonthEnd('reservoir')).rejects.toThrow();
    });
    // 이체만 저장됐어도 잔액에는 들어가지 않는다
    await waitFor(() => expect(L().pendingMonthEnd?.month).toBe('2026-11'));
    expect(L().balances['demo-acc-reservoir']).toBe(reservoirBefore);
    const leftover = L().pendingMonthEnd!.leftover;
    await act(async () => {
      await L().decideMonthEnd('reservoir');
    });
    expect(L().pendingMonthEnd).toBeNull();
    expect(L().balances['demo-acc-reservoir']).toBe(reservoirBefore + leftover);
    const s = await stored(r);
    expect(s.transfers.filter((t) => t.id === 'monthend:2026-11')).toHaveLength(1);
    expect(s.monthEnds.find((m) => m.month === '2026-11')?.choice).toBe('reservoir');
  });

  it('changeRuleAmount: failure after the new rule is saved shows the saved state and retry does not duplicate', async () => {
    const r = setup();
    await startDemo(r);
    const L = () => r.result.current.ledger;
    await moveTo(r, new Date(2026, 11, 3, 9, 0, 0));
    await waitFor(() => expect(L().data!.transfers.some((t) => t.id === 'auto:demo-rule-event:2026-12')).toBe(true));
    r.local.failOnce = 'upsert:rules';
    await act(async () => {
      await expect(L().changeRuleAmount('demo-rule-event', 500_000)).rejects.toThrow();
    });
    await act(async () => {
      await L().changeRuleAmount('demo-rule-event', 500_000);
    });
    const s = await stored(r);
    const rules = s.rules.filter((x) => x.toAccountId === 'demo-acc-event');
    expect(rules).toHaveLength(2);
    expect(rules.find((x) => x.id === 'demo-rule-event')?.endMonth).toBe('2026-12');
    expect(rules.find((x) => x.id === 'demo-rule-event@2027-01')).toMatchObject({ amount: 500_000, startMonth: '2027-01' });
  });
});

describe('a reload in flight does not hide writes made meanwhile', () => {
  it('keeps the expense recorded while the day-change reload was loading', async () => {
    const r = setup();
    await startDemo(r);
    const L = () => r.result.current.ledger;
    let release!: () => void;
    r.local.gate = new Promise<void>((res) => {
      release = res;
    });
    r.clock.now = new Date(2026, 10, 21, 8, 0, 0);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(L().today).toBe('2026-11-21'));
    let id = '';
    await act(async () => {
      id = (await L().addExpense({ date: '2026-11-21', amount: 4_500, accountId: 'demo-acc-fixed', categoryId: null, memo: '커피' })).id;
    });
    r.local.gate = null;
    await act(async () => {
      release();
      await new Promise((res) => setTimeout(res, 20));
    });
    expect(L().data!.expenses.some((e) => e.id === id)).toBe(true);
  });
});

describe('google: forceRefresh and reconnect', () => {
  it('401 retry asks the google module for a fresh token', async () => {
    const { useSessionInternals } = await import('./session');
    const calls: (boolean | undefined)[] = [];
    const google: GoogleDeps = { ...fakeGoogle(), getAccessToken: async (force?: boolean) => (calls.push(force), force ? 'fresh' : 'stale') };
    const fetchMock = vi.fn(async (_u: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).Authorization;
      return new Response('{}', { status: auth === 'Bearer stale' ? 401 : 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const deps: Partial<StateDeps> = { google, local: new LocalBackend(createMemoryStorage()), now: () => new Date(2026, 10, 20), storage: createMemoryStorage() };
      const wrapper = ({ children }: { children: ReactNode }) => <AppProviders deps={deps}>{children}</AppProviders>;
      const hook = renderHook(() => useSessionInternals(), { wrapper });
      await hook.result.current.backendFor({ source: 'sheets' }).share({ id: 's', name: '', kind: 'shared', source: 'sheets' }, 'a@b.c');
      expect(calls).toEqual([false, true]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a load that cannot get a token silently asks for reconnect', async () => {
    const { GoogleError } = await import('@/google/errors');
    const { SESSION_KEY } = await import('./storageKeys');
    const storage = createMemoryStorage();
    const ref: LedgerRef = { id: 'sheet-1', name: '우리집', kind: 'shared', source: 'sheets' };
    storage.setItem(SESSION_KEY, JSON.stringify({ mode: 'google', user: { email: 'a@b.c', name: 'A', picture: null }, recentLedgers: [ref], activeLedgerId: ref.id }));
    const reconnect = vi.fn(async () => ({ email: 'a@b.c', name: 'A', picture: null }));
    let fail = true;
    const sheets = {
      source: 'sheets',
      open: () => ({
        ref,
        load: async () => {
          if (fail) throw new GoogleError('popup_blocked');
          return (await import('@/domain')).createDefaultLedger('shared', '우리집', '2026-11-20', '2026-11-20T00:00:00Z', 'a@b.c', 'A');
        },
        insert: async () => {},
        upsert: async () => {},
        upsertMany: async () => {},
        updateSettings: async () => {},
      }),
    } as unknown as LedgerBackend;
    const deps: Partial<StateDeps> = { google: { ...fakeGoogle(), reconnect }, local: new LocalBackend(createMemoryStorage()), sheets, now: () => new Date(2026, 10, 20), storage, restoreTimeoutMs: 10, demoCouple: false };
    const wrapper = ({ children }: { children: ReactNode }) => <AppProviders deps={deps}>{children}</AppProviders>;
    const r = renderHook(() => ({ session: useSession(), ledger: useLedger() }), { wrapper });
    await waitFor(() => expect(r.result.current.ledger.status).toBe('error'));
    expect(r.result.current.ledger.needsReconnect).toBe(true);
    fail = false;
    await act(async () => {
      await r.result.current.session.reconnectGoogle();
      await r.result.current.ledger.reload();
    });
    expect(reconnect).toHaveBeenCalledWith('a@b.c');
    expect(r.result.current.ledger.status).toBe('ready');
    expect(r.result.current.ledger.needsReconnect).toBe(false);
  });
});
