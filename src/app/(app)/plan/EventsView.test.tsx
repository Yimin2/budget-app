// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatMan, formatWon } from '@/domain';
import { EventsView } from './EventsView';
import { makeHarness } from './testHarness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/plan',
}));

afterEach(cleanup);

async function renderEvents() {
  const h = makeHarness();
  render(<EventsView />, { wrapper: h.Wrapper });
  await screen.findByRole('region', { name: '이벤트통장 잔액' });
  return h;
}

describe('EventsView — 체험 가계부', () => {
  it('평소 쓰는 돈: 일정에 묶지 않은 지난 지출이 있으면 안내 카드와 예측 줄이 보여요', async () => {
    const h = await renderEvents();
    expect(screen.queryByRole('region', { name: '평소 쓰는 돈과 적립' })).toBeNull();
    await act(async () => {
      await h.probe.ledger!.addExpense({ date: '2026-10-12', amount: 900_000, accountId: 'demo-acc-event', categoryId: null });
    });
    const card = await screen.findByRole('region', { name: '평소 쓰는 돈과 적립' });
    expect(card.textContent).toMatch(/평소 매달 .+만원을 쓰는데 적립은 .+이에요. 이대로면 매달 .+씩 줄어요/);
    const chart = screen.getByRole('region', { name: '앞으로 12개월 예상 잔액' });
    expect(within(chart).getByText(/작년 같은 달 기록, 없으면 최근 6개월 평균이에요/)).toBeTruthy();
    expect(h.probe.ledger!.eventProjection!.months.every((m) => m.usual > 0)).toBe(true);
  });

  it('이번 달 정산은 한 줄 요약과 [정산하기] (→ /plan/settle), 이번 달 예측에 돌려줄 돈이 들어가요', async () => {
    const h = await renderEvents();
    const card = screen.getByRole('region', { name: '이번 달 정산' });
    expect(card.id).toBe('settlement');
    expect(within(card).getByTestId('settlement-line').textContent).toMatch(/^이번 달 이벤트통장 쓴 돈 45만 · 들어올 돈 30만 · \d+\/\d+ 정산 30만$/);
    expect(within(card).getByRole('link', { name: '정산하기' }).getAttribute('href')).toBe('/plan/settle');
    // 항목 목록 · 지급 버튼은 정산 화면에만 있어요
    expect(within(card).queryByRole('checkbox')).toBeNull();
    expect(within(card).queryByRole('button', { name: /지급했어요/ })).toBeNull();
    const thisMonth = h.probe.ledger!.eventProjection!.months[0]!;
    expect(thisMonth.claims).toBe(300_000);
  });

  it('저수지에 갚을 돈 카드: 요약(빌린 돈 · 갚은 돈 · 남은 갚을 돈) · 이번 달 갚기 [갚았어요], [모두 보기]로 정산 화면 링크', async () => {
    const h = await renderEvents();
    expect(screen.queryByRole('region', { name: '저수지에 갚을 돈' })).toBeNull();
    await act(async () => {
      await h.probe.ledger!.borrowAndSettleClaims(['demo-claim-jeju']);
    });
    const card = await screen.findByRole('region', { name: '저수지에 갚을 돈' });
    const s = h.probe.ledger!.settlement!;
    expect(s.loan.balance).toBe(300_000);
    expect(within(card).getByTestId('loan-line').textContent).toBe('저수지에 갚을 돈 30만');
    if (s.repay) {
      expect(card.textContent).toContain(`이번 달 ${formatMan(s.repay.amount)} 갚기`);
      expect(within(card).getByRole('button', { name: `저수지에 ${formatWon(s.repay.amount)} 갚았어요` })).toBeTruthy();
    }
    expect(within(card).getByTestId('loan-summary').textContent).toBe('빌린 돈 30만 · 갚은 돈 0원 · 남은 갚을 돈 30만');
    // 처음에는 접혀 있고, [모두 보기]로 같은 자리에서 펼쳐요 (창 · <details> 없음)
    expect(card.querySelector('details')).toBeNull();
    expect(within(card).queryByRole('link')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: '저수지 기록 모두 보기' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(card).getByRole('link', { name: /빌리고 갚은 기록 1건/ }).getAttribute('href')).toBe('/plan/settle#loan');
    expect(card.textContent).not.toContain('민지에게 지급 · 제주 항공권');
    fireEvent.click(within(card).getByRole('button', { name: '저수지 기록 접기' }));
    expect(within(card).queryByRole('link')).toBeNull();
    // 정산 요약 카드에는 갚을 돈이 없어요
    expect(screen.getByRole('region', { name: '이번 달 정산' }).textContent).not.toContain('갚을 돈');
  });

  it('[갚았어요]는 이번 달 갚은 이체를 남기고 "이번 달 10만 갚았어요 · [되돌리기]"가 바로 보여요', async () => {
    const h = await renderEvents();
    await act(async () => {
      await h.probe.ledger!.borrowAndSettleClaims(['demo-claim-jeju']);
      await h.probe.ledger!.repayLoan(100_000);
    });
    const card = await screen.findByRole('region', { name: '저수지에 갚을 돈' });
    expect(within(card).getByTestId('loan-line').textContent).toBe('저수지에 갚을 돈 20만');
    expect(card.textContent).toContain('이번 달 10만 갚았어요');
    expect(within(card).queryByRole('button', { name: /갚았어요$/ })).toBeNull();
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: '이번 달 100,000원 갚은 기록 되돌리기' }));
    });
    await screen.findByText('갚은 기록을 되돌렸어요');
    expect(h.probe.ledger!.settlement!.loan.balance).toBe(300_000);
  });

  it('저수지에서 이미 지급한 이벤트 청구는 이 카드의 버튼 하나로 갚을 돈으로 바꿔요 (잔액 그대로)', async () => {
    const h = await renderEvents();
    const L = h.probe.ledger!;
    const cat = L.data!.categories.find((c) => !c.deleted && c.defaultAccountRole === 'event')!;
    await act(async () => {
      await L.addExpense({ date: '2026-09-02', amount: 70_000, accountId: 'demo-acc-reservoir', categoryId: cat.id, memo: '숲 집들이', paidBy: '준호' });
      await L.addExpense({ date: '2026-09-09', amount: 30_000, accountId: 'demo-acc-reservoir', categoryId: cat.id, memo: '별 생일', paidBy: '준호' });
    });
    const ids = h.probe.ledger!.data!.expenses.filter((e) => e.memo === '숲 집들이' || e.memo === '별 생일').map((e) => e.id);
    await act(async () => {
      await h.probe.ledger!.settleClaims(ids);
    });
    const before = { ...h.probe.ledger!.balances };
    const card = await screen.findByRole('region', { name: '저수지에 갚을 돈' });
    const name = '저수지에서 이미 지급한 이벤트 청구 2건 100,000원을 갚을 돈으로 바꾸기';
    fireEvent.click(within(card).getByRole('button', { name: '저수지 기록 모두 보기' }));
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name }));
    });
    await screen.findByText('2건 100,000원을 저수지에 갚을 돈으로 바꿨어요');
    expect(h.probe.ledger!.settlement!.loan.balance).toBe(100_000);
    expect(h.probe.ledger!.balances).toEqual(before);
    expect(within(card).queryByRole('button', { name })).toBeNull();
  });

  it('불러오는 동안 뼈대, 다 불러오면 잔액 · 매달 적립 · 12개월 막대 · 부족 알림', async () => {
    const h = makeHarness();
    render(<EventsView />, { wrapper: h.Wrapper });
    expect(screen.getByText('일정을 불러오는 중이에요')).toBeTruthy();

    const summary = await screen.findByRole('region', { name: '이벤트통장 잔액' });
    // 시작 600,000 + 적립 300,000 − 제주 여행 숙소 예약금 150,000
    expect(within(summary).getByText('750,000원')).toBeTruthy();
    expect(within(summary).getByText('300,000원')).toBeTruthy();
    expect(within(summary).getByText('1개월')).toBeTruthy();

    const months = screen.getByRole('group', { name: '달 고르기' });
    expect(within(months).getAllByRole('button')).toHaveLength(12);
    const now = within(months).getByRole('button', { name: '11월 (이번 달) 자세히 보기' });
    expect(now.getAttribute('aria-pressed')).toBe('false');
    // 처음엔 첫 부족 달을 보여 줘요
    const april = within(months).getByRole('button', { name: '2027년 4월 자세히 보기' });
    expect(april.getAttribute('aria-pressed')).toBe('true');
    const chart = screen.getByRole('region', { name: '앞으로 12개월 예상 잔액' });
    expect(within(chart).getByRole('heading', { level: 3, name: '2027년 4월' })).toBeTruthy();
    expect(within(chart).getByRole('list', { name: '2027년 4월 예정 일정' }).querySelectorAll('li')).toHaveLength(5);

    // 화면 읽기용 표
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(13);
    expect(within(table).getByText('-300,000원 (300,000원 모자라요)')).toBeTruthy();

    expect(
      screen.getByRole('heading', { name: /2027년 4월에 300,000원 모자라요 \(결혼식 4건 · 어버이날\)/ }),
    ).toBeTruthy();
    expect(screen.getByRole('radio', { name: /지금부터 매달 적립액 \+60,000원/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /2027년 4월에 저수지에서 300,000원 옮기기/ })).toBeTruthy();
    expect((screen.getByRole('button', { name: '이 방법으로 반영하기' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('막대를 누르면 그달 계산과 일정이 보여요 · 이전/다음 달 버튼', async () => {
    await renderEvents();
    const chart = screen.getByRole('region', { name: '앞으로 12개월 예상 잔액' });
    const months = within(chart).getByRole('group', { name: '달 고르기' });
    fireEvent.click(within(months).getByRole('button', { name: '2027년 2월 자세히 보기' }));
    expect(within(chart).getByRole('heading', { level: 3, name: '2027년 2월' })).toBeTruthy();
    const list = within(chart).getByRole('list', { name: '2027년 2월 예정 일정' });
    expect(within(list).getByText('제주 여행')).toBeTruthy();
    expect(within(chart).getByText('달 시작 잔액')).toBeTruthy();
    expect(within(chart).getAllByText('달 말 예상 잔액').length).toBeGreaterThan(0);

    fireEvent.click(within(chart).getByRole('button', { name: '다음 달' }));
    expect(within(chart).getByRole('heading', { level: 3, name: '2027년 3월' })).toBeTruthy();
    expect(within(chart).getByText('이 달에는 예정된 일정이 없어요')).toBeTruthy();

    // 키보드: 왼쪽 화살표로 앞 달
    const march = within(months).getByRole('button', { name: '2027년 3월 자세히 보기' });
    fireEvent.keyDown(march, { key: 'ArrowLeft' });
    expect(within(chart).getByRole('heading', { level: 3, name: '2027년 2월' })).toBeTruthy();
    expect(document.activeElement).toBe(within(months).getByRole('button', { name: '2027년 2월 자세히 보기' }));
  });

  it('② 저수지에서 옮기기를 반영하면 알림이 뜨고 부족이 사라져요', async () => {
    const h = await renderEvents();
    fireEvent.click(screen.getByRole('radio', { name: /저수지에서 300,000원 옮기기/ }));
    fireEvent.click(screen.getByRole('button', { name: '이 방법으로 반영하기' }));
    await screen.findByText('2027년 4월에 저수지에서 300,000원 옮기도록 넣어 뒀어요');
    await waitFor(() => expect(screen.queryByText(/모자라요 \(결혼식/)).toBeNull());
    expect(h.probe.ledger!.eventProjection!.shortages).toHaveLength(0);
    const planned = h.probe.ledger!.data!.transfers.filter((t) => t.status === 'planned');
    expect(planned).toHaveLength(1);
    expect(planned[0]!.amount).toBe(300_000);
    expect(screen.getByText(/옮겨 올 예정인 300,000원을 넣어서 계산했어요/)).toBeTruthy();
    expect(screen.getByRole('region', { name: '이벤트통장 잔액' }).textContent).toContain('없어요');
  });

  it('① 매달 적립액 늘리기를 반영하면 늘어난 적립이 보이고 부족이 사라져요', async () => {
    const h = await renderEvents();
    fireEvent.click(screen.getByRole('radio', { name: /매달 적립액 \+60,000원/ }));
    fireEvent.click(screen.getByRole('button', { name: '이 방법으로 반영하기' }));
    await screen.findByText('매달 적립액을 60,000원 늘렸어요');
    await waitFor(() => expect(h.probe.ledger!.eventProjection!.shortages).toHaveLength(0));
    const summary = screen.getByRole('region', { name: '이벤트통장 잔액' });
    // 체험 가계부의 적립 규칙은 이번 달에 시작해서 금액만 바뀌어요 (이번 달 적립은 이미 들어왔어요)
    expect(within(summary).getByText('360,000원')).toBeTruthy();
    expect(h.probe.ledger!.eventProjection!.months[1]!.contributions).toBe(360_000);
  });

  it('다가오는 일정은 달별로, 반복 · 작성자 · 카테고리를 함께 보여요', async () => {
    await renderEvents();
    const upcoming = screen.getByRole('region', { name: '다가오는 일정' });
    // 제주 여행은 일정이 아닌 여행으로 따로 보여요
    expect(within(upcoming).getByText('7건 · 1,900,000원')).toBeTruthy();
    expect(within(upcoming).getByRole('heading', { level: 3, name: '2027년 1월' })).toBeTruthy();
    const jan = within(upcoming).getByRole('list', { name: '2027년 1월' });
    expect(within(jan).getByText('명절 부모님 용돈')).toBeTruthy();
    expect(within(jan).getByText('민지 · 명절')).toBeTruthy();
    expect(within(upcoming).getByText('매년')).toBeTruthy();
    // 지난 일정은 없어요
    expect(screen.queryByText(/지난 일정 \d+건/)).toBeNull();
  });

  it('일정 추가: 비우고 누르면 안내, 채우면 목록과 예측에 들어가요', async () => {
    const h = await renderEvents();
    fireEvent.click(screen.getByRole('button', { name: '일정 추가' }));
    const dialog = await screen.findByRole('dialog', { name: '일정 추가' });
    fireEvent.click(within(dialog).getByRole('button', { name: '추가하기' }));
    expect(within(dialog).getByText('일정 이름을 입력해 주세요')).toBeTruthy();
    expect(within(dialog).getByText('예상 금액을 입력해 주세요')).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText(/이름/), { target: { value: '지호 돌잔치' } });
    fireEvent.change(within(dialog).getByLabelText(/날짜/), { target: { value: '2026-12-12' } });
    fireEvent.change(within(dialog).getByLabelText(/예상 금액/), { target: { value: '200000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '경조사' }));
    fireEvent.click(within(dialog).getByRole('radio', { name: '매년' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '추가하기' }));

    await screen.findByText('‘지호 돌잔치’ 일정을 넣었어요');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const added = h.probe.ledger!.data!.events.find((e) => e.name === '지호 돌잔치')!;
    expect(added).toMatchObject({
      date: '2026-12-12',
      amount: 200_000,
      repeat: 'yearly',
      categoryId: 'demo-cat-occasion',
    });
    const dec = within(screen.getByRole('region', { name: '다가오는 일정' })).getByRole('list', { name: '12월' });
    expect(within(dec).getByText('지호 돌잔치')).toBeTruthy();
  });

  it('날짜가 지난 일정: 썼어요(실제 금액) → 지출 기록 + 지난 일정으로', async () => {
    const h = await renderEvents();
    await act(async () => {
      await h.probe.ledger!.addEvent({ date: '2026-11-05', name: '동창 모임', amount: 50_000 });
    });
    const overdue = await screen.findByRole('region', { name: '날짜가 지난 일정 1건' });
    fireEvent.click(within(overdue).getByRole('button', { name: '동창 모임 썼어요' }));

    const dialog = await screen.findByRole('dialog', { name: '‘동창 모임’에 얼마 썼어요?' });
    const amount = within(dialog).getByLabelText(/쓴 금액/) as HTMLInputElement;
    expect(amount.value).toBe('50,000');
    expect((within(dialog).getByLabelText(/쓴 날/) as HTMLInputElement).value).toBe('2026-11-05');
    fireEvent.change(amount, { target: { value: '40000' } });
    expect(within(dialog).getByText(/예상보다 10,000원 덜 썼어요/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));

    await screen.findByText('‘동창 모임’ 40,000원 기록했어요');
    await waitFor(() => expect(screen.queryByRole('region', { name: /날짜가 지난 일정/ })).toBeNull());
    const ev = h.probe.ledger!.data!.events.find((e) => e.name === '동창 모임')!;
    expect(ev.status).toBe('done');
    const spent = h.probe.ledger!.data!.expenses.find((x) => x.eventId === ev.id)!;
    expect(spent).toMatchObject({ amount: 40_000, date: '2026-11-05' });

    const past = screen.getByRole('region', { name: '지난 일정 1건' });
    const toggle = within(past).getByRole('button', { name: /지난 일정 1건/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(within(past).getByText('40,000원')).toBeTruthy();
    expect(within(past).getByText('예상 50,000원')).toBeTruthy();
  });

  it('취소됐어요 → 되돌리기로 다시 예정', async () => {
    const h = await renderEvents();
    await act(async () => {
      await h.probe.ledger!.addEvent({ date: '2026-11-10', name: '회식', amount: 30_000 });
    });
    const overdue = await screen.findByRole('region', { name: '날짜가 지난 일정 1건' });
    fireEvent.click(within(overdue).getByRole('button', { name: '회식 취소됐어요' }));
    await screen.findByText('‘회식’ 일정을 취소로 바꿨어요');
    expect(h.probe.ledger!.data!.events.find((e) => e.name === '회식')!.status).toBe('canceled');

    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    await waitFor(() => expect(h.probe.ledger!.data!.events.find((e) => e.name === '회식')!.status).toBe('planned'));
    expect(await screen.findByRole('region', { name: '날짜가 지난 일정 1건' })).toBeTruthy();
  });

  it('일정을 눌러 고치고, 지우기는 한 번 더 물어요', async () => {
    const h = await renderEvents();
    const upcoming = screen.getByRole('region', { name: '다가오는 일정' });
    fireEvent.click(within(upcoming).getByRole('button', { name: /지수 결혼식/ }));
    let dialog = await screen.findByRole('dialog', { name: '일정 고치기' });
    const amount = within(dialog).getByLabelText(/예상 금액/) as HTMLInputElement;
    expect(amount.value).toBe('300,000');
    fireEvent.change(amount, { target: { value: '700000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장하기' }));
    await screen.findByText('‘지수 결혼식’ 일정을 고쳤어요');
    expect(h.probe.ledger!.data!.events.find((e) => e.name === '지수 결혼식')!.amount).toBe(700_000);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(within(upcoming).getByRole('button', { name: /지수 결혼식/ }));
    dialog = await screen.findByRole('dialog', { name: '일정 고치기' });
    fireEvent.click(within(dialog).getByRole('button', { name: '지우기' }));
    const confirm = await screen.findByRole('dialog', { name: '일정을 지울까요?' });
    fireEvent.click(within(confirm).getByRole('button', { name: '지우기' }));
    await screen.findByText('‘지수 결혼식’ 일정을 지웠어요');
    expect(h.probe.ledger!.data!.events.find((e) => e.name === '지수 결혼식')!.deleted).toBe(true);
    await waitFor(() => expect(within(upcoming).queryByText('지수 결혼식')).toBeNull());
  });

  it('여행 카드: 다가오는 여행의 쓴 돈 · 남은 예산, 누르면 여행 화면으로 가요', async () => {
    const h = await renderEvents();
    const card = screen.getByRole('region', { name: '여행' });
    const link = within(card).getByRole('link', { name: /제주 여행/ });
    expect(link.getAttribute('href')).toBe('/plan/trips?id=demo-trip-jeju');
    expect(link.textContent).toContain('450,000원 / 900,000원');
    expect(link.textContent).toContain('남은 예산 450,000원');
    // 링크 이름은 짧게 한 번씩만: 막대는 화면 읽기에서 숨기고 숫자는 이름에 한 번
    expect(within(card).queryByRole('progressbar')).toBeNull();
    expect(link.getAttribute('aria-label')).toMatch(/^제주 여행, .+, 900,000원 중 450,000원 썼어요, 남은 예산 450,000원$/);
    // 남은 예산은 여행 달 예측에 '여행 남은 예산'으로 들어가요
    const feb = h.probe.ledger!.eventProjection!.months.find((m) => m.tripList?.length)!;
    expect(feb.trips).toBe(450_000);

    fireEvent.click(within(card).getByRole('button', { name: '여행 추가' }));
    const dialog = await screen.findByRole('dialog', { name: '여행 추가' });
    fireEvent.click(within(dialog).getByRole('button', { name: '추가하기' }));
    expect(await within(dialog).findByText('여행 이름을 입력해 주세요')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/이름/), { target: { value: '오사카' } });
    fireEvent.change(within(dialog).getByLabelText(/항공/), { target: { value: '400000' } });
    expect(within(dialog).getByText('총예산을 비우면 항목 합 400,000원을 예산으로 잡아요')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '추가하기' }));
    await screen.findByText('‘오사카’ 여행을 추가했어요');
    const added = h.probe.ledger!.trips.find((t) => t.trip.name === '오사카')!;
    expect(added.budget).toBe(400_000);
    expect(within(card).getByRole('link', { name: /오사카/ })).toBeTruthy();
  });

  it('일정이 하나도 없으면 예시와 함께 빈 상태를 보여요', async () => {
    const h = await renderEvents();
    await act(async () => {
      for (const e of h.probe.ledger!.data!.events) await h.probe.ledger!.deleteEvent(e.id);
    });
    expect(await screen.findByText('아직 넣은 일정이 없어요')).toBeTruthy();
    expect(screen.getByText(/결혼식, 명절, 여행처럼 고정비가 아닌 큰 지출을 미리 넣어 두세요/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '명절' }));
    const dialog = await screen.findByRole('dialog', { name: '일정 추가' });
    expect((within(dialog).getByLabelText(/이름/) as HTMLInputElement).value).toBe('설날');
    expect(within(dialog).getByRole('radio', { name: '매년' }).getAttribute('aria-checked')).toBe('true');
    expect(within(dialog).getByRole('button', { name: '명절' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('EventsView — 추천 타협안', () => {
  afterEach(() => window.localStorage.clear());

  it('접힌 요약 한 줄 + [자세히]로 셈 · 개월 칩 · 카테고리별 줄일 금액, 고른 개월 수는 이 기기에 저장', async () => {
    const h = await renderEvents();
    await act(async () => {
      await h.probe.ledger!.addExpense({ date: '2026-10-12', amount: 900_000, accountId: 'demo-acc-event', categoryId: null });
      await h.probe.ledger!.borrowAndSettleClaims(['demo-claim-jeju']);
    });
    const card = await screen.findByRole('region', { name: '평소 쓰는 돈과 적립' });
    const summary = within(card).getByTestId('compromise-summary');
    expect(summary.textContent).toMatch(/^추천: 적립 월 .+ · 쓰는 돈 월 .+ 줄이기 → .+ · 저수지 빚 30만을 24개월에 갚아요$/);
    // 적립이 모자라면 접혀 있어도 올리라는 안내가 보여요
    expect(within(card).getByTestId('compromise-raise').textContent).toMatch(/^적립이 실제 필요보다 월 .+원 적어요 → 월 .+원으로 올려야 해요$/);
    expect(within(card).queryByTestId('compromise-cut')).toBeNull();
    const toggle = within(card).getByRole('button', { name: '추천 타협안 자세히' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(within(card).getByTestId('compromise-cut').textContent).toContain('저수지 빚을 24개월에 갚으려면 쓰는 돈을 월 1.3만원 줄여야 해요');
    expect(within(card).getByRole('list', { name: '카테고리별 줄일 금액' })).toBeTruthy();
    expect(within(card).getByTestId('compromise-check').textContent).toMatch(/추천대로|모자라요/);
    const chip12 = within(card).getByRole('button', { name: '12개월' });
    expect(within(card).getByRole('button', { name: '24개월' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip12);
    expect(chip12.getAttribute('aria-pressed')).toBe('true');
    expect(within(card).getByTestId('compromise-cut').textContent).toContain('저수지 빚을 12개월에 갚으려면 쓰는 돈을 월 2.5만원 줄여야 해요');
    expect(within(card).getByTestId('compromise-summary').textContent).toMatch(/저수지 빚 30만을 12개월에 갚아요$/);
    expect(window.localStorage.getItem('budget:repayMonths')).toBe('12');
    // 자동으로 바꾸는 버튼은 없어요
    expect(within(card).queryByRole('button', { name: /적용|바꾸기|올리기/ })).toBeNull();
  });
});
