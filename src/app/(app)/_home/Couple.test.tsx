// @vitest-environment jsdom
/* 사람별 생활비 (PLAN 4-13 · 4-14): 부부 체험 예시로 홈 · 사도 돼? · 누가 썼나요 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expenseSpender, formatWon } from '@/domain';
import { useLedger } from '@/state';
import { ExpenseDialog } from '../history/_expenses/ExpenseDialog';
import { CheckView } from './CheckView';
import { HomeView } from './HomeView';
import { makeHarness } from './testUtils';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

beforeEach(() => nav.push.mockReset());
afterEach(cleanup);

const MINJI = 'demo-acc-living-minji';
const JUNHO = 'demo-acc-living-junho';

/** 가계부를 다 불러온 뒤에 그려요 (기록 창은 데이터가 있을 때만 열려요) */
function WhenReady({ children }: { children: React.ReactNode }) {
  return useLedger().status === 'ready' ? <>{children}</> : null;
}

async function renderWith(ui: React.ReactElement) {
  const h = makeHarness({ couple: true });
  await act(async () => {
    render(<WhenReady>{ui}</WhenReady>, { wrapper: h.Wrapper });
  });
  return h;
}

describe('홈 — 사람별 오늘 써도 되는 돈', () => {
  it('로그인한 사람(민지)의 금액을 크게, 준호 · 둘이 합친 금액은 작게 보여 주고, 준호로 바꿔 볼 수 있어요', async () => {
    const h = await renderWith(<HomeView />);
    const hero = await screen.findByRole('region', { name: '오늘 내가 써도 되는 돈' });
    const ledger = h.probe.ledger!;
    expect(ledger.myLivingAccountId).toBe(MINJI);
    const mine = ledger.livingFor(MINJI)!;
    const his = ledger.livingFor(JUNHO)!;
    expect(mine.todayAvailable).toBeGreaterThan(0);
    expect(within(hero).getByText(formatWon(mine.todayAvailable))).toBeTruthy();
    const others = within(hero).getByRole('list', { name: '다른 사람과 합계' });
    // 하루 항목에 오늘 쓴 돈이 있으면 '오늘 쓴 돈 ○원·써도 되는 돈 ○원', 없으면 금액만
    const small = (l: typeof his) => {
      const spent = l.items.reduce((n, i) => (i.spread === 'daily' ? n + i.spentToday : n), 0);
      return spent > 0 ? `오늘 쓴 돈 ${formatWon(spent)}·써도 되는 돈 ${formatWon(l.todayAvailable)}` : formatWon(l.todayAvailable);
    };
    expect(within(others).getByText('준호').nextElementSibling!.textContent).toBe(small(his));
    expect(within(others).getByText('둘이 합쳐').nextElementSibling!.textContent).toBe(small(ledger.living!));
    expect(ledger.living!.todayAvailable).toBe(mine.todayAvailable + his.todayAvailable);
    expect(screen.getByRole('region', { name: '항목별 생활비 · 민지' })).toBeTruthy();

    const switcher = within(hero).getByRole('radiogroup', { name: '누구 생활비를 볼까요' });
    expect(within(switcher).getByRole('radio', { name: '민지 (나)' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(switcher).getByRole('radio', { name: '준호' }));
    const junhoHero = await screen.findByRole('region', { name: '오늘 준호가 써도 되는 돈' });
    expect(within(junhoHero).getByText(formatWon(his.todayAvailable))).toBeTruthy();
    expect(within(junhoHero).getByText('민지')).toBeTruthy();
    expect(screen.getByRole('region', { name: '항목별 생활비 · 준호' })).toBeTruthy();
  });

  it('자주 쓰는 지출은 로그인한 사람(민지)이 쓴 지출에서만 추천하고, 누르면 민지 생활비 통장으로 기록해요', async () => {
    const h = await renderWith(<HomeView />);
    await screen.findByRole('region', { name: '오늘 내가 써도 되는 돈' });
    const section = screen.getByRole('region', { name: '자주 쓰는 지출' });
    const labels = within(section).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(labels[0]).toBe('커피 4,500원 기록하기');
    // 준호만 쓴 지출(라테 · 마트 · 영화 · 약국)은 나오지 않아요
    for (const name of ['라테', '마트', '영화', '약국']) expect(labels.some((l) => l!.startsWith(`${name} `))).toBe(false);
    fireEvent.click(within(section).getByRole('button', { name: '커피 4,500원 기록하기' }));
    const form = within(section).getByRole('form', { name: '커피 기록' });
    fireEvent.change(within(form).getByLabelText('금액'), { target: { value: '4800' } });
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: '기록하기' }));
    });
    await screen.findByText('커피 4,800원 기록했어요');
    const row = h.probe.ledger!.data!.expenses.find((e) => !e.id.startsWith('demo-') && e.memo === '커피')!;
    expect(row).toMatchObject({ accountId: MINJI, date: '2026-11-20', amount: 4_800 });
    // 쓴 사람 = 민지 (생활비 통장 주인)
    expect(expenseSpender(h.probe.ledger!.data!, row).name).toBe('민지');
  });
});

