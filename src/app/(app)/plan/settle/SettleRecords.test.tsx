// @vitest-environment jsdom
/** 정산 화면 '지급한 기록'(#paid · 지급 취소)과 '저수지'(#loan · 금액 고치기 · 취소), 내역 → 이체의 정산 이체 안내 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimLoanTransferId, claimTransferId, expenseLoanTransferId, isClaimSettled, loanRepayId, settleEditHref } from '@/domain';
import { TransfersScreen } from '../../history/TransfersScreen';
import { makeHarness, TEST_NOW } from '../testHarness';
import { SettleScreen } from './SettleScreen';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/plan/settle',
}));

afterEach(cleanup);

type H = ReturnType<typeof makeHarness>;
const L = (h: H) => h.probe.ledger!;
const eventCat = (h: H) => L(h).data!.categories.find((c) => !c.deleted && c.defaultAccountRole === 'event')!.id;
const live = (h: H, id: string) => L(h).data!.transfers.find((t) => t.id === id && !t.deleted);
const expense = (h: H, id: string) => L(h).data!.expenses.find((e) => e.id === id)!;
const month = TEST_NOW.toISOString().slice(0, 7);

async function renderScreen() {
  const h = makeHarness();
  render(<SettleScreen />, { wrapper: h.Wrapper });
  await screen.findByRole('region', { name: '사람별 항목' });
  return h;
}

/** 접힌 요약에서 [모두 보기]를 눌러 같은 자리에서 펼쳐요 */
function expand(region: HTMLElement, label: string) {
  const btn = within(region).getByRole('button', { name: `${label} 모두 보기` });
  expect(btn.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(btn);
  expect(within(region).getByRole('button', { name: `${label} 접기` }).getAttribute('aria-expanded')).toBe('true');
}

async function addReservoirClaim(h: H, memo: string, amount = 120_000) {
  await act(async () => {
    await L(h).addExpense({ date: '2026-10-02', amount, accountId: 'demo-acc-reservoir', categoryId: eventCat(h), memo, paidBy: '민지' });
  });
  return L(h).data!.expenses.find((e) => e.memo === memo)!.id;
}

describe('지급한 기록 (#paid)', () => {
  it('지급한 청구를 달마다 최근 순으로 보이고, [지급 취소]는 다시 줄 돈으로 (다시 해도 같고, 되돌리기로 다시 지급)', async () => {
    const h = await renderScreen();
    await act(async () => {
      await L(h).settleClaims(['demo-claim-jeju']);
    });
    const paid = await screen.findByRole('region', { name: '지급한 기록' });
    expect(paid.id).toBe('paid');
    // 처음에는 요약 한 줄만
    expect(within(paid).getByTestId('paid-summary').textContent).toMatch(/^이번 달 \d+건 .+ · 전체 \d+건 .+$/);
    expect(within(paid).queryAllByRole('list')).toHaveLength(0);
    expand(paid, '지급한 기록');
    const lists = within(paid).getAllByRole('list');
    // 가장 최근에 지급한 제주 항공권이 맨 위
    const first = within(lists[0]!).getAllByRole('listitem')[0]!;
    expect(first.textContent).toContain('민지 · 제주 항공권');
    expect(first.textContent).toContain('300,000원');
    expect(first.textContent).not.toContain('저수지에서 빌려 지급');

    const before = { ...L(h).balances };
    await act(async () => {
      fireEvent.click(within(paid).getByRole('button', { name: '민지 제주 항공권 300,000원 지급 취소' }));
    });
    await screen.findByText('민지에게 300,000원 지급한 기록을 취소했어요');
    expect(isClaimSettled(L(h).data!, 'demo-claim-jeju')).toBe(false);
    expect(L(h).claims!.pending.some((c) => c.expense.id === 'demo-claim-jeju')).toBe(true);
    expect(within(paid).queryByRole('button', { name: '민지 제주 항공권 300,000원 지급 취소' })).toBeNull();
    expect(L(h).balances['demo-acc-event']).toBe(before['demo-acc-event']! + 300_000);

    // 다시 해도 아무것도 바뀌지 않아요
    const rows = L(h).data!.transfers.length;
    const again = await act(() => L(h).undoClaimPayments(['demo-claim-jeju']));
    expect(again.transfers).toHaveLength(0);
    expect(L(h).data!.transfers.length).toBe(rows);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    });
    await waitFor(() => expect(isClaimSettled(L(h).data!, 'demo-claim-jeju')).toBe(true));
    expect(L(h).balances['demo-acc-event']).toBe(before['demo-acc-event']);
  });

  it('저수지에서 빌려 지급한 청구: 표시가 붙고, 취소하면 빌린 이체도 지우고 지출을 저수지로 되돌려요', async () => {
    const h = await renderScreen();
    const id = await addReservoirClaim(h, '나무 돌잔치');
    const before = { ...L(h).balances };
    await act(async () => {
      await L(h).borrowReservoirClaims([id]);
    });
    expect(expense(h, id).accountId).toBe('demo-acc-event');
    const paid = await screen.findByRole('region', { name: '지급한 기록' });
    expand(paid, '지급한 기록');
    const row = within(paid).getByRole('button', { name: '민지 나무 돌잔치 120,000원 지급 취소' }).closest('li')!;
    expect(row.textContent).toContain('저수지에서 빌려 지급');

    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: /지급 취소/ }));
    });
    await screen.findByText('민지에게 120,000원 지급한 기록을 취소했어요');
    expect(live(h, claimTransferId(id))).toBeUndefined();
    expect(live(h, claimLoanTransferId(id))).toBeUndefined();
    expect(expense(h, id).accountId).toBe('demo-acc-reservoir');
    expect(L(h).settlement!.loan.balance).toBe(0);
    expect(L(h).balances).toEqual(before);
    expect(L(h).settlement!.reservoirLoan.flatMap((g) => g.claims.map((c) => c.expense.id))).toContain(id);
  });

  it('이벤트통장 청구를 빌려 지급한 것은 지출을 옮기지 않았으니 이벤트통장에 그대로 둬요', async () => {
    const h = await renderScreen();
    await act(async () => {
      await L(h).borrowAndSettleClaims(['demo-claim-jeju']);
    });
    await act(async () => {
      await L(h).undoClaimPayments(['demo-claim-jeju']);
    });
    expect(expense(h, 'demo-claim-jeju').accountId).toBe('demo-acc-event');
    expect(live(h, claimLoanTransferId('demo-claim-jeju'))).toBeUndefined();
    expect(isClaimSettled(L(h).data!, 'demo-claim-jeju')).toBe(false);
  });
});

