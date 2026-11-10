// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { current, renderApp, startDemo } from '../../_components/__tests__/harness';

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
  params: new URLSearchParams(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/history',
  useSearchParams: () => nav.params,
}));

import { AccountsScreen } from './AccountsScreen';

beforeEach(() => {
  nav.params = new URLSearchParams();
});
afterEach(cleanup);

const won = (n: number) => `${n.toLocaleString('en-US')}원`;

async function open(params = '') {
  nav.params = new URLSearchParams(params);
  const h = renderApp(<AccountsScreen />);
  expect(screen.getByText('통장을 불러오는 중이에요')).toBeTruthy();
  await startDemo(h);
  return h;
}

describe('통장 목록', () => {
  it('잔액 합계 · 통장 카드 · 매달 배분 흐름', async () => {
    const h = await open();
    const summary = await screen.findByRole('region', { name: '통장 잔액 합계' });
    const balances = current(h).ledger.balances;
    const total = Object.values(balances).reduce((s, v) => s + v, 0);
    expect(within(summary).getByText(won(total))).toBeTruthy();

    const list = screen.getByRole('heading', { name: '통장 6개' }).parentElement!;
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(6);
    expect(links[3]!.getAttribute('href')).toBe('/history?tab=accounts&id=demo-acc-event');
    expect(links[3]!.textContent).toContain('이벤트통장');
    // 시작 600,000 + 배분 300,000 − 제주 여행 숙소 예약금 150,000 (항공권은 민지 청구라 아직 안 빠짐)
    expect(links[3]!.textContent).toContain('750,000원');
    expect(links[2]!.textContent).toContain('생활비');
    // 사람별 수입통장: 민지 300만 · 준호 200만 들어오고 그만큼 나감
    // (체험 예시에서 민지가 제주 항공권 30만원을 개인 돈으로 내서 그만큼 더 나갔고, 돌려받을 돈으로 보여요)
    expect(links[0]!.textContent).toContain('민지 수입통장');
    expect(links[0]!.textContent).toContain('이번 달 들어온 돈3,000,000원');
    expect(links[0]!.textContent).toContain('나간 돈3,300,000원');
    expect(links[0]!.textContent).toContain('돌려받을 돈 300,000원이 있어요');
    expect(links[0]!.textContent).not.toContain('잔액이 마이너스예요');
    expect(links[1]!.textContent).toContain('준호 수입통장');
    // 준호는 1일에 낸 생활용품 8,000원을 돌려받아 그만큼 더 들어왔어요
    expect(links[1]!.textContent).toContain('이번 달 들어온 돈2,008,000원');

    const flow = screen.getByRole('complementary', { name: '매달 배분' });
    expect(within(flow).getByRole('img').getAttribute('aria-label')).toBe(
      '매달 배분: 고정지출통장 2,000,000원, 이벤트통장 300,000원, 저수지통장 1,200,000원, 저축투자통장 1,500,000원',
    );
    expect(within(flow).getByText('40%')).toBeTruthy(); // 고정지출 200만 / 수입 500만
    expect(within(flow).queryByText(/수입보다/)).toBeNull();
    expect(within(flow).getByText('수입통장 2개')).toBeTruthy();
    const sources = within(flow).getByRole('list', { name: '사람별 수입통장' });
    expect(within(sources).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '민지 수입통장배분 3,000,000원 · 수입 3,000,000원',
      '준호 수입통장배분 2,000,000원 · 수입 2,000,000원',
    ]);
  });

  it('배분이 수입보다 많으면 경고해요', async () => {
    const h = await open();
    await screen.findByRole('region', { name: '통장 잔액 합계' });
    await act(async () => {
      await current(h).ledger.addRule({
        fromAccountId: 'demo-acc-income',
        toAccountId: 'demo-acc-reservoir',
        amount: 1_000_000,
        dayOfMonth: 25,
        startMonth: '2026-11',
        endMonth: null,
      });
    });
    const flow = screen.getByRole('complementary', { name: '매달 배분' });
    expect(await within(flow).findByText('민지 수입통장에서 보내는 돈이 수입보다 1,000,000원 많아요')).toBeTruthy();
    expect(within(flow).queryByText(/준호 수입통장에서 보내는/)).toBeNull();
    expect(within(flow).getByRole('link', { name: '배분 바꾸기' }).getAttribute('href')).toBe('/budget#st-rules');
  });

  it('머리의 이체 기록: 통장끼리 옮긴 돈을 기록해요', async () => {
    const h = await open();
    await screen.findByRole('region', { name: '통장 잔액 합계' });
    fireEvent.click(screen.getByRole('button', { name: '이체 기록' }));
    const dialog = await screen.findByRole('dialog', { name: '이체 기록' });
    const from = within(dialog).getByRole('combobox', { name: /보내는 통장/ }) as HTMLSelectElement;
    const to = within(dialog).getByRole('combobox', { name: /받는 통장/ }) as HTMLSelectElement;
    expect(from.value).toBe('demo-acc-income');
    fireEvent.change(from, { target: { value: 'demo-acc-reservoir' } });
    fireEvent.change(to, { target: { value: 'demo-acc-reservoir' } });
    fireEvent.change(within(dialog).getByLabelText(/금액/), { target: { value: '200000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));
    expect(await within(dialog).findByText('보내는 통장과 다른 통장을 골라 주세요')).toBeTruthy();

    fireEvent.change(to, { target: { value: 'demo-acc-event' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));
    await screen.findByText('이벤트통장으로 200,000원 옮긴 기록을 남겼어요');
    expect(current(h).ledger.balances['demo-acc-event']).toBe(950_000);
    expect(current(h).ledger.balances['demo-acc-reservoir']).toBe(6_200_000);
  });
});

describe('통장 상세', () => {
  it('잔액 · 기록(최신순, 기록마다 잔액) · 시작 잔액', async () => {
    await open('id=demo-acc-event');
    expect(await screen.findByRole('heading', { level: 1, name: '이벤트통장' })).toBeTruthy();
    expect(screen.getByText('지금 잔액').parentElement!.textContent).toContain('750,000원');
    const history = screen.getByRole('heading', { level: 2, name: '기록' }).closest('.card') as HTMLElement;
    const rows = within(history).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain('제주 숙소 예약금');
    expect(rows[0]!.textContent).toContain('잔액 750,000원');
    expect(rows[1]!.textContent).toContain('매달 배분');
    expect(rows[1]!.textContent).toContain('수입통장에서');
    expect(rows[1]!.textContent).toContain('+300,000원');
    expect(rows[1]!.textContent).toContain('잔액 900,000원');
    expect(rows[2]!.textContent).toContain('시작 잔액');
    expect(screen.getByRole('link', { name: /이 통장 지출 보기/ }).getAttribute('href')).toBe('/history?account=demo-acc-event');
  });

  it('실제 잔액 맞추기: 차이를 미리 보여 주고 조정 기록을 남겨요', async () => {
    const h = await open('id=demo-acc-event');
    fireEvent.click(await screen.findByRole('button', { name: '실제 잔액 맞추기' }));
    const dialog = await screen.findByRole('dialog', { name: '실제 잔액 맞추기' });
    const submit = within(dialog).getByRole('button', { name: '잔액 맞추기' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/실제 잔액/), { target: { value: '750000' } });
    expect(within(dialog).getByText('기록과 같아요. 맞출 게 없어요.')).toBeTruthy();
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/실제 잔액/), { target: { value: '725000' } });
    expect(within(dialog).getByText('-25,000원')).toBeTruthy();
    expect(within(dialog).getByText("25,000원 줄이는 '조정' 기록을 남겨요.")).toBeTruthy();
    fireEvent.click(submit);
    await screen.findByText('이벤트통장 잔액을 725,000원으로 맞췄어요');
    expect(current(h).ledger.balances['demo-acc-event']).toBe(725_000);
    const adj = current(h).ledger.data!.transfers.find((t) => t.kind === 'adjustment')!;
    expect(adj).toMatchObject({ fromAccountId: 'demo-acc-event', toAccountId: null, amount: 25_000 });
    // 기록 맨 위에 조정
    const history = screen.getByRole('heading', { level: 2, name: '기록' }).closest('.card') as HTMLElement;
    expect(within(history).getAllByRole('listitem')[0]!.textContent).toContain('잔액 맞추기');
  });

  it('수입 기록: 이 통장으로 받은 돈', async () => {
    const h = await open('id=demo-acc-event');
    fireEvent.click(await screen.findByRole('button', { name: '수입 기록' }));
    const dialog = await screen.findByRole('dialog', { name: '수입 기록' });
    // 수입통장이 여럿이면 누구 수입인지 골라요 (사람별 수입통장이 앞에)
    const to = within(dialog).getByLabelText(/누구 수입인가요/) as HTMLSelectElement;
    expect(to.value).toBe('demo-acc-event');
    expect([...to.options].filter((o) => o.value).slice(0, 2).map((o) => o.textContent)).toEqual(['민지 수입통장 · minji@…', '준호 수입통장 · junho@…']);
    fireEvent.change(within(dialog).getByLabelText(/금액/), { target: { value: '50000' } });
    fireEvent.change(within(dialog).getByLabelText(/메모/), { target: { value: '축의금 받음' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));
    await screen.findByText('이벤트통장에 50,000원 수입을 기록했어요');
    expect(current(h).ledger.balances['demo-acc-event']).toBe(800_000);
    const t = current(h).ledger.data!.transfers.find((x) => x.memo === '축의금 받음')!;
    expect(t).toMatchObject({ kind: 'income', fromAccountId: null, toAccountId: 'demo-acc-event' });
  });

  it('예정 이체는 예정 표시, 눌러서 지우거나 옮겼어요로 완료', async () => {
    const h = await open('id=demo-acc-event');
    await screen.findByRole('heading', { level: 1, name: '이벤트통장' });
    const fix = current(h).ledger.shortageFix!.fromReservoir!;
    await act(async () => {
      await current(h).ledger.applyFromReservoir(fix);
    });
    const history = () => screen.getByRole('heading', { level: 2, name: '기록' }).closest('.card') as HTMLElement;
    const first = within(history()).getAllByRole('listitem')[0]!;
    expect(first.textContent).toContain('예정');
    expect(first.textContent).toContain('잔액에 아직 안 들어가요');

    fireEvent.click(within(first).getByRole('button'));
    let dialog = await screen.findByRole('dialog', { name: '이체 기록' });
    expect(within(dialog).getByRole('button', { name: '옮겼어요' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '지우기' }));
    dialog = await screen.findByRole('dialog', { name: '이 기록을 지울까요?' });
    fireEvent.click(within(dialog).getByRole('button', { name: '지우기' }));
    await screen.findByText('기록을 지웠어요');
    expect(current(h).ledger.data!.transfers.filter((t) => t.status === 'planned' && !t.deleted)).toHaveLength(0);

    // 다시 만들고 '옮겼어요'
    await act(async () => {
      await current(h).ledger.applyFromReservoir(fix);
    });
    fireEvent.click(within(within(history()).getAllByRole('listitem')[0]!).getByRole('button'));
    dialog = await screen.findByRole('dialog', { name: '이체 기록' });
    fireEvent.click(within(dialog).getByRole('button', { name: '옮겼어요' }));
    await screen.findByText('옮긴 기록을 남겼어요. 이제 잔액에 들어가요');
    await waitFor(() => expect(current(h).ledger.balances['demo-acc-event']).toBe(750_000 + fix.amount));
    const done = current(h).ledger.data!.transfers.find((t) => !t.deleted && t.amount === fix.amount && t.status === 'done' && t.fromAccountId === 'demo-acc-reservoir')!;
    expect(done.date).toBe('2026-11-20');
  });

  it('지출 기록을 누르면 지출 고치기 창', async () => {
    await open('id=demo-acc-fixed');
    await screen.findByRole('heading', { level: 1, name: '고정지출통장' });
    const history = screen.getByRole('heading', { level: 2, name: '기록' }).closest('.card') as HTMLElement;
    fireEvent.click(within(within(history).getAllByRole('listitem')[0]!).getByRole('button'));
    expect(await screen.findByRole('dialog', { name: '지출 고치기' })).toBeTruthy();
  });

  it('없는 통장이면 안내', async () => {
    await open('id=nope');
    expect(await screen.findByText('통장을 찾을 수 없어요')).toBeTruthy();
    expect(screen.getByRole('link', { name: '통장 목록 보기' }).getAttribute('href')).toBe('/history?tab=accounts');
  });
});
