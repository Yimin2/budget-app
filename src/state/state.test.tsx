// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryStorage, LocalBackend, type KeyValueStorage } from '@/storage';
import type { LedgerBackend, TableName, TableRows } from '@/storage/types';
import { AppProviders } from './Providers';
import { useLedger } from './ledger';
import { useSession, type GoogleDeps, type StateDeps } from './session';
import { DEMO_LEDGER_ID, SESSION_KEY, THEME_KEY } from './storageKeys';

function fakeGoogle(overrides: Partial<GoogleDeps> = {}): GoogleDeps {
  return {
    isGoogleConfigured: () => false,
    signIn: async () => ({ email: 'a@b.c', name: 'A', picture: null }),
    signOut: () => {},
    restoreSession: () => new Promise(() => {}), // 응답 없음
    pickSpreadsheet: async () => null,
    getAccessToken: async () => 'token',
    ...overrides,
  };
}

const unusedSheets = {} as LedgerBackend;

function setup(opts: { storage?: KeyValueStorage; ledgerStorage?: KeyValueStorage; local?: LocalBackend; google?: GoogleDeps } = {}) {
  const clock = { now: new Date(2026, 10, 20, 10, 0, 0) };
  const sessionStorage = opts.storage ?? createMemoryStorage();
  const ledgerStorage = opts.ledgerStorage ?? createMemoryStorage();
  const deps: Partial<StateDeps> = {
    google: opts.google ?? fakeGoogle(),
    local: opts.local ?? new LocalBackend(ledgerStorage),
    sheets: unusedSheets,
    now: () => clock.now,
    storage: sessionStorage,
    restoreTimeoutMs: 50,
    demoCouple: false,
  };
  const wrapper = ({ children }: { children: ReactNode }) => <AppProviders deps={deps}>{children}</AppProviders>;
  const hook = renderHook(() => ({ session: useSession(), ledger: useLedger() }), { wrapper });
  return { ...hook, clock, sessionStorage, ledgerStorage, deps };
}

async function startDemo(r: ReturnType<typeof setup>) {
  await waitFor(() => expect(r.result.current.session.status).toBe('signedOut'));
  await act(async () => {
    await r.result.current.session.startDemo();
  });
  await waitFor(() => expect(r.result.current.ledger.status).toBe('ready'));
}

