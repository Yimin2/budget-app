// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Category } from '@/domain/types';
import { current, renderApp, startDemo } from '../_components/__tests__/harness';
import { CategoriesCard } from './sections/CategoriesCard';
import type { ReadyLedger } from '../_components/RequireLedger';
import { useLedger } from '@/state';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/settings' }));

afterEach(cleanup);

function Card() {
  const ledger = useLedger();
  return ledger.status === 'ready' && ledger.data ? <CategoriesCard ledger={ledger as ReadyLedger} /> : null;
}

const activeNames = (cats: Category[]) => cats.map((c) => c.name);

describe('카테고리 순서 바꾸기', () => {
  it('위로 · 아래로 버튼(44px 아이콘 버튼)으로 옮기면 order 를 다시 매겨 저장하고, 되돌리기로 제자리에', async () => {
    const h = renderApp(<Card />);
    await startDemo(h);
    const list = () => screen.getByRole('heading', { level: 2, name: '카테고리' }).closest('.card') as HTMLElement;
    const names = activeNames(current(h).ledger.activeCategories);
    const [first, second] = names as [string, string];
    // 맨 위는 위로를 누를 수 없어요
    expect((within(list()).getByRole('button', { name: `${first} 위로` }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(list()).getByRole('button', { name: `${names.at(-1)} 아래로` }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      fireEvent.click(within(list()).getByRole('button', { name: `${first} 아래로` }));
    });
    await waitFor(() => expect(activeNames(current(h).ledger.activeCategories).slice(0, 2)).toEqual([second, first]));
    expect(current(h).ledger.activeCategories.map((c) => c.order)).toEqual(names.map((_, i) => i));
    const stored = await h.local.open(current(h).ledger.ref!).load();
    expect(stored.categories.filter((c) => !c.deleted).sort((a, b) => a.order - b.order).slice(0, 2).map((c) => c.name)).toEqual([second, first]);
    expect(within(list()).getByRole('status').textContent).toContain('아래로 옮겼어요');

    // 되돌리기
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: '되돌리기' }));
    });
    await waitFor(() => expect(activeNames(current(h).ledger.activeCategories)).toEqual(names));
  });
});
