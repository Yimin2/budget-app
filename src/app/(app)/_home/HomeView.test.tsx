// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatWon } from '@/domain';
import { HomeView } from './HomeView';
import { makeHarness } from './testUtils';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

afterEach(cleanup);

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
    expect(screen.getByRole('link', { name: /사도 돼\? 확인하기/ }).getAttribute('href')).toBe('/check');
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
    expect(rows).toHaveLength(living.items.length);
    expect(within(card).getAllByRole('progressbar')).toHaveLength(living.items.length);
    const food = living.items.find((i) => i.name === '식비')!;
    const foodRow = within(card).getByRole('progressbar', { name: '식비 사용' }).closest('li') as HTMLElement;
    expect(within(foodRow).getByText(formatWon(food.todayAvailable!))).toBeTruthy();
    const shopRow = within(card).getByRole('progressbar', { name: '쇼핑 사용' }).closest('li') as HTMLElement;
    expect(within(shopRow).getByText('한 달 한도')).toBeTruthy();
    expect(within(card).getByRole('link', { name: /예산 바꾸기/ }).getAttribute('href')).toBe('/budget#st-living');
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
    const foodRow = () => within(card).getByRole('progressbar', { name: '식비 사용' }).closest('li') as HTMLElement;
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
    const cafeRow = within(card).getByRole('progressbar', { name: '카페 사용' }).closest('li') as HTMLElement;
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

  it('이벤트통장 부족 알림 · 다가오는 일정 3개 · 최근 지출 5개', async () => {
    await renderHome();
    await screen.findByRole('region', { name: '오늘 써도 되는 돈' });
    expect(screen.getByText('2027년 4월에 이벤트통장이 300,000원 모자라요')).toBeTruthy();
    expect(screen.getByRole('link', { name: '대처하기' }).getAttribute('href')).toBe('/plan');

    const upcoming = screen.getByRole('list', { name: '다가오는 일정' });
    const items = within(upcoming).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain('명절 부모님 용돈');
    expect(items[1]!.textContent).toContain('제주 여행');

    const recent = screen.getByRole('region', { name: '최근 지출' });
    expect(within(recent).getAllByRole('listitem')).toHaveLength(5);
    // 작성자 이름(아바타)
    expect(within(recent).getAllByText(/민지|준호/).length).toBeGreaterThan(0);
  });

  it('자주 쓰는 지출을 누르면 바로 기록하고, 되돌리기로 지워요', async () => {
    const h = await renderHome();
    await screen.findByRole('region', { name: '오늘 써도 되는 돈' });
    const before = h.probe.ledger!.living!.spent;

    fireEvent.click(screen.getByRole('button', { name: '커피 4,500원 바로 기록하기' }));
    await screen.findByText('커피 4,500원 기록했어요');
    await waitFor(() => expect(h.probe.ledger!.living!.spent).toBe(before + 4_500));
    const recorded = h.probe.ledger!.data!.expenses.find((e) => e.memo === '커피' && e.date === '2026-11-20' && e.id.startsWith('demo-') === false);
    expect(recorded?.amount).toBe(4_500);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    });
    await screen.findByText('기록을 되돌렸어요');
    await waitFor(() => expect(h.probe.ledger!.living!.spent).toBe(before));
    expect(h.probe.ledger!.data!.expenses.find((e) => e.id === recorded!.id)?.deleted).toBe(true);
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
    expect(screen.getByText('다가오는 일정이 없어요.')).toBeTruthy();
    expect(screen.getByText(/아직 기록한 지출이 없어요/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '자주 쓰는 지출 추가' }).textContent).toContain('추가하기');
    expect(screen.queryByText(/이벤트통장이 .*모자라요/)).toBeNull();
  });

  it('이번 달 정산: 돌려줄 날이 된 청구가 있으면 홈에 한 줄 요약 → /plan/settle, 없으면 "이번 달 정산할 돈은 없어요" 한 줄, 청구가 없으면 숨겨요', async () => {
    const h = await renderHome();
    const card = await screen.findByRole('region', { name: '이번 달 정산' });
    expect(within(card).getByTestId('settlement-line').textContent).toMatch(/^이번 달 이벤트통장 쓴 돈 15만 \+ 예정 30만 · 들어올 돈 30만 · \d+\/\d+ 정산 30만$/);
    expect(screen.queryByRole('region', { name: '사람별 돌려받을 돈' })).toBeNull();
    expect(within(card).getByRole('link', { name: '정산하기' }).getAttribute('href')).toBe('/plan/settle');

    await act(async () => {
      await h.probe.ledger!.settleClaims(['demo-claim-jeju']);
    });
    expect(h.probe.ledger!.claims!.total).toBe(24_000);

    // 남은 청구는 아직 정산일 전 → 사람별 목록 카드 대신 같은 한 줄 카드
    await waitFor(() =>
      expect(within(screen.getByRole('region', { name: '이번 달 정산' })).getByTestId('settlement-line').textContent).toBe(
        '이번 달 이벤트통장 쓴 돈 45만 · 들어올 돈 30만 · 이번 달 정산할 돈은 없어요 · 다음 정산 12/1 2.4만',
      ),
    );
    const line = screen.getByRole('region', { name: '이번 달 정산' });
    expect(line.id).toBe('');
    expect(screen.queryByRole('region', { name: '사람별 돌려받을 돈' })).toBeNull();
    expect(within(line).getByRole('link', { name: '정산하기' }).getAttribute('href')).toBe('/plan/settle');
    expect(screen.queryByText(/저수지에 (쓸|줄) 돈|저수지에서 돌려받을|빌려 줄 돈/)).toBeNull();

    // 아직 안 돌려준 청구가 하나도 없으면 숨겨요
    const rest = h.probe.ledger!.claims!.pending.map((c) => c.expense.id);
    await act(async () => {
      await h.probe.ledger!.settleClaims(rest);
    });
    await waitFor(() => expect(screen.queryByRole('region', { name: '이번 달 정산' })).toBeNull());
    expect(screen.queryByRole('region', { name: '사람별 돌려받을 돈' })).toBeNull();
  });

  it('가계부를 고르지 않았으면 고르기로 안내해요', async () => {
    await renderHome({ autoStart: false });
    expect(await screen.findByRole('heading', { name: '가계부를 골라 주세요' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '가계부 고르기' }).getAttribute('href')).toBe('/start');
  });
});

