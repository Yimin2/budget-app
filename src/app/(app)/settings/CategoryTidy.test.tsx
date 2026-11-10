// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeCountsText, objectParticle, planCategoryMerge } from '@/domain';
import { current, renderApp, startDemo } from '../_components/__tests__/harness';
import { CategoriesCard } from './sections/CategoriesCard';
import type { ReadyLedger } from '../_components/RequireLedger';
import { ExpenseDialog } from '../history/_expenses/ExpenseDialog';
import { useLedger } from '@/state';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/settings' }));

afterEach(cleanup);

function Card() {
  const ledger = useLedger();
  return ledger.status === 'ready' && ledger.data ? <CategoriesCard ledger={ledger as ReadyLedger} /> : null;
}
function Dialog() {
  const ledger = useLedger();
  return ledger.status === 'ready' && ledger.data ? <ExpenseDialog onClose={() => {}} /> : null;
}

const card = () => screen.getByRole('heading', { level: 2, name: '카테고리' }).closest('.card') as HTMLElement;

describe('카테고리 합치기 (설정)', () => {
  it('정리 → 다른 카테고리로 합치기 → 대상 고르기 → 미리 보기 → [합치기] → 모두 옮기고, 되돌리기로 제자리', async () => {
    const h = renderApp(<Card />);
    await startDemo(h);
    const before = current(h).ledger.data!;
    const cafeCount = before.expenses.filter((e) => !e.deleted && e.categoryId === 'demo-cat-cafe').length;
    expect(cafeCount).toBeGreaterThan(0);

    const more = within(card()).getByRole('button', { name: '카페 정리하기 (합치기 · 숨기기)' });
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(within(card()).getByRole('button', { name: /다른 카테고리로 합치기/ }));
    expect(within(card()).getByText('카페를 어느 카테고리로 합칠까요?')).toBeTruthy();
    expect((within(card()).getByRole('button', { name: '합치기' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(within(card()).getByRole('group', { name: '합칠 카테고리' })).getByRole('button', { name: '식비' }));

    const counts = mergeCountsText(planCategoryMerge(before, 'demo-cat-cafe', 'demo-cat-food').counts);
    expect(within(card()).getByText(`${counts}${objectParticle(counts)} '식비'로 옮겨요`)).toBeTruthy();
    expect(within(card()).getByText(/'카페'는 목록에서 빠져요/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(card()).getByRole('button', { name: '합치기' }));
    });
    await screen.findByText("카페를 '식비'로 합쳤어요");
    const after = current(h).ledger.data!;
    expect(after.expenses.filter((e) => !e.deleted && e.categoryId === 'demo-cat-cafe')).toEqual([]);
    expect(after.categories.find((c) => c.id === 'demo-cat-cafe')!.deleted).toBe(true);
    expect(within(card()).queryByRole('button', { name: '카페 정리하기 (합치기 · 숨기기)' })).toBeNull();
    // 저장본에도
    const stored = await h.local.open(current(h).ledger.ref!).load();
    expect(stored.expenses.filter((e) => !e.deleted && e.categoryId === 'demo-cat-cafe')).toEqual([]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    });
    await screen.findByText('합치기를 되돌렸어요');
    const undone = current(h).ledger.data!;
    expect(undone.expenses.filter((e) => !e.deleted && e.categoryId === 'demo-cat-cafe')).toHaveLength(cafeCount);
    expect(undone.categories.find((c) => c.id === 'demo-cat-cafe')!.deleted).toBe(false);
  });
});

describe('카테고리 숨기기', () => {
  it('정리 → 숨기기: 목록과 기록 창에서 빠지고, [숨긴 카테고리 보기]에서 [다시 보기]', async () => {
    const h = renderApp(
      <>
        <Card />
        <Dialog />
      </>,
    );
    await startDemo(h);
    const dialog = await screen.findByRole('dialog', { name: '지출 기록' });
    const all = () => [
      ...within(dialog).getAllByRole('group', { name: /^카테고리/ }).flatMap((g) => within(g).queryAllByRole('button').map((b) => b.textContent)),
    ];
    fireEvent.click(within(dialog).getByRole('button', { name: /더 보기/ }));
    expect(all()).toContain('카페');

    fireEvent.click(within(card()).getByRole('button', { name: '카페 정리하기 (합치기 · 숨기기)' }));
    await act(async () => {
      fireEvent.click(within(card()).getByRole('button', { name: '숨기기' }));
    });
    await screen.findByText('카페를 숨겼어요. 예전 기록과 예산은 그대로예요');
    const L = current(h).ledger;
    expect(L.data!.categories.find((c) => c.id === 'demo-cat-cafe')!.hidden).toBe(true);
    expect(L.pickableCategories.some((c) => c.id === 'demo-cat-cafe')).toBe(false);
    expect(L.activeCategories.some((c) => c.id === 'demo-cat-cafe')).toBe(true);
    expect(all()).not.toContain('카페');
    expect(within(card()).queryByRole('button', { name: '카페 정리하기 (합치기 · 숨기기)' })).toBeNull();
    expect(within(card()).getByText(/숨김 1개/)).toBeTruthy();

    const toggle = within(card()).getByRole('button', { name: '숨긴 카테고리 보기 (1)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await act(async () => {
      fireEvent.click(within(card()).getByRole('button', { name: '카페 다시 보기' }));
    });
    await waitFor(() => expect(current(h).ledger.data!.categories.find((c) => c.id === 'demo-cat-cafe')!.hidden).toBeUndefined());
    expect(all()).toContain('카페');
  });

  it("최근 3개월 동안 안 쓴 카테고리 N개 · [모두 숨기기]", async () => {
    const h = renderApp(<Card />);
    await startDemo(h);
    await act(async () => {
      await current(h).ledger.addCategory({ name: '골프', icon: 'dots', defaultAccountRole: 'fixed' });
      await current(h).ledger.addCategory({ name: '낚시', icon: 'dots', defaultAccountRole: 'fixed' });
    });
    const banner = await within(card()).findByText(/최근 3개월 동안 안 쓴 카테고리 \d+개/);
    const box = banner.closest('.st-cat-suggest') as HTMLElement;
    expect(box.textContent).toContain('골프');
    expect(box.textContent).toContain('낚시');
    expect(within(card()).getAllByText(/3개월 동안 안 썼어요/).length).toBeGreaterThanOrEqual(2);
    await act(async () => {
      fireEvent.click(within(box).getByRole('button', { name: '모두 숨기기' }));
    });
    await waitFor(() => expect(current(h).ledger.data!.categories.filter((c) => c.name === '골프' || c.name === '낚시').every((c) => c.hidden)).toBe(true));
    expect(within(card()).queryByText(/최근 3개월 동안 안 쓴 카테고리/)).toBeNull();
  });
});
