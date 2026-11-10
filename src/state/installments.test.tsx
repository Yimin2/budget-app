// @vitest-environment jsdom
/** 할부 — 상태 계층 (추가 · 도중에 고치기 · 미리 갚기 · 그만 내기 · 사도 돼? 안내) */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { autoFixedExpenseId } from '@/domain';
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

const TV = 'demo-installment-tv';

describe('할부', () => {
  it('체험 가계부의 TV 할부는 16/24회차예요', async () => {
    const r = setup();
    await startDemo(r);
    const plan = r.result.current.ledger.installments.find((p) => p.id === TV)!;
    expect(plan).toMatchObject({ name: 'TV 할부', count: 24, paidCount: 16, remainingCount: 8, remainingAmount: 800_000, monthly: 100_000 });
    const rec = r.result.current.ledger.data!.expenses.find((e) => e.id === autoFixedExpenseId(TV, '2026-11'))!;
    expect(rec).toMatchObject({ amount: 100_000, memo: 'TV 할부 16/24회차', accountId: 'demo-acc-fixed' });
  });

  it('미리 갚으면 지출을 남기고 다음 회차부터 줄여요. 실패한 뒤 다시 해도 한 번만', async () => {
    const r = setup();
    await startDemo(r);
    const L = () => r.result.current.ledger;
    const fixedBefore = L().balances['demo-acc-fixed']!;

    r.local.failOnce = 'upsert:fixedExpenses';
    await act(async () => {
      await expect(L().prepayInstallment(TV, { amount: 400_000, keep: 'monthly' })).rejects.toThrow();
    });
    await waitFor(() => expect(L().status).toBe('ready'));
    await act(async () => {
      await L().prepayInstallment(TV, { amount: 400_000, keep: 'monthly' });
    });
    const saved = await stored(r);
    const prepay = saved.expenses.filter((e) => e.id.startsWith(`prepay:${TV}:`));
    expect(prepay).toHaveLength(1);
    expect(prepay[0]).toMatchObject({ amount: 400_000, memo: 'TV 할부 미리 갚기', accountId: 'demo-acc-fixed', date: '2026-11-20' });
    const rows = saved.fixedExpenses.filter((f) => f.id.startsWith(TV)).map((f) => [f.id, f.startMonth, f.endMonth, f.deleted]);
    expect(rows).toEqual([
      [TV, '2026-11', '2026-11', false],
      [`${TV}@2026-12`, '2026-12', '2027-03', false],
    ]);
    // 지난 자동 기록(16회차)은 그대로
    expect(saved.expenses.find((e) => e.id === autoFixedExpenseId(TV, '2026-11'))).toMatchObject({ amount: 100_000, memo: 'TV 할부 16/24회차' });
    expect(L().installments.find((p) => p.id === TV)).toMatchObject({ count: 20, remainingCount: 4, remainingAmount: 400_000 });
    expect(L().balances['demo-acc-fixed']).toBe(fixedBefore - 400_000);
  });

  it('매달 금액을 고치면 다음 회차부터, 그만 내면 그 뒤로 기록하지 않아요', async () => {
    const r = setup();
    await startDemo(r);
    const L = () => r.result.current.ledger;
    await act(async () => {
      await L().reviseInstallment(TV, { monthly: 120_000, remaining: 5 });
    });
    const plan = L().installments.find((p) => p.id === TV)!;
    expect(plan).toMatchObject({ count: 21, remainingCount: 5, remainingAmount: 600_000, monthly: 120_000 });
    expect(plan.next).toMatchObject({ month: '2026-12', number: 17, amount: 120_000 });
    await act(async () => {
      await expect(L().reviseInstallment(TV, { monthly: 1, fromMonth: '2026-11' })).rejects.toThrow('이미 낸 회차는 바꿀 수 없어요');
    });

    await act(async () => {
      await L().endInstallment(TV);
    });
    expect(L().installments.find((p) => p.id === TV)).toMatchObject({ ended: true, count: 16, remainingCount: 0 });
    const saved = await stored(r);
    // 다음 회차 달에 끊는 0회 행(종료월이 시작월 앞)을 남긴다
    expect(saved.fixedExpenses.filter((f) => f.id.startsWith(TV) && !f.deleted).map((f) => [f.id, f.startMonth, f.endMonth])).toEqual([
      [TV, '2026-11', '2026-11'],
      [`${TV}@2026-12`, '2026-12', '2026-11'],
    ]);
  });

  it('미리 갚기 지출은 행을 다 쓴 뒤 맨 마지막에 써요. 지운 같은 기록이 있으면 되살려요', async () => {
    const r = setup();
    await startDemo(r);
    const L = () => r.result.current.ledger;
    // 행 쓰기가 끊기면 미리 갚은 돈은 아직 기록되지 않아요 (옛 회차와 두 번 내지 않게)
    r.local.failOnce = 'upsert:fixedExpenses';
    await act(async () => {
      await expect(L().prepayInstallment(TV, { amount: 400_000, keep: 'monthly' })).rejects.toThrow('아직 기록되지 않았어요');
    });
    await waitFor(() => expect(L().status).toBe('ready'));
    expect((await stored(r)).expenses.some((e) => e.id.startsWith(`prepay:${TV}:`))).toBe(false);

    // 같은 id 의 지운 미리 갚기가 시트에 있으면 insert 가 건너뛰므로 되살려 써요
    const id = `prepay:${TV}:2026-12:800000:400000`;
    const repo = r.local.open(L().ref!);
    await repo.insert('expenses', [{
      id, date: '2026-11-20', amount: 400_000, accountId: 'demo-acc-fixed', categoryId: null, memo: 'TV 할부 미리 갚기',
      eventId: null, fixedExpenseId: TV, author: 'a@b.c', createdAt: 'x', updatedAt: 'x', deleted: true,
    }]);
    await act(async () => {
      await L().reload();
    });
    await act(async () => {
      await L().prepayInstallment(TV, { amount: 400_000, keep: 'monthly' });
    });
    const saved = (await stored(r)).expenses.filter((e) => e.id === id);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ deleted: false, amount: 400_000 });
  });

  it('새 할부를 추가하고 지울 수 있어요', async () => {
    const r = setup();
    await startDemo(r);
    const L = () => r.result.current.ledger;
    let id = '';
    await act(async () => {
      id = await L().addInstallment({
        name: '노트북', amount: 1_000_000, amountKind: 'total', months: 3, firstMonth: '2026-12', dayOfMonth: 25,
        accountId: 'demo-acc-fixed', categoryId: null,
      });
    });
    const plan = L().installments.find((p) => p.id === id)!;
    expect(plan.payments.map((p) => p.amount)).toEqual([333_334, 333_333, 333_333]);
    expect(plan).toMatchObject({ count: 3, paidCount: 0, remainingAmount: 1_000_000 });
    await act(async () => {
      await L().deleteInstallment(id);
    });
    expect(L().installments.some((p) => p.id === id)).toBe(false);
    expect((await stored(r)).fixedExpenses.filter((f) => f.id.startsWith(id)).every((f) => f.deleted)).toBe(true);
  });

  it('사도 돼?: 큰 금액이면 12개월 할부 매달 금액과 맞는지 알려 줘요', async () => {
    const r = setup();
    await startDemo(r);
    const L = () => r.result.current.ledger;
    expect(L().installmentHint(200_000, 'living', 'demo-cat-shopping')).toBeNull();
    expect(L().installmentHint(600_000, 'living', 'demo-cat-shopping')).toMatchObject({
      months: 12, monthly: 50_000, fits: true, message: '12개월 할부면 매달 50,000원이에요. 한 달 쇼핑 예산 60,000원 안이에요',
    });
    expect(L().installmentHint(1_200_000, 'living', 'demo-cat-shopping')).toMatchObject({ monthly: 100_000, fits: false });
    const ev = L().installmentHint(1_200_000, 'event')!;
    expect(ev.monthly).toBe(100_000);
    expect(ev.message.startsWith('12개월 할부면 매달 100,000원이에요.')).toBe(true);
  });
});
