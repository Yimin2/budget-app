// @vitest-environment jsdom
/* 예산: 생활비 항목 금액은 이번 달부터만 · 이 달만 다른 금액 (PLAN 4-1) */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { current, renderApp, startDemo } from '../_components/__tests__/harness';

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => nav.router, usePathname: () => '/budget' }));

import BudgetPage from './page';

afterEach(cleanup);

function card(title: string): HTMLElement {
  return screen.getByRole('heading', { level: 2, name: title }).closest('.card') as HTMLElement;
}

describe('예산 — 생활비 항목 금액', () => {
  it('금액을 바꾸면 이번 달부터 새 행, 지난달은 그대로 · 이 달만 다른 금액을 넣고 지워요', async () => {
    const h = renderApp(<BudgetPage />);
    await startDemo(h);
    const ledger = () => current(h).ledger;
    const food = ledger().data!.fixedExpenses.find((f) => f.kind === 'living' && f.spread === 'daily')!;
    const name = ledger().data!.categories.find((c) => c.id === food.categoryId)!.name;
    // 6월부터 쓰던 항목으로
    await act(async () => {
      await ledger().saveFixed({ ...food, startMonth: '2026-06' });
    });

    fireEvent.click(within(card('생활비 예산')).getByRole('button', { name: new RegExp(name) }));
    let dialog = screen.getByRole('dialog', { name: '생활비 예산 고치기' });
    expect(within(dialog).getByText('바꾸면 11월부터 적용돼요. 지난달 계산은 그대로예요.')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/한 달 예산/), { target: { value: String(food.amount + 50_000) } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const rows = ledger().data!.fixedExpenses;
    expect(rows.find((f) => f.id === food.id)).toMatchObject({ amount: food.amount, endMonth: '2026-10' });
    expect(rows.find((f) => f.id === `${food.id}@2026-11`)).toMatchObject({ amount: food.amount + 50_000, startMonth: '2026-11' });
    expect(screen.getByText('이번 달부터 바꿨어요. 지난달은 그대로예요')).toBeTruthy();

    // 이 달만 다른 금액: 2026-12 · 700,000원
    fireEvent.click(within(card('생활비 예산')).getByRole('button', { name: new RegExp(name) }));
    dialog = screen.getByRole('dialog', { name: '생활비 예산 고치기' });
    expect(within(dialog).queryByText(/바꾸면 11월부터/)).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('달'), { target: { value: '2026-12' } });
    fireEvent.change(within(dialog).getByLabelText('그 달 금액'), { target: { value: '700000' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '넣기' }));
    });
    await waitFor(() => expect(within(dialog).getByText('2026-12 ·', { exact: false })).toBeTruthy());
    const once = ledger().data!.fixedExpenses.find((f) => f.override)!;
    expect(once).toMatchObject({ id: `${food.id}@once-2026-12`, startMonth: '2026-12', endMonth: '2026-12', amount: 700_000, categoryId: food.categoryId });
    expect(within(dialog).getByText('700,000원')).toBeTruthy();
    // 목록에는 평소 행만, 이 달만은 한 줄 설명으로
    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(card('생활비 예산')).getByText(/12월만 700,000원/)).toBeTruthy();

    // 지우기
    fireEvent.click(within(card('생활비 예산')).getByRole('button', { name: new RegExp(name) }));
    dialog = screen.getByRole('dialog', { name: '생활비 예산 고치기' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '2026-12 금액 지우기' }));
    });
    await waitFor(() => expect(ledger().data!.fixedExpenses.find((f) => f.override)!.deleted).toBe(true));
    expect(within(dialog).queryByText('2026-12 ·', { exact: false })).toBeNull();
  });
});
