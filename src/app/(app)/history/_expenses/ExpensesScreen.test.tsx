// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { current, renderApp, startDemo } from '../../_components/__tests__/harness';
import { listedAccounts, pickAccount } from '../../_components/__tests__/pickAccount';

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
  params: new URLSearchParams(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/history',
  useSearchParams: () => nav.params,
}));

import { ExpensesScreen } from './ExpensesScreen';

beforeEach(() => {
  nav.params = new URLSearchParams();
  nav.router.replace.mockClear();
});
afterEach(cleanup);

async function open(params = '') {
  nav.params = new URLSearchParams(params);
  const h = renderApp(<ExpensesScreen />);
  expect(screen.getByText('지출을 불러오는 중이에요')).toBeTruthy();
  await startDemo(h);
  await screen.findByRole('region', { name: '2026년 11월 지출 목록' });
  return h;
}

function list() {
  return screen.getByRole('region', { name: '2026년 11월 지출 목록' });
}

describe('지출 화면', () => {
  it('이달 합계(생활비/이벤트/고정비)와 날짜별 목록', async () => {
    const h = await open();
    const data = current(h).ledger.data!;
    const nov = data.expenses.filter((e) => !e.deleted && e.date.startsWith('2026-11'));
    const total = nov.reduce((s, e) => s + e.amount, 0);
    const summary = screen.getByRole('region', { name: '2026년 11월 지출 합계' });
    expect(within(summary).getByText(`${total.toLocaleString('en-US')}원`)).toBeTruthy();
    expect(within(summary).getByText(`${nov.length}건`)).toBeTruthy();
    for (const label of ['생활비', '이벤트', '고정비']) expect(within(summary).getByText(label)).toBeTruthy();
    expect(within(summary).getByText('1,500,000원')).toBeTruthy(); // 고정비 (월세·통신비·보험·용돈 1,400,000 + TV 할부 16회차 100,000)

    // 오늘(11/20) 묶음이 맨 위, 오늘 표시
    const days = within(list()).getAllByRole('heading', { level: 3 });
    expect(days[0]!.textContent).toBe('11월 20일 금요일오늘');
    expect(days[days.length - 1]!.textContent).toContain('11월 1일');
    // 고정 지출 자동 기록 표시
    expect(within(list()).getAllByText('자동').length).toBeGreaterThan(0);
    // 다른 달이 없으니 이전/다음 달은 못 눌러요
    expect((screen.getByRole('button', { name: '이전 달' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '다음 달' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('지출 추가: 카테고리를 고르면 통장이 따라 바뀌고, 기록하면 목록에 보여요', async () => {
    const h = await open();
    fireEvent.click(screen.getAllByRole('button', { name: '지출 추가' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: '지출 기록' });

    // 금액 없이 기록하면 오류
    fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));
    expect(await within(dialog).findByText('금액을 입력해 주세요')).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText(/금액/), { target: { value: '230000' } });
    const account = within(dialog).getByLabelText(/^통장/) as HTMLSelectElement;
    expect(account.value).toBe('demo-acc-fixed');
    // 지출 통장은 모든 통장에서 골라요 (청구할 수 없는 통장은 기록할 때 알려 줘요)
    expect(listedAccounts(account)).toHaveLength(current(h).ledger.activeAccounts.length);
    fireEvent.keyDown(within(dialog).getByRole('listbox'), { key: 'Escape' });
    // 생활비 통장이면 생활비 카테고리 6개가 먼저, 이벤트 카테고리는 [더 보기] 안에
    expect(within(dialog).queryByRole('button', { name: '여행' })).toBeNull();
    const more = within(dialog).getByRole('button', { name: /더 보기/ });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(within(dialog).getByRole('button', { name: '여행' }));
    expect(account.value).toBe('demo-acc-event');
    expect(within(dialog).getByText('여행 카테고리에 맞춰 골랐어요')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/내용/), { target: { value: '숙소 예약' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));

    await screen.findByText('숙소 예약 230,000원 기록했어요');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const added = current(h).ledger.data!.expenses.find((e) => e.memo === '숙소 예약')!;
    expect(added).toMatchObject({ amount: 230_000, accountId: 'demo-acc-event', categoryId: 'demo-cat-travel', date: '2026-11-20' });
    // 모바일 제목 · 데스크톱 내용 열 (화면 크기에 따라 하나만 보여요)
    expect(within(list()).getAllByText('숙소 예약').length).toBeGreaterThan(0);
    // 이벤트 합계에 들어가요 (체험 예시의 이벤트통장 지출 — 개인 돈으로 낸 제주 항공권 · 제주 숙소 예약금 — 과 함께)
    const eventTotal = current(h)
      .ledger.data!.expenses.filter((e) => !e.deleted && e.date.startsWith('2026-11') && e.accountId === 'demo-acc-event')
      .reduce((s, e) => s + e.amount, 0);
    expect(eventTotal).toBe(680_000);
    const summary = screen.getByRole('region', { name: '2026년 11월 지출 합계' });
    expect(within(summary).getByText('680,000원')).toBeTruthy();
  });

  it('개인 돈으로 냈어요: 생활비는 다음 월급날에 돌려받고, 목록에 표시돼요', async () => {
    const h = await open();
    fireEvent.click(screen.getAllByRole('button', { name: '지출 추가' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: '지출 기록' });
    fireEvent.change(within(dialog).getByLabelText(/금액/), { target: { value: '18000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '식비' }));
    fireEvent.change(within(dialog).getByLabelText(/내용/), { target: { value: '반찬' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /개인 돈으로 냈어요/ }));
    fireEvent.change(within(dialog).getByLabelText(/누가 냈나요/), { target: { value: '준호' } });
    expect(within(dialog).getByText('준호가 12월 1일에 18,000원 돌려받아요')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));
    await screen.findByText('반찬 18,000원 기록했어요 · 준호가 12월 1일에 18,000원 돌려받아요');
    const added = current(h).ledger.data!.expenses.find((e) => e.memo === '반찬')!;
    expect(added).toMatchObject({ accountId: 'demo-acc-fixed', paidBy: '준호', claimDue: '2026-12-01' });
    expect(within(list()).getAllByText('준호 돌려받기 전').length).toBeGreaterThan(0);
  });

  it('낸 사람은 멤버만 고를 수 있고, 예전 청구에 적힌 다른 이름은 그 지출을 고칠 때 보여요', async () => {
    const h = await open();
    await act(async () => {
      await current(h).ledger.addExpense({
        date: '2026-11-20', amount: 9_000, accountId: 'demo-acc-fixed', categoryId: null, memo: '예전 청구', paidBy: '가온',
      });
    });
    expect(current(h).ledger.claimPayers).toEqual(['민지', '준호']);
    const row = within(list()).getAllByText('예전 청구')[0]!.closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button'));
    const dialog = await screen.findByRole('dialog', { name: '지출 고치기' });
    const payer = within(dialog).getByLabelText(/누가 냈나요/) as HTMLSelectElement;
    expect(payer.value).toBe('가온');
    const names = () => [...payer.options].filter((o) => !o.disabled).map((o) => o.value);
    expect(names()).toEqual(['민지', '준호', '가온']);
    // 다른 사람으로 바꿔도 원래 이름은 목록에 남아 되돌릴 수 있어요
    fireEvent.change(payer, { target: { value: '준호' } });
    expect(names()).toEqual(['민지', '준호', '가온']);
  });

  it('개인 돈으로 냈어요를 고른 채 청구할 수 없는 통장으로 바꾸면 기록하지 않고 알려 줘요', async () => {
    const h = await open();
    const before = current(h).ledger.data!.expenses.length;
    fireEvent.click(screen.getAllByRole('button', { name: '지출 추가' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: '지출 기록' });
    fireEvent.change(within(dialog).getByLabelText(/금액/), { target: { value: '18000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '식비' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /개인 돈으로 냈어요/ }));
    pickAccount(within(dialog).getByLabelText(/^통장/), 'demo-acc-savings');
    fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));
    expect(await within(dialog).findByText('개인 돈으로 낸 지출은 이벤트통장 · 고정지출통장 · 저수지통장 중에서 골라 주세요')).toBeTruthy();
    expect(current(h).ledger.data!.expenses).toHaveLength(before);
    // 체크를 끄면 보통 지출로 기록할 수 있어요
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /개인 돈으로 냈어요/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));
    await waitFor(() => expect(current(h).ledger.data!.expenses).toHaveLength(before + 1));
  });

  it('일정과 여행은 하나만 연결해요', async () => {
    const h = await open();
    fireEvent.click(screen.getAllByRole('button', { name: '지출 추가' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: '지출 기록' });
    fireEvent.change(within(dialog).getByLabelText(/이벤트 일정 연결/), { target: { value: 'demo-event-holiday' } });
    fireEvent.change(within(dialog).getByLabelText(/^여행/), { target: { value: 'demo-trip-jeju' } });
    expect((within(dialog).getByLabelText(/이벤트 일정 연결/) as HTMLSelectElement).value).toBe('');
    fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const added = current(h).ledger.data!.expenses.find((e) => e.memo === '명절 부모님 용돈')!;
    expect(added).toMatchObject({ tripId: 'demo-trip-jeju', eventId: null });
    expect(current(h).ledger.data!.events.find((e) => e.id === 'demo-event-holiday')!.status).toBe('planned');
  });

  it('일정을 연결하면 금액·내용을 채우고, 일정을 완료로 바꿔요', async () => {
    const h = await open();
    fireEvent.click(screen.getAllByRole('button', { name: '지출 추가' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: '지출 기록' });
    fireEvent.change(within(dialog).getByLabelText(/이벤트 일정 연결/), { target: { value: 'demo-event-holiday' } });
    expect((within(dialog).getByLabelText(/금액/) as HTMLInputElement).value).toBe('400,000');
    expect((within(dialog).getByLabelText(/내용/) as HTMLInputElement).value).toBe('명절 부모님 용돈');
    expect((within(dialog).getByLabelText(/^통장/) as HTMLSelectElement).value).toBe('demo-acc-event');
    expect((within(dialog).getByRole('checkbox', { name: /완료로 바꿔요/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));
    await screen.findByText('명절 부모님 용돈 400,000원 기록하고 일정을 완료했어요');
    const data = current(h).ledger.data!;
    expect(data.events.find((e) => e.id === 'demo-event-holiday')!.status).toBe('done');
    expect(data.expenses.find((e) => e.eventId === 'demo-event-holiday')!.amount).toBe(400_000);
  });

  it('예외 (평소 지출 아님): 이벤트통장 지출에서 켜고 끌 수 있고, 목록에 표시돼요', async () => {
    const h = await open();
    fireEvent.click(screen.getAllByRole('button', { name: '지출 추가' })[0]!);
    let dialog = await screen.findByRole('dialog', { name: '지출 기록' });
    fireEvent.change(within(dialog).getByLabelText(/금액/), { target: { value: '500000' } });
    // 생활비 통장 지출에는 보이지 않아요
    expect(within(dialog).queryByRole('checkbox', { name: /예외 \(평소 지출 아님\)/ })).toBeNull();
    pickAccount(within(dialog).getByLabelText(/^통장/), 'demo-acc-event');
    fireEvent.change(within(dialog).getByLabelText(/내용/), { target: { value: '친구 결혼식' } });
    const toggle = within(dialog).getByRole('checkbox', { name: /예외 \(평소 지출 아님\)/ }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));
    await screen.findByText('친구 결혼식 500,000원 기록했어요');
    const added = current(h).ledger.data!.expenses.find((e) => e.memo === '친구 결혼식')!;
    expect(added).toMatchObject({ accountId: 'demo-acc-event', excluded: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(list()).getAllByText('예외').length).toBeGreaterThan(0);

    // 고칠 때 끄면 평소 지출로 돌아가요
    const row = within(list()).getAllByText('친구 결혼식')[0]!.closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button'));
    dialog = await screen.findByRole('dialog', { name: '지출 고치기' });
    const again = within(dialog).getByRole('checkbox', { name: /예외 \(평소 지출 아님\)/ }) as HTMLInputElement;
    expect(again.checked).toBe(true);
    fireEvent.click(again);
    fireEvent.click(within(dialog).getByRole('button', { name: '저장하기' }));
    await screen.findByText('지출을 고쳤어요');
    expect(current(h).ledger.data!.expenses.find((e) => e.id === added.id)!.excluded).toBeUndefined();
  });

  it('작성자 필터 · 필터 지우기 · 조건에 맞는 지출이 없을 때', async () => {
    const h = await open();
    fireEvent.click(screen.getByRole('button', { name: '필터' }));
    const group = screen.getByRole('group', { name: '작성자' });
    fireEvent.click(within(group).getByRole('button', { name: '준호' }));
    const junho = current(h).ledger.data!.expenses.filter(
      (e) => !e.deleted && e.date.startsWith('2026-11') && e.author === 'junho@demo',
    );
    expect(within(list()).getAllByRole('listitem')).toHaveLength(junho.length);
    expect(screen.getByText('2026년 11월 지출 (필터 적용)')).toBeTruthy();

    // 이벤트통장 + 준호 → 없음
    fireEvent.click(within(screen.getByRole('group', { name: '통장' })).getByRole('button', { name: '이벤트통장' }));
    expect(await screen.findByText('조건에 맞는 지출이 없어요')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '필터 지우기' }));
    expect(screen.queryByText('조건에 맞는 지출이 없어요')).toBeNull();
    expect(screen.getByRole('button', { name: '필터' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('누르면 고치고, 지우기는 한 번 더 확인해요', async () => {
    const h = await open();
    const firstRow = within(list()).getAllByRole('listitem')[0]!;
    const target = current(h).ledger.data!.expenses
      .filter((e) => !e.deleted && e.date === '2026-11-20')
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1))[0]!;
    fireEvent.click(within(firstRow).getByRole('button'));
    let dialog = await screen.findByRole('dialog', { name: '지출 고치기' });
    const amount = within(dialog).getByLabelText(/금액/) as HTMLInputElement;
    expect(amount.value).toBe(target.amount.toLocaleString('en-US'));

    fireEvent.change(amount, { target: { value: '12345' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장하기' }));
    await screen.findByText('지출을 고쳤어요');
    expect(current(h).ledger.data!.expenses.find((e) => e.id === target.id)!.amount).toBe(12_345);

    fireEvent.click(within(within(list()).getAllByRole('listitem')[0]!).getByRole('button'));
    dialog = await screen.findByRole('dialog', { name: '지출 고치기' });
    fireEvent.click(within(dialog).getByRole('button', { name: '지우기' }));
    dialog = await screen.findByRole('dialog', { name: '이 지출을 지울까요?' });
    expect(document.activeElement?.textContent).toBe('취소');
    fireEvent.click(within(dialog).getByRole('button', { name: '지우기' }));
    await screen.findByText('지출을 지웠어요');
    expect(current(h).ledger.data!.expenses.find((e) => e.id === target.id)!.deleted).toBe(true);

    // 되돌리기
    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    await screen.findByText('지출을 되살렸어요');
    expect(current(h).ledger.data!.expenses.find((e) => e.id === target.id)!.deleted).toBe(false);
  });

  it('?month= 로 다른 달을 열면 빈 상태, ?new=1 이면 기록 창을 열고 주소에서 지워요', async () => {
    nav.params = new URLSearchParams('month=2026-10&new=1');
    const h = renderApp(<ExpensesScreen />);
    await startDemo(h);
    expect(await screen.findByText('2026년 10월에 기록한 지출이 없어요')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: '지출 기록' })).toBeTruthy();
    expect(nav.router.replace).toHaveBeenCalledWith('/history?month=2026-10', { scroll: false });
    // 10월에서는 다음 달(11월)로 갈 수 있어요
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    fireEvent.click(screen.getByRole('button', { name: '다음 달' }));
    expect(await screen.findByRole('region', { name: '2026년 11월 지출 목록' })).toBeTruthy();
  });
});