describe('저수지 기록 (#loan)', () => {
  it('[금액 고치기]: 그 줄이 금액 칸 + [저장] / [취소]가 되고, 빌린 이체 금액만 고쳐요 (지급은 그대로)', async () => {
    const h = await renderScreen();
    await act(async () => {
      await L(h).borrowAndSettleClaims(['demo-claim-jeju']);
    });
    const loan = await screen.findByRole('region', { name: '저수지 · 갚을 돈 30만' });
    expand(loan, '저수지 기록');
    const row = within(loan).getByTestId(`loan-row-${claimLoanTransferId('demo-claim-jeju')}`);
    fireEvent.click(within(row).getByRole('button', { name: '민지에게 지급 · 제주 항공권 금액 고치기' }));
    const input = within(row).getByRole('textbox', { name: '민지에게 지급 · 제주 항공권 금액' }) as HTMLInputElement;
    expect(input.value).toBe('300,000');
    // [취소]는 그대로 돌아가요
    fireEvent.click(within(row).getByRole('button', { name: '취소' }));
    expect(within(row).queryByRole('textbox')).toBeNull();

    fireEvent.click(within(row).getByRole('button', { name: '민지에게 지급 · 제주 항공권 금액 고치기' }));
    fireEvent.change(within(row).getByRole('textbox'), { target: { value: '250000' } });
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: '저장' }));
    });
    await screen.findByText('금액을 250,000원으로 고쳤어요');
    expect(live(h, claimLoanTransferId('demo-claim-jeju'))!.amount).toBe(250_000);
    expect(live(h, claimTransferId('demo-claim-jeju'))!.amount).toBe(300_000);
    expect(expense(h, 'demo-claim-jeju').amount).toBe(300_000);
    expect(L(h).settlement!.loan.balance).toBe(250_000);
    await waitFor(() => expect(within(row).queryByRole('textbox')).toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    });
    await waitFor(() => expect(L(h).settlement!.loan.balance).toBe(300_000));
  });

  it('빌려 지급한 기록 [취소] → 그 자리에서 "지급도 함께 취소할까요?": 빌린 기록만 취소 (옮긴 저수지 지출은 저수지에서 지급한 것으로)', async () => {
    const h = await renderScreen();
    const id = await addReservoirClaim(h, '나무 돌잔치');
    await act(async () => {
      await L(h).borrowReservoirClaims([id]);
    });
    const before = { ...L(h).balances };
    const loan = await screen.findByRole('region', { name: /^저수지 · 갚을 돈/ });
    expand(loan, '저수지 기록');
    const row = within(loan).getByTestId(`loan-row-${claimLoanTransferId(id)}`);
    fireEvent.click(within(row).getByRole('button', { name: '민지에게 지급 · 나무 돌잔치 취소' }));
    expect(row.textContent).toContain('지급도 함께 취소할까요?');
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: '빌린 기록만 취소' }));
    });
    await screen.findByText('빌린 기록만 취소했어요');
    expect(live(h, claimLoanTransferId(id))).toBeUndefined();
    expect(live(h, claimTransferId(id))!.fromAccountId).toBe('demo-acc-reservoir');
    expect(expense(h, id).accountId).toBe('demo-acc-reservoir');
    expect(isClaimSettled(L(h).data!, id)).toBe(true);
    expect(L(h).settlement!.loan.balance).toBe(0);
    expect(L(h).balances).toEqual(before);
    // 다시 해도 같아요
    const again = await act(() => L(h).cancelClaimLoans([id]));
    expect(again.transfers).toHaveLength(0);
  });

  it('빌려 지급한 기록 [취소] → 지급까지 취소', async () => {
    const h = await renderScreen();
    await act(async () => {
      await L(h).borrowAndSettleClaims(['demo-claim-jeju']);
    });
    const loan = await screen.findByRole('region', { name: '저수지 · 갚을 돈 30만' });
    expand(loan, '저수지 기록');
    const row = within(loan).getByTestId(`loan-row-${claimLoanTransferId('demo-claim-jeju')}`);
    fireEvent.click(within(row).getByRole('button', { name: '민지에게 지급 · 제주 항공권 취소' }));
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: '지급까지 취소' }));
    });
    await screen.findByText('지급과 빌린 기록을 함께 취소했어요');
    expect(live(h, claimLoanTransferId('demo-claim-jeju'))).toBeUndefined();
    expect(isClaimSettled(L(h).data!, 'demo-claim-jeju')).toBe(false);
  });

  it('지출을 바꾼 기록 [취소]는 지출을 저수지로, 갚은 기록 [취소]는 지워요', async () => {
    const h = await renderScreen();
    await act(async () => {
      await L(h).addExpense({ date: '2026-10-05', amount: 200_000, accountId: 'demo-acc-reservoir', categoryId: eventCat(h), memo: '돌잔치' });
    });
    const id = L(h).data!.expenses.find((e) => e.memo === '돌잔치')!.id;
    await act(async () => {
      await L(h).convertToLoan([id]);
      await L(h).repayLoan(50_000);
    });
    const loan = await screen.findByRole('region', { name: '저수지 · 갚을 돈 15만' });
    expand(loan, '저수지 기록');
    await act(async () => {
      fireEvent.click(within(loan).getByRole('button', { name: '저수지에 갚음 취소' }));
    });
    await screen.findByText('갚은 기록을 취소했어요');
    expect(live(h, loanRepayId(month))).toBeUndefined();
    expect(L(h).settlement!.loan.balance).toBe(200_000);

    await act(async () => {
      fireEvent.click(within(loan).getByRole('button', { name: '돌잔치 취소' }));
    });
    await screen.findByText('돌잔치를 저수지 지출로 되돌렸어요');
    expect(live(h, expenseLoanTransferId(id))).toBeUndefined();
    expect(expense(h, id).accountId).toBe('demo-acc-reservoir');
    // 다시 해도 같아요
    const again = await act(() => L(h).cancelLoanTransfer(expenseLoanTransferId(id)));
    expect(again.transfers).toHaveLength(0);
  });
});

