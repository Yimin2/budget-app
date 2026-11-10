// @vitest-environment jsdom
/** 이벤트 화면 카드 1 '이번 달': 칸 셋 · 정산 한 줄 · 저수지 갚을 돈 한 줄 · [정산하기] */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventMonthUsage, formatMan, formatManShort, formatShortDate, formatWon } from '@/domain';
import { EventsView } from './EventsView';
import { makeHarness } from './testHarness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/plan',
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const CARD = '이번 달 · 11월';

async function renderCard() {
  const h = makeHarness();
  render(<EventsView />, { wrapper: h.Wrapper });
  const card = await screen.findByRole('region', { name: CARD });
  return { h, card, L: () => h.probe.ledger! };
}

const eventCat = (L: ReturnType<typeof makeHarness>['probe']['ledger']) =>
  L!.data!.categories.find((c) => !c.deleted && c.defaultAccountRole === 'event')!.id;

describe('이번 달 카드', () => {
  it('칸 셋: 이벤트통장 잔액 · 쓴 돈 + 예정(여행 뺌) · 여행 (따로), [정산하기] → /plan/settle, #settlement 로 들어와요', async () => {
    const { card, L } = await renderCard();
    expect(card.id).toBe('settlement');
    const usage = eventMonthUsage(L().data!, L().settlement!, L().today);
    // 시작 600,000 + 적립 300,000 − 제주 여행 숙소 예약금 150,000
    const balance = within(card).getByTestId('kpi-balance');
    expect(balance.textContent).toBe('이벤트통장 잔액75만매달 30만 적립');
    expect(within(card).getByTestId('kpi-usage').textContent).toBe(
      `쓴 돈 + 예정${formatManShort(usage.spent)} + ${formatManShort(usage.planned)}여행 빼고`,
    );
    const trip = usage.tripSpent + usage.tripPlanned;
    expect(trip).toBeGreaterThan(0);
    expect(within(card).getByTestId('kpi-trip').textContent).toContain(`여행 (따로)${formatManShort(trip)}`);
    const settle = within(card).getByRole('link', { name: '정산하기' });
    expect(settle.getAttribute('href')).toBe('/plan/settle');
    // 항목 목록 · 지급 버튼은 정산 화면에만 있어요
    expect(within(card).queryByRole('checkbox')).toBeNull();
    expect(within(card).queryByRole('button', { name: /지급했어요/ })).toBeNull();
    expect(L().eventProjection!.months[0]!.claims).toBe(300_000);
  });

  it('정산 한 줄: 정산일에 줄 돈 · 저수지 돈으로 낸 이벤트 청구는 따로', async () => {
    const { card, L } = await renderCard();
    const date = formatShortDate(L().settlement!.date);
    const line = within(card).getByRole('group', { name: '이번 달 정산' });
    expect(within(line).getByTestId('settlement-line').textContent).toBe(`${date} 정산 30만`);
    expect(within(line).queryByTestId('settlement-carry')).toBeNull();
    await act(async () => {
      await L().addExpense({ date: '2026-10-02', amount: 24_000, accountId: 'demo-acc-reservoir', categoryId: eventCat(L()), memo: '꽃', paidBy: '준호' });
    });
    await waitFor(() => expect(within(card).getByTestId('settlement-line').textContent).toBe(`${date} 정산 30만 · 저수지에서 빌려 2.4만`));
    expect(card.textContent).not.toMatch(/저수지에 (쓸|줄) 돈|저수지에서 돌려받을|빌려 줄 돈/);
  });

  it('지금 줄 돈이 없으면 "이번 달 정산할 돈은 없어요"와 다음 정산, 청구가 없으면 정산 줄을 숨겨요', async () => {
    const { card, L } = await renderCard();
    await act(async () => {
      await L().settleClaims(['demo-claim-jeju']);
    });
    const upcoming = L().settlement!.upcoming[0]!;
    await waitFor(() =>
      expect(within(card).getByTestId('settlement-line').textContent).toBe(
        `이번 달 정산할 돈은 없어요 · 다음 정산 ${formatShortDate(upcoming.due)} 2.4만`,
      ),
    );
    expect(within(card).getByRole('link', { name: '정산하기' }).getAttribute('href')).toBe('/plan/settle');
    const rest = L().settlement!.upcoming.flatMap((g) => g.claims.map((c) => c.expense.id));
    await act(async () => {
      await L().settleClaims(rest);
    });
    await waitFor(() => expect(within(card).queryByRole('group', { name: '이번 달 정산' })).toBeNull());
    expect(screen.getByRole('region', { name: CARD })).toBe(card);
  });

  it("이벤트통장이 음수면 '이벤트통장이 ○원 모자라요'", async () => {
    const { card, L } = await renderCard();
    expect(within(card).queryByTestId('settlement-short')).toBeNull();
    await act(async () => {
      await L().addExpense({ date: '2026-11-03', amount: 5_000_000, accountId: 'demo-acc-event', categoryId: eventCat(L()), memo: '큰 지출' });
    });
    await waitFor(() => expect(L().settlement!.shortfall).toBeGreaterThan(0));
    const won = L().settlement!.shortfall.toLocaleString('ko-KR');
    await waitFor(() => expect(within(card).getByTestId('settlement-short').textContent).toBe(`이벤트통장이 ${won}원 모자라요`));
  });

  it('폰에서는 칸 셋만, [펼치기]로 정산 · 저수지 줄 (넓은 화면은 CSS 로 늘 펼침)', async () => {
    const { card } = await renderCard();
    const toggle = within(card).getByRole('button', { name: '이번 달 정산 · 저수지 펼치기' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const body = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(within(body).getByTestId('settlement-line')).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(within(card).getByRole('button', { name: '이번 달 정산 · 저수지 접기' })).toBe(toggle);
  });
});

describe('이번 달 카드 — 저수지 갚을 돈 한 줄', () => {
  it('빌린 돈이 생기면 "저수지 갚을 돈 · 매달 ○씩 · ○월에 끝", 그 아래 늘 펼친 요약 · 갚기 · 정산 화면 링크', async () => {
    const { card, L } = await renderCard();
    expect(within(card).queryByRole('group', { name: '저수지 갚을 돈' })).toBeNull();
    await act(async () => {
      await L().borrowAndSettleClaims(['demo-claim-jeju']);
    });
    const loan = await within(card).findByRole('group', { name: '저수지 갚을 돈' });
    const s = L().settlement!;
    expect(s.loan.balance).toBe(300_000);
    // 갚는 개월 수는 추천 타협안과 같은 값 (기본 24개월): 30만 ÷ 24 = 1.25만 → 천 원 올림 1.3만, 24번째 달에 끝
    expect(within(loan).getByTestId('loan-line').textContent).toBe('저수지 갚을 돈 30만 · 매달 1.3만씩 · 2028년 11월에 끝');
    // [자세히] 없이 늘 펼쳐져 있어요 (창 · <details> 없음)
    expect(loan.querySelector('details')).toBeNull();
    expect(within(loan).queryByRole('button', { name: '저수지 갚을 돈 자세히' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(loan).getByTestId('loan-summary').textContent).toBe('빌린 돈 30만 · 갚은 돈 0원 · 남은 갚을 돈 30만');
    if (s.repay) {
      expect(loan.textContent).toContain(`이번 달 ${formatMan(s.repay.amount)} 갚기`);
      expect(within(loan).getByRole('button', { name: `저수지에 ${formatWon(s.repay.amount)} 갚았어요` })).toBeTruthy();
    }
    expect(within(loan).getByRole('link', { name: /빌리고 갚은 기록 1건/ }).getAttribute('href')).toBe('/plan/settle#loan');
    expect(loan.textContent).not.toContain('민지에게 지급 · 제주 항공권');
    // 정산 줄에는 갚을 돈이 없어요
    const settle = within(card).queryByRole('group', { name: '이번 달 정산' });
    if (settle) expect(settle.textContent).not.toContain('갚을 돈');
  });

  it('[갚았어요]로 남긴 이번 달 갚은 기록은 "이번 달 10만 갚았어요 · [되돌리기]"', async () => {
    const { card, L } = await renderCard();
    await act(async () => {
      await L().borrowAndSettleClaims(['demo-claim-jeju']);
      await L().repayLoan(100_000);
    });
    const loan = await within(card).findByRole('group', { name: '저수지 갚을 돈' });
    expect(within(loan).getByTestId('loan-line').textContent).toMatch(/^저수지 갚을 돈 20만/);
    expect(loan.textContent).toContain('이번 달 10만 갚았어요');
    expect(within(loan).queryByRole('button', { name: /갚았어요$/ })).toBeNull();
    await act(async () => {
      fireEvent.click(within(loan).getByRole('button', { name: '이번 달 100,000원 갚은 기록 되돌리기' }));
    });
    await screen.findByText('갚은 기록을 되돌렸어요');
    expect(L().settlement!.loan.balance).toBe(300_000);
  });

  it('추천 타협안에서 고른 갚는 개월 수를 따라 매달 금액 · 끝나는 달이 바뀌어요', async () => {
    window.localStorage.setItem('budget:repayMonths', '12');
    const { card, L } = await renderCard();
    await act(async () => {
      await L().borrowAndSettleClaims(['demo-claim-jeju']);
    });
    const loan = await within(card).findByRole('group', { name: '저수지 갚을 돈' });
    expect(within(loan).getByTestId('loan-line').textContent).toBe('저수지 갚을 돈 30만 · 매달 2.5만씩 · 2027년 11월에 끝');
  });

  it('저수지에서 이미 지급한 이벤트 청구는 버튼 하나로 갚을 돈으로 바꿔요 (잔액 그대로)', async () => {
    const { card, L } = await renderCard();
    const cat = eventCat(L());
    await act(async () => {
      await L().addExpense({ date: '2026-09-02', amount: 70_000, accountId: 'demo-acc-reservoir', categoryId: cat, memo: '숲 집들이', paidBy: '준호' });
      await L().addExpense({ date: '2026-09-09', amount: 30_000, accountId: 'demo-acc-reservoir', categoryId: cat, memo: '별 생일', paidBy: '준호' });
    });
    const ids = L().data!.expenses.filter((e) => e.memo === '숲 집들이' || e.memo === '별 생일').map((e) => e.id);
    await act(async () => {
      await L().settleClaims(ids);
    });
    const before = { ...L().balances };
    const loan = await within(card).findByRole('group', { name: '저수지 갚을 돈' });
    const name = '저수지에서 이미 지급한 이벤트 청구 2건 100,000원을 갚을 돈으로 바꾸기';
    await act(async () => {
      fireEvent.click(within(loan).getByRole('button', { name }));
    });
    await screen.findByText('2건 100,000원을 저수지에 갚을 돈으로 바꿨어요');
    expect(L().settlement!.loan.balance).toBe(100_000);
    expect(L().balances).toEqual(before);
    expect(within(loan).queryByRole('button', { name })).toBeNull();
  });
});
