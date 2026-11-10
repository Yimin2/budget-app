// @vitest-environment jsdom
/* 예산 달별 보기 (작업정리 13): ◀ 달 ▶ · 지난 달은 보기만 · 다음 달 [전달 복사] / [초기화] · 다음 달만 따로 고치기 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { current, renderApp, startDemo, type AppHarness } from '../_components/__tests__/harness';

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => nav.router, usePathname: () => '/budget' }));

import { budgetMonthView, formatMan, livingBudgetOf } from '@/domain';
import type { ReadyLedger } from '../_components/RequireLedger';
import BudgetPage from './page';
import { accountCard, openOut } from './budgetTestUtils';
import { ledgerForMonth, PAST_READ_ONLY } from './monthLedger';

const LIVING = 'demo-acc-living-minji';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

const monthTitle = () => screen.getByTestId('budget-month').textContent;
const prev = () => fireEvent.click(screen.getByRole('button', { name: '이전 달' }));
const next = () => fireEvent.click(screen.getByRole('button', { name: '다음 달' }));
const ledgerOf = (h: AppHarness) => current(h).ledger as ReadyLedger;

/** 민지 생활비 항목을 8월부터 있던 것으로 두고, 이번 달(11월)부터 금액을 바꿔 지난 달 기록을 만들어요 */
async function withHistory(h: AppHarness): Promise<{ before: number; after: number }> {
  const row = ledgerOf(h).data.fixedExpenses.find((f) => f.kind === 'living' && f.accountId === LIVING && !f.deleted)!;
  await act(async () => {
    await ledgerOf(h).saveFixed({ ...row, startMonth: '2026-08' });
  });
  const moved = ledgerOf(h).data.fixedExpenses.find((f) => f.id === row.id)!;
  await act(async () => {
    await ledgerOf(h).saveLivingItem(row.id, { ...moved, amount: moved.amount + 100_000 });
  });
  const d = ledgerOf(h).data;
  return { before: livingBudgetOf(d, LIVING, '2026-10'), after: livingBudgetOf(d, LIVING, '2026-11') };
}

