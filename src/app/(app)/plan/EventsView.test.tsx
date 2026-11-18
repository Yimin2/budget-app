// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventsView } from './EventsView';
import { chooseScheduleAdd, headerAddButton, makeHarness } from './testHarness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/plan',
}));

afterEach(cleanup);

async function renderEvents() {
  const h = makeHarness();
  render(<EventsView />, { wrapper: h.Wrapper });
  await screen.findByTestId('events-status');
  return h;
}

describe('EventsView — 체험 가계부', () => {
  it('평소 쓰는 돈: 기록이 없으면 안내 한 줄, 일정에 묶지 않은 지난 지출이 생기면 한 줄 안내와 항목별 한 달 평균 표', async () => {
    const h = await renderEvents();
    const card = screen.getByRole('region', { name: '평소 쓰는 돈' });
    expect(within(card).getByTestId('usual-empty')).toBeTruthy();
    expect(within(card).queryByRole('table')).toBeNull();
    await act(async () => {
      await h.probe.ledger!.addExpense({ date: '2026-10-12', amount: 900_000, accountId: 'demo-acc-event', categoryId: null, memo: '갑작스런 경조사' });
    });
    await waitFor(() => expect(within(card).queryByTestId('usual-empty')).toBeNull());
    expect(within(card).getByTestId('usual-summary').textContent).toMatch(/이대로면 매달 .+씩 줄어요/);
    const table = within(card).getByRole('table');
    expect(within(table).getByRole('rowheader', { name: '분류 없음' })).toBeTruthy();
    // 도넛 · 막대 · 단계 칩 · 타협안은 없어요 (타협안은 상태 카드의 [대처하기])
    expect(within(card).queryByTestId('savings-bar')).toBeNull();
    expect(within(card).queryByRole('button')).toBeNull();
    expect(h.probe.ledger!.eventProjection!.months.every((m) => m.usual > 0)).toBe(true);
  });

  it('불러오는 동안 뼈대, 다 불러오면 상태 카드 (모자라는 달 · 쓸 수 있는 돈 · 다음 적립)', async () => {
    const h = makeHarness();
    render(<EventsView />, { wrapper: h.Wrapper });
    expect(screen.getByText('일정을 불러오는 중이에요')).toBeTruthy();
    const status = await screen.findByTestId('events-status');
    expect(within(status).getByRole('heading', { level: 2 }).textContent).toMatch(/^2027년 4월에 .+만 모자라요/);
    expect(status.textContent).toContain('결혼식 4건 · 어버이날');
    // 시작 600,000 + 적립 300,000 − 제주 여행 숙소 예약금 150,000 (돌려줄 돈이 있으면 뺀 금액)
    expect(within(status).getByTestId('status-usable').textContent).toMatch(/^지금 쓸 수 있는 돈/);
    expect(within(status).getByTestId('status-next').textContent).toMatch(/^다음 적립\+30만/);
    // 숫자 카드 · 12개월 카드 · 범위 띠는 없어요
    expect(screen.queryByTestId('kpi-strip')).toBeNull();
    expect(screen.queryByRole('region', { name: /12개월/ })).toBeNull();
    expect(h.probe.ledger!.eventProjection!.shortages).toHaveLength(1);
  });

  it('[대처하기]를 누르면 추천 타협안 창이 열려요', async () => {
    await renderEvents();
    const status = screen.getByTestId('events-status');
    fireEvent.click(within(status).getByRole('button', { name: '대처하기' }));
    const dialog = await screen.findByRole('dialog', { name: '모자라는 달 대처하기' });
    // 평소 쓰는 돈 기록이 없으면 타협안 대신 두 가지 방법을 알려 줘요 (바로 바꾸는 버튼은 없어요)
    expect(within(dialog).getByTestId('fix-ways').textContent).toMatch(/매달 적립을 .+ 늘리면/);
    expect(within(dialog).getByTestId('fix-ways').textContent).toMatch(/저수지에서 .+ 옮기면/);
    expect(within(dialog).queryByRole('radio')).toBeNull();
  });

  it('달 말 잔액: 지난 달(최대 3개월) + 앞으로 12개월, 막대를 누르면 그달 상세 시트 · 이전/다음 달', async () => {
    const h = await renderEvents();
    const chart = screen.getByRole('region', { name: '달 말 잔액' });
    const bars = within(chart).getAllByRole('button');
    const past = h.probe.ledger!.eventProjection!.months.length;
    expect(bars.length).toBeGreaterThanOrEqual(past);
    expect(bars.length).toBeLessThanOrEqual(past + 3);
    fireEvent.click(within(chart).getByRole('button', { name: /^2027년 4월 달 말 .+ 모자라요/ }));
    const sheet = await screen.findByRole('dialog', { name: '2027년 4월' });
    expect(within(sheet).getByRole('list', { name: '2027년 4월에 쓸 돈 (예정)' }).querySelectorAll('li')).toHaveLength(5);
    expect(within(sheet).getByTestId('sheet-calc').textContent).toContain('2027년 4월 말 잔액');
    fireEvent.click(within(sheet).getByRole('button', { name: '이전 달' }));
    const march = await screen.findByRole('dialog', { name: '2027년 3월' });
    expect(within(march).getByText('이 달에 쓸 돈이 없어요')).toBeTruthy();
    fireEvent.click(within(march).getByRole('button', { name: '이전 달' }));
    // 2월: 여행은 쓸 돈에 함께 (여행 화면 링크)
    const feb = await screen.findByRole('dialog', { name: '2027년 2월' });
    expect(within(feb).getByRole('link', { name: '제주 여행' }).getAttribute('href')).toBe('/plan/trips?id=demo-trip-jeju');
  });

  it('쓴 날 기준: 이번 달 시트에 개인 돈으로 낸 청구가 쓴 달 돈으로, 돌려주는 날에 다시 빼지 않아요', async () => {
    await renderEvents();
    const chart = screen.getByRole('region', { name: '달 말 잔액' });
    fireEvent.click(within(chart).getByRole('button', { name: /이번 달/ }));
    const sheet = await screen.findByRole('dialog', { name: '11월 · 이번 달' });
    expect(within(sheet).getByText('이번 달 쓴 돈 (예정 포함)')).toBeTruthy();
    expect(within(sheet).getByTestId('sheet-calc').textContent).toContain('11월 말 잔액');
  });

  it('저수지에서 옮길 예정 이체가 있으면 들어올 돈에 넣어 계산하고, 모자라는 달이 없어져요', async () => {
    const h = await renderEvents();
    await act(async () => {
      await h.probe.ledger!.applyFromReservoir(h.probe.ledger!.shortageFix!.fromReservoir!);
    });
    await waitFor(() => expect(h.probe.ledger!.eventProjection!.shortages).toHaveLength(0));
    await waitFor(() =>
      expect(within(screen.getByTestId('events-status')).getByRole('heading', { level: 2 }).textContent).toMatch(/모자라지 않아요$/),
    );
  });

  it('다가오는 일정은 달별로, 반복 · 작성자 · 카테고리를 함께 보여요', async () => {
    await renderEvents();
    // 일정 7건 1,900,000원 + 제주 여행 남은 예산 450,000원을 날짜순으로 한 목록에
    const card = screen.getByRole('region', { name: '달별 일정 · 8건 235만' });
    const upcoming = within(card).getByRole('region', { name: '다가오는 일정' });
    expect(within(upcoming).getByRole('heading', { level: 3, name: '2027년 1월' })).toBeTruthy();
    const jan = within(upcoming).getByRole('list', { name: '2027년 1월' });
    expect(within(jan).getByText('명절 부모님 용돈')).toBeTruthy();
    expect(within(jan).getByText('민지 · 명절')).toBeTruthy();
    // 금액은 만 단위 (정확한 금액은 화면 읽기용 글과 일정 창에)
        expect(within(upcoming).getByText(/^1건 · 40만 · 달 말/)).toBeTruthy();
    expect(within(jan).getByRole('button', { name: /명절 부모님 용돈/ }).textContent).toContain('40만400,000원');
    // 가까운 3개 달(1월 · 2월 · 4월)만 펼쳐 두고, 8월 결혼기념일(매년)은 [1건 더]로
    expect(within(upcoming).queryByRole('list', { name: '2027년 8월' })).toBeNull();
    fireEvent.click(within(upcoming).getByRole('button', { name: '다가오는 일정 1건 더 보기' }));
    expect(within(upcoming).getByRole('list', { name: '2027년 8월' })).toBeTruthy();
    expect(within(upcoming).getByText('매년')).toBeTruthy();
    // 지난 일정은 없어요
    expect(screen.queryByText(/지난 일정 \d+건/)).toBeNull();
  });

  it('일정 추가: 비우고 누르면 안내, 채우면 목록과 예측에 들어가요', async () => {
    const h = await renderEvents();
    chooseScheduleAdd('새 일정');
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

  it('일정 카드의 여행 줄: 여행 표시 · 쓴 돈 / 예산 · 남은 예산, 누르면 여행 화면, 머리의 [+ 추가 ▾] 메뉴로 여행 추가', async () => {
    const h = await renderEvents();
    const card = screen.getByRole('region', { name: /^달별 일정 · / });
    const link = within(card).getByRole('link', { name: /제주 여행/ });
    expect(link.getAttribute('href')).toBe('/plan/trips?id=demo-trip-jeju');
    expect(link.textContent).toContain('여행');
    expect(link.textContent).toContain('쓴 돈 45만 / 예산 90만');
    expect(link.textContent).toContain('남은 45만');
    // 일정과 함께 떠나는 날의 달에, 날짜순으로
    const febList = within(card).getByRole('list', { name: '2027년 2월' });
    expect(within(febList).getByRole('link', { name: /제주 여행/ })).toBe(link);
    // 링크 이름은 짧게 한 번씩만: 막대는 화면 읽기에서 숨기고 숫자는 이름에 한 번
    expect(within(card).queryByRole('progressbar')).toBeNull();
    expect(link.getAttribute('aria-label')).toMatch(/^제주 여행, .+, 900,000원 중 450,000원 썼어요(, 미리 낸 돈 \d건 포함)?, 남은 예산 450,000원$/);
    // 남은 예산은 여행 달 예측에 '여행 남은 예산'으로 들어가요
    const feb = h.probe.ledger!.eventProjection!.months.find((m) => m.tripList?.length)!;
    expect(feb.trips).toBe(450_000);

    // 머리의 [+ 추가 ▾] 메뉴의 '여행 추가'로 여행 창을 열어요 (카드에는 추가 버튼이 없어요)
    expect(within(card).queryByRole('button', { name: '추가' })).toBeNull();
    const add = headerAddButton();
    expect(add.getAttribute('aria-haspopup')).toBe('menu');
    expect(add.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(add);
    expect(add.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: '무엇을 추가할까요' });
    expect(within(menu).getByRole('menuitem', { name: '새 일정' })).toBeTruthy();
    fireEvent.click(within(menu).getByRole('menuitem', { name: '여행 추가' }));
    expect(screen.queryByRole('menu')).toBeNull();
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
    expect(await within(screen.getByRole('region', { name: /^달별 일정 · / })).findByRole('link', { name: /오사카/ })).toBeTruthy();
    // 미리 낸 돈이 없으면 그 문구와 [펼치기]가 없어요
    const osaka = within(screen.getByRole('region', { name: /^달별 일정 · / })).getByRole('link', { name: /오사카/ });
    expect(osaka.textContent).not.toContain('미리 낸 돈');
    expect(screen.queryByRole('button', { name: '오사카 미리 낸 돈 펼치기' })).toBeNull();
  });

  it('일정이 하나도 없으면 예시와 함께 빈 상태를 보여요', async () => {
    const h = await renderEvents();
    await act(async () => {
      for (const e of h.probe.ledger!.data!.events) await h.probe.ledger!.deleteEvent(e.id);
    });
    expect(await screen.findByText('아직 넣은 일정이 없어요')).toBeTruthy();
    expect(screen.getByText(/결혼식, 명절, 여행처럼 고정비가 아닌 큰 지출을 미리 넣어 두세요/)).toBeTruthy();
    // 다가오는 여행은 빈 상태 아래에 그대로 보여요
    expect(within(screen.getByRole('region', { name: /^달별 일정/ })).getByRole('link', { name: /제주 여행/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '명절' }));
    const dialog = await screen.findByRole('dialog', { name: '일정 추가' });
    expect((within(dialog).getByLabelText(/이름/) as HTMLInputElement).value).toBe('설날');
    expect(within(dialog).getByRole('radio', { name: '매년' }).getAttribute('aria-checked')).toBe('true');
    expect(within(dialog).getByRole('button', { name: '명절' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('EventsView — 추천 타협안', () => {
  afterEach(() => window.localStorage.clear());

  it('[대처하기] 창: 요약 · 셈 · 개월 칩 · 카테고리별 줄일 금액, 고른 개월 수는 이 기기에 저장하고 정산 줄의 저수지 줄도 따라요', async () => {
    const h = await renderEvents();
    await act(async () => {
      await h.probe.ledger!.addExpense({ date: '2026-10-12', amount: 900_000, accountId: 'demo-acc-event', categoryId: null });
      await h.probe.ledger!.borrowAndSettleClaims(['demo-claim-jeju']);
    });
    const status = await screen.findByTestId('events-status');
    fireEvent.click(await within(status).findByRole('button', { name: '대처하기' }));
    const dialog = await screen.findByRole('dialog', { name: '모자라는 달 대처하기' });
    expect(within(dialog).getByTestId('compromise-summary').textContent).toMatch(/^추천: 적립 월 .+ · 쓰는 돈 월 .+ 줄이기 → .+ · 저수지 빚 30만을 24개월에 갚아요$/);
    expect(within(dialog).getByTestId('compromise-raise').textContent).toMatch(/^적립이 실제 필요보다 월 .+원 적어요 → 월 .+원으로 올려야 해요$/);
    expect(within(dialog).getByTestId('compromise-cut').textContent).toContain('저수지 빚을 24개월에 갚으려면 쓰는 돈을 월 1.3만원 줄여야 해요');
    expect(within(dialog).getByRole('list', { name: '카테고리별 줄일 금액' })).toBeTruthy();
    const chip12 = within(dialog).getByRole('button', { name: '12개월' });
    expect(within(dialog).getByRole('button', { name: '24개월' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip12);
    expect(chip12.getAttribute('aria-pressed')).toBe('true');
    expect(within(dialog).getByTestId('compromise-cut').textContent).toContain('저수지 빚을 12개월에 갚으려면 쓰는 돈을 월 2.5만원 줄여야 해요');
    expect(window.localStorage.getItem('budget:repayMonths')).toBe('12');
    expect(within(screen.getByTestId('events-settle')).getByTestId('loan-line').textContent).toContain('매달 2.5만 ·');
    // 자동으로 바꾸는 버튼은 없어요
    expect(within(dialog).queryByRole('button', { name: /적용|바꾸기|올리기/ })).toBeNull();
  });
});
