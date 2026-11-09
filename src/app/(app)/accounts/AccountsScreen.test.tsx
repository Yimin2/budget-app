// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { current, renderApp, startDemo } from '../_components/__tests__/harness';

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
  params: new URLSearchParams(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/accounts',
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

    const list = screen.getByRole('heading', { name: '통장 5개' }).parentElement!;
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(5);
    expect(links[2]!.getAttribute('href')).toBe('/accounts?id=demo-acc-event');
    expect(links[2]!.textContent).toContain('이벤트통장');
    expect(links[2]!.textContent).toContain('900,000원');
    expect(links[1]!.textContent).toContain('생활비');
    // 수입통장: 이번 달 500만 들어오고 500만 나감
    expect(links[0]!.textContent).toContain('이번 달 들어온 돈5,000,000원');
    expect(links[0]!.textContent).toContain('나간 돈5,000,000원');

    const flow = screen.getByRole('complementary', { name: '매달 배분' });
    expect(within(flow).getByRole('img').getAttribute('aria-label')).toBe(
      '매달 배분: 고정지출통장 2,000,000원, 이벤트통장 300,000원, 저수지통장 1,200,000원, 저축투자통장 1,500,000원',
    );
    expect(within(flow).getByText('40%')).toBeTruthy(); // 고정지출 200만 / 수입 500만
    expect(within(flow).queryByText(/수입보다/)).toBeNull();
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
    expect(await within(flow).findByText('배분 합계가 수입보다 1,000,000원 많아요')).toBeTruthy();
    expect(within(flow).getByRole('link', { name: '배분 바꾸기' }).getAttribute('href')).toBe('/settings#st-rules');
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
    expect(current(h).ledger.balances['demo-acc-event']).toBe(1_100_000);
    expect(current(h).ledger.balances['demo-acc-reservoir']).toBe(6_200_000);
  });
});

describe('통장 상세', () => {
  it('잔액 · 기록(최신순, 기록마다 잔액) · 시작 잔액', async () => {
    await open('id=demo-acc-event');
    expect(await screen.findByRole('heading', { level: 1, name: '이벤트통장' })).toBeTruthy();
    expect(screen.getByText('지금 잔액').parentElement!.textContent).toContain('900,000원');
    const history = screen.getByRole('heading', { level: 2, name: '기록' }).closest('.card') as HTMLElement;
    const rows = within(history).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('매달 배분');
    expect(rows[0]!.textContent).toContain('수입통장에서');
    expect(rows[0]!.textContent).toContain('+300,000원');
    expect(rows[0]!.textContent).toContain('잔액 900,000원');
    expect(rows[1]!.textContent).toContain('시작 잔액');
    expect(screen.getByRole('link', { name: /이 통장 지출 보기/ }).getAttribute('href')).toBe('/expenses?account=demo-acc-event');
  });

  it('실제 잔액 맞추기: 차이를 미리 보여 주고 조정 기록을 남겨요', async () => {
    const h = await open('id=demo-acc-event');
    fireEvent.click(await screen.findByRole('button', { name: '실제 잔액 맞추기' }));
    const dialog = await screen.findByRole('dialog', { name: '실제 잔액 맞추기' });
    const submit = within(dialog).getByRole('button', { name: '잔액 맞추기' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/실제 잔액/), { target: { value: '900000' } });
    expect(within(dialog).getByText('기록과 같아요. 맞출 게 없어요.')).toBeTruthy();
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/실제 잔액/), { target: { value: '875000' } });
    expect(within(dialog).getByText('-25,000원')).toBeTruthy();
    expect(within(dialog).getByText("25,000원 줄이는 '조정' 기록을 남겨요.")).toBeTruthy();
    fireEvent.click(submit);
    await screen.findByText('이벤트통장 잔액을 875,000원으로 맞췄어요');
    expect(current(h).ledger.balances['demo-acc-event']).toBe(875_000);
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
    expect((within(dialog).getByLabelText(/받는 통장/) as HTMLSelectElement).value).toBe('demo-acc-event');
    fireEvent.change(within(dialog).getByLabelText(/금액/), { target: { value: '50000' } });
    fireEvent.change(within(dialog).getByLabelText(/메모/), { target: { value: '축의금 받음' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));
    await screen.findByText('이벤트통장에 50,000원 수입을 기록했어요');
    expect(current(h).ledger.balances['demo-acc-event']).toBe(950_000);
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
    await waitFor(() => expect(current(h).ledger.balances['demo-acc-event']).toBe(900_000 + fix.amount));
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
    expect(screen.getByRole('link', { name: '통장 목록 보기' }).getAttribute('href')).toBe('/accounts');
  });
});