describe('state — 체험 모드 흐름', () => {
  it('startDemo → 데이터 로드 → 지출 → 일정 완료 → 월말 처리', async () => {
    const r = setup();
    await startDemo(r);
    const s = r.result.current;
    expect(s.session.mode).toBe('demo');
    expect(s.session.user?.email).toBe('minji@demo');
    expect(s.session.activeLedger?.id).toBe(DEMO_LEDGER_ID);
    expect(s.ledger.today).toBe('2026-11-20');
    expect(s.ledger.data?.accounts.length).toBe(6);
    expect(s.ledger.incomeAccounts.map((a) => a.name)).toEqual(['민지 수입통장', '준호 수입통장']);
    expect(s.ledger.living).not.toBeNull();
    expect(s.ledger.eventProjection?.shortages.length).toBeGreaterThan(0);
    expect(s.ledger.shortageFix?.fromReservoir).not.toBeNull();
    expect(s.ledger.displayName('junho@demo')).toBe('준호');
    expect(s.ledger.displayName('nobody@x.com')).toBe('nobody');

    // 고정 지출 자동 기록 (월세 10일, 통신비 15일 지남)
    const autoFixed = s.ledger.data!.expenses.filter((e) => e.fixedExpenseId !== null);
    expect(autoFixed.length).toBeGreaterThan(0);

    // 지출 → 오늘 써도 되는 돈 감소
    const before = s.ledger.living!.todayAvailable;
    const livingAccountId = s.ledger.living!.livingAccountId!;
    await act(async () => {
      await r.result.current.ledger.addExpense({ date: '2026-11-20', amount: 10_000, accountId: livingAccountId, categoryId: 'demo-cat-food' });
    });
    expect(r.result.current.ledger.living!.todayAvailable).toBe(before - 10_000);
    // 항목이 여럿이면 항목을 골라야 생활비 판단을 해요
    expect(r.result.current.ledger.judge(1000, 'living')).toBeNull();
    expect(r.result.current.ledger.judge(1000, 'living', 'demo-cat-food')?.message).toContain('식비');
    expect(r.result.current.ledger.judge(1000, 'living', 'demo-cat-shopping')?.signal).toBeDefined();
    expect(r.result.current.ledger.judge(1000, 'event')).not.toBeNull();

    // 일정 완료 → 지출 생성 + 상태 done
    const ev = r.result.current.ledger.data!.events.find((e) => e.status === 'planned' && !e.deleted)!;
    await act(async () => {
      await r.result.current.ledger.completeEvent(ev.id, ev.amount - 50_000);
    });
    const after = r.result.current.ledger.data!;
    expect(after.events.find((e) => e.id === ev.id)?.status).toBe('done');
    const evExpense = after.expenses.find((e) => e.eventId === ev.id);
    expect(evExpense?.amount).toBe(ev.amount - 50_000);
    expect(evExpense?.author).toBe('minji@demo');

    // 다음 달로 넘어가면 월말 처리 요청
    r.clock.now = new Date(2026, 11, 2, 9, 0, 0);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(r.result.current.ledger.today).toBe('2026-12-02'));
    await waitFor(() => expect(r.result.current.ledger.pendingMonthEnd?.month).toBe('2026-11'));
    const leftover = r.result.current.ledger.pendingMonthEnd!.leftover;
    expect(leftover).toBeGreaterThan(0);
    const pendingItems = r.result.current.ledger.pendingMonthEnd!.items;
    expect(pendingItems.reduce((a, i) => a + i.leftover, 0)).toBe(leftover);
    expect(pendingItems.map((i) => i.name)).toContain('식비');
    // 12월 자동 배분이 생김
    await waitFor(() =>
      expect(r.result.current.ledger.data!.transfers.some((t) => t.id === 'auto:demo-rule-event:2026-12')).toBe(true),
    );

    await act(async () => {
      await r.result.current.ledger.decideMonthEnd('reservoir');
    });
    const final = r.result.current.ledger;
    expect(final.pendingMonthEnd).toBeNull();
    expect(final.data!.monthEnds.find((m) => m.month === '2026-11')?.choice).toBe('reservoir');
    expect(final.data!.monthEnds.find((m) => m.month === '2026-11')?.items?.length).toBe(pendingItems.length);
    const mt = final.data!.transfers.find((t) => t.id === 'monthend:2026-11');
    expect(mt?.amount).toBe(leftover);
    expect(mt?.toAccountId).toBe('demo-acc-reservoir');
    // 저장소에도 기록됨
    const stored = await r.deps.local!.open(final.ref!).load();
    expect(stored.monthEnds.some((m) => m.month === '2026-11')).toBe(true);
  });

  it('자동 기록은 다시 불러와도 중복되지 않는다', async () => {
    const storage = createMemoryStorage();
    const ledgerStorage = createMemoryStorage();
    const r = setup({ storage, ledgerStorage });
    await startDemo(r);
    const count = () => ({
      t: r.result.current.ledger.data!.transfers.length,
      e: r.result.current.ledger.data!.expenses.length,
    });
    const first = count();
    await act(async () => {
      await r.result.current.ledger.reload();
    });
    expect(count()).toEqual(first);
    r.unmount();

    // 같은 저장소로 다시 열기 (세션 복구) → 같은 개수
    const r2 = setup({ storage, ledgerStorage });
    await waitFor(() => expect(r2.result.current.session.status).toBe('signedIn'));
    await waitFor(() => expect(r2.result.current.ledger.status).toBe('ready'));
    expect(r2.result.current.ledger.data!.transfers.length).toBe(first.t);
    expect(r2.result.current.ledger.data!.expenses.length).toBe(first.e);

    // 체험 가계부는 한 번만 만든다 (기록 유지)
    const expenseId = r2.result.current.ledger.data!.expenses[0]!.id;
    await act(async () => {
      await r2.result.current.session.startDemo();
    });
    await waitFor(() => expect(r2.result.current.ledger.status).toBe('ready'));
    expect(r2.result.current.ledger.data!.expenses.some((e) => e.id === expenseId)).toBe(true);
  });

  it('저장 실패 시 되돌리고 한국어 오류를 던진다', async () => {
    class FailingLocal extends LocalBackend {
      fail = false;
      open(ref: Parameters<LocalBackend['open']>[0]) {
        const repo = super.open(ref);
        const self = this;
        return {
          ref: repo.ref,
          load: () => repo.load(),
          insert: <T extends TableName>(t: T, rows: TableRows[T][]) =>
            self.fail ? Promise.reject(new Error('boom')) : repo.insert(t, rows),
          upsert: <T extends TableName>(t: T, row: TableRows[T]) =>
            self.fail ? Promise.reject(new Error('boom')) : repo.upsert(t, row),
          upsertMany: <T extends TableName>(t: T, rows: TableRows[T][]) =>
            self.fail ? Promise.reject(new Error('boom')) : repo.upsertMany(t, rows),
          updateSettings: repo.updateSettings.bind(repo),
        };
      }
    }
    const local = new FailingLocal(createMemoryStorage());
    const r = setup({ local });
    await startDemo(r);
    const n = r.result.current.ledger.data!.expenses.length;
    local.fail = true;
    let message = '';
    await act(async () => {
      try {
        await r.result.current.ledger.addExpense({ date: '2026-11-20', amount: 5000, accountId: 'demo-acc-fixed', categoryId: null });
      } catch (e) {
        message = (e as Error).message;
      }
    });
    expect(message).toBe('지출을 기록하지 못했어요');
    expect(r.result.current.ledger.data!.expenses.length).toBe(n);
    expect(r.result.current.ledger.saving).toBe(false);

    // 카테고리 순서: 저장이 실패하면 화면 순서를 되돌려요
    const order = r.result.current.ledger.activeCategories.map((c) => c.id);
    let moveError = '';
    await act(async () => {
      try {
        await r.result.current.ledger.moveCategory(order[0]!, 1);
      } catch (e) {
        moveError = (e as Error).message;
      }
    });
    expect(moveError).toBe('카테고리 순서를 바꾸지 못했어요');
    expect(r.result.current.ledger.activeCategories.map((c) => c.id)).toEqual(order);
    local.fail = false;
    await act(async () => {
      expect(await r.result.current.ledger.moveCategory(order[0]!, 1)).toBe(true);
    });
    expect(r.result.current.ledger.activeCategories.map((c) => c.id).slice(0, 2)).toEqual([order[1], order[0]]);
    // 맨 위에서 위로는 바꿀 게 없어요
    await act(async () => {
      expect(await r.result.current.ledger.moveCategory(order[1]!, -1)).toBe(false);
    });
  });

  it('적립액 변경·부족 대처·잔액 맞추기', async () => {
    const r = setup();
    await startDemo(r);
    const L = () => r.result.current.ledger;
    // 이번 달 시작한 규칙은 금액만 바꾼다
    await act(async () => {
      await L().changeRuleAmount('demo-rule-event', 400_000);
    });
    let rules = L().data!.rules.filter((x) => x.toAccountId === 'demo-acc-event');
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ amount: 400_000, endMonth: null });

    // 다음 달: 이번 달 자동 이체가 이미 있으므로 기존 규칙은 이번 달까지, 새 금액은 그다음 달부터
    r.clock.now = new Date(2026, 11, 3, 9, 0, 0);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() =>
      expect(L().data!.transfers.some((t) => t.id === 'auto:demo-rule-event:2026-12')).toBe(true),
    );
    await act(async () => {
      await L().changeRuleAmount('demo-rule-event', 450_000);
    });
    rules = L().data!.rules.filter((x) => x.toAccountId === 'demo-acc-event');
    expect(rules.find((x) => x.id === 'demo-rule-event')?.endMonth).toBe('2026-12');
    expect(rules.find((x) => x.id !== 'demo-rule-event')).toMatchObject({ amount: 450_000, startMonth: '2027-01', endMonth: null });

    const fix = L().shortageFix;
    if (fix?.fromReservoir) {
      const f = fix.fromReservoir;
      await act(async () => {
        await L().applyFromReservoir(f);
      });
      const planned = L().data!.transfers.find((t) => t.status === 'planned' && t.fromAccountId === 'demo-acc-reservoir');
      expect(planned?.date).toBe(`${f.month}-01`);
    }

    const bal = L().balances['demo-acc-savings']!;
    await act(async () => {
      await L().adjustBalance('demo-acc-savings', bal - 1234);
    });
    expect(L().balances['demo-acc-savings']).toBe(bal - 1234);
    const adj = L().data!.transfers.find((t) => t.kind === 'adjustment')!;
    expect(adj).toMatchObject({ fromAccountId: 'demo-acc-savings', toAccountId: null, amount: 1234 });
  });

  it('로그아웃하면 세션만 지우고 테마는 남긴다', async () => {
    const r = setup();
    r.sessionStorage.setItem(THEME_KEY, 'dark');
    await startDemo(r);
    expect(r.sessionStorage.getItem(SESSION_KEY)).not.toBeNull();
    act(() => r.result.current.session.signOut());
    expect(r.result.current.session.status).toBe('signedOut');
    expect(r.sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(r.sessionStorage.getItem(THEME_KEY)).toBe('dark');
    await waitFor(() => expect(r.result.current.ledger.status).toBe('idle'));
    expect(r.result.current.ledger.data).toBeNull();
  });

  it('구글 모드 복구가 응답하지 않아도 화면이 멈추지 않는다', async () => {
    const storage = createMemoryStorage();
    storage.setItem(
      SESSION_KEY,
      JSON.stringify({ mode: 'google', user: { email: 'a@b.c', name: 'A', picture: null }, recentLedgers: [], activeLedgerId: null }),
    );
    const r = setup({ storage });
    await waitFor(() => expect(r.result.current.session.status).toBe('signedIn'));
    expect(r.result.current.session.mode).toBe('google');
    expect(r.result.current.ledger.status).toBe('idle');
    // 체험 모드에서는 공유 가계부 열기 없음
    const d = setup();
    await startDemo(d);
    let opened: unknown = 'x';
    await act(async () => {
      opened = await d.result.current.session.openSharedLedger();
    });
    expect(opened).toBeNull();
  });
});