describe('사도 돼? — 누구 생활비 · 누가 썼나요', () => {
  function verdictTitle() {
    return screen.getByRole('heading', { level: 2, name: /괜찮아요|가능하지만|비추천/ }).textContent;
  }

  it('기본은 내 예산, 준호로 바꾸면 준호 예산으로 판단하고, 기록할 때 누가 썼는지 바꾸면 그 사람 생활비 통장으로', async () => {
    const h = await renderWith(<CheckView initialAmount={1_000} />);
    const who = await screen.findByRole('radiogroup', { name: '누구 생활비로 볼까요' });
    expect(within(who).getByRole('radio', { name: '민지 (나)' }).getAttribute('aria-checked')).toBe('true');
    const ledger = h.probe.ledger!;
    const food = ledger.data!.categories.find((c) => c.name === '식비')!.id;
    // 민지 식비로는 되지만 준호 식비 남은 돈보다는 큰 금액
    const minjiFood = ledger.livingFor(MINJI)!.items.find((i) => i.categoryId === food)!;
    const junhoFood = ledger.livingFor(JUNHO)!.items.find((i) => i.categoryId === food)!;
    expect(minjiFood.remaining).toBeGreaterThan(junhoFood.remaining);
    const amount = junhoFood.remaining + 1_000;
    fireEvent.change(screen.getByLabelText('사려는 금액'), { target: { value: String(amount) } });
    fireEvent.click(screen.getByRole('button', { name: '식비' }));
    await waitFor(() => expect(verdictTitle()).not.toBe('비추천'));

    fireEvent.click(within(who).getByRole('radio', { name: '준호' }));
    fireEvent.click(screen.getByRole('button', { name: '식비' }));
    await waitFor(() => expect(verdictTitle()).toBe('비추천'));

    // 기록 창: 사도 돼?에서 고른 준호가 기본, 통장은 준호 생활비 통장
    fireEvent.click(screen.getByRole('button', { name: /샀어요/ }));
    const dialog = await screen.findByRole('dialog', { name: '지출로 기록할게요' });
    const spender = within(dialog).getByRole('group', { name: '누가 썼나요?' });
    expect(within(spender).getByRole('button', { name: '준호' }).getAttribute('aria-pressed')).toBe('true');
    expect((within(dialog).getByLabelText(/통장/) as HTMLSelectElement).value).toBe(JUNHO);
    // 민지로 바꾸면 민지 생활비 통장
    fireEvent.click(within(spender).getByRole('button', { name: '민지 (나)' }));
    expect((within(dialog).getByLabelText(/통장/) as HTMLSelectElement).value).toBe(MINJI);
    fireEvent.change(within(dialog).getByLabelText(/내용/), { target: { value: '장보기 테스트' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));
    });
    await waitFor(() => expect(h.probe.ledger!.data!.expenses.some((e) => e.memo === '장보기 테스트')).toBe(true));
    expect(h.probe.ledger!.data!.expenses.find((e) => e.memo === '장보기 테스트')).toMatchObject({ accountId: MINJI, categoryId: food });
  });

  it('이벤트통장으로 사면 누가 썼든 함께 쓰는 이벤트통장에서 나가요', async () => {
    await renderWith(<CheckView initialAmount={10_000} initialSource="event" />);
    await screen.findByRole('radiogroup', { name: '어느 돈으로 살까요' });
    await waitFor(() => expect(screen.getByRole('button', { name: /샀어요/ }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /샀어요/ }));
    const dialog = await screen.findByRole('dialog', { name: '지출로 기록할게요' });
    expect((within(dialog).getByLabelText(/통장/) as HTMLSelectElement).value).toBe('demo-acc-event');
    fireEvent.click(within(within(dialog).getByRole('group', { name: '누가 썼나요?' })).getByRole('button', { name: '준호' }));
    expect((within(dialog).getByLabelText(/통장/) as HTMLSelectElement).value).toBe('demo-acc-event');
  });
});

describe('지출 기록 창 — 누가 썼나요', () => {
  it('새 기록은 나(민지), 고르면 그 사람 생활비 통장으로. 고치는 지출은 그 통장 주인이 골라져 있어요', async () => {
    const h = await renderWith(<ExpenseDialog onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: '지출 기록' });
    const spender = within(dialog).getByRole('group', { name: '누가 썼나요?' });
    expect(within(spender).getByRole('button', { name: '민지 (나)' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(dialog).getByRole('button', { name: '카페' }));
    expect((within(dialog).getByLabelText(/통장/) as HTMLSelectElement).value).toBe(MINJI);
    fireEvent.click(within(spender).getByRole('button', { name: '준호' }));
    expect((within(dialog).getByLabelText(/통장/) as HTMLSelectElement).value).toBe(JUNHO);
    fireEvent.change(within(dialog).getByLabelText(/^금액/), { target: { value: '5200' } });
    fireEvent.change(within(dialog).getByLabelText(/내용/), { target: { value: '라테 테스트' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));
    });
    await waitFor(() => expect(h.probe.ledger!.data!.expenses.find((e) => e.memo === '라테 테스트')?.accountId).toBe(JUNHO));
    cleanup();

    const saved = h.probe.ledger!.data!.expenses.find((e) => e.memo === '라테 테스트')!;
    const h2 = await renderWith(<ExpenseDialog expense={{ ...saved, accountId: JUNHO }} onClose={() => {}} />);
    void h2;
    const edit = await screen.findByRole('dialog', { name: '지출 고치기' });
    const who = within(edit).getByRole('group', { name: '누가 썼나요?' });
    await waitFor(() => expect(within(who).getByRole('button', { name: '준호' }).getAttribute('aria-pressed')).toBe('true'));
  });
});
