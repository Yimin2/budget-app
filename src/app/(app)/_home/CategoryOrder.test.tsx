// @vitest-environment jsdom
/** 카테고리 순서: 옮기면 홈 항목별 생활비 · 사도 돼? 어디에 쓸까요 칩이 그 순서를 따르고, 기타 묶음은 맨 뒤 */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeView } from './HomeView';
import { CheckView } from './CheckView';
import { makeHarness } from './testUtils';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

afterEach(cleanup);

const names = (el: HTMLElement, selector: string) => [...el.querySelectorAll(selector)].map((x) => x.textContent?.trim() ?? '');

describe('카테고리 순서를 모든 화면이 따라요', () => {
  it('식비를 맨 아래로 옮기면 홈 항목 · 사도 돼? 칩 · 생활비 항목이 따라요', async () => {
    const h = makeHarness();
    await act(async () => {
      render(
        <>
          <HomeView />
          <CheckView />
        </>,
        { wrapper: h.Wrapper },
      );
    });
    const items = await screen.findByRole('region', { name: '항목별 생활비' });
    const ledger = () => h.probe.ledger!;
    const livingNames = () => ledger().living!.items.map((i) => i.name);
    const before = livingNames();
    expect(before[0]).toBe('식비');
    const food = ledger().activeCategories.find((c) => c.name === '식비')!;
    const steps = ledger().activeCategories.length;
    for (let i = 0; i < steps; i++) {
      await act(async () => {
        await ledger().moveCategory(food.id, 1);
      });
    }
    await waitFor(() => expect(ledger().activeCategories.at(-1)!.name).toBe('식비'));
    // order 가 0..n-1 로 다시 매겨져요
    expect(ledger().activeCategories.map((c) => c.order)).toEqual(ledger().activeCategories.map((_, i) => i));
    // 생활비 항목: 식비가 예산 항목 중 맨 뒤, 기타(예산 없음)가 있으면 그 뒤
    const after = livingNames();
    const budgeted = ledger().living!.items.filter((i) => !i.unbudgeted).map((i) => i.name);
    expect(budgeted.at(-1)).toBe('식비');
    const etc = ledger().living!.items.findIndex((i) => i.unbudgeted);
    if (etc >= 0) expect(etc).toBe(after.length - 1);
    // 홈 항목별 생활비 카드도 같은 순서
    expect(names(within(items).getByRole('list'), ':scope > li [class*="itemText"]')).toEqual(after);
    // 사도 돼? 어디에 쓸까요 칩: 생활비 항목 순서 그대로 (식비가 생활비 칩 중 맨 뒤)
    const chips = names(screen.getByRole('group', { name: '어디에 쓸까요' }), 'button');
    expect(chips.slice(0, budgeted.length)).toEqual(budgeted);
  });
});
