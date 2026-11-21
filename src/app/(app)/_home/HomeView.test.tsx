// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatWon, livingItemExpenses } from '@/domain';
import { HomeView } from './HomeView';
import { makeHarness } from './testUtils';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

afterEach(cleanup);

/** 항목별 생활비 카드의 펼치기 버튼: 글이 그 항목 이름으로 시작해요 */
function itemToggle(card: HTMLElement, name: string): HTMLElement {
  const btn = within(card)
    .getAllByRole('button')
    .find((b) => b.hasAttribute('aria-expanded') && (b.textContent ?? '').startsWith(name));
  if (!btn) throw new Error(`항목 없음: ${name}`);
  return btn;
}
/** 항목별 생활비 카드의 항목 한 줄(li) */
const itemRow = (card: HTMLElement, name: string) => itemToggle(card, name).closest('li') as HTMLElement;

async function renderHome(opts: { autoStart?: boolean } = {}) {
  const h = makeHarness(opts);
  // 체험 모드 시작(비동기)까지 act 안에서 끝내야 React 가 경고하지 않아요
  await act(async () => {
    render(<HomeView />, { wrapper: h.Wrapper });
  });
  return h;
}

describe('HomeView — 체험 가계부', () => {
  it('불러오는 동안 뼈대를 보여 주고, 다 불러오면 오늘 써도 되는 돈(하루씩 항목 합)을 크게 보여 줘요', async () => {
    const h = await renderHome();
    expect(screen.getByText('11월 20일 금요일')).toBeTruthy();
    const hero = await screen.findByRole('region', { name: '오늘 써도 되는 돈' });
    const living = h.probe.ledger!.living!;
    expect(living.todayAvailable).toBeGreaterThan(0);
    expect(within(hero).getByText(formatWon(living.todayAvailable))).toBeTruthy();
    expect(within(hero).getByText(formatWon(living.remaining))).toBeTruthy();
    expect(within(hero).getByText(`${living.daysLeft}일 남음`)).toBeTruthy();
    expect(within(hero).getByRole('progressbar', { name: '이번 달 생활비 사용' })).toBeTruthy();
    // 사도 돼? 는 홈에서 빠졌어요 (+ 버튼에서)
    expect(screen.queryByRole('link', { name: /사도 돼\? 확인하기/ })).toBeNull();
    // 큰 숫자 = 하루에 나눠 쓰는 항목(식비·카페·교통)의 오늘 써도 되는 돈 합
    const daily = living.items.filter((i) => i.spread === 'daily');
    expect(daily.map((i) => i.name)).toEqual(['식비', '카페', '교통']);
    expect(living.todayAvailable).toBe(daily.reduce((s, i) => s + (i.todayAvailable ?? 0), 0));
    expect(within(hero).getByText('식비 · 카페 · 교통 합계')).toBeTruthy();
  });

  it('항목별 생활비: 항목마다 막대 · 남은 돈 · 하루 항목은 오늘 써도 되는 돈', async () => {
    const h = await renderHome();
    const card = await screen.findByRole('region', { name: '항목별 생활비' });
    const living = h.probe.ledger!.living!;
    const rows = within(card).getAllByRole('listitem');
    // 생활비 항목 + 맨 아래 '이벤트' 한 줄 (이번 달 이벤트통장 쓴 돈 / 적립액, 누르면 이벤트 화면)
    expect(rows).toHaveLength(living.items.length + 1);
    const ev = within(card).getByTestId('living-event');
    expect(ev.textContent).toContain('이벤트');
    // 항목 한 줄 = 펼치기 버튼 (막대는 버튼 글과 같은 숫자라 화면 읽기에서 숨겨요)
    expect(within(card).getAllByRole('button').filter((b) => b.getAttribute('aria-expanded') === 'false')).toHaveLength(living.items.length + 1);
    expect(card.querySelectorAll('.bar')).toHaveLength(living.items.length + 1);
    const food = living.items.find((i) => i.name === '식비')!;
    const foodRow = itemRow(card, '식비');
    expect(within(foodRow).getByText(formatWon(food.todayAvailable!))).toBeTruthy();
    const shopRow = itemRow(card, '쇼핑');
    expect(within(shopRow).getByText('한 달 한도')).toBeTruthy();
    // 머리 링크는 예산이 아니라 이번 달 생활비 통장 내역 (예산 바꾸기는 예산 탭에서)
    expect(within(card).queryByRole('link', { name: /예산 바꾸기/ })).toBeNull();
    expect(within(card).getByRole('link', { name: /내역 보기/ }).getAttribute('href')).toBe(
      `/history?month=2026-11&account=${living.livingAccountId}`,
    );
  });

  it('하루 예산: 오늘 안 썼으면 써도 되는 돈만, 쓰면 오늘 쓴 돈과 함께, 넘으면 넘은 돈을 경고 색으로', async () => {
    const h = await renderHome();
    await screen.findByRole('region', { name: '오늘 써도 되는 돈' });
    const ledger = () => h.probe.ledger!;
    const dailyIds = new Set(ledger().living!.items.filter((i) => i.spread === 'daily').map((i) => i.categoryId));
    // 오늘 하루 항목 지출을 모두 지워 '0원' 상태로
    for (const e of ledger().data!.expenses.filter((x) => x.date === '2026-11-20' && !x.deleted && dailyIds.has(x.categoryId))) {
      await act(async () => {
        await ledger().deleteExpense(e.id);
      });
    }
    await waitFor(() => expect(ledger().living!.items.filter((i) => i.spread === 'daily').every((i) => i.spentToday === 0)).toBe(true));
    let hero = screen.getByRole('region', { name: '오늘 써도 되는 돈' });
    expect(within(hero).queryByText(/오늘 쓴 돈/)).toBeNull();
    let card = screen.getByRole('region', { name: '항목별 생활비' });
    const foodRow = () => itemRow(card, '식비');
    expect(within(foodRow()).queryByText(/오늘 쓴 돈/)).toBeNull();
    expect(within(foodRow()).getByText(/오늘 써도 되는 돈/)).toBeTruthy();

    const food = ledger().living!.items.find((i) => i.name === '식비')!;
    await act(async () => {
      await ledger().addExpense({ date: '2026-11-20', amount: 3_000, accountId: ledger().living!.livingAccountId!, categoryId: food.categoryId });
    });
    hero = screen.getByRole('region', { name: '오늘 써도 되는 돈' });
    expect(within(hero).getByText('오늘 쓴 돈').textContent).toContain('3,000원');
    card = screen.getByRole('region', { name: '항목별 생활비' });
    const after = ledger().living!.items.find((i) => i.name === '식비')!;
    expect(foodRow().textContent).toContain(`오늘 쓴 돈 ${formatWon(3_000)}·써도 되는 돈 ${formatWon(after.todayAvailable!)}`);
    // 다른 하루 항목(카페)은 안 썼으니 '오늘 써도 되는 돈'만
    const cafeRow = itemRow(card, '카페');
    expect(within(cafeRow).queryByText(/오늘 쓴 돈/)).toBeNull();

    // 넘으면 '오늘 ○원 넘었어요' (경고 색)
    await act(async () => {
      await ledger().addExpense({ date: '2026-11-20', amount: 500_000, accountId: ledger().living!.livingAccountId!, categoryId: food.categoryId });
    });
    card = screen.getByRole('region', { name: '항목별 생활비' });
    const overItem = ledger().living!.items.find((i) => i.name === '식비')!;
    expect(overItem.todayAvailable!).toBeLessThan(0);
    const warn = within(foodRow()).getByText(`오늘 ${formatWon(-overItem.todayAvailable!)} 넘었어요`);
    expect(warn.className).toMatch(/warn/);
    expect(foodRow().textContent).toContain(`오늘 쓴 돈 ${formatWon(503_000)}`);
  });

  it('자주 쓰는 지출: 최근에 자주 쓴 지출을 칩으로, 누르면 그 자리에서 금액만 고쳐 오늘 날짜로 기록하고 되돌리기로 지워요', async () => {
    const h = await renderHome();
    await screen.findByRole('region', { name: '오늘 써도 되는 돈' });
    const section = screen.getByRole('region', { name: '자주 쓰는 지출' });
    const chips = within(section).getAllByRole('button');
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.length).toBeLessThanOrEqual(6);
    // 가장 많이 쓴 커피가 맨 앞
    expect(chips[0]!.getAttribute('aria-label')).toBe('커피 4,500원 기록하기');
    const before = h.probe.ledger!.living!.spent;
    const count = h.probe.ledger!.data!.expenses.length;

    // 누르면 금액 팝업이 뜨고 가장 최근 금액이 들어 있어요
    expect(chips[0]!.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(chips[0]!);
    const dialog = await screen.findByRole('dialog', { name: '커피 기록' });
    const input = within(dialog).getByLabelText('금액') as HTMLInputElement;
    expect(input.value).toBe('4,500');
    expect(document.activeElement).toBe(input);
    expect(within(dialog).getByText(/카페 · .* · 오늘/)).toBeTruthy();
    // 금액을 지우면 확인
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));
    expect(within(dialog).getByText('금액을 입력해 주세요')).toBeTruthy();
    expect(h.probe.ledger!.data!.expenses).toHaveLength(count);

    fireEvent.change(input, { target: { value: '5200' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }));
    });
    await screen.findByText('커피 5,200원 기록했어요');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(h.probe.ledger!.living!.spent).toBe(before + 5_200));
    const recorded = h.probe.ledger!.data!.expenses.find((e) => !e.id.startsWith('demo-') && e.memo === '커피');
    expect(recorded).toMatchObject({ date: '2026-11-20', amount: 5_200, categoryId: 'demo-cat-cafe', accountId: h.probe.ledger!.myLivingAccountId });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    });
    await screen.findByText('기록을 되돌렸어요');
    await waitFor(() => expect(h.probe.ledger!.living!.spent).toBe(before));
    expect(h.probe.ledger!.data!.expenses.find((e) => e.id === recorded!.id)?.deleted).toBe(true);
  });

  it('자주 쓰는 지출 팝업: 취소 · Esc 로 닫고, 아무것도 기록하지 않아요', async () => {
    const h = await renderHome();
    await screen.findByRole('region', { name: '오늘 써도 되는 돈' });
    const section = screen.getByRole('region', { name: '자주 쓰는 지출' });
    const chip = within(section).getByRole('button', { name: '커피 4,500원 기록하기' });
    const count = h.probe.ledger!.data!.expenses.length;
    fireEvent.click(chip);
    const dialog = await screen.findByRole('dialog', { name: '커피 기록' });
    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(chip);
    await screen.findByRole('dialog', { name: '커피 기록' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(h.probe.ledger!.data!.expenses).toHaveLength(count);
  });
});

