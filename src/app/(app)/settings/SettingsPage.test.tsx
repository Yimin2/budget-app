// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { current, renderApp, startDemo } from '../_components/__tests__/harness';

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => nav.router, usePathname: () => '/settings' }));

import BudgetPage from '../budget/page';
import SettingsPage from './page';
import { accountCard, card as headingCard, openIncoming, openOut, pickOwner } from '../budget/budgetTestUtils';

/** 설정과 예산을 한 번에 (예전 설정 화면 테스트를 그대로 써요) */
function Pages() {
  return (
    <>
      <SettingsPage />
      <BudgetPage />
    </>
  );
}

afterEach(cleanup);

/** 제목으로 카드 찾기. 예산 화면은 접힌 칸을 펼쳐서 (8-3: 배분은 통장 카드 들어오는 돈 줄, 고정비 · 할부 · 생활비는 통장 카드 안) */
function card(title: string): HTMLElement {
  if (title === '고정 지출') return openOut('고정지출통장', '고정비');
  if (title === '할부') return openOut('고정지출통장', '할부');
  if (title === '생활비 예산') return openOut('고정지출통장', '생활비 예산');
  return headingCard(title);
}

describe('설정 화면', () => {
  it('불러오는 동안 뼈대, 준비되면 섹션들', async () => {
    const h = renderApp(<Pages />);
    expect(screen.getByText('설정을 불러오는 중이에요')).toBeTruthy();
    expect(screen.getByText('예산을 불러오는 중이에요')).toBeTruthy();
    await startDemo(h);
    // 설정: 가계부 · 통장 · 멤버 · 기록 도우미 · 테마 · 계정
    for (const title of ['가계부와 통장', '가계부', '통장', '멤버 · 공유', '함께 쓰는 사람', '기록 도우미', '카테고리', '파일에서 가져오기', '테마', '계정 · 가계부 바꾸기', '정보']) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeTruthy();
    }
    // 자주 쓰는 지출은 홈에서 저절로 추천해요 (설정의 등록 카드 없음)
    expect(screen.queryByRole('heading', { level: 2, name: '자주 쓰는 지출' })).toBeNull();
    // 예산: 월급날 돈 흐름 → 통장별 들어오는 돈 · 나가는 돈 (차례 링크와 같은 순서, 8-3)
    const index = screen.getByRole('navigation', { name: '예산 차례' });
    expect(within(index).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['#bd-flow', '#bd-accounts']);
    for (const title of ['월급날 돈 흐름', '통장별 들어오는 돈 · 나가는 돈']) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeTruthy();
    }
    // 설정 화면의 예산 카드는 예산 화면에만 있어요

    // 사람별 수입통장마다 보내는 배분 합 = 그 사람 수입 → 경고 없음
    pickOwner('민지');
    expect(within(accountCard('민지 수입통장')).getByTestId('income-sent').textContent).toBe('매달 배분으로 보내는 돈 300만');
    pickOwner('준호');
    expect(within(accountCard('준호 수입통장')).getByTestId('income-sent').textContent).toBe('매달 배분으로 보내는 돈 200만');
    expect(screen.queryByText(/수입보다/)).toBeNull();
    expect(screen.getByRole('radiogroup', { name: '화면 테마' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '체험 데이터 처음으로 되돌리기' })).toBeTruthy();
  });

  it('매달 배분 금액 바꾸기 · 이름 바꾸기', async () => {
    const h = renderApp(<Pages />);
    await startDemo(h);

    // 매달 배분: 이벤트 적립 30만 → 35만 (이벤트통장 카드 들어오는 돈 줄에서 그 자리 고치기)
    pickOwner('함께');
    const editor = openIncoming('이벤트통장', /수입통장에서/);
    fireEvent.change(within(editor).getByLabelText('금액'), { target: { value: '350000' } });
    expect(within(editor).getByText(/새 금액을 적용해요/)).toBeTruthy();
    fireEvent.click(within(editor).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(document.getElementById(editor.id)).toBeNull());
    const eventRules = current(h).ledger.data!.rules.filter((r) => !r.deleted && r.toAccountId === 'demo-acc-event');
    expect(eventRules.map((r) => r.amount)).toContain(350_000);

    // 이름 바꾸기
    const ledgerCard = card('가계부');
    fireEvent.change(within(ledgerCard).getByLabelText('이름'), { target: { value: '우리 집' } });
    fireEvent.click(within(ledgerCard).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(current(h).ledger.data!.settings.name).toBe('우리 집'));
    expect(current(h).session.activeLedger?.name).toBe('우리 집');
  });

  it('고정 지출 이번 달까지만 · 카테고리 아이콘 바꾸기', async () => {
    const h = renderApp(<Pages />);
    await startDemo(h);

    const fixed = card('고정 지출');
    fireEvent.click(within(fixed).getByRole('button', { name: /통신비/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '이번 달까지만' }));
    const confirm = await screen.findByRole('dialog', { name: '이번 달까지만 쓸까요?' });
    fireEvent.click(within(confirm).getByRole('button', { name: '이번 달까지만' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(current(h).ledger.data!.fixedExpenses.find((f) => f.id === 'demo-fixed-phone')?.endMonth).toBe('2026-11');
    expect(within(card('고정 지출')).getByText('이번 달까지')).toBeTruthy();

    const cats = card('카테고리');
    fireEvent.click(within(cats).getByRole('button', { name: /^카페(?! 순서 바꾸기| 정리하기)/ }));
    const dialog = screen.getByRole('dialog', { name: '카테고리 고치기' });
    const icons = within(dialog).getByRole('radiogroup', { name: '아이콘' });
    expect(within(icons).getByRole('radio', { name: '커피' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(icons).getByRole('radio', { name: '반짝임' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(current(h).ledger.data!.categories.find((c) => c.id === 'demo-cat-cafe')?.icon).toBe('sparkles');
  });

  it('한 사람 수입통장만 넘치면 그 통장 이름으로 경고해요', async () => {
    const h = renderApp(<Pages />);
    await startDemo(h);
    pickOwner('함께');
    const editor = openIncoming('고정지출통장', /^\d+일 · 준호 수입통장에서/);
    fireEvent.change(within(editor).getByLabelText('금액'), { target: { value: '1000000' } });
    fireEvent.click(within(editor).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(document.getElementById(editor.id)).toBeNull());
    pickOwner('준호');
    expect(await within(accountCard('준호 수입통장')).findByText('준호 수입통장에서 보내는 돈이 수입보다 200,000원 많아요')).toBeTruthy();
    pickOwner('민지');
    expect(within(accountCard('민지 수입통장')).queryByText(/수입보다/)).toBeNull();
    expect(current(h).ledger.data).not.toBeNull();
  });

  it('다른 사람 수입통장 추가: 주인 이름으로 통장 이름을 지어요', async () => {
    const h = renderApp(<Pages />);
    await startDemo(h);
    fireEvent.click(within(card('통장')).getByRole('button', { name: '다른 사람 수입통장 추가' }));
    const dialog = screen.getByRole('dialog', { name: '수입통장 추가' });
    // 함께 쓰는 사람이 아니면 '직접 입력'으로 이름과 이메일을 적어요
    const owner = within(dialog).getByRole('combobox', { name: /^주인/ }) as HTMLSelectElement;
    expect([...owner.options].map((o) => o.text)).toEqual(['함께 쓰는 통장 (주인 없음)', '민지 · minji@demo', '준호 · junho@demo', '직접 입력']);
    fireEvent.change(owner, { target: { value: '__manual__' } });
    const manual = within(dialog).getByRole('group', { name: '주인 직접 입력' });
    fireEvent.change(within(manual).getByLabelText(/이름/), { target: { value: '서연' } });
    fireEvent.change(within(manual).getByLabelText(/이메일/), { target: { value: 'nope' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(within(dialog).getByText('이메일 주소를 확인해 주세요')).toBeTruthy();
    fireEvent.change(within(manual).getByLabelText(/이메일/), { target: { value: 'seo@x.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const added = current(h).ledger.data!.accounts.find((a) => a.name === '서연 수입통장');
    expect(added).toMatchObject({ role: 'income', ownerName: '서연', ownerEmail: 'seo@x.com' });
    expect(current(h).ledger.incomeAccounts).toHaveLength(3);
  });

  it('통장 주인: 함께 쓰는 사람을 고르면 이름과 이메일이 함께 채워져요', async () => {
    const h = renderApp(<Pages />);
    await startDemo(h);
    fireEvent.click(within(card('통장')).getByRole('button', { name: '통장 추가' }));
    const dialog = screen.getByRole('dialog', { name: '통장 추가' });
    fireEvent.change(within(dialog).getByLabelText(/^이름/), { target: { value: '여행 적금' } });
    const owner = within(dialog).getByRole('combobox', { name: /^주인/ }) as HTMLSelectElement;
    expect(owner.value).toBe('');
    fireEvent.change(owner, { target: { value: 'junho@demo' } });
    expect(within(dialog).queryByRole('group', { name: '주인 직접 입력' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const added = current(h).ledger.data!.accounts.find((a) => a.name === '여행 적금');
    expect(added).toMatchObject({ ownerName: '준호', ownerEmail: 'junho@demo' });
    // 목록에도 이름과 이메일이 함께 보여요
    expect(within(card('통장')).getByText('준호 · junho@demo')).toBeTruthy();
  });

  it('고정 지출: 용돈 탭 · 종류 없이 고정비 하나로 (용돈 행을 만들지 않아요)', async () => {
    const h = renderApp(<Pages />);
    await startDemo(h);
    const fixed = card('고정 지출');
    expect(within(fixed).queryByRole('heading', { name: '용돈' })).toBeNull();
    expect(within(fixed).getByRole('list', { name: '고정비' })).toBeTruthy();
    fireEvent.click(within(fixed).getByRole('button', { name: '고정 지출 추가' }));
    const dialog = screen.getByRole('dialog', { name: '고정 지출 추가' });
    expect(within(dialog).queryByRole('radio', { name: '용돈' })).toBeNull();
    expect(within(dialog).queryByRole('radiogroup', { name: '종류' })).toBeNull();
    expect(within(dialog).queryByRole('combobox', { name: /받는 사람/ })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/^이름/), { target: { value: '십일조' } });
    fireEvent.change(within(dialog).getByLabelText(/^금액/), { target: { value: '50000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(current(h).ledger.data!.fixedExpenses.find((f) => f.name === '십일조')).toMatchObject({ kind: 'bill', targetEmail: null });
    expect(current(h).ledger.data!.fixedExpenses.some((f) => f.kind === 'allowance')).toBe(false);
  });

  it('생활비 예산: 항목 추가 · 쓰는 방식 · 예전 생활비 한 줄을 항목으로 나누기', async () => {
    const h = renderApp(<Pages />);
    await startDemo(h);
    const living = card('생활비 예산');
    expect(within(living).getByRole('button', { name: /식비/ })).toBeTruthy();
    expect(within(living).queryByText('생활비를 항목별로 나눠 보세요')).toBeNull();

    // 항목 추가: 이미 있는 항목은 막고, 기타를 한 달 한도로 추가
    fireEvent.click(within(living).getByRole('button', { name: '생활비 항목 추가' }));
    let dialog = screen.getByRole('dialog', { name: '생활비 항목 추가' });
    fireEvent.change(within(dialog).getByLabelText(/항목/), { target: { value: 'demo-cat-food' } });
    fireEvent.change(within(dialog).getByLabelText(/한 달 예산/), { target: { value: '10000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(within(dialog).getByText('이미 예산이 있는 항목이에요')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/항목/), { target: { value: 'demo-cat-etc' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: '한 달 한도만' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const etc = current(h).ledger.data!.fixedExpenses.find((f) => f.kind === 'living' && f.categoryId === 'demo-cat-etc');
    expect(etc).toMatchObject({ name: '기타', amount: 10_000, spread: 'monthly', dayOfMonth: null, startMonth: '2026-11' });

    // 예전 방식: 항목을 모두 지우고 카테고리 없는 생활비 한 줄만 남기면 나누라고 안내해요
    const ledger = current(h).ledger;
    await act(async () => {
      for (const f of ledger.data!.fixedExpenses.filter((x) => x.kind === 'living')) {
        await current(h).ledger.saveFixed({ ...f, deleted: true });
      }
      await current(h).ledger.addFixed({
        name: '생활비', amount: 600_000, accountId: 'demo-acc-fixed', categoryId: null, dayOfMonth: null, kind: 'living',
        targetEmail: null, spread: 'daily', startMonth: '2026-10', endMonth: null,
      });
    });
    expect(current(h).ledger.living!.items.map((i) => i.name)).toEqual(['생활비']);
    const banner = await within(card('생활비 정리')).findByText('생활비를 항목별로 나눠 보세요');
    fireEvent.click(within(banner.closest('.banner') as HTMLElement).getByRole('button', { name: '항목으로 나누기' }));
    dialog = screen.getByRole('dialog', { name: '생활비를 항목으로 나눠요' });
    fireEvent.change(within(within(dialog).getByRole('group', { name: '식비' })).getByLabelText('한 달 예산'), { target: { value: '400000' } });
    fireEvent.change(within(within(dialog).getByRole('group', { name: '쇼핑' })).getByLabelText('한 달 예산'), { target: { value: '200000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '나누기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const after = current(h).ledger;
    const legacy = after.data!.fixedExpenses.find((f) => !f.deleted && f.kind === 'living' && f.categoryId === null)!;
    expect(legacy.endMonth).toBe('2026-10');
    // 예산 없는 카테고리(카페 등) 지출은 기타(예산 없음)로 모여요
    expect(after.living!.items.filter((i) => !i.unbudgeted).map((i) => [i.name, i.base, i.spread])).toEqual([
      ['식비', 400_000, 'daily'],
      ['쇼핑', 200_000, 'monthly'],
    ]);
    expect(after.living!.items.find((i) => i.unbudgeted)?.name).toBe('기타(예산 없음)');
    expect(screen.queryByText('생활비를 항목별로 나눠 보세요')).toBeNull();
  });

  it('할부: 회차 · 남은 금액을 보여 주고, 미리 갚으면 다음 회차부터 줄어요', async () => {
    const h = renderApp(<Pages />);
    await startDemo(h);
    const inst = card('할부');
    expect(within(inst).getByText('TV 할부')).toBeTruthy();
    expect(within(inst).getByText('16/24회차 · 남은 8회 · 남은 금액 800,000원')).toBeTruthy();
    expect(within(card('고정 지출')).queryByText('TV 할부')).toBeNull();

    fireEvent.click(within(inst).getByRole('button', { name: /TV 할부/ }));
    const dialog = screen.getByRole('dialog', { name: 'TV 할부' });
    fireEvent.click(within(dialog).getByRole('radio', { name: '미리 갚기' }));
    fireEvent.change(within(dialog).getByLabelText(/미리 갚을 금액/), { target: { value: '400000' } });
    expect(within(dialog).getByText(/갚고 나면 남은 4회/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '미리 갚기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(card('할부')).getByText('16/20회차 · 남은 4회 · 남은 금액 400,000원')).toBeTruthy();
    expect(current(h).ledger.data!.expenses.some((e) => e.memo === 'TV 할부 미리 갚기' && e.amount === 400_000)).toBe(true);
  });

  it('할부 고치기: 언제부터를 바꾸면 남은 회차도 그 달부터 다시 세서 전체 회차가 늘지 않아요', async () => {
    const h = renderApp(<Pages />);
    await startDemo(h);
    fireEvent.click(within(card('할부')).getByRole('button', { name: /TV 할부/ }));
    const dialog = screen.getByRole('dialog', { name: 'TV 할부' });
    fireEvent.change(within(dialog).getByLabelText(/언제부터/), { target: { value: '2027-02' } });
    expect((within(dialog).getByLabelText(/남은 회차/) as HTMLInputElement).value).toBe('6');
    fireEvent.change(within(dialog).getByLabelText(/^이름/), { target: { value: '거실 TV' } });
    expect(within(dialog).getByText(/전체 24회/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(current(h).ledger.installments.find((p) => p.id === 'demo-installment-tv')).toMatchObject({ count: 24, name: '거실 TV' });
  });

  it('끝난 할부도 열어서 지울 수 있어요', async () => {
    const h = renderApp(<Pages />);
    await startDemo(h);
    await act(async () => {
      await current(h).ledger.endInstallment('demo-installment-tv');
    });
    expect(within(card('할부')).getByText('16회 다 냈어요')).toBeTruthy();
    fireEvent.click(within(card('할부')).getByRole('button', { name: /TV 할부/ }));
    const view = screen.getByRole('dialog', { name: 'TV 할부' });
    fireEvent.click(within(view).getByRole('button', { name: '지우기' }));
    const confirm = await screen.findByRole('dialog', { name: '이 할부를 지울까요?' });
    fireEvent.click(within(confirm).getByRole('button', { name: '지우기' }));
    await waitFor(() => expect(current(h).ledger.installments.some((p) => p.id === 'demo-installment-tv')).toBe(false));
  });

  it('할부 추가: 총액과 개월로 매달 금액을 보여 줘요', async () => {
    const h = renderApp(<Pages />);
    await startDemo(h);
    fireEvent.click(within(card('할부')).getByRole('button', { name: '할부 추가' }));
    const dialog = screen.getByRole('dialog', { name: '할부 추가' });
    fireEvent.change(within(dialog).getByLabelText(/이름/), { target: { value: '노트북' } });
    fireEvent.change(within(dialog).getByLabelText(/^총액/), { target: { value: '1200000' } });
    expect(within(dialog).getByText(/매달 100,000원 · 총 1,200,000원/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '추가' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const plan = current(h).ledger.installments.find((p) => p.name === '노트북')!;
    expect(plan).toMatchObject({ count: 12, monthly: 100_000, remainingAmount: 1_200_000 });
  });
});
