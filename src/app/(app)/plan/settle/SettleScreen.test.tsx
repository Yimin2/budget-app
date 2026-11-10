// @vitest-environment jsdom
/** 정산 화면 '/plan/settle': 사람별 항목 · 전체 선택 / 선택 해제 · 사람 선택(일부만 = indeterminate) · 지급 · 저수지에서 빌려 지급 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimLoanTransferId, claimTransferId } from '@/domain';
import { makeHarness } from '../testHarness';
import SettlePage, { metadata } from './page';
import { SettleScreen } from './SettleScreen';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/plan/settle',
}));

afterEach(cleanup);

const L = (h: ReturnType<typeof makeHarness>) => h.probe.ledger!;
const eventCat = (h: ReturnType<typeof makeHarness>) =>
  L(h).data!.categories.find((c) => !c.deleted && c.defaultAccountRole === 'event')!.id;

async function renderScreen() {
  const h = makeHarness();
  render(<SettleScreen />, { wrapper: h.Wrapper });
  const list = await screen.findByRole('region', { name: '사람별 항목' });
  const bar = screen.getByRole('region', { name: '고른 항목' });
  return { h, list, bar };
}

const box = (scope: HTMLElement, name: string | RegExp) => within(scope).getByRole('checkbox', { name }) as HTMLInputElement;

describe('정산 화면', () => {
  it("'/plan/settle' 페이지가 정산 화면을 그려요 (제목 '이번 달 정산')", async () => {
    const h = makeHarness();
    render(<SettlePage />, { wrapper: h.Wrapper });
    expect(metadata.title).toBe('이번 달 정산');
    expect(await screen.findByRole('region', { name: '사람별 항목' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '이번 달 정산', level: 1 })).toBeTruthy();
  });

  it('뒤로 가기 · 지급할 수 있는 돈과 셈 · 사람별 항목, 처음엔 오래된 순으로 나눠 둔 것만 골라 둬요', async () => {
    const { list, bar } = await renderScreen();
    expect(screen.getByRole('heading', { name: '이번 달 정산', level: 1 })).toBeTruthy();
    expect(screen.getByRole('link', { name: '이벤트로' }).getAttribute('href')).toBe('/plan');
    const payable = screen.getByRole('region', { name: '지급할 수 있는 돈' });
    expect(payable.textContent).toContain('지급할 수 있는 돈 750,000원');
    expect(payable.textContent).toMatch(/이벤트통장 잔액/);

    const minji = within(list).getByRole('list', { name: '민지 항목' });
    expect(within(minji).getByRole('button', { name: '제주 항공권 자세히 보기' })).toBeTruthy();
    expect(box(minji, '제주 항공권 300,000원 고르기').checked).toBe(true);
    const junho = within(list).getByRole('list', { name: '준호 항목' });
    expect(within(junho).getAllByRole('checkbox').every((c) => !(c as HTMLInputElement).checked)).toBe(true);
    expect(junho.textContent).toMatch(/정산일 \d+\/\d+/);
    expect(bar.textContent).toContain('고른 1건 · 300,000원');
  });

  it('전체 선택 · 선택 해제 · 사람 선택 (일부만 고르면 indeterminate)', async () => {
    const { h, list, bar } = await renderScreen();
    await act(async () => {
      await L(h).addExpense({ date: '2026-11-05', amount: 50_000, accountId: 'demo-acc-event', categoryId: eventCat(h), memo: '하늘 돌잔치', paidBy: '민지' });
    });
    const minjiAll = await waitFor(() => box(list, '민지 모두 고르기'));
    const junhoAll = box(list, '준호 모두 고르기');
    expect(minjiAll.checked).toBe(true);
    expect(minjiAll.indeterminate).toBe(false);
    expect(junhoAll.checked).toBe(false);

    // 민지 항목 하나만 빼면 사람 체크박스가 indeterminate
    fireEvent.click(box(list, '제주 항공권 300,000원 고르기'));
    expect(minjiAll.checked).toBe(false);
    expect(minjiAll.indeterminate).toBe(true);
    expect(bar.textContent).toContain('고른 1건 · 50,000원');
    // 사람 체크박스를 누르면 그 사람 모두
    fireEvent.click(minjiAll);
    expect(minjiAll.checked).toBe(true);
    expect(minjiAll.indeterminate).toBe(false);
    expect(bar.textContent).toContain('고른 2건 · 350,000원');
    fireEvent.click(minjiAll);
    expect(within(list).getByRole('list', { name: '민지 항목' }).querySelectorAll('input:checked')).toHaveLength(0);

    fireEvent.click(within(list).getByRole('button', { name: '전체 선택' }));
    const all = within(list).getAllByRole('checkbox') as HTMLInputElement[];
    expect(all.every((c) => c.checked)).toBe(true);
    expect(junhoAll.checked).toBe(true);
    expect(bar.textContent).toContain('고른 3건 · 374,000원');

    fireEvent.click(within(list).getByRole('button', { name: '선택 해제' }));
    expect((within(list).getAllByRole('checkbox') as HTMLInputElement[]).every((c) => !c.checked && !c.indeterminate)).toBe(true);
    expect(bar.textContent).toContain('고른 0건 · 0원');
    expect((within(bar).getByRole('button', { name: '지급했어요' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('[지급했어요]: 고른 것만 claim:<id> 이체로 지급하고, 되돌리기로 지워요', async () => {
    const { h, bar } = await renderScreen();
    await act(async () => {
      fireEvent.click(within(bar).getByRole('button', { name: '지급했어요' }));
    });
    await screen.findByText('고른 1건 300,000원을 지급했다고 기록했어요');
    expect(L(h).data!.transfers.filter((t) => t.id === claimTransferId('demo-claim-jeju') && !t.deleted)).toHaveLength(1);
    expect(L(h).settlement!.pay).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    });
    await waitFor(() => expect(L(h).settlement!.pay.map((g) => g.amount)).toEqual([300_000]));
  });

  it('지급할 수 있는 돈보다 많이 고르면 넘는 금액을 보이고, [저수지에서 빌려 지급]은 넘는 것만 빌려요', async () => {
    const { h, list, bar } = await renderScreen();
    await act(async () => {
      await L(h).addExpense({ date: '2026-11-04', amount: 900_000, accountId: 'demo-acc-event', categoryId: eventCat(h), memo: '바다 결혼 선물', paidBy: '민지' });
    });
    const big = await waitFor(() => box(list, '바다 결혼 선물 900,000원 고르기'));
    expect(big.checked).toBe(false);
    fireEvent.click(big);
    expect(bar.textContent).toContain('이벤트통장에서 줄 수 있는 돈은 75만이에요 · 나머지 90만은 저수지에서 빌려 줄 수 있어요');
    // [지급했어요]는 안에 드는 것만 (막히지 않음), 넘는 것은 [저수지에서 빌려 지급]으로만
    expect((within(bar).getByRole('button', { name: '지급했어요' }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      fireEvent.click(within(bar).getByRole('button', { name: '저수지에서 빌려 지급' }));
    });
    await screen.findByText('고른 2건을 지급하고 넘는 900,000원은 저수지에서 빌렸다고 기록했어요');
    const id = L(h).data!.expenses.find((e) => e.memo === '바다 결혼 선물')!.id;
    expect(L(h).data!.transfers.some((t) => t.id === claimLoanTransferId(id) && !t.deleted)).toBe(true);
    expect(L(h).data!.transfers.some((t) => t.id === claimLoanTransferId('demo-claim-jeju') && !t.deleted)).toBe(false);
    expect(L(h).settlement!.loan.balance).toBe(900_000);
  });

  it('이벤트통장이 음수면 맨 위에 모자란 돈, 지급할 수 있는 돈이 0 이면 [지급했어요]는 이유와 함께 막히고 빌려 지급만 돼요', async () => {
    const { h, list, bar } = await renderScreen();
    await act(async () => {
      await L(h).addExpense({ date: '2026-11-03', amount: 5_000_000, accountId: 'demo-acc-event', categoryId: eventCat(h), memo: '큰 지출' });
    });
    await waitFor(() => expect(L(h).settlement!.shortfall).toBeGreaterThan(0));
    const s = L(h).settlement!;
    expect(s.payable).toBe(0);
    const short = `이벤트통장이 ${s.shortfall.toLocaleString('ko-KR')}원 모자라요`;
    expect(await screen.findByText(short)).toBeTruthy();
    expect(screen.getByTestId('settle-explain').textContent).toMatch(/^지갑\(이벤트통장\)이 .+만 모자라.*줄 수 있는 돈은 0원이에요\.$/);

    const jeju = box(list, '제주 항공권 300,000원 고르기');
    if (!jeju.checked) fireEvent.click(jeju);
    expect(bar.textContent).toContain('이벤트통장에서 줄 수 있는 돈이 없어요 · 나머지 30만은 저수지에서 빌려 줄 수 있어요');
    const pay = within(bar).getByRole('button', { name: '지급했어요' }) as HTMLButtonElement;
    expect(pay.disabled).toBe(true);
    expect(bar.textContent).toContain('이벤트통장에서 줄 수 있는 돈이 없어서 지급할 수 없어요');
    await act(async () => {
      fireEvent.click(within(bar).getByRole('button', { name: '저수지에서 빌려 지급' }));
    });
    await screen.findByText('고른 1건을 지급하고 넘는 300,000원은 저수지에서 빌렸다고 기록했어요');
    expect(L(h).data!.transfers.some((t) => t.id === claimLoanTransferId('demo-claim-jeju') && !t.deleted)).toBe(true);
  });

  it("지난달에 못 준 청구는 '지난달부터' 표시와 함께 먼저 골라 두고, 설명에 먼저 돌려준다고 알려요", async () => {
    const { h, list } = await renderScreen();
    await act(async () => {
      const e = await L(h).addExpense({ date: '2026-10-02', amount: 70_000, accountId: 'demo-acc-event', categoryId: eventCat(h), memo: '지난 돌잔치', paidBy: '민지' });
      // 10월 정산일에 못 준 청구로 (돌려줄 날만 바꾸면 그대로 둬요)
      await L(h).updateExpense({ ...e, claimDue: '2026-10-21' });
    });
    const old = await waitFor(() => box(list, '지난 돌잔치 70,000원 고르기'));
    expect(old.checked).toBe(true);
    const row = old.closest('li')!;
    expect(row.textContent).toContain('지난달부터');
    expect(box(list, '제주 항공권 300,000원 고르기').closest('li')!.textContent).not.toContain('지난달부터');
    expect(screen.getByTestId('settle-explain').textContent).toContain('지난달에 못 준 돈 7만을 먼저 돌려줘요.');
  });

  it('저수지 돈으로 낸 이벤트 청구는 사람 목록 안에 "저수지에서 빌려 지급" 표시로, 지급하면 저수지에 갚을 돈이 돼요', async () => {
    const { h, list, bar } = await renderScreen();
    const before = { ...L(h).balances };
    await act(async () => {
      await L(h).addExpense({ date: '2026-10-02', amount: 120_000, accountId: 'demo-acc-reservoir', categoryId: eventCat(h), memo: '나무 돌잔치', paidBy: '민지' });
    });
    const minji = await waitFor(() => within(list).getByRole('list', { name: '민지 항목' }));
    await waitFor(() => expect(box(minji, '나무 돌잔치 120,000원 고르기').checked).toBe(true));
    expect(minji.textContent).toContain('저수지에서 빌려 지급');
    expect(screen.queryByText(/저수지에 (쓸|줄) 돈|저수지에서 돌려받을|빌려 줄 돈/)).toBeNull();
    expect(bar.textContent).toContain('저수지에서 빌려 지급 1건 120,000원 포함');

    fireEvent.click(box(minji, '제주 항공권 300,000원 고르기'));
    await act(async () => {
      fireEvent.click(within(bar).getByRole('button', { name: '지급했어요' }));
    });
    await screen.findByText(/고른 1건 120,000원을 지급했다고 기록했어요/);
    const id = L(h).data!.expenses.find((e) => e.memo === '나무 돌잔치')!.id;
    expect(L(h).data!.expenses.find((e) => e.id === id)!.accountId).toBe('demo-acc-event');
    expect(L(h).settlement!.loan.balance).toBe(120_000);
    expect(L(h).balances['demo-acc-reservoir']).toBe(before['demo-acc-reservoir']! - 120_000);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    });
    await waitFor(() => expect(L(h).settlement!.loan.balance).toBe(0));
    expect(L(h).data!.expenses.find((e) => e.id === id)!.accountId).toBe('demo-acc-reservoir');
  });

  it("맨 아래 '저수지' 칸(#loan): 요약과 [모두 보기] → 같은 자리에서 빌리고 갚은 기록(취소 · 금액 고치기) · 하나씩 바꾸기, [접기]", async () => {
    const { h } = await renderScreen();
    expect(screen.queryByRole('region', { name: /^저수지 · 갚을 돈/ })).toBeNull();
    await act(async () => {
      await L(h).borrowAndSettleClaims(['demo-claim-jeju']);
      await L(h).addExpense({ date: '2026-10-05', amount: 200_000, accountId: 'demo-acc-reservoir', categoryId: eventCat(h), memo: '돌잔치' });
    });
    const loan = await screen.findByRole('region', { name: '저수지 · 갚을 돈 30만' });
    expect(loan.id).toBe('loan');
    expect(loan.querySelector('details')).toBeNull();
    expect(within(loan).getByTestId('loan-section-summary').textContent).toBe(
      '빌린 돈 30만 · 갚은 돈 0원 · 남은 갚을 돈 30만 · 바꿀 수 있는 지출 1건',
    );
    expect(within(loan).queryByRole('list', { name: '빌리고 갚은 기록' })).toBeNull();
    const toggle = within(loan).getByRole('button', { name: '저수지 기록 모두 보기' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    const history = within(loan).getByRole('list', { name: '빌리고 갚은 기록' });
    expect(history.textContent).toContain('민지에게 지급 · 제주 항공권');
    expect(history.textContent).toContain('저수지에서 지급');
    await act(async () => {
      fireEvent.click(within(loan).getByRole('button', { name: '돌잔치 200,000원 이벤트통장이 갚을 돈으로 바꾸기' }));
    });
    await screen.findByText('200,000원을 이벤트통장이 갚을 돈으로 바꿨어요');
    expect(L(h).settlement!.loan.balance).toBe(500_000);
    await waitFor(() => expect(within(loan).getByRole('button', { name: '돌잔치 취소' })).toBeTruthy());
    fireEvent.click(within(loan).getByRole('button', { name: '저수지 기록 접기' }));
    expect(within(loan).queryByRole('list', { name: '빌리고 갚은 기록' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
