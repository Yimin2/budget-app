// @vitest-environment jsdom
/**
 * 정산 화면 '/plan/settle': [‹ 이벤트] · 달별 한 목록 · [줄 돈만 · 전체 기록] · [전체 · 사람] · 달 모두 고르기(일부 = indeterminate) ·
 * 전체 선택 / 선택 해제 · 오른쪽 요약(줄 수 있는 돈 · 사람별) · 아래 막대의 [○ 지급] · [저수지에서 빌려 지급]
 */
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

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

type H = ReturnType<typeof makeHarness>;
const L = (h: H) => h.probe.ledger!;
const eventCat = (h: H) => L(h).data!.categories.find((c) => !c.deleted && c.defaultAccountRole === 'event')!.id;

async function renderScreen() {
  const h = makeHarness();
  render(<SettleScreen />, { wrapper: h.Wrapper });
  const months = await screen.findByRole('list', { name: '달별 기록' });
  const list = months.closest('section')!;
  const bar = screen.getByRole('region', { name: '고른 항목' });
  return { h, list, bar };
}

const box = (scope: HTMLElement, name: string | RegExp) => within(scope).getByRole('checkbox', { name }) as HTMLInputElement;
const chip = (name: string) => screen.getByRole('button', { name, pressed: false });
const payBtn = (bar: HTMLElement) => within(bar).getByTestId('settle-pay') as HTMLButtonElement;

