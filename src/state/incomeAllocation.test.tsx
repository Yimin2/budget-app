// @vitest-environment jsdom
/** 월급(수입)을 기록하면 그 월급날 배분을 바로 만들어요 — 상태 계층 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { autoTransferId, incomeRecordId } from '@/domain';
import type { LedgerData } from '@/domain/types';
import { createMemoryStorage, LocalBackend } from '@/storage';
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

/** 정한 쓰기를 한 번 실패시킬 수 있는 로컬 백엔드 */
class FlakyLocal extends LocalBackend {
  failOnce: string | null = null;
  open(ref: LedgerRef): LedgerRepository {
    const repo = super.open(ref);
    const run = async <R,>(op: string, fn: () => Promise<R>): Promise<R> => {
      if (this.failOnce === op) {
        this.failOnce = null;
        throw new Error('네트워크 오류');
      }
      return fn();
    };
    return {
      ref: repo.ref,
      load: () => repo.load(),
      insert: <T extends TableName>(t: T, rows: TableRows[T][]) => run(`insert:${t}`, () => repo.insert(t, rows)),
      upsert: <T extends TableName>(t: T, row: TableRows[T]) => run(`upsert:${t}`, () => repo.upsert(t, row)),
      upsertMany: <T extends TableName>(t: T, rows: TableRows[T][]) => run(`upsertMany:${t}`, () => repo.upsertMany(t, rows)),
      updateSettings: repo.updateSettings.bind(repo),
    };
  }
}

function setup() {
  const local = new FlakyLocal(createMemoryStorage());
  const deps: Partial<StateDeps> = {
    google: fakeGoogle(),
    local,
    sheets: {} as LedgerBackend,
    now: () => new Date(2026, 10, 20, 10, 0, 0),
    storage: createMemoryStorage(),
    restoreTimeoutMs: 50,
    demoCouple: true,
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

const L = (r: ReturnType<typeof setup>) => r.result.current.ledger;

describe('월급을 기록하면 계획대로 배분', () => {
  it('배분일(21일) 전인 20일에 월급 295만을 기록하면 21일 배분이 그날 바로 생기고, 21일 수입 계획은 또 기록하지 않아요', async () => {
    const r = setup();
    await startDemo(r);
    const d = L(r).data!;
    const salary = d.accounts.find((a) => a.name === '월급통장')!;
    const rest = d.rules.find((x) => x.fromAccountId === salary.id && x.kind === 'remainder' && x.dayOfMonth === 21)!;
    const fixed21 = d.rules.filter((x) => x.fromAccountId === salary.id && x.kind !== 'remainder' && x.dayOfMonth === 21 && x.amount > 0);
    expect(fixed21.length).toBeGreaterThan(0);
    // 아직 21일 배분은 없어요
    expect(d.transfers.some((t) => t.id === autoTransferId(rest.id, '2026-11'))).toBe(false);
    await act(async () => {
      await L(r).addTransfer({ date: '2026-11-20', kind: 'income', fromAccountId: null, toAccountId: salary.id, amount: 2_950_000, memo: '민지 월급' });
    });
    await waitFor(() => expect(L(r).data!.transfers.some((t) => t.id === autoTransferId(rest.id, '2026-11'))).toBe(true));
    const after = L(r).data!;
    for (const x of fixed21) expect(after.transfers.find((t) => t.id === autoTransferId(x.id, '2026-11'))).toMatchObject({ date: '2026-11-20', amount: x.amount });
    const fixedSum = fixed21.reduce((s, x) => s + x.amount, 0);
    expect(after.transfers.find((t) => t.id === autoTransferId(rest.id, '2026-11'))).toMatchObject({ date: '2026-11-20', amount: 2_950_000 - fixedSum });
    // 시트에도 저장돼요
    const saved = await stored(r);
    expect(saved.transfers.some((t) => t.id === autoTransferId(rest.id, '2026-11'))).toBe(true);
    // 21일에 열어도 민지 월급 계획 기록(320만)은 또 생기지 않아요
    const plan = after.incomePlans.find((p) => p.dayOfMonth === 21 && p.accountId === salary.id)!;
    expect(after.transfers.some((t) => t.id === incomeRecordId(plan.id, '2026-11'))).toBe(false);
  });
});