describe('HomeView — 두 칸 배치와 읽는 순서', () => {
  const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it('넓은 화면(≥1280)은 이번 달 쓴 돈 · 최근 지출이 오른쪽 칸 이벤트통장 아래, 좁으면 이번 달 쓴 돈이 항목별 생활비 바로 아래', async () => {
    const original = window.matchMedia;
    const setWide = (wide: boolean) => {
      window.matchMedia = ((query: string) => ({
        matches: wide && query === '(min-width: 1280px)',
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    };
    try {
      setWide(true);
      const h = makeHarness({ couple: true });
      await act(async () => {
        render(<HomeView />, { wrapper: h.Wrapper });
      });
      const spent = await screen.findByRole('region', { name: '이번 달 쓴 돈 · 민지' });
      const items = screen.getByRole('region', { name: '항목별 생활비 · 민지' });
      const recent = screen.getByRole('region', { name: '최근 지출' });
      const event = screen.getByRole('region', { name: /이벤트통장/ });
      // 같은 오른쪽 칸: 이벤트통장 → 이번 달 쓴 돈 → 최근 지출 (DOM = 탭 순서)
      expect(spent.parentElement).toBe(event.parentElement);
      expect(recent.parentElement).toBe(event.parentElement);
      expect(items.parentElement).not.toBe(event.parentElement);
      expect(follows(event, spent) && follows(spent, recent)).toBe(true);
      cleanup();

      setWide(false);
      const h2 = makeHarness({ couple: true });
      await act(async () => {
        render(<HomeView />, { wrapper: h2.Wrapper });
      });
      const spent2 = await screen.findByRole('region', { name: '이번 달 쓴 돈 · 민지' });
      const items2 = screen.getByRole('region', { name: '항목별 생활비 · 민지' });
      const event2 = screen.getByRole('region', { name: /이벤트통장/ });
      const recent2 = screen.getByRole('region', { name: '최근 지출' });
      expect(spent2.parentElement).toBe(items2.parentElement);
      expect(follows(items2, spent2) && follows(spent2, event2) && follows(event2, recent2)).toBe(true);
    } finally {
      window.matchMedia = original;
    }
  });
});

describe('HomeView — 이번 달 쓴 돈 (부부 예시)', () => {
  const JUNHO = 'demo-acc-living-junho';

  it('항목별 생활비 아래에 보이는 사람의 기타 · 용돈과 이벤트통장, 사람을 바꾸면 따라가요', async () => {
    const h = makeHarness({ couple: true });
    await act(async () => {
      render(<HomeView />, { wrapper: h.Wrapper });
    });
    const card = await screen.findByRole('region', { name: '이번 달 쓴 돈 · 민지' });
    const items = screen.getByRole('region', { name: '항목별 생활비 · 민지' });
    expect(items.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // 민지: 기타 지출은 없고, 용돈은 제주 항공권 청구로 잔액 0원, 이벤트통장은 숙소 예약금 15만 + 항공권 청구 30만
    expect(within(card).queryByRole('link', { name: /기타/ })).toBeNull();
    expect(within(card).getByRole('link', { name: /용돈/ }).textContent).toContain('0원 썼어요 · 남은 돈 0원');
    const event = within(card).getByRole('link', { name: /이벤트통장/ });
    expect(event.textContent).toContain('45만 썼어요 · 적립 30만 · 잔액 45만');
    expect(event.getAttribute('href')).toBe('/plan');

    // 준호의 생활비 통장에 카테고리 없는 지출, 용돈 통장에 지출
    const ledger = () => h.probe.ledger!;
    await act(async () => {
      await ledger().addExpense({ date: '2026-11-20', amount: 23_400, accountId: JUNHO, categoryId: null, memo: '기타' });
      await ledger().addExpense({ date: '2026-11-20', amount: 40_000, accountId: 'demo-acc-allowance-junho', categoryId: null, memo: '용돈' });
    });
    fireEvent.click(screen.getByRole('radio', { name: '준호' }));
    const his = await screen.findByRole('region', { name: '이번 달 쓴 돈 · 준호' });
    const etc = within(his).getByRole('link', { name: /기타/ });
    expect(etc.textContent).toContain('23,400원 · 1건');
    expect(etc.getAttribute('href')).toBe(`/history?month=2026-11&account=${JUNHO}`);
    const allowance = within(his).getByRole('link', { name: /용돈/ });
    expect(allowance.textContent).toContain('4만 썼어요 · 남은 돈 18.6만');
    expect(allowance.getAttribute('href')).toBe('/history?tab=accounts&id=demo-acc-allowance-junho');
    expect(within(his).getByRole('link', { name: /이벤트통장/ }).textContent).toContain('45만 썼어요');
  });

  it('고정비 한 줄: 낸 돈 / 이번 달 전체 · 남은 결제 N건, 예산 고정 지출로 가고 사람을 따라가요', async () => {
    const h = makeHarness({ couple: true });
    await act(async () => {
      render(<HomeView />, { wrapper: h.Wrapper });
    });
    const card = await screen.findByRole('region', { name: '이번 달 쓴 돈 · 민지' });
    // 민지 11월: 회비 3만 · 통신비 6만 · 보험 12만 모두 오늘(20일)까지 결제
    const fixed = within(card).getByRole('link', { name: /고정비/ });
    expect(fixed.textContent).toContain('21만 / 21만 · 남은 결제 없어요');
    expect(fixed.getAttribute('href')).toBe('/budget#st-fixed');
    // 줄 순서: 고정비가 맨 위
    expect(within(card).getAllByRole('link')[0]).toBe(fixed);

    // 민지 통장에 28일 결제 고정비를 더하면 전체만 늘고 남은 결제 1건
    await act(async () => {
      await h.probe.ledger!.addFixed({
        name: '구독', amount: 15_000, accountId: 'demo-acc-living-minji', categoryId: null, dayOfMonth: 28, kind: 'bill',
        targetEmail: null, spread: 'daily', startMonth: '2026-11', endMonth: null,
      });
    });
    expect(within(card).getByRole('link', { name: /고정비/ }).textContent).toContain('21만 / 22.5만 · 남은 결제 1건');

    fireEvent.click(screen.getByRole('radio', { name: '준호' }));
    const his = await screen.findByRole('region', { name: '이번 달 쓴 돈 · 준호' });
    expect(within(his).getByRole('link', { name: /고정비/ }).textContent).toContain('83.5만 / 83.5만 · 남은 결제 없어요');
  });
});
