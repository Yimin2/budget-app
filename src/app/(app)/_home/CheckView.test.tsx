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

/* 2026-11-20 체험 가계부 (남은 일수 11): 오늘 써도 되는 돈 합 10,500원 · 남은 생활비 231,900원
   식비(하루씩) 오늘 10,600 · 남은 117,400 / 쇼핑(한 달 한도) 남은 20,200 · 남겨 둘 돈 10,000 */

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
  it('큰 금액이면 12개월 할부 매달 금액과 맞는지 함께 알려 줘요', async () => {
    await renderCheck({ initialAmount: 100_000 });
    fireEvent.click(screen.getByRole('button', { name: '쇼핑' }));
    await screen.findByRole('heading', { level: 2, name: /괜찮아요|가능하지만|비추천/ });
    expect(screen.queryByText(/개월 할부면/)).toBeNull();
    fireEvent.change(amountInput(), { target: { value: '600000' } });
    expect(await screen.findByText('12개월 할부면 매달 50,000원이에요. 한 달 쇼핑 예산 60,000원 안이에요')).toBeTruthy();
    fireEvent.change(amountInput(), { target: { value: '1200000' } });
    expect(await screen.findByText('12개월 할부면 매달 100,000원이에요. 한 달 쇼핑 예산보다 40,000원 많아요')).toBeTruthy();
  });

  it('금액이 없으면 안내만 보이고 [샀어요]를 누를 수 없어요', async () => {
    await renderCheck();
    expect(screen.getByText('어디에 쓸지 골라 주세요')).toBeTruthy();
    // 체험 예시: 어제 준호가 개인 돈으로 낸 마트 장보기 24,000원도 식비에 들어가 있어요
    expect(screen.getByText('오늘 써도 되는 돈 8,300원')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '식비' }));
    expect(screen.getByText('금액을 넣으면 바로 알려 드려요')).toBeTruthy();
    expect(screen.getByText('오늘 식비에 써도 되는 돈 8,400원')).toBeTruthy();
    expect((screen.getByRole('button', { name: /샀어요/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('link', { name: '안 살래요' }).getAttribute('href')).toBe('/');
  });

  it('항목을 고르기 전에는 판단하지 않아요', async () => {
    await renderCheck({ initialAmount: 3_000 });
    expect(screen.getByText('어디에 쓸지 골라 주세요')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: /괜찮아요|가능하지만|비추천/ })).toBeNull();
    expect((screen.getByRole('button', { name: /샀어요/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('입력하는 대로 신호등이 바뀌어요 (하루에 나눠 쓰는 항목: 식비)', async () => {
    await renderCheck();
    fireEvent.click(screen.getByRole('button', { name: '식비' }));
    expect(screen.getByRole('button', { name: '식비' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(amountInput(), { target: { value: '3000' } });
    await waitFor(() => expect(verdictTitle()).toBe('괜찮아요'));
    expect(screen.getByText('오늘 식비 예산 안이에요')).toBeTruthy();

    fireEvent.change(amountInput(), { target: { value: '70,000' } });
    await waitFor(() => expect(verdictTitle()).toBe('가능하지만'));
    expect(screen.getByText('사면 내일부터 식비에 하루 2,300원씩 쓸 수 있어요')).toBeTruthy();

    fireEvent.change(amountInput(), { target: { value: '150000' } });
    await waitFor(() => expect(verdictTitle()).toBe('비추천'));
    expect(screen.getByText('이번 달 식비 예산을 56,600원 넘어요')).toBeTruthy();
    expect((screen.getByRole('button', { name: /샀어요/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('한 달 한도만 보는 항목(쇼핑)은 남은 돈과 남은 날 몫으로 판단해요', async () => {
    await renderCheck({ initialAmount: 10_000 });
    fireEvent.click(screen.getByRole('button', { name: '쇼핑' }));
    await waitFor(() => expect(verdictTitle()).toBe('괜찮아요'));
    expect(screen.getByText('이번 달 쇼핑 한도 안이에요')).toBeTruthy();
    fireEvent.change(amountInput(), { target: { value: '15000' } });
    await waitFor(() => expect(verdictTitle()).toBe('가능하지만'));
    expect(screen.getByText('사면 이번 달 쇼핑 한도가 5,200원 남아요')).toBeTruthy();
    fireEvent.change(amountInput(), { target: { value: '30000' } });
    await waitFor(() => expect(verdictTitle()).toBe('비추천'));
    expect(screen.getByText('12월 1일에 사면 쇼핑 한도 안이에요')).toBeTruthy();
  });

  it('빠른 금액 칩 · 만원 더하기', async () => {
    await renderCheck();
    fireEvent.click(screen.getByRole('button', { name: '식비' }));
    fireEvent.click(screen.getByRole('button', { name: '5만원' }));
    expect(amountInput().value).toBe('50,000');
    expect(screen.getByRole('button', { name: '5만원' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '1만원 더하기' }));
    expect(amountInput().value).toBe('60,000');
    fireEvent.click(screen.getByRole('button', { name: '10만원 더하기' }));
    expect(amountInput().value).toBe('160,000');
    await waitFor(() => expect(verdictTitle()).toBe('비추천'));
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

    // 생활비 항목을 고르면 다시 생활비
    fireEvent.click(screen.getByRole('button', { name: '카페' }));
    await waitFor(() => expect(verdictTitle()).toBe('비추천'));
    expect(within(group).getByRole('radio', { name: '생활비로' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('figure')).toBeNull();
  });

  it('[샀어요 · 기록하기] → 확인 시트 → 기록 → 알림 → 홈', async () => {
    const h = await renderCheck({ initialAmount: 20_000 });
    fireEvent.click(screen.getByRole('button', { name: '쇼핑' }));
    await waitFor(() => expect(verdictTitle()).toBe('가능하지만'));
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

  it('개인 돈으로 냈어요: 낸 사람을 고르면 언제 돌려주는지 보여 주고 기록해요', async () => {
    const h = await renderCheck({ initialAmount: 50_000, initialSource: 'event' });
    fireEvent.click(screen.getByRole('button', { name: /샀어요/ }));
    const dialog = await screen.findByRole('dialog', { name: '지출로 기록할게요' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /개인 돈으로 냈어요/ }));
    const payer = within(dialog).getByLabelText(/누가 냈나요/) as HTMLSelectElement;
    expect(payer.value).toBe('민지'); // 체험 모드 사용자
    fireEvent.change(payer, { target: { value: '준호' } });
    // 이벤트통장 잔액 900,000 − 다른 청구 300,000 이 50,000 을 감당해요 → 오늘
    expect(within(dialog).getByText('준호에게 50,000원, 오늘 돌려주세요')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));
    });
    await screen.findByText(/기록했어요 · 준호에게 50,000원, 오늘 돌려주세요/);
    const row = h.probe.ledger!.data!.expenses.find((e) => e.paidBy === '준호' && e.amount === 50_000)!;
    expect(row).toMatchObject({ accountId: 'demo-acc-event', claimAccountId: 'demo-acc-income-junho', claimDue: '2026-11-20' });
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

  it('여행을 고르면 여행 남은 예산으로 판단하고, 기록하면 여행에 묶여요', async () => {
    const h = await renderCheck({ initialAmount: 100_000 });
    fireEvent.click(screen.getByRole('button', { name: '제주 여행' }));
    expect(screen.getByRole('radio', { name: '이벤트통장으로' }).getAttribute('aria-checked')).toBe('true');
    // 여행 남은 예산 안이라 이미 예측에 있던 돈: 4월 부족은 그대로 300,000원 (여행 없이 보면 400,000원)
    expect(await screen.findByText('사면 2027년 4월에 300,000원 모자라요')).toBeTruthy();
    expect(screen.getByText('제주 여행 남은 예산').nextElementSibling?.textContent).toBe('350,000원');
    fireEvent.click(screen.getByRole('button', { name: '제주 여행' }));
    expect(await screen.findByText('사면 2027년 4월에 400,000원 모자라요')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '제주 여행' }));
    await screen.findByText('사면 2027년 4월에 300,000원 모자라요');
    fireEvent.click(screen.getByRole('button', { name: /샀어요/ }));
    const dialog = await screen.findByRole('dialog', { name: '지출로 기록할게요' });
    expect(within(dialog).getByText('제주 여행')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));
    });
    await screen.findByText(/100,000원 기록했어요/);
    const added = h.probe.ledger!.data!.expenses.find((e) => e.amount === 100_000 && e.tripId === 'demo-trip-jeju');
    expect(added?.accountId).toBe('demo-acc-event');
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
    await act(async () => {
      for (const f of h.probe.ledger!.data!.fixedExpenses.filter((x) => x.kind === 'living')) {
        await h.probe.ledger!.saveFixed({ ...f, deleted: true });
      }
    });
    await screen.findByText('생활비를 아직 정하지 않았어요');
    fireEvent.change(amountInput(), { target: { value: '10000' } });
    await waitFor(() => expect(screen.getByText('생활비를 정하면 바로 알려 드려요')).toBeTruthy());
    expect(screen.queryByRole('heading', { level: 2, name: /비추천/ })).toBeNull();
    expect((screen.getByRole('button', { name: /샀어요/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('생활비 항목이 하나뿐이면(예전 생활비 한 줄) 고르지 않아도 바로 판단해요', async () => {
    const h = await renderCheck();
    await act(async () => {
      for (const f of h.probe.ledger!.data!.fixedExpenses.filter((x) => x.kind === 'living')) {
        await h.probe.ledger!.saveFixed({ ...f, deleted: true });
      }
      await h.probe.ledger!.addFixed({
        name: '생활비', amount: 600_000, accountId: 'demo-acc-fixed', categoryId: null, dayOfMonth: null, kind: 'living',
        targetEmail: null, spread: 'daily', startMonth: '2026-11', endMonth: null,
      });
    });
    fireEvent.change(amountInput(), { target: { value: '3000' } });
    await waitFor(() => expect(verdictTitle()).toBe('괜찮아요'));
    expect(screen.getByText('오늘 생활비 예산 안이에요')).toBeTruthy();
    expect(screen.getByRole('button', { name: '생활비' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('결과 영역은 처음부터 알림 영역이라 첫 결과도 읽어 줘요', async () => {
    await renderCheck();
    const region = screen.getByText('어디에 쓸지 골라 주세요').closest('[aria-live]')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    fireEvent.click(screen.getByRole('button', { name: '식비' }));
    fireEvent.change(amountInput(), { target: { value: '3000' } });
    await waitFor(() => expect(verdictTitle()).toBe('괜찮아요'));
    expect(screen.getByRole('heading', { level: 2, name: '괜찮아요' }).closest('[aria-live]')).toBe(region);
  });
});

