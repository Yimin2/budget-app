// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckScreen } from './CheckScreen';
import { CheckView } from './CheckView';
import { makeHarness } from './testUtils';

const nav = vi.hoisted(() => ({ push: vi.fn(), params: new URLSearchParams() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => nav.params,
  usePathname: () => '/check',
}));

beforeEach(() => {
  nav.push.mockReset();
  nav.params = new URLSearchParams();
});
afterEach(cleanup);

/* 2026-11-20 체험 가계부: 오늘 써도 되는 돈 16,900원 · 남은 생활비 231,900원 */

async function renderCheck(props: Parameters<typeof CheckView>[0] = {}) {
  const h = makeHarness();
  render(<CheckView {...props} />, { wrapper: h.Wrapper });
  await screen.findByRole('radiogroup', { name: '어느 돈으로 살까요' });
  return h;
}

function amountInput() {
  return screen.getByLabelText('사려는 금액') as HTMLInputElement;
}

function verdictTitle() {
  return screen.getByRole('heading', { level: 2, name: /괜찮아요|가능하지만|비추천/ }).textContent;
}

describe('CheckView — 사도 돼?', () => {
  it('금액이 없으면 안내만 보이고 [샀어요]를 누를 수 없어요', async () => {
    await renderCheck();
    expect(screen.getByText('금액을 넣으면 바로 알려 드려요')).toBeTruthy();
    expect(screen.getByText('오늘 써도 되는 생활비 16,900원')).toBeTruthy();
    expect((screen.getByRole('button', { name: /샀어요/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('link', { name: '안 살래요' }).getAttribute('href')).toBe('/');
  });

  it('입력하는 대로 신호등이 바뀌어요 (생활비 기준)', async () => {
    await renderCheck();
    fireEvent.change(amountInput(), { target: { value: '3000' } });
    await waitFor(() => expect(verdictTitle()).toBe('괜찮아요'));
    expect(screen.getByText('오늘 생활비 안이에요')).toBeTruthy();

    fireEvent.change(amountInput(), { target: { value: '200,000' } });
    await waitFor(() => expect(verdictTitle()).toBe('가능하지만'));
    expect(screen.getByText(/사면 남은 날 하루 생활비가/)).toBeTruthy();

    fireEvent.change(amountInput(), { target: { value: '300000' } });
    await waitFor(() => expect(verdictTitle()).toBe('비추천'));
    expect(screen.getByText('이번 달 생활비를 68,100원 넘어요')).toBeTruthy();
    expect((screen.getByRole('button', { name: /샀어요/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('빠른 금액 칩 · 만원 더하기', async () => {
    await renderCheck();
    fireEvent.click(screen.getByRole('button', { name: '5만원' }));
    expect(amountInput().value).toBe('50,000');
    expect(screen.getByRole('button', { name: '5만원' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '1만원 더하기' }));
    expect(amountInput().value).toBe('60,000');
    fireEvent.click(screen.getByRole('button', { name: '10만원 더하기' }));
    expect(amountInput().value).toBe('160,000');
    await waitFor(() => expect(verdictTitle()).toBe('가능하지만'));
  });

  it('이벤트 카테고리를 고르면 이벤트통장 기준으로 바뀌고 12개월 막대를 보여 줘요', async () => {
    await renderCheck({ initialAmount: 200_000 });
    const group = screen.getByRole('radiogroup', { name: '어느 돈으로 살까요' });
    expect(within(group).getByRole('radio', { name: '생활비로' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '경조사' }));
    expect(within(group).getByRole('radio', { name: '이벤트통장으로' }).getAttribute('aria-checked')).toBe('true');
    const chart = await screen.findByRole('figure', { name: '사면 이벤트통장 예상 잔액' });
    expect(within(chart).getAllByRole('row')).toHaveLength(13); // 머리 + 12개월
    // 체험 가계부는 4월에 이미 모자라서, 더 사면 '가능하지만'
    await waitFor(() => expect(verdictTitle()).toBe('가능하지만'));
    expect(within(chart).getByText(/2027년 4월에 .*원 모자라요/)).toBeTruthy();

    // 생활비 카테고리를 고르면 다시 생활비
    fireEvent.click(screen.getByRole('button', { name: '카페' }));
    expect(within(group).getByRole('radio', { name: '생활비로' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('figure')).toBeNull();
  });

  it('[샀어요 · 기록하기] → 확인 시트 → 기록 → 알림 → 홈', async () => {
    const h = await renderCheck({ initialAmount: 20_000 });
    await waitFor(() => expect(verdictTitle()).toBe('가능하지만'));
    fireEvent.click(screen.getByRole('button', { name: '쇼핑' }));
    fireEvent.click(screen.getByRole('button', { name: /샀어요/ }));

    const dialog = await screen.findByRole('dialog', { name: '지출로 기록할게요' });
    expect((within(dialog).getByLabelText(/날짜/) as HTMLInputElement).value).toBe('2026-11-20');
    expect((within(dialog).getByLabelText(/카테고리/) as HTMLSelectElement).value).toBe('demo-cat-shopping');
    expect((within(dialog).getByLabelText(/통장/) as HTMLSelectElement).value).toBe('demo-acc-fixed');
    fireEvent.change(within(dialog).getByLabelText(/내용/), { target: { value: '양말' } });

    const before = h.probe.ledger!.data!.expenses.length;
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));
    });
    await screen.findByText('양말 20,000원 기록했어요');
    expect(nav.push).toHaveBeenCalledWith('/');
    const data = h.probe.ledger!.data!;
    expect(data.expenses.length).toBe(before + 1);
    const row = data.expenses.find((e) => e.memo === '양말')!;
    expect(row).toMatchObject({ amount: 20_000, accountId: 'demo-acc-fixed', categoryId: 'demo-cat-shopping', date: '2026-11-20' });
    expect(screen.queryByRole('dialog')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    });
    await waitFor(() => expect(h.probe.ledger!.data!.expenses.find((e) => e.id === row.id)?.deleted).toBe(true));
  });

  it('이벤트통장으로 사면 이벤트통장에 기록해요', async () => {
    const h = await renderCheck({ initialAmount: 50_000, initialSource: 'event' });
    fireEvent.click(screen.getByRole('button', { name: /샀어요/ }));
    const dialog = await screen.findByRole('dialog', { name: '지출로 기록할게요' });
    expect((within(dialog).getByLabelText(/통장/) as HTMLSelectElement).value).toBe('demo-acc-event');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));
    });
    await screen.findByText('지출 50,000원 기록했어요');
    expect(h.probe.ledger!.data!.expenses.some((e) => e.accountId === 'demo-acc-event' && e.amount === 50_000)).toBe(true);
  });
});

describe('CheckScreen — 주소로 미리 채우기', () => {
  it('?amount=2만&source=event', async () => {
    nav.params = new URLSearchParams('amount=2만&source=event');
    const h = makeHarness();
    render(<CheckScreen />, { wrapper: h.Wrapper });
    await screen.findByRole('radiogroup', { name: '어느 돈으로 살까요' });
    expect(amountInput().value).toBe('20,000');
    expect(screen.getByRole('radio', { name: '이벤트통장으로' }).getAttribute('aria-checked')).toBe('true');
  });

  it('생활비를 정하지 않았으면 비추천 대신 안내만 보여요', async () => {
    const h = await renderCheck();
    const living = h.probe.ledger!.data!.fixedExpenses.find((f) => f.kind === 'living')!;
    await act(async () => {
      await h.probe.ledger!.saveFixed({ ...living, deleted: true });
    });
    await screen.findByText('생활비를 아직 정하지 않았어요');
    fireEvent.change(amountInput(), { target: { value: '10000' } });
    await waitFor(() => expect(screen.getByText('생활비를 정하면 바로 알려 드려요')).toBeTruthy());
    expect(screen.queryByRole('heading', { level: 2, name: /비추천/ })).toBeNull();
    expect((screen.getByRole('button', { name: /샀어요/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('결과 영역은 처음부터 알림 영역이라 첫 결과도 읽어 줘요', async () => {
    await renderCheck();
    const region = screen.getByText('금액을 넣으면 바로 알려 드려요').closest('[aria-live]')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    fireEvent.change(amountInput(), { target: { value: '3000' } });
    await waitFor(() => expect(verdictTitle()).toBe('괜찮아요'));
    expect(screen.getByRole('heading', { level: 2, name: '괜찮아요' }).closest('[aria-live]')).toBe(region);
  });
});