describe('HomeView — 새 가계부', () => {
  it('생활비를 안 정했으면 설정으로 안내하고, 빈 목록 문구를 보여 줘요', async () => {
    const h = await renderHome();
    await screen.findByRole('region', { name: '오늘 써도 되는 돈' });
    await act(async () => {
      await h.probe.session!.createLedger({ kind: 'shared', name: '새 가계부' });
    });
    const setup = await screen.findByRole('region', { name: '생활비 예산을 정해 주세요' });
    expect(within(setup).getByRole('link', { name: '생활비 정하기' }).getAttribute('href')).toBe('/budget#st-living');
    expect(screen.queryByRole('region', { name: '항목별 생활비' })).toBeNull();
    // 기록이 없으면 자주 쓰는 지출은 짧은 안내만 (예전에 등록한 즐겨찾기는 쓰지 않아요)
    const quick = screen.getByRole('region', { name: '자주 쓰는 지출' });
    expect(within(quick).queryAllByRole('button')).toHaveLength(0);
    expect(within(quick).getByText(/지출을 기록하면 자주 쓴 것을/)).toBeTruthy();
    expect(screen.queryByText(/이벤트통장이 .*모자라요/)).toBeNull();
  });

  it('가계부를 고르지 않았으면 고르기로 안내해요', async () => {
    await renderHome({ autoStart: false });
    expect(await screen.findByRole('heading', { name: '가계부를 골라 주세요' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '가계부 고르기' }).getAttribute('href')).toBe('/start');
  });
});

