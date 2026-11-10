// @vitest-environment jsdom
/* 예산 화면 시각화 (작업정리 8-3): 월급날 돈 흐름 · 통장별 들어오는 돈 / 나가는 돈 · 펼치기 · 그 자리 고치기 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { current, renderApp, startDemo } from '../_components/__tests__/harness';
import { listedAccounts } from '../_components/__tests__/pickAccount';

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => nav.router, usePathname: () => '/budget' }));

import { dateInMonth, formatMan, monthOf, paydayPlans, windowNeed } from '@/domain';
import BudgetPage from './page';
import { accountCard, openOut } from './budgetTestUtils';
import { accountMoney, paydayFlows } from './flow';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

/** 흐름 그림 한 장(월급날)의 막대 이름 */
function flowLabels(day: number): string[] {
  const fig = screen.getByRole('heading', { level: 3, name: `${day}일 월급날` }).closest('section') as HTMLElement;
  return Array.from(fig.querySelectorAll('ol li > span:first-child')).map((x) => x.textContent ?? '');
}

describe('예산 — 월급날 돈 흐름 (8-3)', () => {
  it('월급날마다 월급통장 → 각 통장 막대, 금액은 월급날 미리보기와 같아요 · 표로도 읽혀요', async () => {
    const h = renderApp(<BudgetPage />, { couple: true });
    await startDemo(h);
    expect(screen.getAllByTestId('payday-flow')).toHaveLength(2);
    expect(flowLabels(21)).toEqual(['민지 생활비 90만', '준호 생활비 110만', '이벤트 30만', '저수지 남는 돈 90만']);
    expect(flowLabels(25)).toEqual(['민지 용돈 40만', '준호 용돈 35만', '저축투자 100만', '저수지 남는 돈 105만']);
    expect(screen.getByText('월급통장에 320만 들어와요 (민지)')).toBeTruthy();

    // 금액 = 월급날 미리보기 (paydayPlans) 그대로
    const data = current(h).ledger.data!;
    const month = monthOf(current(h).ledger.today);
    const plans = paydayPlans(data, month, 'demo-acc-income');
    for (const f of paydayFlows(data, month)) {
      const p = plans.find((x) => x.day === f.day)!;
      expect(f.bars.map((b) => b.amount)).toEqual([...p.fixed, ...p.auto].map((l) => l.amount).concat(p.remainder ? [p.remainder.amount] : []));
    }

    // 화면 읽기 프로그램용 표 (그림은 aria-hidden)
    const table = screen.getByRole('table', { name: /21일 월급날 돈 흐름/ });
    const rows = within(table).getAllByRole('row').slice(1).map((r) => Array.from(r.children).map((c) => c.textContent));
    expect(rows).toEqual([
      ['민지 생활비', '900,000원', '매달 같은 금액'],
      ['준호 생활비', '1,100,000원', '매달 같은 금액'],
      ['이벤트', '300,000원', '매달 같은 금액'],
      ['저수지', '900,000원', '남는 돈 전부'],
    ]);
  });

  it("알아서 맞추기로 바꾸면 막대에 '(자동)'과 그 기간 필요한 금액 · 남는 돈이 그만큼 바뀌어요", async () => {
    const h = renderApp(<BudgetPage />, { couple: true });
    await startDemo(h);
    const rule = current(h).ledger.data!.rules.find((r) => r.toAccountId === 'demo-acc-living-minji')!;
    await act(async () => {
      await current(h).ledger.saveRule({ ...rule, kind: 'auto', amount: 0 });
    });
    const data = current(h).ledger.data!;
    const month = monthOf(current(h).ledger.today);
    const need = windowNeed(data, 'demo-acc-living-minji', dateInMonth(month, 21), 21).total;
    const labels = flowLabels(21);
    expect(labels).toContain(`민지 생활비 ${formatMan(need)} (자동)`);
    const rest = 3_200_000 - 1_100_000 - 300_000 - need;
    expect(labels).toContain(`저수지 남는 돈 ${formatMan(rest)}`);
  });

  it('흐름 그림은 보기만: [배분 고치기] 단추와 펼친 목록이 없고, #st-rules 로 들어오면 처음 탭 생활비 통장의 들어오는 돈으로 가요', async () => {
    window.location.hash = '#st-rules';
    const h = renderApp(<BudgetPage />, { couple: true });
    await startDemo(h);
    expect(screen.queryByRole('button', { name: /배분 고치기|배분 보기/ })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: '매달 배분' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: '수입 계획' })).toBeNull();
    const target = document.getElementById('st-rules')!;
    expect(target.getAttribute('aria-label')).toBe('생활비(민지) 들어오는 돈');
    await waitFor(() => expect(document.activeElement).toBe(target));
  });
});

