// @vitest-environment jsdom
/** 여행 — 상태 계층 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { DEMO_TRIP_ID } from '@/domain';
import type { LedgerData } from '@/domain/types';
import { createMemoryStorage, LocalBackend } from '@/storage';
import type { LedgerBackend } from '@/storage/types';
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

function setup() {
  const local = new LocalBackend(createMemoryStorage());
  const deps: Partial<StateDeps> = {
    google: fakeGoogle(),
    local,
    sheets: {} as LedgerBackend,
    now: () => new Date(2026, 10, 20, 10, 0, 0),
    storage: createMemoryStorage(),
    restoreTimeoutMs: 50,
    demoCouple: false,
    demoHistory: false,
  };
  const wrapper = ({ children }: { children: ReactNode }) => <AppProviders deps={deps}>{children}</AppProviders>;
  const hook = renderHook(() => ({ session: useSession(), ledger: useLedger() }), { wrapper });
  return { ...hook, local };
}

async function startDemo(r: ReturnType<typeof setup>) {
  await waitFor(() => expect(r.result.current.session.status).toBe('signedOut'));
  await act(async () => {
    await r.result.current.session.startDemo();
  });
  await waitFor(() => expect(r.result.current.ledger.status).toBe('ready'));
}

const stored = (r: ReturnType<typeof setup>): Promise<LedgerData> => r.local.open(r.result.current.ledger.ref!).load();

describe('여행', () => {
  it('체험 가계부에는 다가오는 제주 여행이 있고 남은 예산이 예측에 들어가요', async () => {
    const r = setup();
    await startDemo(r);
    const l = r.result.current.ledger;
    expect(l.trips.map((t) => t.trip.id)).toEqual([DEMO_TRIP_ID]);
    const s = l.trips[0]!;
    expect(s.spent).toBe(450_000);
    expect(s.remaining).toBe(450_000);
    const feb = l.eventProjection!.months.find((m) => m.month === '2027-02')!;
    expect(feb.trips).toBe(450_000);
  });

  it('추가 · 지출 묶기 · 고치기 · 지우기 · 되살리기', async () => {
    const r = setup();
    await startDemo(r);
    let id = '';
    await act(async () => {
      const t = await r.result.current.ledger.addTrip({
        name: ' 오사카 ', startDate: '2027-04-01', endDate: '2027-04-04', budget: 1_500_000, items: { flight: 500_000, stay: 0 },
      });
      id = t.id;
    });
    let saved = (await stored(r)).trips.find((t) => t.id === id)!;
    expect(saved).toMatchObject({ name: '오사카', budget: 1_500_000, items: { flight: 500_000 }, deleted: false });

    const reservoir = r.result.current.ledger.accountByRole('reservoir')!;
    await act(async () => {
      await r.result.current.ledger.addExpense({
        date: '2026-11-20', amount: 420_000, accountId: reservoir.id, categoryId: null, memo: '항공권', tripId: id, tripItem: 'flight',
      });
    });
    let s = r.result.current.ledger.trips.find((t) => t.trip.id === id)!;
    expect(s.spent).toBe(420_000);
    expect(s.spentElsewhere).toBe(420_000);
    expect(r.result.current.ledger.eventProjection!.months.find((m) => m.month === '2027-04')!.trips).toBe(1_080_000);
    const ex = (await stored(r)).expenses.find((e) => e.memo === '항공권')!;
    expect(ex).toMatchObject({ tripId: id, tripItem: 'flight', accountId: reservoir.id });

    await act(async () => {
      await r.result.current.ledger.updateTrip(id, { name: '오사카', startDate: '2027-04-01', endDate: '2027-04-05', budget: 2_000_000 });
    });
    saved = (await stored(r)).trips.find((t) => t.id === id)!;
    expect(saved).toMatchObject({ endDate: '2027-04-05', budget: 2_000_000, items: {} });

    // 묶은 지출을 풀면 여행에서 빠져요
    await act(async () => {
      await r.result.current.ledger.updateExpense({ ...ex, tripId: null, tripItem: null });
    });
    s = r.result.current.ledger.trips.find((t) => t.trip.id === id)!;
    expect(s.spent).toBe(0);

    await act(async () => {
      await r.result.current.ledger.deleteTrip(id);
    });
    expect(r.result.current.ledger.trips.some((t) => t.trip.id === id)).toBe(false);
    expect((await stored(r)).trips.find((t) => t.id === id)!.deleted).toBe(true);
    await act(async () => {
      await r.result.current.ledger.restoreTrip(id);
    });
    expect(r.result.current.ledger.trips.some((t) => t.trip.id === id)).toBe(true);
  });

  it('없는 여행 · 잘못된 입력은 거절해요', async () => {
    const r = setup();
    await startDemo(r);
    const event = r.result.current.ledger.accountByRole('event')!;
    await expect(
      r.result.current.ledger.addExpense({ date: '2026-11-20', amount: 1000, accountId: event.id, categoryId: null, tripId: 'nope' }),
    ).rejects.toThrow('여행을 찾을 수 없어요');
    await expect(
      r.result.current.ledger.addTrip({ name: '', startDate: '2027-01-01', endDate: '2027-01-02', budget: 1 }),
    ).rejects.toThrow('여행 이름을 입력해 주세요');
  });

  it('사도 돼?에서 여행을 고르면 여행 남은 예산으로 판단해요', async () => {
    const r = setup();
    await startDemo(r);
    const v = r.result.current.ledger.judge(100_000, 'event', null, { tripId: DEMO_TRIP_ID })!;
    expect(v.details).toContainEqual({ label: '제주 여행 남은 예산', value: '350,000원' });
  });
});