describe('HomeView — 항목별 생활비 펼쳐 보기 (부부 예시)', () => {
  const MINJI = 'demo-acc-living-minji';
  const amountOf = (b: HTMLElement) => Number((b.getAttribute('aria-label') ?? '').match(/([\d,]+)원 고치기$/)![1]!.replace(/,/g, ''));

  async function renderCouple() {
    const h = makeHarness({ couple: true });
    await act(async () => {
      render(<HomeView />, { wrapper: h.Wrapper });
    });
    const card = await screen.findByRole('region', { name: '항목별 생활비 · 민지' });
    return { h, card };
  }

  it('머리 링크는 민지 생활비 통장의 이번 달 내역, 예산 바꾸기는 없어요', async () => {
    const { card } = await renderCouple();
    expect(within(card).queryByRole('link', { name: /예산/ })).toBeNull();
    expect(within(card).getByRole('link', { name: /내역 보기/ }).getAttribute('href')).toBe(`/history?month=2026-11&account=${MINJI}`);
  });

  it('항목을 누르면 창 없이 그 아래로 이번 달 최근 지출 5건(새것부터)이 펼쳐지고, 더 있으면 전체 N건 보기. 여러 개를 함께 펼치고 다시 누르면 접혀요', async () => {
    const { h, card } = await renderCouple();
    const view = h.probe.ledger!.livingViews.find((v) => v.accountId === MINJI)!;
    const food = view.status.items.find((i) => i.name === '식비')!;
    const cafe = view.status.items.find((i) => i.name === '카페')!;
    const foodBtn = itemToggle(card, '식비');
    expect(foodBtn.tagName).toBe('BUTTON');
    expect(foodBtn.getAttribute('aria-expanded')).toBe('false');
    expect(foodBtn.hasAttribute('aria-controls')).toBe(false);

    fireEvent.click(foodBtn);
    expect(foodBtn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('dialog')).toBeNull();
    const panel = document.getElementById(foodBtn.getAttribute('aria-controls')!)!;
    expect(panel.getAttribute('aria-label')).toBe('이번 달 식비 지출');
    const expected = livingItemExpenses(h.probe.ledger!.data!, view.status, food);
    expect(expected.length).toBeGreaterThan(0);
    const rows = within(panel).getAllByRole('button', { name: /고치기$/ });
    expect(rows).toHaveLength(Math.min(5, expected.length));
    // 보이는 5건 = 최근 5건, 전체 합은 카드에 보이는 식비 쓴 돈
    expect(rows.reduce((s, b) => s + amountOf(b), 0)).toBe(expected.slice(0, 5).reduce((s, e) => s + e.amount, 0));
    expect(expected.reduce((s, e) => s + e.amount, 0)).toBe(food.spent);
    expect(itemRow(card, '식비').textContent).toContain(`${food.spent.toLocaleString('ko-KR')} / `);
    // 새것부터
    expect(rows[0]!.getAttribute('aria-label')).toContain(expected[0]!.amount.toLocaleString('ko-KR'));
    expect(expected.map((e) => e.date)).toEqual([...expected.map((e) => e.date)].sort().reverse());
    // 더 있으면 '식비 전체 N건 보기' (없으면 '식비 내역 보기')
    const more = expected.length > 5 ? `식비 전체 ${expected.length}건 보기` : '식비 내역 보기';
    expect(within(panel).getByRole('link', { name: more }).getAttribute('href')).toBe(
      `/history?month=2026-11&account=${MINJI}&category=${food.categoryId}`,
    );

    // 카페도 함께 펼쳐요
    const cafeBtn = itemToggle(card, '카페');
    fireEvent.click(cafeBtn);
    expect(foodBtn.getAttribute('aria-expanded')).toBe('true');
    expect(cafeBtn.getAttribute('aria-expanded')).toBe('true');
    const cafePanel = document.getElementById(cafeBtn.getAttribute('aria-controls')!)!;
    const cafeRows = within(cafePanel).queryAllByRole('button', { name: /고치기$/ });
    const cafeExpected = livingItemExpenses(h.probe.ledger!.data!, view.status, cafe);
    expect(cafeRows.reduce((s, b) => s + amountOf(b), 0)).toBe(cafeExpected.slice(0, 5).reduce((s, e) => s + e.amount, 0));

    // 다시 누르면 접혀요
    fireEvent.click(foodBtn);
    expect(foodBtn.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(panel.id)).toBeNull();
    expect(cafeBtn.getAttribute('aria-expanded')).toBe('true');
  });

  it('펼친 지출을 누르면 내역과 같은 지출 고치기 창이 그 지출로 열려요', async () => {
    const { h, card } = await renderCouple();
    const view = h.probe.ledger!.livingViews.find((v) => v.accountId === MINJI)!;
    const food = view.status.items.find((i) => i.name === '식비')!;
    const first = livingItemExpenses(h.probe.ledger!.data!, view.status, food)[0]!;
    fireEvent.click(itemToggle(card, '식비'));
    const row = within(card).getAllByRole('button', { name: /고치기$/ })[0]!;
    fireEvent.click(row);
    const dialog = await screen.findByRole('dialog', { name: '지출 고치기' });
    expect((within(dialog).getByLabelText(/^금액/) as HTMLInputElement).value.replace(/,/g, '')).toBe(String(first.amount));
    expect((within(dialog).getByLabelText(/통장/) as HTMLSelectElement).value).toBe(MINJI);
  });
});

