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

const list = () => screen.getByRole('heading', { level: 2, name: '카테고리' }).closest('.card') as HTMLElement;

/** jsdom 은 배치를 하지 않아서, 줄마다 56px 높이로 놓인 것처럼 꾸며요 */
function fakeLayout() {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const i = Number(this.dataset.index ?? 0);
    return { top: i * 56, bottom: i * 56 + 56, height: 56, left: 0, right: 320, width: 320, x: 0, y: i * 56, toJSON: () => ({}) } as DOMRect;
  });
}

async function storedOrder(h: ReturnType<typeof renderApp>) {
  const stored = await h.local.open(current(h).ledger.ref!).load();
  return stored.categories.filter((c) => !c.deleted).sort((a, b) => a.order - b.order).map((c) => c.name);
}

describe('카테고리 순서 바꾸기', () => {
  it('위로 · 아래로 버튼 대신 줄마다 44px 손잡이가 있어요', async () => {
    const h = renderApp(<Card />);
    await startDemo(h);
    const names = activeNames(current(h).ledger.activeCategories);
    expect(within(list()).queryByRole('button', { name: `${names[0]} 아래로` })).toBeNull();
    const handle = within(list()).getByRole('button', { name: `${names[0]} 순서 바꾸기` });
    expect(handle.className).toContain('st-cat-handle');
    expect(within(list()).getByText(/순서 바꾸기: 손잡이를 끌어 놓아요/)).toBeTruthy();
  });

  it('손잡이를 끌어 놓으면(포인터) 한 번에 여러 칸 옮겨 저장하고, 되돌리기로 제자리에', async () => {
    const h = renderApp(<Card />);
    await startDemo(h);
    const spy = fakeLayout();
    const names = activeNames(current(h).ledger.activeCategories);
    const [first, second, third] = names as [string, string, string];
    const handle = within(list()).getByRole('button', { name: `${first} 순서 바꾸기` });
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 28, button: 0, pointerType: 'touch' });
    const row = handle.closest('li')!;
    expect(row.className).toContain('is-lifted');
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 28 + 56 * 2 });
    // 집은 줄은 손가락을 따라가고, 사이의 줄은 한 칸 위로 비켜나요
    expect(row.style.transform).toBe('translateY(112px)');
    const secondRow = within(list()).getByRole('button', { name: `${second} 순서 바꾸기` }).closest('li')!;
    expect(secondRow.style.transform).toBe('translateY(-56px)');
    await act(async () => {
      fireEvent.pointerUp(handle, { pointerId: 1, clientY: 28 + 56 * 2 });
    });
    spy.mockRestore();
    await waitFor(() => expect(activeNames(current(h).ledger.activeCategories).slice(0, 3)).toEqual([second, third, first]));
    expect(current(h).ledger.activeCategories.map((c) => c.order)).toEqual(names.map((_, i) => i));
    expect((await storedOrder(h)).slice(0, 3)).toEqual([second, third, first]);
    expect(within(list()).getByRole('status').textContent).toContain('3번째로 옮겼어요');

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: '되돌리기' }));
    });
    await waitFor(() => expect(activeNames(current(h).ledger.activeCategories)).toEqual(names));
  });

  it('끄는 중 취소(pointercancel)하면 그대로예요', async () => {
    const h = renderApp(<Card />);
    await startDemo(h);
    const spy = fakeLayout();
    const names = activeNames(current(h).ledger.activeCategories);
    const handle = within(list()).getByRole('button', { name: `${names[0]} 순서 바꾸기` });
    fireEvent.pointerDown(handle, { pointerId: 2, clientY: 28, button: 0, pointerType: 'mouse' });
    fireEvent.pointerMove(handle, { pointerId: 2, clientY: 200 });
    fireEvent.pointerCancel(handle, { pointerId: 2 });
    spy.mockRestore();
    expect(handle.closest('li')!.className).not.toContain('is-lifted');
    expect(activeNames(current(h).ledger.activeCategories)).toEqual(names);
  });

  it('키보드: 스페이스로 집고 화살표로 옮긴 뒤 스페이스로 놓아요 · Esc 는 그대로', async () => {
    const h = renderApp(<Card />);
    await startDemo(h);
    const names = activeNames(current(h).ledger.activeCategories);
    const [first, second] = names as [string, string];
    const handle = () => within(list()).getByRole('button', { name: `${first} 순서 바꾸기` });

    // Esc: 그대로
    fireEvent.keyDown(handle(), { key: ' ' });
    expect(handle().getAttribute('aria-pressed')).toBe('true');
    expect(within(list()).getByRole('status').textContent).toContain('집었어요');
    fireEvent.keyDown(handle(), { key: 'ArrowDown' });
    fireEvent.keyDown(handle(), { key: 'Escape' });
    expect(handle().getAttribute('aria-pressed')).toBe('false');
    expect(activeNames(current(h).ledger.activeCategories)).toEqual(names);

    fireEvent.keyDown(handle(), { key: 'Enter' });
    fireEvent.keyDown(handle(), { key: 'ArrowDown' });
    // 놓기 전에도 놓일 자리에 보이고, 손잡이에 포커스가 남아요
    const rows = within(list()).getAllByRole('button', { name: /순서 바꾸기$/ }).map((b) => b.getAttribute('aria-label'));
    expect(rows.slice(0, 2)).toEqual([`${second} 순서 바꾸기`, `${first} 순서 바꾸기`]);
    expect(document.activeElement).toBe(handle());
    expect(within(list()).getByRole('status').textContent).toBe('2번째');
    await act(async () => {
      fireEvent.keyDown(handle(), { key: ' ' });
    });
    await waitFor(() => expect(activeNames(current(h).ledger.activeCategories).slice(0, 2)).toEqual([second, first]));
    expect((await storedOrder(h)).slice(0, 2)).toEqual([second, first]);
  });
});