describe('예산 달별 보기 — ◀ 달 ▶ (13)', () => {
  it('맨 위에서 달을 옮기면 화면 전체가 그 달 기준이고, 다음 달에서는 ▶ 이 꺼져요', async () => {
    const h = renderApp(<BudgetPage />, { couple: true });
    await startDemo(h);
    const { before, after } = await withHistory(h);
    expect(before).not.toBe(after);

    expect(monthTitle()).toBe('2026년 11월');
    expect(screen.getByText('이번 달')).toBeTruthy();
    const livingNow = within(openOut('생활비(민지)', '생활비 예산').closest('[data-testid="out-row"]') as HTMLElement).getByText(formatMan(after));
    expect(livingNow).toBeTruthy();

    prev();
    expect(monthTitle()).toBe('2026년 10월');
    expect(screen.getByTestId('month-note').textContent).toBe(PAST_READ_ONLY);
    // 지난 달은 그달 기준: 통장 카드 기간 · 그달 생활비 항목 금액
    expect(within(accountCard('생활비(민지)')).getByTestId('outgoing-total').textContent).toContain('10/21 ~ 11/20');
    const livingPast = openOut('생활비(민지)', '생활비 예산');
    expect(livingPast.textContent).toContain(before.toLocaleString('en-US'));
    expect(livingPast.textContent).not.toContain(after.toLocaleString('en-US'));
    // 가장 앞 달(8월)에서는 ◀ 이 꺼져요
    prev();
    prev();
    expect(monthTitle()).toBe('2026년 8월');
    expect((screen.getByRole('button', { name: '이전 달' }) as HTMLButtonElement).disabled).toBe(true);

    // [이번 달]로 바로 돌아와요
    fireEvent.click(screen.getByRole('button', { name: '이번 달' }));
    expect(monthTitle()).toBe('2026년 11월');
    expect(screen.queryByTestId('month-note')).toBeNull();

    next();
    expect(monthTitle()).toBe('2026년 12월');
    expect((screen.getByRole('button', { name: '다음 달' }) as HTMLButtonElement).disabled).toBe(true);
    // 준비하지 않은 다음 달은 비어서 시작 (계산은 이번 달 예산이 이어져요)
    expect(screen.getByTestId('next-empty')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '12월 예산은 아직 준비하지 않았어요' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: '월급날 돈 흐름' })).toBeNull();
    expect(livingBudgetOf(ledgerOf(h).data, LIVING, '2026-12')).toBe(after);
  });

  it('지난 달은 보기만: 펼친 칸의 단추 · 입력이 꺼지고 고치기는 막혀요', async () => {
    const h = renderApp(<BudgetPage />, { couple: true });
    await startDemo(h);
    await withHistory(h);
    prev();
    // 돈 흐름의 [배분 보기]
    const btn = screen.getByRole('button', { name: '수입 계획과 매달 배분 배분 보기' });
    fireEvent.click(btn);
    const rules = document.getElementById(btn.getAttribute('aria-controls')!)!;
    const fieldset = within(rules).getByTestId('read-only') as HTMLFieldSetElement;
    expect(fieldset.tagName).toBe('FIELDSET');
    expect(fieldset.disabled).toBe(true);
    for (const b of within(fieldset).queryAllByRole('button')) expect(b.matches(':disabled')).toBe(true);
    // 통장 카드의 생활비 예산 · 고정비도 보기만
    const living = openOut('생활비(민지)', '생활비 예산');
    expect((within(living).getByTestId('read-only') as HTMLFieldSetElement).disabled).toBe(true);
    const bills = openOut('생활비(민지)', '고정비');
    expect((within(bills).getByTestId('read-only') as HTMLFieldSetElement).disabled).toBe(true);
    // 이번 달은 그대로 고칠 수 있어요
    fireEvent.click(screen.getByRole('button', { name: '이번 달' }));
    expect(screen.queryByTestId('read-only')).toBeNull();
    // 지난 달 가계부로는 고치지 못해요
    const view = budgetMonthView(ledgerOf(h).data, ledgerOf(h).today, '2026-10');
    const row = ledgerOf(h).data.fixedExpenses.find((f) => f.kind === 'living' && !f.deleted)!;
    await expect(ledgerForMonth(ledgerOf(h), view).saveFixed({ ...row, amount: 1 })).rejects.toThrow(PAST_READ_ONLY);
  });

  it('다음 달: [전달 복사]로 준비하면 따로 고치고, [초기화]로 다시 비워요', async () => {
    const h = renderApp(<BudgetPage />, { couple: true });
    await startDemo(h);
    const thisMonth = livingBudgetOf(ledgerOf(h).data, LIVING, '2026-11');
    next();
    expect((within(screen.getByTestId('next-empty')).getByRole('button', { name: '초기화' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '전달 복사' }));
    await waitFor(() => expect(screen.getByTestId('next-prepared')).toBeTruthy());
    expect(ledgerOf(h).data.settings.preparedMonth).toBe('2026-12');
    expect(ledgerOf(h).data.rules.some((r) => r.id.endsWith('@2026-12') && !r.deleted)).toBe(true);
    expect(screen.getByRole('heading', { level: 2, name: '월급날 돈 흐름' })).toBeTruthy();
    expect(screen.getAllByTestId('payday-flow').length).toBeGreaterThan(0);

    // 다음 달 생활비 항목만 고쳐요 (이번 달은 그대로)
    const view = budgetMonthView(ledgerOf(h).data, ledgerOf(h).today, '2026-12');
    expect(view.editable).toBe(true);
    const row = ledgerOf(h).data.fixedExpenses.find((f) => f.kind === 'living' && f.accountId === LIVING && !f.deleted && f.startMonth === '2026-12')!;
    await act(async () => {
      await ledgerForMonth(ledgerOf(h), view).saveLivingItem(row.id, { ...row, amount: row.amount + 50_000 });
    });
    expect(livingBudgetOf(ledgerOf(h).data, LIVING, '2026-11')).toBe(thisMonth);
    expect(livingBudgetOf(ledgerOf(h).data, LIVING, '2026-12')).toBe(thisMonth + 50_000);

    // [초기화] → 그 자리에서 확인 → 다시 이번 달 예산이 이어져요
    fireEvent.click(screen.getByRole('button', { name: '초기화' }));
    const confirm = screen.getByRole('group', { name: '초기화 확인' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(within(confirm).getByRole('button', { name: '초기화할게요' }));
    await waitFor(() => expect(screen.getByTestId('next-empty')).toBeTruthy());
    expect(ledgerOf(h).data.settings.preparedMonth ?? null).toBeNull();
    expect(livingBudgetOf(ledgerOf(h).data, LIVING, '2026-12')).toBe(thisMonth);
  });
});