describe('예산 — 통장별 들어오는 돈 · 나가는 돈 (8-3)', () => {
  it('사람 탭마다 통장 카드: 들어오는 돈(날짜 · 금액)과 나가는 돈 합(고정비 · 할부 · 생활비 예산)이 배분 기간 계산과 같아요', async () => {
    const h = renderApp(<BudgetPage />, { couple: true });
    await startDemo(h);
    // 사람 탭: 민지 · 준호 · 함께 (모두 없음), 처음은 나
    const tabs = screen.getByRole('radiogroup', { name: '누구 통장' });
    expect(within(tabs).getAllByRole('radio').map((r) => r.textContent)).toEqual(['민지', '준호', '함께']);
    expect(screen.getAllByTestId('account-card').map((c) => within(c).getByRole('heading', { level: 3 }).textContent)).toEqual([
      '생활비(민지)',
      '용돈(민지)',
    ]);

    const data = current(h).ledger.data!;
    const today = current(h).ledger.today;
    const month = monthOf(today);
    const m = accountMoney(data, 'demo-acc-living-minji', month, today);
    const need = windowNeed(data, 'demo-acc-living-minji', dateInMonth(month, 21), 21);
    expect(m).toMatchObject({ bills: need.bills, installments: need.installments, living: need.living, outgoingTotal: need.total, incomingTotal: 900_000 });
    const minji = accountCard('생활비(민지)');
    expect(within(minji).getByTestId('incoming-summary').textContent).toBe('한 달 90만');
    // 들어오는 돈 줄: 날짜 · 보내는 통장 · 금액 · 방식 (누르면 그 자리에서 고쳐요)
    const inRows = within(minji).getAllByTestId('incoming-row');
    expect(inRows).toHaveLength(1);
    expect(inRows[0]!.tagName).toBe('BUTTON');
    expect(inRows[0]!.textContent).toBe('21일 · 월급통장에서매달 같은 금액90만');
    expect(within(minji).getByTestId('outgoing-total').textContent).toMatch(new RegExp(`^${formatMan(need.total).replace('.', '\\.')} · `));
    const outs = within(minji).getAllByTestId('out-row').map((r) => r.querySelector('p')?.textContent);
    expect(outs).toEqual([`고정비 · 3건${formatMan(need.bills)}`, `할부${formatMan(0)}`, `생활비 예산${formatMan(need.living)}`]);
    // 들어오는 돈과 나가는 돈이 다르면 한 줄로
    const diff = 900_000 - need.total;
    expect(within(minji).getByTestId('account-diff').textContent).toBe(
      diff < 0 ? `들어오는 돈보다 나가는 돈이 ${formatMan(-diff)} 많아요` : `나가는 돈을 빼고 ${formatMan(diff)} 남아요`,
    );

    // 함께 탭: 이벤트 · 저수지 · 저축투자 (들어오는 돈만, 21일 · 25일 남는 돈 전부는 두 번)
    fireEvent.click(within(tabs).getByRole('radio', { name: '함께' }));
    expect(within(accountCard('저수지통장')).getByTestId('incoming-summary').textContent).toBe('한 달 195만');
    expect(within(accountCard('저수지통장')).getAllByTestId('incoming-row').map((r) => r.textContent)).toEqual([
      '21일 · 월급통장에서남는 돈 전부90만',
      '25일 · 월급통장에서남는 돈 전부105만',
    ]);
    // 월급통장 카드: 들어오는 돈 = 수입 계획, 보내는 배분 합
    const salary = accountCard('월급통장');
    expect(within(salary).getByTestId('incoming-summary').textContent).toBe('한 달 600만');
    expect(within(salary).getAllByTestId('income-row').map((r) => r.textContent)).toEqual(['21일 · 민지수입 계획320만', '25일 · 준호수입 계획280만']);
    expect(within(salary).getByTestId('income-sent').textContent).toBe('매달 배분으로 보내는 돈 405만 · 남는 돈 전부 → 저수지');
    expect(within(salary).queryByText(/수입보다/)).toBeNull();
    expect(within(accountCard('이벤트통장')).getByTestId('outgoing-total').textContent).toBe('나가는 고정 지출이 없어요');
  });

  it('나가는 돈 줄은 접힌 요약 → 펼치면 그 통장 항목만, 접으면 다시 숨겨요 · 항목은 한 곳에만 보여요', async () => {
    const h = renderApp(<BudgetPage />, { couple: true });
    await startDemo(h);
    const btn = within(accountCard('생활비(민지)')).getByRole('button', { name: '생활비(민지) 고정비 펼치기' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: /^통신비/ })).toBeNull();
    const body = openOut('생활비(민지)', '고정비');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(within(within(body).getByRole('list', { name: '고정비' })).getAllByRole('listitem')).toHaveLength(3);
    expect(within(body).getByRole('button', { name: /^통신비/ })).toBeTruthy();
    // 준호의 월세는 민지 카드에 없어요
    expect(within(body).queryByRole('button', { name: /^월세/ })).toBeNull();
    fireEvent.click(within(accountCard('생활비(민지)')).getByRole('button', { name: '생활비(민지) 고정비 접기' }));
    expect(screen.queryByRole('button', { name: /^통신비/ })).toBeNull();

    // TV 할부는 준호 생활비 통장에만
    expect(within(openOut('생활비(민지)', '할부')).queryByText('TV 할부')).toBeNull();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: '누구 통장' })).getByRole('radio', { name: '준호' }));
    const inst = openOut('생활비(준호)', '할부');
    expect(within(inst).getAllByText('TV 할부')).toHaveLength(1);
    expect(screen.getAllByText('TV 할부')).toHaveLength(1);
    // 예전 따로 있던 카드는 없어요
    expect(screen.queryByRole('heading', { level: 2, name: '고정 지출' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: '할부' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: '생활비 예산' })).toBeNull();
  });

  it('카드 안에서 고정비를 추가하면 그 통장이 기본 · 저장하면 합계가 바로 바뀌어요 · 고치기도 그대로', async () => {
    const h = renderApp(<BudgetPage />, { couple: true });
    await startDemo(h);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: '누구 통장' })).getByRole('radio', { name: '준호' }));
    const before = accountMoney(current(h).ledger.data!, 'demo-acc-living-junho', monthOf(current(h).ledger.today), current(h).ledger.today);
    let body = openOut('생활비(준호)', '고정비');
    fireEvent.click(within(body).getByRole('button', { name: '고정 지출 추가' }));
    let dialog = screen.getByRole('dialog', { name: '고정 지출 추가' });
    expect((within(dialog).getByLabelText('나가는 통장') as HTMLSelectElement).value).toBe('demo-acc-living-junho');
    // 나가는 통장은 모든 통장에서 골라요 (거르지 않음)
    expect([...listedAccounts(within(dialog).getByLabelText('나가는 통장'))].sort()).toEqual(current(h).ledger.activeAccounts.map((a) => a.id).sort());
    fireEvent.keyDown(within(dialog).getByRole('listbox'), { key: 'Escape' });
    fireEvent.change(within(dialog).getByLabelText(/이름/), { target: { value: '넷플릭스' } });
    fireEvent.change(within(dialog).getByLabelText(/^금액/), { target: { value: '17000' } });
    fireEvent.change(within(dialog).getByLabelText('결제일'), { target: { value: String(Number(before.from.slice(8, 10)) + 1) } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const added = current(h).ledger.data!.fixedExpenses.find((f) => f.name === '넷플릭스')!;
    expect(added.accountId).toBe('demo-acc-living-junho');
    const after = accountMoney(current(h).ledger.data!, 'demo-acc-living-junho', monthOf(current(h).ledger.today), current(h).ledger.today);
    expect(after.bills - before.bills).toBe(17_000);
    expect(within(accountCard('생활비(준호)')).getByTestId('outgoing-total').textContent).toMatch(
      new RegExp(`^${formatMan(after.outgoingTotal).replace('.', '\\.')} · `),
    );

    // 고치기: 이름 바꾸기
    body = openOut('생활비(준호)', '고정비');
    fireEvent.click(within(body).getByRole('button', { name: /^넷플릭스/ }));
    dialog = screen.getByRole('dialog', { name: '고정 지출 고치기' });
    fireEvent.change(within(dialog).getByLabelText(/이름/), { target: { value: '넷플릭스 프리미엄' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(current(h).ledger.data!.fixedExpenses.find((f) => f.id === added.id)!.name).toBe('넷플릭스 프리미엄');
  });

  it('#st-fixed 로 들어오면 처음 탭의 생활비 통장 고정비를 펼쳐요', async () => {
    window.location.hash = '#st-fixed';
    const h = renderApp(<BudgetPage />, { couple: true });
    await startDemo(h);
    await waitFor(() =>
      expect(within(accountCard('생활비(민지)')).getByRole('button', { name: '생활비(민지) 고정비 접기' }).getAttribute('aria-expanded')).toBe('true'),
    );
    expect(document.getElementById('st-fixed')).toBeTruthy();
  });
});
