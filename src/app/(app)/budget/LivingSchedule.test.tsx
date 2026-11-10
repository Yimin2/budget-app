// @vitest-environment jsdom
/* 예산: 생활비 항목의 쓰는 날 (평일 · 공휴일 빼기 · 주 N회) 과 쉬는 날 (PLAN 4-1) */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { current, renderApp, startDemo } from '../_components/__tests__/harness';

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => nav.router, usePathname: () => '/budget' }));

import BudgetPage from './page';
import { openOut } from './budgetTestUtils';

afterEach(cleanup);

describe('예산 — 생활비 쓰는 날', () => {
  it('평일 · 공휴일 빼기를 고르면 미리 보기가 보이고, 저장하면 목록에 표시 · 회사 쉬는 날 칸은 없어요', async () => {
    const h = renderApp(<BudgetPage />);
    await startDemo(h);
    const food = current(h).ledger.data!.fixedExpenses.find((f) => f.kind === 'living' && f.spread === 'daily')!;
    const name = current(h).ledger.data!.categories.find((c) => c.id === food.categoryId)!.name;
    fireEvent.click(within(openOut('고정지출통장', '생활비 예산')).getByRole('button', { name: new RegExp(name) }));
    let dialog = screen.getByRole('dialog', { name: '생활비 예산 고치기' });
    // 매일: 11월 20일(금)부터 11일
    expect(within(dialog).getByText(/11월 남은 11일 → 하루/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('radio', { name: '평일' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /공휴일 빼기/ }));
    expect(within(dialog).getByText(/11월 남은 쓰는 날 7일 → 하루/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(current(h).ledger.data!.fixedExpenses.find((f) => f.id === food.id)).toMatchObject({ useDays: [1, 2, 3, 4, 5], skipHolidays: true });
    expect(within(openOut('고정지출통장', '생활비 예산')).getByText('평일 · 공휴일 빼기')).toBeTruthy();

    // 회사 쉬는 날 넣기는 없어요 (공휴일 빼기만, 8-3)
    expect(screen.queryByLabelText('쉬는 날 추가 (회사 휴무 등)')).toBeNull();
    expect(screen.queryByText('쉬는 날')).toBeNull();

    // 주 N회로 바꾸기
    fireEvent.click(within(openOut('고정지출통장', '생활비 예산')).getByRole('button', { name: new RegExp(name) }));
    dialog = screen.getByRole('dialog', { name: '생활비 예산 고치기' });
    fireEvent.click(within(dialog).getByRole('radio', { name: '주 N회' }));
    expect(within(dialog).getByText(/이번 주 남은 \d회 · 한 번에/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const row = current(h).ledger.data!.fixedExpenses.find((f) => f.id === food.id)!;
    expect(row.perWeek).toBe(2);
    expect(row.useDays).toBeUndefined();
    expect(within(openOut('고정지출통장', '생활비 예산')).getByText('주 2회')).toBeTruthy();
  });
});