describe('HomeView — 항목별 생활비의 이벤트 줄', () => {
  it('누르면 이번 달 이벤트통장 지출(여행 포함)이 펼쳐지고, 여행 지출에는 여행 표시가 붙어요', async () => {
    const h = await renderHome();
    const card = await screen.findByRole('region', { name: '항목별 생활비' });
    const ev = within(card).getByTestId('living-event');
    const toggle = within(ev).getAllByRole('button')[0]!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const panel = within(ev).getByRole('group', { name: '이번 달 이벤트통장 지출' });
    const d = h.probe.ledger!.data!;
    const acc = d.accounts.find((a) => a.role === 'event')!;
    const month = h.probe.ledger!.today.slice(0, 7);
    const mine = d.expenses.filter((e) => !e.deleted && e.accountId === acc.id && e.date.startsWith(month) && e.date <= h.probe.ledger!.today);
    if (mine.length === 0) expect(within(panel).getByText('이번 달 이벤트통장 지출이 없어요.')).toBeTruthy();
    else expect(within(panel).getAllByRole('button', { name: /고치기$/ }).length).toBe(mine.length);
    if (mine.some((e) => e.tripId)) expect(within(panel).getAllByRole('button', { name: /\(여행 .+\)/ }).length).toBeGreaterThan(0);
    expect(within(panel).getByRole('link', { name: /이벤트 화면 보기/ }).getAttribute('href')).toBe('/plan');
  });
});
