// @vitest-environment jsdom
/* 예산: 수입 계획 · 나머지 배분 · 사람별 생활비 (부부 체험 예시, PLAN 4-13 · 4-14) */
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

describe('예산 — 부부 예시', () => {
  it('수입 계획 목록 · 월급날마다 미리보기 · 나머지가 있으면 남는 돈 경고 없음', async () => {
    const h = renderApp(<BudgetPage />, { couple: true });
    await startDemo(h);
    const income = card('수입 계획');
    expect(within(income).getByText('한 달 6,000,000원')).toBeTruthy();
    expect(within(income).getByRole('button', { name: /민지/ })).toBeTruthy();

    const rules = card('매달 배분');
    const preview = within(rules).getByRole('list', { name: '월급날마다 보내는 돈' });
    expect(within(preview).getAllByRole('listitem').map((li) => li.firstChild?.textContent)).toEqual([
      '21일: 320만 → 생활비(민지) 90만 · 생활비(준호) 110만 · 이벤트 30만 · 나머지 90만 → 저수지',
      '25일: 280만 → 용돈(민지) 40만 · 용돈(준호) 35만 · 저축투자 100만 · 나머지 105만 → 저수지',
    ]);
    // 나머지 예상 (PLAN 4-15): 다음 회차 예상과 매달 약
    expect(within(preview).getByText('나머지 전부 → 저수지 · 다음 21일 예상 900,000원')).toBeTruthy();
    expect(within(preview).getByText('저수지로 매달 약 105만원')).toBeTruthy();
    // 다음 배분에 필요한 금액: 생활비 · 용돈 통장마다 한 줄
    const needs = card('다음 배분에 필요한 금액');
    expect(within(needs).getByText(/^생활비\(민지\)/)).toBeTruthy();
    expect(within(rules).getByText('나머지 → 저수지통장').nextSibling?.textContent).toBe('1,950,000원');
    expect(within(rules).queryByText(/수입보다/)).toBeNull();
    expect(within(rules).getAllByText('나머지 전부')).toHaveLength(2);
  });

  it('수입 계획 금액을 고치고, 나머지 규칙을 정한 금액으로 바꾸거나 같은 날 하나 더 만들지 못하게 해요', async () => {
    const h = renderApp(<BudgetPage />, { couple: true });
    await startDemo(h);

    // 수입 계획: 준호 월급 280만 → 300만
    fireEvent.click(within(card('수입 계획')).getByRole('button', { name: /준호/ }));
    let dialog = screen.getByRole('dialog', { name: '수입 계획 고치기' });
    fireEvent.change(within(dialog).getByLabelText(/한 달 금액/), { target: { value: '3000000' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(current(h).ledger.data!.incomePlans.find((p) => p.personName === '준호')!.amount).toBe(3_000_000);
    expect(within(card('매달 배분')).getByText(/25일: 300만/)).toBeTruthy();

    // 같은 날(21일) 나머지 배분을 하나 더 만들면 막아요
    fireEvent.click(within(card('매달 배분')).getByRole('button', { name: '배분 추가' }));
    dialog = screen.getByRole('dialog', { name: '매달 배분 추가' });
    fireEvent.change(within(dialog).getByLabelText('받는 통장'), { target: { value: 'demo-acc-event' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: '나머지 전부' }));
    expect(within(dialog).queryByLabelText('금액')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('이체일'), { target: { value: '21' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(await within(dialog).findByText('이 통장에서 같은 날 나머지를 보내는 배분이 이미 있어요')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }));

    // 25일 나머지 → 정한 금액 500,000
    const rows = within(card('매달 배분')).getAllByRole('button', { name: /월급통장 → 저수지통장/ });
    fireEvent.click(rows[1]!);
    dialog = screen.getByRole('dialog', { name: '매달 배분 고치기' });
    expect(within(dialog).getByRole('radio', { name: '나머지 전부' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(dialog).getByRole('radio', { name: '정한 금액' }));
    fireEvent.change(within(dialog).getByLabelText('금액'), { target: { value: '500000' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const changed = current(h).ledger.data!.rules.find((r) => r.id === 'demo-rule-25-reservoir')!;
    expect(changed).toMatchObject({ kind: 'fixed', amount: 500_000 });
  });

  it('생활비 항목은 누구 생활비인지 고르고, 같은 항목도 사람마다 따로 둘 수 있어요', async () => {
    const h = renderApp(<BudgetPage />, { couple: true });
    await startDemo(h);
    const living = card('생활비 예산');
    fireEvent.click(within(living).getByRole('button', { name: '생활비 항목 추가' }));
    const dialog = screen.getByRole('dialog', { name: '생활비 항목 추가' });
    const who = within(dialog).getByLabelText(/누구 생활비인가요/) as HTMLSelectElement;
    expect(who.value).toBe('demo-acc-living-minji');
    const etc = current(h).ledger.data!.categories.find((c) => c.name === '기타')!.id;
    fireEvent.change(within(dialog).getByLabelText(/항목/), { target: { value: etc } });
    fireEvent.change(who, { target: { value: 'demo-acc-living-junho' } });
    fireEvent.change(within(dialog).getByLabelText(/한 달 예산/), { target: { value: '15000' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const row = current(h).ledger.data!.fixedExpenses.find((f) => f.kind === 'living' && f.categoryId === etc)!;
    expect(row).toMatchObject({ accountId: 'demo-acc-living-junho', amount: 15_000 });
    expect(current(h).ledger.livingFor('demo-acc-living-junho')!.items.some((i) => i.categoryId === etc && !i.unbudgeted)).toBe(true);
  });
});
