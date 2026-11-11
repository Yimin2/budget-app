// @vitest-environment jsdom
/** 이벤트 화면 카드 2 '앞으로 12개월': 막대 · 고른 달 항목 · 다가오는 달 · 부족 알림 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { forecastCompare, formatManShort, formatWon, pastMonthEnds } from '@/domain';
import { EventsView } from './EventsView';
import { makeHarness } from './testHarness';
import { aheadTotalLines, aheadTotals, USUAL_BASIS_NOTE } from './selectors';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/plan',
}));

afterEach(cleanup);

async function renderCard(opts: { history?: boolean } = {}) {
  const h = makeHarness(opts);
  render(<EventsView />, { wrapper: h.Wrapper });
  const card = await screen.findByRole('region', { name: '앞으로 12개월' });
  return { h, card };
}

describe('앞으로 12개월 카드', () => {
  it('고른 달(처음엔 첫 부족 달)의 나갈 돈 항목과 그 달 끝 예상 잔액', async () => {
    const { h, card } = await renderCard();
    const april = h.probe.ledger!.eventProjection!.months.find((m) => m.month === '2027-04')!;
    const detail = within(card).getByTestId('ahead-month');
    expect(within(detail).getByRole('heading', { level: 3, name: '2027년 4월' })).toBeTruthy();
    const list = within(detail).getByRole('list', { name: '2027년 4월 나갈 돈' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(april.events.length);
    for (const e of april.events) expect(list.textContent).toContain(e.name);
    expect(detail.textContent).toContain(`그 달 끝 예상 잔액${formatWon(april.endBalance)}`);
    expect(detail.textContent).toContain(`${formatWon(-april.endBalance)} 모자라요`);
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
    expect(last.textContent).toBe(`평소 쓰는 돈 (${USUAL_BASIS_NOTE[dec.usualBasis ?? 'recent']})${formatWon(dec.usual)}`);
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
    expect(rows.every((r) => r.getAttribute('aria-pressed') === 'false')).toBe(true);
    fireEvent.click(rows[1]!);
    expect(rows[1]!.getAttribute('aria-pressed')).toBe('true');
    expect(within(card).getByRole('heading', { level: 3, name: '12월' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: '12월 자세히 보기' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(card).getByRole('link', { name: /지난 달 쓴 돈은 정산 화면에서/ }).getAttribute('href')).toBe('/plan/settle#paid');
    // 지난 달 쓴 돈 목록은 없어요 (정산 화면에 있어요)
    expect(within(card).queryByText('썼어요')).toBeNull();
    expect(screen.queryByRole('region', { name: '월별 이벤트 비용' })).toBeNull();
  });

  it('모자라는 달이 있으면 같은 카드 안에 부족 알림(두 가지 방법)', async () => {
    const { card } = await renderCard();
    const panel = within(card).getByRole('group', { name: /2027년 4월에 300,000원 모자라요/ });
    expect(within(panel).getByRole('heading', { level: 3, name: /2027년 4월에 300,000원 모자라요 \(결혼식 4건 · 어버이날\)/ })).toBeTruthy();
    expect(within(panel).getAllByRole('radio')).toHaveLength(2);
  });

  it('폰에서는 상태 한 줄만, [펼치기]로 막대 · 항목 (넓은 화면은 CSS 로 늘 펼침)', async () => {
    const { card } = await renderCard();
    expect(within(card).getByTestId('ahead-status').textContent).toMatch(/^12개월 중 1개월이 모자라요/);
    const toggle = within(card).getByRole('button', { name: '앞으로 12개월 펼치기' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const body = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(within(body).getByRole('group', { name: '달 고르기' })).toBeTruthy();
    expect(body.contains(within(card).getByTestId('ahead-status'))).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('고른 달 맨 위에 나갈 돈 합계(굵게): 앞으로 달은 합계, 이번 달은 이미 나간 돈 + 앞으로', async () => {
    const { h, card } = await renderCard();
    const proj = h.probe.ledger!.eventProjection!;
    const april = proj.months.find((m) => m.month === '2027-04')!;
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
    const list = within(repay).getByRole('list', { name: /지난 지출 돌려주기$/ });
    expect(within(list).getAllByRole('listitem')[0]!.textContent).toMatch(/^\d+월에 쓴 것 · 민지/);
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
    expect(detail.textContent).toContain(`시작 잔액${formatWon(oct.startBalance)}`);
    expect(detail.textContent).toContain(`들어온 돈+${formatWon(oct.inflow)}`);
    expect(detail.textContent).toContain(`나간 돈−${formatWon(oct.outflow)}`);
    expect(detail.textContent).toContain(`끝 잔액${formatWon(oct.endBalance)}`);
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