describe('state — 고정비 금액 변경 · 배분 금액 맞추기 (PLAN 4-15)', () => {
  it('changeRuleAmount with fromMonth splits the rule at that month', async () => {
    const r = setup();
    await startDemo(r);
    const L = () => r.result.current.ledger;
    await act(async () => {
      await L().changeRuleAmount('demo-rule-event', 420_000, '2027-02');
    });
    const rules = L().data!.rules.filter((x) => x.toAccountId === 'demo-acc-event' && !x.deleted);
    expect(rules.find((x) => x.id === 'demo-rule-event')?.endMonth).toBe('2027-01');
    expect(rules.find((x) => x.id !== 'demo-rule-event')).toMatchObject({ amount: 420_000, startMonth: '2027-02', endMonth: null });
  });

  it('changeFixedAmount keeps past records, adds a dated segment, and retrying does not duplicate', async () => {
    const r = setup();
    await startDemo(r);
    const L = () => r.result.current.ledger;
    await act(async () => {
      await L().changeFixedAmount('demo-fixed-phone', 130_000, '2026-12-20');
    });
    await act(async () => {
      await expect(L().changeFixedAmount('demo-fixed-phone', 130_000, '2026-11-01')).rejects.toThrow();
    });
    const rows = L().data!.fixedExpenses.filter((f) => f.id.startsWith('demo-fixed-phone'));
    expect(rows.map((f) => [f.id, f.amount, f.endDate ?? null, f.startDate ?? null])).toEqual([
      ['demo-fixed-phone', 120_000, '2026-12-19', null],
      ['demo-fixed-phone@2026-12-20', 130_000, null, '2026-12-20'],
    ]);
    expect(L().data!.expenses.filter((e) => e.fixedExpenseId === 'demo-fixed-phone').every((e) => e.amount === 120_000)).toBe(true);
  });
});
