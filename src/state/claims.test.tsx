// @vitest-environment jsdom
/** 청구(개인 돈으로 내고 돌려받기) — 상태 계층 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { claimTransferId } from '@/domain';
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

describe('청구 — 기록 · 돌려주기', () => {
  it('체험 가계부에는 돌려받을 돈이 있어요', async () => {
    const r = setup();
    await startDemo(r);
    const c = r.result.current.ledger.claims!;
    expect(c.total).toBe(324_000);
    expect(c.dueNow.map((x) => x.expense.id)).toEqual(['demo-claim-jeju']);
    expect(r.result.current.ledger.claimPayers).toEqual(['민지', '준호']);
  });

  it('개인 돈으로 기록하면 돌려받을 통장과 정산일을 정하고, 돌려주면 이체 하나만 남겨요', async () => {
    const r = setup();
    await startDemo(r);
    const L = () => r.result.current.ledger;
    const fixedBefore = L().balances['demo-acc-fixed']!;

    // 고정지출통장(생활비) → 다음 월급날 (체험 예시의 이벤트 적립일 1일 → 12월 1일)
    expect(L().previewClaimDue('demo-acc-fixed', 30_000)).toBe('2026-12-01');
    expect(L().previewClaimDue('demo-acc-savings', 30_000)).toBeNull();
    let created!: Awaited<ReturnType<ReturnType<typeof L>['addExpense']>>;
    await act(async () => {
      created = await L().addExpense({
        date: '2026-11-20', amount: 30_000, accountId: 'demo-acc-fixed', categoryId: 'demo-cat-food', memo: '장보기', paidBy: '준호',
      });
    });
    expect(created).toMatchObject({ paidBy: '준호', claimAccountId: 'demo-acc-income-junho', claimDue: '2026-12-01' });
    // 돌려주기 전: 고정지출통장 잔액은 그대로, 준호 수입통장에서 빠져요
    expect(L().balances['demo-acc-fixed']).toBe(fixedBefore);
    expect(L().claims!.total).toBe(354_000);

    // 이벤트통장은 잔액(750,000: 제주 여행 숙소 예약금 150,000 뺌) − 다른 청구(300,000)가 넉넉하면 오늘
    expect(L().previewClaimDue('demo-acc-event', 450_000)).toBe('2026-11-20');
    expect(L().previewClaimDue('demo-acc-event', 450_001)).toBe('2026-12-01');

    // 청구할 수 없는 통장은 거절
    await expect(
      L().addExpense({ date: '2026-11-20', amount: 1_000, accountId: 'demo-acc-savings', categoryId: null, paidBy: '민지' }),
    ).rejects.toThrow('이벤트통장이나 고정지출통장');

    // 돌려주기: 처음 저장이 실패해도 다시 누르면 이체가 하나만
    r.local.failOnce = 'upsert:transfers';
    await act(async () => {
      await expect(L().settleClaims([created.id])).rejects.toThrow();
    });
    await act(async () => {
      await L().settleClaims([created.id]);
      await L().settleClaims([created.id]);
    });
    const saved = await stored(r);
    const rows = saved.transfers.filter((t) => t.id === claimTransferId(created.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fromAccountId: 'demo-acc-fixed', toAccountId: 'demo-acc-income-junho', amount: 30_000, status: 'done' });
    expect(L().balances['demo-acc-fixed']).toBe(fixedBefore - 30_000);
    expect(L().claims!.total).toBe(324_000);

    // 되돌리기 → 다시 돌려받을 돈, 다시 돌려주면 같은 행을 되살려요
    await act(async () => {
      await L().unsettleClaims([created.id]);
    });
    expect(L().claims!.total).toBe(354_000);
    await act(async () => {
      await L().settleClaims([created.id]);
    });
    const again = (await stored(r)).transfers.filter((t) => t.id === claimTransferId(created.id));
    expect(again).toHaveLength(1);
    expect(again[0]!.deleted).toBe(false);
  });

  it('다른 기기에서 돌려줬다 되돌린(지운) 행이 시트에 있어도 [보냈어요]가 저장돼요', async () => {
    const r = setup();
    await startDemo(r);
    const L = () => r.result.current.ledger;
    const id = 'demo-claim-jeju';
    const c = L().claims!.pending.find((x) => x.expense.id === id)!;
    // 이 기기는 모르는, 다른 기기가 남긴 지운 claim 행
    await r.local.open(L().ref!).insert('transfers', [{
      id: claimTransferId(id), date: '2026-11-19', kind: 'transfer', fromAccountId: c.accountId, toAccountId: c.claimAccountId,
      amount: c.amount, status: 'done', ruleId: null, memo: '', author: 'x@y', createdAt: 'x', updatedAt: 'x', deleted: true,
    }]);
    await act(async () => {
      await L().settleClaims([id]);
    });
    const rows = (await stored(r)).transfers.filter((t) => t.id === claimTransferId(id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deleted).toBe(false);
  });

  it('돌려준 청구의 금액 · 통장을 고치거나 지우면 돌려준 이체도 함께 바뀌어요', async () => {
    const r = setup();
    await startDemo(r);
    const L = () => r.result.current.ledger;
    const done = L().data!.expenses.find((e) => e.id === 'demo-claim-done')!;
    const settle = () => L().data!.transfers.find((t) => t.id === claimTransferId(done.id))!;
    const payerAcc = done.claimAccountId!;
    const shared = done.accountId;
    const payerBefore = L().balances[payerAcc]!;
    const sharedBefore = L().balances[shared]!;

    await act(async () => {
      await L().updateExpense({ ...done, amount: done.amount - 20_000 });
    });
    expect(settle()).toMatchObject({ amount: done.amount - 20_000, deleted: false });
    // 낸 사람은 지출 − 돌려받음 = 0 그대로, 함께 쓰는 통장은 줄인 만큼 덜 나가요
    expect(L().balances[payerAcc]).toBe(payerBefore);
    expect(L().balances[shared]).toBe(sharedBefore + 20_000);
    expect((await stored(r)).transfers.find((t) => t.id === claimTransferId(done.id))!.amount).toBe(done.amount - 20_000);

    await act(async () => {
      await L().deleteExpense(done.id);
    });
    expect(settle().deleted).toBe(true);
    expect(L().balances[payerAcc]).toBe(payerBefore);
    expect(L().balances[shared]).toBe(sharedBefore + done.amount);

    // 되살리면 돌려준 이체도 되살아나요
    const deleted = L().data!.expenses.find((e) => e.id === done.id)!;
    await act(async () => {
      await L().updateExpense({ ...deleted, deleted: false });
    });
    expect(settle().deleted).toBe(false);
    expect(L().claims!.pending.some((c) => c.expense.id === done.id)).toBe(false);
  });

  it('보통 지출을 청구로 바꾸면 그 지출을 빼고 정산일을 정해요', async () => {
    const r = setup();
    await startDemo(r);
    const L = () => r.result.current.ledger;
    let x!: Awaited<ReturnType<ReturnType<typeof L>['addExpense']>>;
    await act(async () => {
      x = await L().addExpense({ date: '2026-11-20', amount: 450_000, accountId: 'demo-acc-event', categoryId: null });
    });
    // 이 지출이 잔액에서 빠진 채로 세면 다음 월급날이 되지만, 청구가 되면 잔액을 줄이지 않으므로 오늘
    expect(L().previewClaimDue('demo-acc-event', 450_000, x.id)).toBe('2026-11-20');
    await act(async () => {
      await L().updateExpense({ ...x, paidBy: '민지' });
    });
    expect(L().data!.expenses.find((e) => e.id === x.id)!.claimDue).toBe('2026-11-20');
  });

  it('고칠 때 낸 사람을 비우면 보통 지출, 돌려준 청구는 그대로 둬요', async () => {
    const r = setup();
    await startDemo(r);
    const L = () => r.result.current.ledger;
    const mart = L().data!.expenses.find((e) => e.id === 'demo-claim-mart')!;
    await act(async () => {
      await L().updateExpense({ ...mart, paidBy: null });
    });
    expect(L().data!.expenses.find((e) => e.id === mart.id)).toMatchObject({ paidBy: null, claimAccountId: null, claimDue: null });

    const done = L().data!.expenses.find((e) => e.id === 'demo-claim-done')!;
    await act(async () => {
      await L().updateExpense({ ...done, paidBy: null, memo: '세제' });
    });
    expect(L().data!.expenses.find((e) => e.id === done.id)).toMatchObject({ paidBy: '준호', memo: '세제' });
  });

  it('정산일을 설정하면 그날을 써요', async () => {
    const r = setup();
    await startDemo(r);
    await act(async () => {
      await r.result.current.ledger.saveSettleDay(25);
    });
    expect(r.result.current.ledger.previewClaimDue('demo-acc-fixed', 1_000)).toBe('2026-11-25');
    expect((await stored(r)).settings.settleDay).toBe(25);
  });
});