describe('정산 화면', () => {
  it("'/plan/settle' 페이지: 제목 '정산 · 정산일'과 그 위 [‹ 이벤트] (→ /plan)", async () => {
    const h = makeHarness();
    render(<SettlePage />, { wrapper: h.Wrapper });
    expect(metadata.title).toBe('정산');
    await screen.findByRole('list', { name: '달별 기록' });
    const date = L(h).settlement!.date;
    const [, m, d] = date.split('-').map(Number);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`정산 · ${m}/${d}`);
    const back = screen.getByRole('link', { name: '이벤트' });
    expect(back.getAttribute('href')).toBe('/plan');
    // 머리에서 [‹ 이벤트]가 제목보다 먼저 와요
    expect(back.compareDocumentPosition(screen.getByRole('heading', { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('처음엔 줄 돈만: 달 머리(합계 · 줄 돈)와 줄 돈 줄, 오래된 순으로 나눠 둔 것만 골라 두고 오른쪽에 줄 수 있는 돈 · 사람별', async () => {
    const { list, bar } = await renderScreen();
    expect(screen.getByRole('button', { name: '줄 돈만', pressed: true })).toBeTruthy();
    const nov = within(list).getByRole('list', { name: '11월 기록' });
    expect(nov.closest('li')!.querySelector('h3')!.textContent).toMatch(/^11월 · 합계 .+ · 줄 돈 32\.4만$/);
    const rows = within(nov).getAllByRole('listitem');
    expect(rows.every((r) => r.textContent!.includes('줄 돈'))).toBe(true);
    expect(within(nov).getByRole('button', { name: '제주 항공권 자세히 보기' })).toBeTruthy();
    expect(box(nov, '제주 항공권 300,000원 고르기').checked).toBe(true);
    const jeju = box(nov, '제주 항공권 300,000원 고르기').closest('li')!;
    expect(jeju.textContent).toContain('민지가 냄');
    const mart = box(nov, /마트 장보기/).closest('li')!;
    expect((within(mart).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(mart.textContent).toMatch(/준호가 냄 · 정산일 \d+\/\d+/);
    expect(screen.queryByText('그냥 지출')).toBeNull();

    const payable = screen.getByRole('region', { name: /^줄 수 있는 돈/ });
    expect(payable.textContent).toContain('75만');
    expect(payable.textContent).toContain('고른 것 1건30만');
    expect(payable.textContent).toContain('남는 돈45만');
    expect(payable.textContent).toContain('이번 달 일정 몫 (빼 둠)');
    expect(screen.getByTestId('settle-explain').textContent).toMatch(/줄 수 있는 돈은 75만이에요\.$/);
    const people = screen.getByRole('list', { name: '사람별 줄 돈' });
    expect(within(people).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['민지30만', '준호2.4만']);
    // 폰에서 접힌 한 줄
    expect(screen.getByRole('button', { name: /^줄 수 있는 돈 75만 · 고른 30만/ }).getAttribute('aria-expanded')).toBe('false');

    expect(within(bar).getByTestId('settle-picked').textContent).toBe('1건 · 30만');
    expect(bar.textContent).toContain('민지 30만');
    expect(payBtn(bar).textContent).toBe('30만 지급');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('전체 기록: 지급함 · 그냥 지출 줄도 흐리게 (체크박스 없음), 줄 돈이 없는 달은 "다 정리됨"으로 접힌 채 [펼치기]', async () => {
    const { h, list } = await renderScreen();
    await act(async () => {
      await L(h).settleClaims(['demo-claim-jeju']);
      await L(h).addExpense({ date: '2026-09-03', amount: 40_000, accountId: 'demo-acc-event', categoryId: eventCat(h), memo: '9월 축의금' });
    });
    fireEvent.click(chip('전체 기록'));
    expect(screen.getByRole('button', { name: '전체 기록', pressed: true })).toBeTruthy();
    const nov = within(list).getByRole('list', { name: '11월 기록' });
    const jeju = within(nov).getByRole('button', { name: '제주 항공권 자세히 보기' }).closest('li')!;
    expect(within(jeju).queryByRole('checkbox')).toBeNull();
    expect(jeju.textContent).toContain('지급함');
    expect(jeju.textContent).toMatch(/민지 · \d+\/\d+ 지급/);
    expect(within(nov).getAllByText('그냥 지출').length).toBeGreaterThan(0);

    const sepHead = within(list).getByRole('heading', { name: /^9월/ });
    expect(sepHead.textContent).toMatch(/다 정리됨$/);
    expect(within(list).queryByRole('list', { name: '9월 기록' })).toBeNull();
    fireEvent.click(within(list).getByRole('button', { name: '9월 펼치기' }));
    expect(within(within(list).getByRole('list', { name: '9월 기록' })).getByText('9월 축의금')).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: '9월 접기' }));
    expect(within(list).queryByRole('list', { name: '9월 기록' })).toBeNull();

    // 줄 돈만으로 돌아가면 줄 돈이 없는 달은 숨겨요
    fireEvent.click(chip('줄 돈만'));
    expect(within(list).queryByRole('heading', { name: /^9월/ })).toBeNull();
  });

  it('사람 필터: 그 사람이 쓴 줄만, 달 합계도 그 사람 몫으로', async () => {
    const { list } = await renderScreen();
    fireEvent.click(chip('준호'));
    expect(screen.getByRole('button', { name: '준호', pressed: true })).toBeTruthy();
    const nov = within(list).getByRole('list', { name: '11월 기록' });
    expect(within(nov).queryByRole('button', { name: '제주 항공권 자세히 보기' })).toBeNull();
    expect(within(nov).getByRole('button', { name: '마트 장보기 자세히 보기' })).toBeTruthy();
    expect(nov.closest('li')!.querySelector('h3')!.textContent).toMatch(/줄 돈 2\.4만$/);
    fireEvent.click(chip('전체'));
    expect(within(list).getByRole('button', { name: '제주 항공권 자세히 보기' })).toBeTruthy();
  });

  it('전체 선택 · 선택 해제 · 사람마다 고르기 · 달 모두 고르기 (일부만 = indeterminate)', async () => {
    const { h, list, bar } = await renderScreen();
    await act(async () => {
      await L(h).addExpense({ date: '2026-11-05', amount: 50_000, accountId: 'demo-acc-event', categoryId: eventCat(h), memo: '하늘 돌잔치', paidBy: '민지' });
    });
    const monthAll = await waitFor(() => box(list, '11월 모두 고르기'));
    await waitFor(() => expect(box(list, '하늘 돌잔치 50,000원 고르기').checked).toBe(true));
    expect(monthAll.checked).toBe(false);
    expect(monthAll.indeterminate).toBe(true);

    fireEvent.click(monthAll);
    expect(monthAll.checked).toBe(true);
    expect(monthAll.indeterminate).toBe(false);
    expect(within(bar).getByTestId('settle-picked').textContent).toBe('3건 · 37.4만');
    fireEvent.click(monthAll);
    expect(monthAll.checked).toBe(false);
    expect(within(bar).getByTestId('settle-picked').textContent).toBe('0건 · 0원');
    expect(payBtn(bar).disabled).toBe(true);

    fireEvent.click(within(list).getByRole('button', { name: '전체 선택' }));
    expect((within(list).getAllByRole('checkbox') as HTMLInputElement[]).every((c) => c.checked)).toBe(true);
    fireEvent.click(within(list).getByRole('button', { name: '선택 해제' }));
    expect((within(list).getAllByRole('checkbox') as HTMLInputElement[]).every((c) => !c.checked && !c.indeterminate)).toBe(true);

    // 사람마다: 민지만 보고 모두 고르기 → 민지 것만
    fireEvent.click(chip('민지'));
    fireEvent.click(within(list).getByRole('button', { name: '이 사람 모두 고르기' }));
    expect(within(bar).getByTestId('settle-picked').textContent).toBe('2건 · 35만');
    expect(bar.textContent).toContain('민지 35만');
    fireEvent.click(chip('전체'));
    expect(box(list, /마트 장보기/).checked).toBe(false);

    // 하나 빼면 달 체크박스가 indeterminate
    fireEvent.click(box(list, '제주 항공권 300,000원 고르기'));
    expect(box(list, '11월 모두 고르기').indeterminate).toBe(true);
    expect(within(bar).getByTestId('settle-picked').textContent).toBe('1건 · 5만');
  });

  it('[○ 지급]: 고른 것만 claim:<id> 이체로 지급하고, 되돌리기로 지워요', async () => {
    const { h, bar } = await renderScreen();
    await act(async () => {
      fireEvent.click(payBtn(bar));
    });
    await screen.findByText('고른 1건 300,000원을 지급했다고 기록했어요');
    expect(screen.queryByRole('button', { name: '이벤트로' })).toBeNull();
    expect(L(h).data!.transfers.filter((t) => t.id === claimTransferId('demo-claim-jeju') && !t.deleted)).toHaveLength(1);
    expect(L(h).settlement!.pay).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    });
    await waitFor(() => expect(L(h).settlement!.pay.map((g) => g.amount)).toEqual([300_000]));
  });

  it('줄 수 있는 돈보다 많이 고르면 넘는 돈을 빨갛게 보이고, [저수지에서 빌려 지급]은 넘는 것만 빌려요', async () => {
    const { h, list, bar } = await renderScreen();
    expect((within(bar).getByRole('button', { name: '저수지에서 빌려 지급' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      await L(h).addExpense({ date: '2026-11-04', amount: 900_000, accountId: 'demo-acc-event', categoryId: eventCat(h), memo: '바다 결혼 선물', paidBy: '민지' });
    });
    const big = await waitFor(() => box(list, '바다 결혼 선물 900,000원 고르기'));
    expect(big.checked).toBe(false);
    fireEvent.click(big);
    expect(bar.textContent).toContain('이벤트통장에서 줄 수 있는 돈은 75만이에요 · 나머지 90만은 저수지에서 빌려 줄 수 있어요');
    const payable = screen.getByRole('region', { name: /^줄 수 있는 돈/ });
    expect(payable.textContent).toContain('넘는 돈90만');
    expect(payable.textContent).not.toContain('남는 돈');
    // [○ 지급]은 안에 드는 것만 (막히지 않음), 넘는 것은 [저수지에서 빌려 지급]으로만
    expect(payBtn(bar).disabled).toBe(false);
    expect(payBtn(bar).textContent).toBe('30만 지급');
    await act(async () => {
      fireEvent.click(within(bar).getByRole('button', { name: '저수지에서 빌려 지급' }));
    });
    await screen.findByText('고른 2건을 지급하고 넘는 900,000원은 저수지에서 빌렸다고 기록했어요');
    const id = L(h).data!.expenses.find((e) => e.memo === '바다 결혼 선물')!.id;
    expect(L(h).data!.transfers.some((t) => t.id === claimLoanTransferId(id) && !t.deleted)).toBe(true);
    expect(L(h).data!.transfers.some((t) => t.id === claimLoanTransferId('demo-claim-jeju') && !t.deleted)).toBe(false);
    expect(L(h).settlement!.loan.balance).toBe(900_000);
  });

  it('이벤트통장이 음수면 맨 위에 모자란 돈, 줄 수 있는 돈이 0 이면 [○ 지급]은 이유와 함께 막히고 빌려 지급만 돼요', async () => {
    const { h, list, bar } = await renderScreen();
    await act(async () => {
      await L(h).addExpense({ date: '2026-11-03', amount: 5_000_000, accountId: 'demo-acc-event', categoryId: eventCat(h), memo: '큰 지출' });
    });
    await waitFor(() => expect(L(h).settlement!.shortfall).toBeGreaterThan(0));
    const s = L(h).settlement!;
    expect(s.payable).toBe(0);
    expect(await screen.findByText(`이벤트통장이 ${s.shortfall.toLocaleString('ko-KR')}원 모자라요`)).toBeTruthy();
    expect(screen.getByTestId('settle-explain').textContent).toMatch(/^지갑\(이벤트통장\)이 .+만 모자라.*줄 수 있는 돈은 0원이에요\.$/);

    const jeju = box(list, '제주 항공권 300,000원 고르기');
    if (!jeju.checked) fireEvent.click(jeju);
    expect(bar.textContent).toContain('이벤트통장에서 줄 수 있는 돈이 없어요 · 나머지 30만은 저수지에서 빌려 줄 수 있어요');
    expect(payBtn(bar).disabled).toBe(true);
    expect(bar.textContent).toContain('이벤트통장에서 줄 수 있는 돈이 없어서 지급할 수 없어요');
    await act(async () => {
      fireEvent.click(within(bar).getByRole('button', { name: '저수지에서 빌려 지급' }));
    });
    await screen.findByText('고른 1건을 지급하고 넘는 300,000원은 저수지에서 빌렸다고 기록했어요');
    expect(L(h).data!.transfers.some((t) => t.id === claimLoanTransferId('demo-claim-jeju') && !t.deleted)).toBe(true);
  });

  it("지난달에 못 준 청구는 '지난달부터'와 함께 먼저 골라 두고, 사람별에 '(못 준 돈 · 10월)'", async () => {
    const { h, list } = await renderScreen();
    await act(async () => {
      const e = await L(h).addExpense({ date: '2026-10-02', amount: 70_000, accountId: 'demo-acc-event', categoryId: eventCat(h), memo: '지난 돌잔치', paidBy: '민지' });
      await L(h).updateExpense({ ...e, claimDue: '2026-10-21' });
    });
    const old = await waitFor(() => box(list, '지난 돌잔치 70,000원 고르기'));
    expect(old.checked).toBe(true);
    expect(old.closest('li')!.textContent).toContain('지난달부터');
    expect(within(list).getByRole('heading', { name: /^10월/ }).textContent).toMatch(/줄 돈 7만$/);
    expect(box(list, '제주 항공권 300,000원 고르기').closest('li')!.textContent).not.toContain('지난달부터');
    expect(screen.getByTestId('settle-explain').textContent).toContain('지난달에 못 준 돈 7만을 먼저 돌려줘요.');
    const people = screen.getByRole('list', { name: '사람별 줄 돈' });
    expect(within(people).getAllByRole('listitem')[0]!.textContent).toBe('민지37만 (못 준 돈 7만 · 10월)');
  });

  it('저수지 돈으로 낸 이벤트 청구는 "저수지에서 빌려 지급" 메모와 함께 줄 돈, 지급하면 "저수지에서 빌려 줌"이 돼요', async () => {
    const { h, list, bar } = await renderScreen();
    const before = { ...L(h).balances };
    await act(async () => {
      await L(h).addExpense({ date: '2026-10-02', amount: 120_000, accountId: 'demo-acc-reservoir', categoryId: eventCat(h), memo: '나무 돌잔치', paidBy: '민지' });
    });
    const tree = await waitFor(() => box(list, '나무 돌잔치 120,000원 고르기'));
    await waitFor(() => expect(tree.checked).toBe(true));
    expect(tree.closest('li')!.textContent).toContain('저수지에서 빌려 지급');
    expect(bar.textContent).toContain('저수지에서 빌려 지급 1건 120,000원 포함');

    fireEvent.click(box(list, '제주 항공권 300,000원 고르기'));
    await act(async () => {
      fireEvent.click(payBtn(bar));
    });
    await screen.findByText(/고른 1건 120,000원을 지급했다고 기록했어요/);
    const id = L(h).data!.expenses.find((e) => e.memo === '나무 돌잔치')!.id;
    expect(L(h).data!.expenses.find((e) => e.id === id)!.accountId).toBe('demo-acc-event');
    expect(L(h).settlement!.loan.balance).toBe(120_000);
    expect(L(h).balances['demo-acc-reservoir']).toBe(before['demo-acc-reservoir']! - 120_000);
    fireEvent.click(chip('전체 기록'));
    fireEvent.click(within(list).getByRole('button', { name: '10월 펼치기' }));
    const row = within(list).getByRole('button', { name: '나무 돌잔치 자세히 보기' }).closest('li')!;
    expect(row.textContent).toContain('저수지에서 빌려 줌');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    });
    await waitFor(() => expect(L(h).settlement!.loan.balance).toBe(0));
    expect(L(h).data!.expenses.find((e) => e.id === id)!.accountId).toBe('demo-acc-reservoir');
  });

  it('이름을 누르면 지출 창(자세히 · 고치기)', async () => {
    const { list } = await renderScreen();
    fireEvent.click(within(list).getByRole('button', { name: '제주 항공권 자세히 보기' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('#paid 로 들어오면 전체 기록, 같은 화면에서 #paid 로 바뀌어도 전체 기록으로', async () => {
    window.location.hash = '#paid';
    await renderScreen();
    expect(screen.getByRole('button', { name: '전체 기록', pressed: true })).toBeTruthy();
    cleanup();
    window.location.hash = '';
    await renderScreen();
    expect(screen.getByRole('button', { name: '줄 돈만', pressed: true })).toBeTruthy();
    await act(async () => {
      window.location.hash = '#paid';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByRole('button', { name: '전체 기록', pressed: true })).toBeTruthy();
  });
});

describe('정산 화면 — 오래된 것 먼저 · 여행 배지 · 좁은 막대', () => {
  afterEach(() => vi.restoreAllMocks());

  const monthHeads = (list: HTMLElement) => within(within(list).getByRole('list', { name: '달별 기록' })).getAllByRole('heading', { level: 3 }).map((h) => h.textContent!.split(' · ')[0]);

  it('줄 돈만 · 전체 기록 모두 오래된 달이 위, 달 안에서도 오래된 날 → 기록한 순서', async () => {
    const { h, list } = await renderScreen();
    await act(async () => {
      await L(h).addExpense({ date: '2026-10-02', amount: 70_000, accountId: 'demo-acc-event', categoryId: eventCat(h), memo: '지난 돌잔치', paidBy: '민지' });
      await L(h).addExpense({ date: '2026-11-03', amount: 10_000, accountId: 'demo-acc-event', categoryId: eventCat(h), memo: '먼저 넣은 선물', paidBy: '민지' });
      // 기록한 시각(createdAt)이 같은 밀리초가 되지 않게 조금 기다려요
      await new Promise((r) => setTimeout(r, 5));
      await L(h).addExpense({ date: '2026-11-03', amount: 20_000, accountId: 'demo-acc-event', categoryId: eventCat(h), memo: '나중 넣은 선물', paidBy: '준호' });
    });
    await waitFor(() => box(list, '지난 돌잔치 70,000원 고르기'));
    expect(monthHeads(list)).toEqual(['10월', '11월']);
    const names = (scope: HTMLElement) => within(scope).getAllByRole('button', { name: / 자세히 보기$/ }).map((b) => b.textContent);
    const nov = within(list).getByRole('list', { name: '11월 기록' });
    const dates = L(h).data!.expenses.filter((e) => !e.deleted);
    const novNames = names(nov);
    expect(novNames.indexOf('먼저 넣은 선물')).toBeLessThan(novNames.indexOf('나중 넣은 선물'));
    // 날짜순
    const novDates = novNames.map((n) => dates.find((e) => e.memo === n)!.date);
    expect([...novDates].sort()).toEqual(novDates);

    fireEvent.click(chip('전체 기록'));
    const heads = monthHeads(list);
    expect(heads.indexOf('10월')).toBeLessThan(heads.indexOf('11월'));
    expect(heads[heads.length - 1]).toBe('11월');
  });

  it('전체 기록을 열면 위에 접힌 다 정리된 달이 있을 때 줄 돈이 있는 첫 달로 스크롤해요', async () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this.getAttribute('data-month') ?? '');
    });
    const { h, list } = await renderScreen();
    await act(async () => {
      // 다 정리된 9월 (그냥 지출)
      await L(h).addExpense({ date: '2026-09-02', amount: 30_000, accountId: 'demo-acc-event', categoryId: eventCat(h), memo: '9월 꽃' });
    });
    expect(scrolled).toEqual([]);
    fireEvent.click(chip('전체 기록'));
    const heads = monthHeads(list);
    expect(heads[0]).toBe('9월');
    expect(within(list).getByRole('button', { name: '9월 펼치기' })).toBeTruthy();
    await waitFor(() => expect(scrolled).toHaveLength(1));
    const first = scrolled[0]!;
    expect(within(list).getByRole('list', { name: `${Number(first.slice(5))}월 기록` })).toBeTruthy();
    expect(first > '2026-09').toBe(true);
  });

  it('여행에 묶인 지출 줄은 이름 뒤에 보라 여행 배지 (여행 화면 링크), 여행을 지우면 사라져요', async () => {
    const { h, list } = await renderScreen();
    const row = box(list, '제주 항공권 300,000원 고르기').closest('li')!;
    const badge = within(row).getByRole('link', { name: '여행 제주 여행 보기' });
    expect(badge.getAttribute('href')).toBe('/plan/trips?id=demo-trip-jeju');
    expect(badge.className).toContain('violet');
    expect(badge.textContent).toBe('제주 여행');
    // 이름 뒤에
    const title = within(row).getByRole('button', { name: '제주 항공권 자세히 보기' });
    expect(title.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 여행에 안 묶인 줄은 배지 없음
    expect(within(box(list, /마트 장보기/).closest('li')!).queryByRole('link')).toBeNull();
    await act(async () => {
      await L(h).deleteTrip('demo-trip-jeju');
    });
    await waitFor(() => expect(within(list).queryByRole('link', { name: '여행 제주 여행 보기' })).toBeNull());
  });

  it('좁은 화면용 짧은 글자 [빌려 지급]이 있어도 버튼 이름은 그대로', async () => {
    const { bar } = await renderScreen();
    const borrow = within(bar).getByRole('button', { name: '저수지에서 빌려 지급' });
    expect(borrow.textContent).toContain('빌려 지급');
  });
});
