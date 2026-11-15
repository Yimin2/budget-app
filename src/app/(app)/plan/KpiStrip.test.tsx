// @vitest-environment jsdom
/** 이벤트 화면 맨 위 숫자 띠: 잔액 · 이번 달 나갈 돈 · 정산(+ 저수지 갚을 돈) · 가장 모자라는 달 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventMonthUsage, formatManShort, formatShortDate, formatWon, spentSoFarThisMonth } from '@/domain';
import { EventsView } from './EventsView';
import { aheadTotals } from './selectors';
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

async function renderStrip() {
  const h = makeHarness();
  render(<EventsView />, { wrapper: h.Wrapper });
  const strip = await screen.findByRole('region', { name: '이번 달 · 11월' });
  return { h, strip, L: () => h.probe.ledger! };
}

const eventCat = (L: ReturnType<typeof makeHarness>['probe']['ledger']) =>
  L!.data!.categories.find((c) => !c.deleted && c.defaultAccountRole === 'event')!.id;

describe('숫자 띠', () => {
  it('네 칸: 이벤트통장 잔액 · 이번 달 나갈 돈(12개월 카드 이번 달과 같은 셈) · 정산 · 가장 모자라는 달, 늘 펼쳐 있어요', async () => {
    const { strip, L } = await renderStrip();
    expect(strip.getAttribute('data-testid')).toBe('kpi-strip');
    // 접는 버튼이 없어요
    expect(within(strip).queryByRole('button', { name: /펼치기|접기/ })).toBeNull();
    // 시작 600,000 + 적립 300,000 − 제주 여행 숙소 예약금 150,000 (이번 달 적립은 이미 들어왔어요)
    expect(within(strip).getByTestId('kpi-balance').textContent).toBe('이벤트통장 잔액75만매달 30만 적립');

    const p = L().eventProjection!;
    const now = p.months[0]!;
    const t = aheadTotals(now);
    const spent = spentSoFarThisMonth(L().data!, p.accountId!, L().today);
    const spend = within(strip).getByTestId('kpi-spend');
    expect(spend.textContent).toContain(`이번 달 나갈 돈${formatManShort(spent + t.total)}`);
    expect(spend.textContent).toContain(`이미 ${formatManShort(spent)} · 앞으로 ${formatManShort(t.total)}`);
    expect(t.repay).toBe(300_000);
    expect(spend.textContent).toContain('(돌려주기 30만)');
    // 12개월 카드 이번 달 합계와 같아요
    fireEvent.click(within(screen.getByRole('group', { name: '달 고르기' })).getByRole('button', { name: '11월 (이번 달) 자세히 보기' }));
    expect(within(screen.getByTestId('ahead-total')).getByText(`이번 달 나갈 돈 ${formatManShort(spent + t.total)}`)).toBeTruthy();
    const usage = eventMonthUsage(L().data!, L().settlement!, L().today);
    const trip = usage.tripSpent + usage.tripPlanned;
    if (trip > 0) expect(within(spend).getByTestId('kpi-trip').textContent).toBe(`여행 ${formatManShort(trip)}`);
    else expect(within(spend).queryByTestId('kpi-trip')).toBeNull();

    const settle = within(strip).getByTestId('kpi-settle');
    expect(settle.id).toBe('settlement');
    expect(settle.textContent).toMatch(new RegExp(`^${formatShortDate(L().settlement!.date)} 정산30만`));
    expect(within(settle).getByRole('link', { name: '정산하기' }).getAttribute('href')).toBe('/plan/settle');
    // 항목 목록 · 지급 버튼은 정산 화면에만 있어요
    expect(within(strip).queryByRole('checkbox')).toBeNull();
    expect(within(strip).queryByRole('button', { name: /지급했어요/ })).toBeNull();

    const short = within(strip).getByRole('button', { name: /가장 모자라는 달/ });
    expect(short.textContent).toContain('2027년 4월 −30만');
    expect(short.textContent).toContain('300,000원 모자라요');
  });

  it('가장 모자라는 달을 누르면 12개월 카드에서 그 달을 고르고 그 카드로 스크롤해요', async () => {
    const { strip } = await renderStrip();
    const scroll = vi.fn();
    document.getElementById('ahead')!.scrollIntoView = scroll;
    const months = screen.getByRole('group', { name: '달 고르기' });
    fireEvent.click(within(months).getByRole('button', { name: '2027년 2월 자세히 보기' }));
    expect(within(months).getByRole('button', { name: '2027년 4월 자세히 보기' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(within(strip).getByRole('button', { name: /가장 모자라는 달/ }));
    expect(within(months).getByRole('button', { name: '2027년 4월 자세히 보기' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(screen.getByRole('region', { name: '앞으로 12개월' })).getByRole('heading', { level: 3, name: '2027년 4월' })).toBeTruthy();
    expect(scroll).toHaveBeenCalled();
  });

  it('모자라는 달이 없으면 "12개월 동안 모자라는 달 없어요" (누르는 칸 아님)', async () => {
    const { strip, L } = await renderStrip();
    await act(async () => {
      await L().applyFromReservoir(L().shortageFix!.fromReservoir!);
    });
    await waitFor(() => expect(within(strip).getByTestId('kpi-short').textContent).toBe('가장 모자라는 달12개월 동안 모자라는 달 없어요'));
    expect(within(strip).queryByRole('button', { name: /가장 모자라는 달/ })).toBeNull();
  });

  it('정산 칸: 이벤트통장 밖에서 나가는 돈은 작은 줄로 · 저수지 돈으로 낸 이벤트 청구는 따로', async () => {
    const { strip, L } = await renderStrip();
    const settle = within(strip).getByTestId('kpi-settle');
    expect(within(settle).queryByTestId('settlement-note')).toBeNull();
    expect(within(settle).queryByTestId('settlement-carry')).toBeNull();
    await act(async () => {
      await L().addExpense({ date: '2026-10-02', amount: 24_000, accountId: 'demo-acc-reservoir', categoryId: eventCat(L()), memo: '꽃', paidBy: '준호' });
    });
    await waitFor(() => expect(within(settle).getByTestId('settlement-note').textContent).toBe('저수지에서 빌려 2.4만'));
    expect(settle.textContent).toMatch(/정산32\.4만/);
    expect(strip.textContent).not.toMatch(/저수지에 (쓸|줄) 돈|저수지에서 돌려받을|빌려 줄 돈/);
  });

  it('지금 줄 돈이 없으면 "정산할 돈 없어요"와 다음 정산, [정산하기]는 그대로', async () => {
    const { strip, L } = await renderStrip();
    await act(async () => {
      await L().settleClaims(['demo-claim-jeju']);
    });
    const upcoming = L().settlement!.upcoming[0]!;
    const settle = within(strip).getByTestId('kpi-settle');
    await waitFor(() => expect(settle.textContent).toContain('정산할 돈 없어요'));
    expect(within(settle).getByTestId('settlement-note').textContent).toBe(`다음 정산 ${formatShortDate(upcoming.due)} 2.4만`);
    expect(within(settle).getByRole('link', { name: '정산하기' }).getAttribute('href')).toBe('/plan/settle');
    const rest = L().settlement!.upcoming.flatMap((g) => g.claims.map((c) => c.expense.id));
    await act(async () => {
      await L().settleClaims(rest);
    });
    await waitFor(() => expect(within(settle).queryByTestId('settlement-note')).toBeNull());
    expect(settle.textContent).toContain('정산할 돈 없어요');
  });

  it("이벤트통장이 음수면 정산 칸에 '이벤트통장이 ○원 모자라요'", async () => {
    const { strip, L } = await renderStrip();
    expect(within(strip).queryByTestId('settlement-short')).toBeNull();
    await act(async () => {
      await L().addExpense({ date: '2026-11-03', amount: 5_000_000, accountId: 'demo-acc-event', categoryId: eventCat(L()), memo: '큰 지출' });
    });
    await waitFor(() => expect(L().settlement!.shortfall).toBeGreaterThan(0));
    const won = L().settlement!.shortfall.toLocaleString('ko-KR');
    await waitFor(() =>
      expect(within(within(strip).getByTestId('kpi-settle')).getByTestId('settlement-short').textContent).toBe(`이벤트통장이 ${won}원 모자라요`),
    );
  });
});

describe('숫자 띠 정산 칸 — 저수지 갚을 돈 한 줄', () => {
  it('빌린 돈이 생기면 정산 칸에 "저수지 갚을 돈 · 매달 ○" + 그 자리 [갚았어요] · 정산 화면 기록 링크', async () => {
    const { strip: card, L } = await renderStrip();
    expect(within(card).queryByRole('group', { name: '저수지 갚을 돈' })).toBeNull();
    await act(async () => {
      await L().borrowAndSettleClaims(['demo-claim-jeju']);
    });
    const loan = await within(within(card).getByTestId('kpi-settle')).findByRole('group', { name: '저수지 갚을 돈' });
    const s = L().settlement!;
    expect(s.loan.balance).toBe(300_000);
    // 갚는 개월 수는 추천 타협안과 같은 값 (기본 24개월): 30만 ÷ 24 = 1.25만 → 천 원 올림 1.3만, 24번째 달에 끝 (끝나는 달은 화면 읽기용)
    expect(within(loan).getByTestId('loan-line').textContent).toBe('저수지 갚을 돈 30만 · 매달 1.3만 · 2028년 11월에 끝');
    expect(loan.querySelector('details')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    if (s.repay) {
      expect(within(loan).getByRole('button', { name: `저수지에 ${formatWon(s.repay.amount)} 갚았어요` }).textContent).toBe(
        `${formatManShort(s.repay.amount)} 갚았어요`,
      );
    }
    expect(within(loan).getByRole('link', { name: /빌리고 갚은 기록 1건/ }).getAttribute('href')).toBe('/plan/settle#loan');
    expect(loan.textContent).not.toContain('민지에게 지급 · 제주 항공권');
  });

  it('[갚았어요]로 남긴 이번 달 갚은 기록은 "이번 달 10만 갚았어요 · [되돌리기]"', async () => {
    const { strip: card, L } = await renderStrip();
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
    const { strip: card, L } = await renderStrip();
    await act(async () => {
      await L().borrowAndSettleClaims(['demo-claim-jeju']);
    });
    const loan = await within(card).findByRole('group', { name: '저수지 갚을 돈' });
    expect(within(loan).getByTestId('loan-line').textContent).toBe('저수지 갚을 돈 30만 · 매달 2.5만 · 2027년 11월에 끝');
  });

  it('저수지에서 이미 지급한 이벤트 청구는 버튼 하나로 갚을 돈으로 바꿔요 (잔액 그대로)', async () => {
    const { strip: card, L } = await renderStrip();
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
    expect(within(loan).getByRole('button', { name }).textContent).toBe('이미 지급한 청구 2건 갚을 돈으로');
    await act(async () => {
      fireEvent.click(within(loan).getByRole('button', { name }));
    });
    await screen.findByText('2건 100,000원을 저수지에 갚을 돈으로 바꿨어요');
    expect(L().settlement!.loan.balance).toBe(100_000);
    expect(L().balances).toEqual(before);
    expect(within(loan).queryByRole('button', { name })).toBeNull();
  });
});
