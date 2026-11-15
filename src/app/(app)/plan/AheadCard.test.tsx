// @vitest-environment jsdom
/** 이벤트 화면 '지난 · 앞으로 12개월' 카드: 막대 · 고른 달 항목(모자라면 맨 위 한 줄) · 다가오는 달 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { forecastCompare, formatManShort, formatWon, pastMonthEnds } from '@/domain';
import { EventsView } from './EventsView';
import { makeHarness } from './testHarness';
import { aheadMonthItems, aheadTotalLines, aheadTotals, repayByMonth, USUAL_BASIS_NOTE } from './selectors';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/plan',
}));

afterEach(cleanup);

async function renderCard(opts: { history?: boolean } = {}) {
  const h = makeHarness(opts);
  render(<EventsView />, { wrapper: h.Wrapper });
  const card = await screen.findByRole('region', { name: /앞으로 12개월$/ });
  return { h, card };
}

describe('앞으로 12개월 카드', () => {
  it('처음엔 이번 달을 골라 두고, 모자라는 달을 고르면 맨 위 한 줄 · 나갈 돈 항목 · 그 달 끝 예상 잔액', async () => {
    const { h, card } = await renderCard();
    expect(within(within(card).getByTestId('ahead-month')).getByRole('heading', { level: 3, name: '11월 · 이번 달' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: '11월 (이번 달) 자세히 보기' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(card).getByTestId('ahead-month-status').textContent).toBe('모자라지 않아요');
    const april = h.probe.ledger!.eventProjection!.months.find((m) => m.month === '2027-04')!;
    fireEvent.click(within(card).getByRole('button', { name: '2027년 4월 자세히 보기' }));
    const detail = within(card).getByTestId('ahead-month');
    expect(within(detail).getByTestId('ahead-month-status').textContent).toBe('2027년 4월에 30만 모자라요 · 결혼식 4건 · 어버이날');
    expect(within(detail).getByRole('heading', { level: 3, name: '2027년 4월' })).toBeTruthy();
    const list = within(detail).getByRole('list', { name: '2027년 4월 나갈 돈' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(april.events.length);
    for (const e of april.events) expect(list.textContent).toContain(e.name);
    // 보이는 금액은 만 단위, 화면 읽기용 글에는 정확한 금액
    expect(detail.textContent).toContain(`그 달 끝 예상 잔액${formatManShort(april.endBalance)}${formatWon(april.endBalance)}`);
    // 해결 방법 패널(적립 늘리기 · 저수지에서 옮기기)은 없어요
    expect(within(card).queryByRole('radio')).toBeNull();
    expect(within(card).queryByRole('button', { name: '이 방법으로 반영하기' })).toBeNull();
  });

  it('평소 쓰는 돈은 근거와 함께 마지막 줄, 금액은 예측 그대로', async () => {
    const { h, card } = await renderCard();
    await act(async () => {
      await h.probe.ledger!.addExpense({ date: '2026-10-12', amount: 900_000, accountId: 'demo-acc-event', categoryId: null });
    });
    const dec = h.probe.ledger!.eventProjection!.months.find((m) => m.month === '2026-12')!;
    expect(dec.usual).toBeGreaterThan(0);
    fireEvent.click(within(card).getByRole('button', { name: '12월 자세히 보기' }));
    const items = within(within(card).getByRole('list', { name: '12월 나갈 돈' })).getAllByRole('listitem');
    const last = items[items.length - 1]!;
    expect(last.textContent).toBe(`평소 쓰는 돈 (${USUAL_BASIS_NOTE[dec.usualBasis ?? 'recent']})${formatManShort(dec.usual)}${formatWon(dec.usual)}`);
  });

  it('다가오는 달: 이번 달부터 4개월 한 줄씩, 누르면 그 달을 골라요 · 지난 달 쓴 돈은 정산 화면 링크', async () => {
    const { card } = await renderCard();
    const up = within(card).getByRole('list', { name: '다가오는 달' });
    const rows = within(up).getAllByRole('button');
    expect(rows).toHaveLength(4);
    expect(rows[0]!.textContent).toMatch(/^11월 · ([\d.]+만|0원).* \(이번 달\)$/);
    expect(rows[1]!.textContent).toMatch(/^12월 · ([\d.]+만|0원)/);
    // 합계가 먼저, 굵게
    expect(rows[1]!.querySelector('strong')!.textContent).toMatch(/^12월 · ([\d.]+만|0원)$/);
    // 처음엔 이번 달
    expect(rows.map((r) => r.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false']);
    fireEvent.click(rows[1]!);
    expect(rows[1]!.getAttribute('aria-pressed')).toBe('true');
    expect(within(card).getByRole('heading', { level: 3, name: '12월' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: '12월 자세히 보기' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(card).getByRole('link', { name: /지난 달 쓴 돈은 정산 화면에서/ }).getAttribute('href')).toBe('/plan/settle#paid');
    // 지난 달 쓴 돈 목록은 없어요 (정산 화면에 있어요)
    expect(within(card).queryByText('썼어요')).toBeNull();
    expect(screen.queryByRole('region', { name: '월별 이벤트 비용' })).toBeNull();
  });

  it('다가오는 달 중 모자라는 달은 경고 색으로 \'−30만\'', async () => {
    const { h, card } = await renderCard();
    // 12월에 큰 일정을 넣어 다가오는 달 안에 모자라는 달을 만들어요
    await act(async () => {
      await h.probe.ledger!.addEvent({ date: '2026-12-10', name: '큰 경조사', amount: 1_500_000 });
    });
    const dec = h.probe.ledger!.eventProjection!.months.find((m) => m.month === '2026-12')!;
    expect(dec.endBalance).toBeLessThan(0);
    const row = within(within(card).getByRole('list', { name: '다가오는 달' })).getByRole('button', { name: /^12월/ });
    expect(row.className).toMatch(/upShort/);
    expect(row.textContent).toContain(`−${formatManShort(-dec.endBalance)} 모자라요`);
  });

  it('폰에서도 접지 않아요: 상태 한 줄 · 막대 · 고른 달(이번 달 합계)이 늘 보여요', async () => {
    const { card } = await renderCard();
    expect(within(card).getByTestId('ahead-status').textContent).toMatch(/^12개월 중 1개월이 모자라요/);
    // 카드 접기 버튼은 없어요 (지난 지출 돌려주기 묶음의 [펼치기]만)
    expect(within(card).queryAllByRole('button', { name: /펼치기$/ }).filter((b) => !b.closest('[data-testid="ahead-repay"]'))).toHaveLength(0);
    expect(within(card).getByRole('group', { name: '달 고르기' })).toBeTruthy();
    expect(within(card).getByTestId('ahead-total').textContent).toMatch(/^이번 달 나갈 돈 /);
    expect(card.querySelector('[class*="folded"]')).toBeNull();
  });

  it('고른 달 맨 위에 나갈 돈 합계(굵게): 앞으로 달은 합계, 이번 달은 이미 나간 돈 + 앞으로', async () => {
    const { h, card } = await renderCard();
    const proj = h.probe.ledger!.eventProjection!;
    const april = proj.months.find((m) => m.month === '2027-04')!;
    fireEvent.click(within(card).getByRole('button', { name: '2027년 4월 자세히 보기' }));
    const total = within(within(card).getByTestId('ahead-month')).getByTestId('ahead-total');
    expect(total.textContent).toContain(`2027년 4월 나갈 돈 합계 ${formatManShort(aheadTotals(april).total)}`);
    fireEvent.click(within(card).getByRole('button', { name: '11월 (이번 달) 자세히 보기' }));
    const now = within(within(card).getByTestId('ahead-month')).getByTestId('ahead-total');
    const lines = aheadTotalLines(proj.months[0]!, '2026-11-20', null);
    expect(now.textContent).toMatch(/^이번 달 나갈 돈 [\d.]+만= 이미 나간 돈 [\d.]+만 \+ 앞으로 /);
    expect(now.textContent).toContain(`앞으로 ${formatManShort(aheadTotals(proj.months[0]!).total)}`);
    expect(lines.title).toMatch(/나갈 돈 합계/);
  });

  it('돌려줄 청구는 새로 나갈 돈과 따로 \'지난 지출 돌려주기\' 묶음 (쓴 달 · 낸 사람), 정산 화면 링크', async () => {
    const { h, card } = await renderCard();
    const m = h.probe.ledger!.eventProjection!.months.find((x) => (x.claims ?? 0) > 0)!;
    expect(m).toBeTruthy();
    const name = m.month === '2026-11' ? '11월 (이번 달) 자세히 보기' : `${Number(m.month.slice(5))}월 자세히 보기`;
    fireEvent.click(within(card).getByRole('button', { name }));
    const repay = within(card).getByTestId('ahead-repay');
    expect(repay.textContent).toContain(`지난 지출 돌려주기 ${formatManShort(m.claims!)}`);
    // 처음엔 접혀 있고, 펼치면 쓴 달별 한 줄 → 달을 누르면 낸 사람
    expect(within(repay).queryByRole('list', { name: /지난 지출 돌려주기$/ })).toBeNull();
    fireEvent.click(within(repay).getByRole('button', { name: /펼치기/ }));
    const list = within(repay).getByRole('list', { name: /지난 지출 돌려주기$/ });
    const monthBtn = within(list).getAllByRole('button')[0]!;
    expect(monthBtn.textContent).toMatch(/^\d+월에 쓴 것 · \d+건/);
    fireEvent.click(monthBtn);
    expect(within(list).getAllByRole('list')[0]!.textContent).toContain('민지');
    expect(repay.textContent).toContain('이미 쓴 돈이라 지출은 그때 달에 세고, 여기선 통장에서 돈이 나가는 날로 잡아요');
    expect(within(repay).getByRole('link', { name: /정산 화면/ }).getAttribute('href')).toBe('/plan/settle');
    // 새로 나갈 돈 목록에는 돌려주기가 없어요
    const spend = within(card).queryByRole('list', { name: /나갈 돈$/ });
    if (spend) expect(spend.textContent).not.toContain('에 쓴 것');
    const up = within(within(card).getByRole('list', { name: '다가오는 달' })).getAllByRole('button');
    expect(up.some((r) => r.textContent!.includes(`돌려주기 ${formatManShort(m.claims!)}`))).toBe(true);
  });
});

describe('앞으로 12개월 카드 — 지난 달 실제 잔액 · 예측 기록', () => {
  it('이번 달 왼쪽에 지난 12개월 회색 막대(지난 달), 이번 달 표시는 그대로', async () => {
    const { card } = await renderCard({ history: true });
    const bars = within(card).getAllByTestId('ahead-past-bar');
    expect(bars).toHaveLength(12);
    expect(bars[0]!.getAttribute('aria-label')).toBe('2025년 11월 (지난 달) 자세히 보기');
    expect(bars[11]!.getAttribute('aria-label')).toBe('10월 (지난 달) 자세히 보기');
    const group = within(card).getByRole('group', { name: '달 고르기' });
    const all = within(group).getAllByRole('button');
    expect(all).toHaveLength(24);
    expect(all[12]!.getAttribute('aria-label')).toBe('11월 (이번 달) 자세히 보기');
    // 화면 읽기용 표: 지난 달 표 + 앞으로 달 표
    expect(within(card).getByRole('table', { name: '이벤트통장 지난 달 실제 잔액' })).toBeTruthy();
    expect(within(within(card).getByRole('table', { name: '이벤트통장 지난 달 실제 잔액' })).getAllByRole('row')).toHaveLength(13);
    expect(within(card).getByRole('table', { name: '이벤트통장 달별 예상 잔액' })).toBeTruthy();
  });

  it('지난 막대를 누르면 시작 잔액 · 들어온 돈 · 나간 돈 · 끝 잔액, 그때 예상과 견주기, 정산 화면 링크', async () => {
    const { h, card } = await renderCard({ history: true });
    const data = h.probe.ledger!.data!;
    const past = pastMonthEnds(data, 'demo-acc-event', '2026-11-20');
    const oct = past.at(-1)!;
    fireEvent.click(within(card).getByRole('button', { name: '10월 (지난 달) 자세히 보기' }));
    const detail = within(card).getByTestId('ahead-past-month');
    expect(within(detail).getByRole('heading', { level: 3, name: '10월 · 지난 달' })).toBeTruthy();
    expect(detail.textContent).toContain(`시작 잔액${formatManShort(oct.startBalance)}${formatWon(oct.startBalance)}`);
    expect(detail.textContent).toContain(`들어온 돈+${formatManShort(oct.inflow)}${formatWon(oct.inflow)}`);
    expect(detail.textContent).toContain(`나간 돈−${formatManShort(oct.outflow)}${formatWon(oct.outflow)}`);
    expect(detail.textContent).toContain(`끝 잔액${formatManShort(oct.endBalance)}${formatWon(oct.endBalance)}`);
    const snap = data.forecasts.find((f) => f.targetMonth === '2026-10')!;
    const cmp = forecastCompare(snap, oct);
    const compare = within(detail).getByTestId('ahead-compare');
    expect(compare.textContent).toContain(cmp.headline);
    expect(cmp.headline).toMatch(/^그달 처음 예상 .+ → 실제 \+60만 \(6만 아꼈어요\)$/);
    expect(compare.textContent).toContain(cmp.detail!);
    expect(within(detail).getByRole('link', { name: /그 달 쓴 돈은 정산 화면에서/ }).getAttribute('href')).toBe('/plan/settle#paid');
    // 들어온 돈이 바뀐 달 (그때 적립을 25만으로 알았던 달)
    fireEvent.click(within(card).getByRole('button', { name: '7월 (지난 달) 자세히 보기' }));
    expect(within(card).getByTestId('ahead-compare').textContent).toContain('적립 등 들어온 돈이 25만 → 30만으로 바뀌었어요');
    // 기록이 없는 달
    fireEvent.click(within(card).getByRole('button', { name: '2월 (지난 달) 자세히 보기' }));
    expect(within(card).getByTestId('ahead-past-month').textContent).toContain('그때 남긴 예측 기록이 없어요');
  });

  it('예측 기록이 있는 지난 달에만 그때 예상한 잔액 점선, 범례도 함께', async () => {
    const { card } = await renderCard({ history: true });
    const bars = within(card).getAllByTestId('ahead-past-bar');
    const marked = bars.filter((b) => within(b).queryByTestId('ahead-snapshot-mark'));
    expect(marked.map((b) => b.getAttribute('aria-label')!.split(' (')[0])).toEqual(['5월', '6월', '7월', '8월', '9월', '10월']);
    expect(card.textContent).toContain('그때 예상한 잔액');
    expect(card.textContent).toContain('지난 달 실제 잔액');
    // 지난달 기록이 없으니 앞으로 달에는 옅은 표시가 없어요
    expect(within(card).queryAllByTestId('ahead-prev-mark')).toHaveLength(0);
  });

  it('지난 기록이 없으면(통장을 이번 달에 시작) 지난 막대 · 범례가 없어요', async () => {
    const { card } = await renderCard();
    expect(within(card).queryAllByTestId('ahead-past-bar')).toHaveLength(0);
    expect(card.textContent).not.toContain('지난 달 실제 잔액');
    expect(within(card).queryByRole('table', { name: '이벤트통장 지난 달 실제 잔액' })).toBeNull();
  });
});

describe('앞으로 12개월 카드 — 돌려줄 청구가 많을 때 (6~11월 26건)', () => {
  // 체험 가계부의 민지 30만(11월) + 민구 24건(6월 3 · 7월 4 · 8월 5 · 9월 4 · 10월 8) 각 17.5만 = 420만 + 기쁜 1건 20만 → 470만 · 26건
  const PLAN: [string, number][] = [
    ['2026-06', 3],
    ['2026-07', 4],
    ['2026-08', 5],
    ['2026-09', 4],
    ['2026-10', 8],
  ];

  async function renderMany() {
    const r = await renderCard();
    const before = r.h.probe.ledger!.eventProjection!.months[0]!.claims ?? 0;
    // 통장 잔액이 넉넉하면 청구의 정산일이 오늘(이번 달)이에요 → 25건이 모두 이번 달에 돌려줄 돈
    await act(async () => {
      await r.h.probe.ledger!.addTransfer({ date: '2026-11-01', kind: 'transfer', fromAccountId: 'demo-acc-living', toAccountId: 'demo-acc-event', amount: 10_000_000, memo: '' });
    });
    const add = (date: string, amount: number, paidBy: string) =>
      act(async () => {
        // 한 번에 하나씩 (상태가 바뀐 뒤의 ledger 로)
        await r.h.probe.ledger!.addExpense({
          date,
          amount,
          accountId: 'demo-acc-event',
          categoryId: null,
          memo: `청구 ${date}`,
          paidBy,
          claimAccountId: 'demo-acc-living',
          claimDue: '2026-11-21',
        } as never);
      });
    for (const [month, n] of PLAN) {
      for (let i = 0; i < n; i++) await add(`${month}-${String(i + 2).padStart(2, '0')}`, 175_000, '민구');
    }
    await add('2026-10-20', 200_000, '기쁜');
    return { ...r, before };
  }

  it('처음엔 접혀 있고 머리 한 줄 · 낸 사람별 합 · [펼치기] · 정산 화면 링크, 합계는 그대로', async () => {
    const { h, card, before } = await renderMany();
    const nov = h.probe.ledger!.eventProjection!.months[0]!;
    expect(before).toBe(300_000);
    expect(nov.claims).toBe(4_700_000);
    expect(nov.claimList).toHaveLength(26);
    const repay = within(card).getByTestId('ahead-repay');
    expect(within(repay).getByTestId('ahead-repay-head').textContent).toBe('지난 지출 돌려주기 470만 · 26건 (6~11월에 쓴 것)');
    expect(within(repay).getByTestId('ahead-repay-payers').textContent).toBe('민구 420만 · 민지 30만 · 기쁜 20만');
    const toggle = within(repay).getByRole('button', { name: /펼치기/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(repay).queryAllByRole('listitem')).toHaveLength(0);
    expect(within(repay).getByRole('link', { name: /정산 화면/ }).getAttribute('href')).toBe('/plan/settle');
    // 합계 · 다가오는 달 · 숫자 띠는 그대로
    expect(within(card).getByTestId('ahead-total').textContent).toContain(`앞으로 ${formatManShort(aheadTotals(nov).total)}`);
    const up = within(within(card).getByRole('list', { name: '다가오는 달' })).getAllByRole('button')[0]!;
    expect(up.textContent).toContain('돌려주기 470만');
    expect(screen.getByTestId('kpi-spend').textContent).toContain('(돌려주기 470만)');
  });

  it('펼치면 쓴 달별 한 줄(오래된 달 먼저, 항목은 숨김) → 달을 펼치면 5줄 + \'N건 더\'', async () => {
    const { h, card } = await renderMany();
    const nov = h.probe.ledger!.eventProjection!.months[0]!;
    const repay = within(card).getByTestId('ahead-repay');
    const toggle = within(repay).getByRole('button', { name: /펼치기/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('접기');
    const list = within(repay).getByRole('list', { name: '11월 지난 지출 돌려주기' });
    const monthBtns = within(list).getAllByRole('button');
    const groups = repayByMonth(aheadMonthItems(nov), nov);
    expect(monthBtns.map((b) => b.textContent)).toEqual(
      groups.map((g) => `${g.label}에 쓴 것 · ${g.count}건${formatManShort(g.amount)}${formatWon(g.amount)}`),
    );
    expect(monthBtns[0]!.textContent).toMatch(/^6월에 쓴 것 · 3건52\.5만/);
    expect(monthBtns[4]!.textContent).toMatch(/^10월에 쓴 것 · 9건160만/);
    // 달 안 항목은 처음엔 숨김
    expect(within(list).queryAllByRole('list')).toHaveLength(0);
    expect(monthBtns.every((b) => b.getAttribute('aria-expanded') === 'false')).toBe(true);
    // 6월(3건)은 다 보이고 'N건 더' 없음
    fireEvent.click(monthBtns[0]!);
    expect(monthBtns[0]!.getAttribute('aria-expanded')).toBe('true');
    const june = within(list).getByRole('list', { name: '6월에 쓴 것' });
    expect(within(june).getAllByRole('listitem')).toHaveLength(3);
    expect(within(june).getAllByRole('listitem')[0]!.textContent).toBe(`6/2민구${formatManShort(175_000)}${formatWon(175_000)}`);
    // 10월(9건)은 5줄 + '4건 더', 누르면 다
    fireEvent.click(monthBtns[4]!);
    const oct = within(list).getByRole('list', { name: '10월에 쓴 것' });
    expect(within(oct).getAllByRole('listitem')).toHaveLength(5);
    const more = within(list).getByRole('button', { name: '4건 더' });
    fireEvent.click(more);
    expect(within(within(list).getByRole('list', { name: '10월에 쓴 것' })).getAllByRole('listitem')).toHaveLength(9);
    // 다시 접기
    fireEvent.click(toggle);
    expect(within(repay).queryByRole('list', { name: '11월 지난 지출 돌려주기' })).toBeNull();
  });

  it('새로 나갈 돈이 6줄을 넘으면 앞 5줄 + \'N건 더\'', async () => {
    const { h, card } = await renderCard();
    await act(async () => {
      for (let i = 0; i < 8; i++) await h.probe.ledger!.addEvent({ date: `2027-02-${String(i + 1).padStart(2, '0')}`, name: `모임 ${i + 1}`, amount: 50_000 });
    });
    fireEvent.click(within(card).getByRole('button', { name: '2027년 2월 자세히 보기' }));
    const feb = h.probe.ledger!.eventProjection!.months.find((m) => m.month === '2027-02')!;
    const all = aheadMonthItems(feb).filter((i) => i.kind !== 'claims');
    expect(all.length).toBeGreaterThan(6);
    const detail = within(card).getByTestId('ahead-month');
    const list = within(detail).getByRole('list', { name: '2027년 2월 나갈 돈' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    fireEvent.click(within(detail).getByRole('button', { name: `${all.length - 5}건 더` }));
    expect(within(within(detail).getByRole('list', { name: '2027년 2월 나갈 돈' })).getAllByRole('listitem')).toHaveLength(all.length);
  });
});

describe('앞으로 12개월 카드 — 통장 시작 전 달은 쓴 돈만', () => {
  // 체험 가계부의 이벤트통장은 이번 달(11월)에 시작 → 가져온 지난 지출은 잔액을 되살릴 수 없어 쓴 돈만
  async function renderImported() {
    const r = await renderCard();
    const add = (date: string, amount: number, categoryId: string, memo: string) =>
      act(async () => {
        await r.h.probe.ledger!.addExpense({ date, amount, accountId: 'demo-acc-event', categoryId, memo });
      });
    await add('2026-06-05', 100_000, 'demo-cat-occasion', '축의금 1');
    await add('2026-06-12', 50_000, 'demo-cat-occasion', '축의금 2');
    await add('2026-06-20', 30_000, 'demo-cat-gift', '선물');
    await add('2026-09-03', 400_000, 'demo-cat-occasion', '큰 축의금');
    // 12개월 창 밖은 안 보여요
    await add('2025-09-03', 999_000, 'demo-cat-occasion', '오래된 것');
    return r;
  }

  it('기록이 있는 달만 빗금 막대(따로 높이) + 범례 · 구간 글자, 잔액 막대는 없어요', async () => {
    const { card } = await renderImported();
    expect(within(card).getByRole('heading', { level: 2, name: /^지난 · 앞으로 12개월$/ })).toBeTruthy();
    const bars = within(card).getAllByTestId('ahead-spent-bar');
    expect(bars.map((b) => b.getAttribute('aria-label'))).toEqual(['6월 (통장 기록 전) 자세히 보기', '9월 (통장 기록 전) 자세히 보기']);
    expect(within(card).queryAllByTestId('ahead-past-bar')).toHaveLength(0);
    // 높이 기준은 쓴 돈 달 중 가장 많이 쓴 달 (9월 40만이 꽉, 6월 18만은 그 45%)
    const fills = bars.map((b) => parseFloat((within(b).getByTestId('ahead-spent-fill') as HTMLElement).style.height));
    expect(fills[1]).toBeGreaterThan(fills[0]!);
    expect(fills[0]! / fills[1]!).toBeCloseTo(0.45, 1);
    // 막대 위 금액
    expect(bars[0]!.textContent).toMatch(/^18만6/);
    expect(bars[1]!.textContent).toMatch(/^40만9/);
    expect(card.textContent).toContain('통장 기록 전 쓴 돈');
    expect(within(card).getByTestId('ahead-spent-seg').textContent).toBe('통장 기록 전 · 쓴 돈');
    expect(card.textContent).not.toContain('지난 달 실제 잔액');
    // 이번 달 칸은 그대로 · 칸은 쓴 돈 2 + 앞으로 12
    const all = within(within(card).getByRole('group', { name: '달 고르기' })).getAllByRole('button');
    expect(all).toHaveLength(14);
    expect(all[2]!.getAttribute('aria-label')).toBe('11월 (이번 달) 자세히 보기');
    // 화면 읽기 표: '쓴 돈' 열
    const table = within(card).getByRole('table', { name: '이벤트통장 시작 전 쓴 돈' });
    const rows = within(table).getAllByRole('row');
    expect(rows.map((r) => r.textContent)).toEqual(['달쓴 돈건수', '6월 (통장 기록 전)180,000원3건', '9월 (통장 기록 전)400,000원1건']);
  });

  it('누르면 \'○월 · 통장 기록 전\' · 쓴 돈 · 묶은 줄 · 정산 화면 링크, 잔액 · 예측 견주기는 없어요', async () => {
    const { card } = await renderImported();
    fireEvent.click(within(card).getByRole('button', { name: '6월 (통장 기록 전) 자세히 보기' }));
    const detail = within(card).getByTestId('ahead-spent-month');
    expect(within(detail).getByRole('heading', { level: 3, name: '6월 · 통장 기록 전' })).toBeTruthy();
    expect(within(detail).getByTestId('ahead-spent-total').textContent).toBe(`18만${formatWon(180_000)}`);
    const items = within(within(detail).getByRole('list', { name: '6월 쓴 돈' })).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([`경조사 · 2건15만${formatWon(150_000)}`, `선물3만${formatWon(30_000)}`]);
    expect(within(detail).getByRole('link', { name: /그 달 쓴 돈은 정산 화면에서/ }).getAttribute('href')).toBe('/plan/settle#paid');
    for (const word of ['시작 잔액', '끝 잔액', '들어온 돈', '그달 처음 예상', '예측 기록']) expect(detail.textContent).not.toContain(word);
    expect(within(card).queryByTestId('ahead-compare')).toBeNull();
    // 다음 달 버튼으로 9월 → 11월(이번 달)
    fireEvent.click(within(detail).getByRole('button', { name: '다음 달' }));
    expect(within(within(card).getByTestId('ahead-spent-month')).getByRole('heading', { level: 3, name: '9월 · 통장 기록 전' })).toBeTruthy();
    fireEvent.click(within(within(card).getByTestId('ahead-spent-month')).getByRole('button', { name: '다음 달' }));
    expect(within(within(card).getByTestId('ahead-month')).getByRole('heading', { level: 3, name: '11월 · 이번 달' })).toBeTruthy();
  });

  it('줄이 6개를 넘으면 5줄 + \'N건 더\'', async () => {
    const { h, card } = await renderCard();
    const cats = h.probe.ledger!.data!.categories.filter((c) => !c.deleted).slice(0, 8);
    expect(cats.length).toBe(8);
    for (const [i, c] of cats.entries()) {
      await act(async () => {
        await h.probe.ledger!.addExpense({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, amount: 10_000 * (i + 1), accountId: 'demo-acc-event', categoryId: c.id, memo: '' });
      });
    }
    fireEvent.click(within(card).getByRole('button', { name: '8월 (통장 기록 전) 자세히 보기' }));
    const detail = within(card).getByTestId('ahead-spent-month');
    expect(within(within(detail).getByRole('list', { name: '8월 쓴 돈' })).getAllByRole('listitem')).toHaveLength(5);
    fireEvent.click(within(detail).getByRole('button', { name: '3건 더' }));
    expect(within(within(detail).getByRole('list', { name: '8월 쓴 돈' })).getAllByRole('listitem')).toHaveLength(8);
  });
});
