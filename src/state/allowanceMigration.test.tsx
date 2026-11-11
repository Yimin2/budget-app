// @vitest-environment jsdom
/**
 * 기존 시트 자동 고치기 (8-2): 열 때 예전 '용돈' 고정지출 행을 용돈 통장으로 가는 배분 또는 고정비로 옮겨요.
 * 배분 · 고정지출을 한 번씩 한 번에 쓰고 한 번 알려요. 다시 열면 쓰지 않아요. 옮긴 배분은 알아서 맞추기로 바뀌지 않아요
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useLayoutEffect, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALLOWANCE_MOVE_NOTICE, allowanceRuleId, createDemoLedger } from '@/domain';
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
  const fixedWrites: string[][] = [];
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
          if (t === 'rules' || t === 'fixedExpenses') {
            if (opts.readOnly) throw new Error('403');
            (t === 'rules' ? ruleWrites : fixedWrites).push(rows.map((x) => (x as { id: string }).id));
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
  return { ruleWrites, fixedWrites, stored: () => inner.open({ ...ref, source: 'local' }).load() };
}

/**
 * 부부 예시 + 예전 용돈 행: 민지 용돈 통장에는 배분이 이미 있고(뺌), 준호 용돈 통장으로 가는 배분은 없앤 채(→ 배분으로),
 * 받는 사람의 용돈 통장이 없는 용돈(→ 고정비 '용돈(이름)')
 */
function sheet(): LedgerData {
  const d = createDemoLedger('2026-11-12', '2026-11-12T01:00:00.000Z', { couple: true });
  const base = { categoryId: null, spread: 'daily' as const, startMonth: '2026-10', endMonth: null, deleted: false };
  return {
    ...d,
    members: [...d.members, { email: 'mom@demo', displayName: '어머니' }],
    rules: d.rules.filter((r) => r.toAccountId !== 'demo-acc-allowance-junho'),
    fixedExpenses: [
      ...d.fixedExpenses,
      { ...base, id: 'al-minji', name: '용돈(민지)', amount: 150_000, accountId: 'demo-acc-income', dayOfMonth: 25, kind: 'allowance', targetEmail: 'minji@demo' },
      { ...base, id: 'al-junho', name: '용돈(준호)', amount: 200_000, accountId: 'demo-acc-income', dayOfMonth: 25, kind: 'allowance', targetEmail: 'junho@demo' },
      { ...base, id: 'al-mom', name: '용돈', amount: 100_000, accountId: 'demo-acc-living-minji', dayOfMonth: 5, kind: 'allowance', targetEmail: 'mom@demo' },
    ],
  };
}

describe('용돈 항목 자동 옮기기', () => {
  it('배분 · 고정지출을 한 번에 쓰고 한 번 알려요. 다시 열면 쓰지 않아요', async () => {
    const s = await setup(sheet());
    await waitFor(() => expect(s.fixedWrites).toHaveLength(1));
    expect(s.fixedWrites[0]!.sort()).toEqual(['al-junho', 'al-minji', 'al-mom']);
    // 첫 쓰기 = 옮긴 배분 하나 (그다음은 8-1 알아서 맞추기 고치기)
    expect(s.ruleWrites[0]).toEqual([allowanceRuleId('al-junho')]);
    expect(box.ledger!.notice).toBe(`${ALLOWANCE_MOVE_NOTICE} · 배분이 이미 있어 뺀 용돈: 용돈(민지) 15만`);

    const stored = await s.stored();
    const fx = (id: string) => stored.fixedExpenses.find((f) => f.id === id)!;
    expect(fx('al-minji')).toMatchObject({ kind: 'allowance', deleted: true });
    expect(fx('al-junho')).toMatchObject({ kind: 'allowance', deleted: true });
    expect(fx('al-mom')).toMatchObject({ kind: 'bill', name: '용돈(어머니)', targetEmail: null, deleted: false });
    // 옮긴 배분은 매달 같은 금액 그대로 (알아서 맞추기로 바뀌지 않아요)
    expect(stored.rules.find((r) => r.id === allowanceRuleId('al-junho'))).toMatchObject({
      fromAccountId: 'demo-acc-income', toAccountId: 'demo-acc-allowance-junho', amount: 200_000, kind: 'fixed', dayOfMonth: 25,
    });
    expect(box.ledger!.data!.fixedExpenses.some((f) => !f.deleted && f.kind === 'allowance')).toBe(false);

    const writes = { rules: s.ruleWrites.length, fixed: s.fixedWrites.length };
    while (box.ledger!.notice) act(() => box.ledger!.dismissNotice());
    await act(async () => {
      await box.ledger!.reload();
    });
    expect(s.fixedWrites).toHaveLength(writes.fixed);
    expect(s.ruleWrites).toHaveLength(writes.rules);
    expect(box.ledger!.notice).toBeNull();
  });

  it('보기 권한이라 못 쓰면 그대로 두고 알리지 않아요', async () => {
    const s = await setup(sheet(), { readOnly: true });
    expect(s.fixedWrites).toHaveLength(0);
    expect(box.ledger!.notice).toBeNull();
    expect(box.ledger!.data!.fixedExpenses.filter((f) => !f.deleted && f.kind === 'allowance')).toHaveLength(3);
  });
});
