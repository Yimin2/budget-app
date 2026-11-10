// @vitest-environment jsdom
/**
 * 기존 시트 자동 고치기 (8-1, PLAN 4-15): 열 때 생활비 통장으로 가는 '매달 같은 금액' 배분을
 * '알아서 맞추기'로 한 번에 쓰고 한 번 알려요. 다시 열면 쓰지 않고, 용돈 · 이벤트 · 저축 · 남는 돈 전부는 그대로.
 * 지난 고치기가 용돈 배분까지 알아서 맞추기로 바꿨으면 다시 매달 같은 금액으로 되돌려요 (PLAN 4-7)
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useLayoutEffect, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALLOWANCE_FIXED_NOTICE, AUTO_KIND_NOTICE, autoTransferId, createDemoLedger, nextAllocationDate, windowNeed } from '@/domain';
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
const LIVING = ['demo-acc-living-minji', 'demo-acc-living-junho'];
const ALLOWANCE = ['demo-acc-allowance-minji', 'demo-acc-allowance-junho'];

describe('배분 방식 자동 고치기', () => {
  it('생활비 배분만 한 번에 알아서 맞추기로 쓰고 한 번 알려요. 용돈은 건너뛰어요. 다시 열면 쓰지 않아요', async () => {
    const before = sheet();
    const s = await setup(before);
    await waitFor(() => expect(s.ruleWrites).toHaveLength(1));
    const into = (id: string) => before.rules.find((r) => r.toAccountId === id)!.id;
    expect(s.ruleWrites[0]!.sort()).toEqual(LIVING.map(into).sort());
    expect(box.ledger!.notice).toBe(AUTO_KIND_NOTICE);

    const stored = await s.stored();
    for (const r of stored.rules) {
      const was = before.rules.find((x) => x.id === r.id)!;
      if (LIVING.includes(r.toAccountId)) expect(r).toMatchObject({ kind: 'auto', amount: 0 });
      else expect(r).toEqual(was);
    }
    expect(box.ledger!.data!.rules.filter((r) => r.kind === 'auto')).toHaveLength(2);

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

/** 지난 고치기를 거친 시트: 생활비 · 용돈 배분 모두 알아서 맞추기(금액 0). 민지 용돈은 10월에 매달 같은 금액으로 기록된 이체가 있어요 */
function brokenSheet(): LedgerData {
  const d = sheet();
  const rules = d.rules.map((r) => ([...LIVING, ...ALLOWANCE].includes(r.toAccountId) ? { ...r, kind: 'auto' as const, amount: 0 } : r));
  const minji = rules.find((r) => r.toAccountId === 'demo-acc-allowance-minji')!;
  return {
    ...d,
    rules: rules.map((r) => (r.id === minji.id ? { ...r, startMonth: '2026-09' } : r)),
    transfers: [
      ...d.transfers,
      {
        id: autoTransferId(minji.id, '2026-10'), date: '2026-10-25', kind: 'transfer', fromAccountId: minji.fromAccountId, toAccountId: minji.toAccountId,
        amount: 400_000, status: 'done', ruleId: minji.id, memo: '매달 배분', author: ME.email,
        createdAt: '2026-10-25T01:00:00.000Z', updatedAt: '2026-10-25T01:00:00.000Z', deleted: false,
      },
    ],
  };
}

describe('용돈 배분 되돌리기 (4-7)', () => {
  it('용돈 배분을 매달 같은 금액으로 한 번에 되돌리고 한 번 알려요. 기록이 없으면 고정비 합 + 확인 필요. 다시 열면 쓰지 않아요', async () => {
    const before = brokenSheet();
    const s = await setup(before);
    await waitFor(() => expect(s.ruleWrites).toHaveLength(1));
    const into = (id: string) => before.rules.find((r) => r.toAccountId === id)!;
    expect(s.ruleWrites[0]!.sort()).toEqual(ALLOWANCE.map((id) => into(id).id).sort());
    const stored = await s.stored();
    const minji = stored.rules.find((r) => r.toAccountId === 'demo-acc-allowance-minji')!;
    const junho = stored.rules.find((r) => r.toAccountId === 'demo-acc-allowance-junho')!;
    expect(minji).toMatchObject({ kind: 'fixed', amount: 400_000 });
    expect(minji.needsReview).toBeFalsy();
    const junhoRule = into('demo-acc-allowance-junho');
    const bills = windowNeed(before, junhoRule.toAccountId, nextAllocationDate(before, junhoRule, '2026-11-12'), junhoRule.dayOfMonth).total;
    expect(junho).toMatchObject({ kind: 'fixed', amount: bills, needsReview: true });
    // 생활비 자동은 그대로, 지운 행 없음
    expect(stored.rules.filter((r) => r.kind === 'auto').map((r) => r.toAccountId).sort()).toEqual([...LIVING].sort());
    expect(stored.rules).toHaveLength(before.rules.length);
    expect(stored.transfers.filter((t) => !t.deleted)).toHaveLength(before.transfers.length);
    expect(box.ledger!.notice).toMatch(new RegExp(`^${ALLOWANCE_FIXED_NOTICE.replace(/'/g, "'")} · 민지 용돈 40만, 준호 용돈 .+ \\(확인 필요\\)$`));

    act(() => box.ledger!.dismissNotice());
    await act(async () => {
      await box.ledger!.reload();
    });
    expect(s.ruleWrites).toHaveLength(1);
    expect(box.ledger!.notice).toBeNull();
  });

  it('보기 권한이라 못 쓰면 그대로 두고 알리지 않아요', async () => {
    const s = await setup(brokenSheet(), { readOnly: true });
    expect(s.ruleWrites).toHaveLength(0);
    expect(box.ledger!.notice).toBeNull();
  });
});