describe('내역 → 이체의 정산 이체', () => {
  it('정산 이체는 고칠 곳을 알려 줘요 (claim: → #paid, loan: · loanpay: → #loan, 그 밖은 없음)', () => {
    expect(settleEditHref('claim:x')).toBe('/plan/settle#paid');
    expect(settleEditHref('loan:claim:x')).toBe('/plan/settle#loan');
    expect(settleEditHref('loan:x')).toBe('/plan/settle#loan');
    expect(settleEditHref('loanpay:2026-11')).toBe('/plan/settle#loan');
    expect(settleEditHref('t1')).toBeNull();
  });

  it('누르면 창 대신 그 줄 아래 "정산 화면에서 고칠 수 있어요 →" 링크', async () => {
    const h = makeHarness();
    render(<TransfersScreen />, { wrapper: h.Wrapper });
    await waitFor(() => expect(h.probe.ledger?.data).toBeTruthy());
    await act(async () => {
      await L(h).borrowAndSettleClaims(['demo-claim-jeju']);
    });
    const settleRow = await waitFor(() => {
      const found = screen.getAllByRole('button', { name: /민지에게 돌려줌 · 제주 항공권/ }).find((b) => !/저수지에서 빌림/.test(b.textContent ?? ''));
      expect(found).toBeTruthy();
      return found!;
    });
    fireEvent.click(settleRow);
    const link = screen.getByRole('link', { name: '정산 화면에서 고칠 수 있어요 →' });
    expect(link.getAttribute('href')).toBe('/plan/settle#paid');
    expect(screen.queryByRole('dialog')).toBeNull();

    const loanRow = screen.getAllByRole('button', { name: /저수지에서 빌림/ })[0]!;
    fireEvent.click(loanRow);
    expect(screen.getByRole('link', { name: '정산 화면에서 고칠 수 있어요 →' }).getAttribute('href')).toBe('/plan/settle#loan');
  });
});
