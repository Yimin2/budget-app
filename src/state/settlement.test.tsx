// @vitest-environment jsdom
/** 이번 달 정산 · 저수지에서 빌린 돈 — 상태 계층 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { claimLoanTransferId, claimTransferId, expenseLoanTransferId, loanRepayId } from '@/domain';
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
    demoCouple: false,
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

describe('이번 달 정산 — 상태 계층', () => {
  it('체험 가계부: 사람별 지급, [저수지에서 빌려 지급]은 다시 눌러도 빌린 이체 · 돌려준 이체가 하나씩, 되돌리면 둘 다 지워요', async () => {
    const r = setup();
    await startDemo(r);
    const s = L(r).settlement!;
    expect(s.pay.map((g) => [g.name, g.amount])).toEqual([['민지', 300_000]]);
    const before = { ...L(r).balances };
    const id = 'demo-claim-jeju';

    r.local.failOnce = 'upsert:transfers';
    await act(async () => {
      await expect(L(r).borrowAndSettleClaims([id])).rejects.toThrow();
    });
    await act(async () => {
      await L(r).borrowAndSettleClaims([id]);
      await L(r).borrowAndSettleClaims([id]);
    });
    const saved = await stored(r);
    const loan = saved.transfers.filter((t) => t.id === claimLoanTransferId(id));
    const settle = saved.transfers.filter((t) => t.id === claimTransferId(id));
    expect(loan).toHaveLength(1);
    expect(settle).toHaveLength(1);
    expect(loan[0]).toMatchObject({ fromAccountId: 'demo-acc-reservoir', toAccountId: 'demo-acc-event', amount: 300_000 });
    expect(L(r).balances['demo-acc-reservoir']).toBe(before['demo-acc-reservoir']! - 300_000);
    expect(L(r).balances['demo-acc-event']).toBe(before['demo-acc-event']);
    expect(L(r).settlement!.loan.balance).toBe(300_000);
    expect(L(r).settlement!.pay).toEqual([]);

    await act(async () => {
      await L(r).unsettleClaims([id]);
    });
    expect(L(r).settlement!.loan.balance).toBe(0);
    expect(L(r).balances).toEqual(before);
    expect(L(r).settlement!.pay.map((g) => g.name)).toEqual(['민지']);
  });

  it('[지급했어요]는 지급할 수 있는 돈을 넘는 이벤트통장 청구를 거절해요 (아무것도 쓰지 않음), 빌려 지급은 돼요', async () => {
    const r = setup();
    await startDemo(r);
    const cat = L(r).data!.categories.find((c) => !c.deleted && c.defaultAccountRole === 'event')!.id;
    await act(async () => {
      await L(r).addExpense({ date: '2026-11-04', amount: 900_000, accountId: 'demo-acc-event', categoryId: cat, memo: '바다 결혼 선물', paidBy: '민지' });
    });
    const id = L(r).data!.expenses.find((e) => e.memo === '바다 결혼 선물')!.id;
    const payable = L(r).settlement!.payable;
    expect(payable).toBeLessThan(900_000);
    const before = (await stored(r)).transfers.length;
    await act(async () => {
      await expect(L(r).settleClaims([id])).rejects.toThrow(/이벤트통장에서 줄 수 있는 돈.*저수지에서 빌려 지급해 주세요/);
      await expect(L(r).settleClaims(['demo-claim-jeju', id])).rejects.toThrow(/저수지에서 빌려 지급해 주세요/);
    });
    expect((await stored(r)).transfers.length).toBe(before);
    expect(L(r).data!.transfers.some((t) => t.id === claimTransferId(id) && !t.deleted)).toBe(false);
    // 안에 드는 것만은 되고, 넘는 것은 빌려서
    await act(async () => {
      await L(r).settleClaims(['demo-claim-jeju']);
      await L(r).borrowAndSettleClaims([id]);
    });
    expect(L(r).data!.transfers.some((t) => t.id === claimLoanTransferId(id) && !t.deleted)).toBe(true);
    expect(L(r).settlement!.loan.balance).toBe(900_000);
  });

  it('[갚았어요]는 이번 달 loanpay:<월> 하나 (다시 눌러도), 되돌리기로 지워요', async () => {
    const r = setup();
    await startDemo(r);
    await act(async () => {
      await L(r).borrowAndSettleClaims(['demo-claim-jeju']);
    });
    await act(async () => {
      await L(r).repayLoan(100_000);
      await L(r).repayLoan(100_000);
    });
    const rows = (await stored(r)).transfers.filter((t) => t.id === loanRepayId('2026-11'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fromAccountId: 'demo-acc-event', toAccountId: 'demo-acc-reservoir', amount: 100_000, deleted: false });
    expect(L(r).settlement!.loan.balance).toBe(200_000);
    expect(L(r).settlement!.repay).toBeNull();
    await act(async () => {
      await L(r).undoRepayLoan();
    });
    expect(L(r).settlement!.loan.balance).toBe(300_000);
    await expect(L(r).repayLoan(0)).rejects.toThrow('갚을 금액');
  });

  it('저수지에서 쓴 이벤트 지출을 갚을 돈으로 바꾸고, 지우고 되살리고, 되돌려요 (잔액은 늘 그대로)', async () => {
    const r = setup();
    await startDemo(r);
    const cat = L(r).data!.categories.find((c) => !c.deleted && c.defaultAccountRole === 'event')!;
    let id = '';
    await act(async () => {
      const e = await L(r).addExpense({ date: '2026-10-05', amount: 200_000, accountId: 'demo-acc-reservoir', categoryId: cat.id, memo: '돌잔치' });
      id = e.id;
    });
    expect(L(r).loanCandidates.map((e) => e.id)).toContain(id);
    const before = { ...L(r).balances };

    await act(async () => {
      await L(r).convertToLoan([id]);
    });
    expect(L(r).data!.expenses.find((e) => e.id === id)!.accountId).toBe('demo-acc-event');
    expect(L(r).balances).toEqual(before);
    expect(L(r).settlement!.loan.balance).toBe(200_000);
    expect(L(r).loanCandidates.map((e) => e.id)).not.toContain(id);

    // 지우면 빌린 이체도 지우고, 되살리면 함께 되살아나요
    await act(async () => {
      await L(r).deleteExpense(id);
    });
    expect(L(r).settlement!.loan.balance).toBe(0);
    const deleted = L(r).data!.expenses.find((e) => e.id === id)!;
    await act(async () => {
      await L(r).updateExpense({ ...deleted, deleted: false });
    });
    expect(L(r).settlement!.loan.balance).toBe(200_000);
    expect(L(r).balances).toEqual(before);

    // 금액을 고치면 빌린 이체도 따라가요
    const live = L(r).data!.expenses.find((e) => e.id === id)!;
    await act(async () => {
      await L(r).updateExpense({ ...live, amount: 150_000 });
    });
    expect(L(r).data!.transfers.find((t) => t.id === expenseLoanTransferId(id))!.amount).toBe(150_000);
    expect(L(r).settlement!.loan.balance).toBe(150_000);

    await act(async () => {
      await L(r).unconvertLoan([id]);
    });
    expect(L(r).data!.expenses.find((e) => e.id === id)!.accountId).toBe('demo-acc-reservoir');
    expect(L(r).settlement!.loan.balance).toBe(0);
    expect(L(r).loanCandidates.map((e) => e.id)).toContain(id);
  });
});
