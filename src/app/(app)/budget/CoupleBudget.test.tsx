// @vitest-environment jsdom
/* 예산: 통장 카드 들어오는 돈(매달 배분 · 수입 계획) 그 자리 고치기 · 사람별 생활비 (부부 체험 예시, PLAN 4-13 · 4-14) */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { current, renderApp, startDemo } from '../_components/__tests__/harness';
import { listedAccounts, pickAccount } from '../_components/__tests__/pickAccount';

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => nav.router, usePathname: () => '/budget' }));

import { ruleNext } from '@/domain';
import BudgetPage from './page';
import { accountCard, openIncoming, openOut, pickOwner } from './budgetTestUtils';

afterEach(cleanup);


describe('예산 — 부부 예시', () => {
  it('통장 카드 들어오는 돈: 줄을 누르면 그 자리에서 금액을 고치고 저장하면 카드가 바로 바뀌어요 (창 없음)', async () => {
    const h = renderApp(<BudgetPage />, { couple: true });
    await startDemo(h);
    const editor = openIncoming('생활비(민지)', /^21일 · 월급통장에서/);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(editor.getAttribute('aria-label')).toBe('생활비(민지) 배분 고치기');
    expect(within(editor).getByRole('radio', { name: '매달 같은 금액' }).getAttribute('aria-checked')).toBe('true');
    // 생활비 통장은 알아서 맞추기도 고를 수 있어요
    expect(within(editor).getByRole('radio', { name: '알아서 맞추기' })).toBeTruthy();
    expect(within(editor).getByLabelText('보내는 통장')).toBeTruthy();
    expect((within(editor).getByLabelText('이체일') as HTMLSelectElement).value).toBe('21');
    const amount = within(editor).getByLabelText('금액') as HTMLInputElement;
    expect(amount.value.replace(/\D/g, '')).toBe('900000');
    fireEvent.change(amount, { target: { value: '1000000' } });
    expect(within(editor).getByText(/새 금액을 적용해요/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(editor).getByRole('button', { name: '저장' }));
    });
    await waitFor(() => expect(document.getElementById(editor.id)).toBeNull());
    const live = current(h).ledger.data!.rules.filter((r) => !r.deleted && r.toAccountId === 'demo-acc-living-minji');
    expect(live.map((r) => r.amount)).toContain(1_000_000);
    // 이번 달 배분이 이미 기록됐으면 다음 달부터: 그래도 카드에 새 금액 줄이 보여요
    expect(within(accountCard('생활비(민지)')).getAllByTestId('incoming-row').some((r) => r.textContent?.includes('100만'))).toBe(true);
  });

  it('알아서 맞추기로 바꾸면 줄에 자동 금액 · 내역 · 지난달과 달라진 까닭을 보여요', async () => {
    const h = renderApp(<BudgetPage />, { couple: true });
    await startDemo(h);
    const editor = openIncoming('생활비(민지)', /^21일 · 월급통장에서/);
    fireEvent.click(within(editor).getByRole('radio', { name: '알아서 맞추기' }));
    expect(within(editor).queryByLabelText('금액')).toBeNull();
    await act(async () => {
      fireEvent.click(within(editor).getByRole('button', { name: '저장' }));
    });
    await waitFor(() => expect(document.getElementById(editor.id)).toBeNull());
    const rule = current(h).ledger.data!.rules.find((r) => r.id === 'demo-rule-21-living-minji')!;
    expect(rule).toMatchObject({ kind: 'auto', amount: 0 });
    // 다음 배분 기간에 새 구독이 시작하면 '지난달보다 +1.5만 · 넷플릭스 시작'
    const next = ruleNext(current(h).ledger.data!, rule, current(h).ledger.today)!;
    await act(async () => {
      await current(h).ledger.addFixed({
        name: '넷플릭스', amount: 15_000, accountId: 'demo-acc-living-minji', categoryId: null, dayOfMonth: Number(next.date.slice(8, 10)),
        kind: 'bill', targetEmail: null, spread: 'monthly', startMonth: next.date.slice(0, 7), endMonth: null, startDate: next.date,
      });
    });
    const after = ruleNext(current(h).ledger.data!, rule, current(h).ledger.today)!;
    expect(after.amount - next.amount).toBe(15_000);
    const row = within(accountCard('생활비(민지)')).getAllByTestId('incoming-row')[0]!;
    expect(within(row).getByText('알아서 맞추기')).toBeTruthy();
    expect(within(row).getByText(/^고정비 /)).toBeTruthy();
    expect(within(row).getByText(/^지난달보다 \+[\d.]+만 · 넷플릭스 시작$/)).toBeTruthy();
  });

  it('[+ 들어오는 돈]으로 그 통장에 배분을 추가하고, 같은 날 나머지는 하나만 · 줄에서 지우기도 그 자리에서', async () => {
    const h = renderApp(<BudgetPage />, { couple: true });
    await startDemo(h);
    pickOwner('함께');
    const event = () => accountCard('이벤트통장');
    expect(within(event()).getAllByTestId('incoming-row')).toHaveLength(1);
    fireEvent.click(within(event()).getByRole('button', { name: '이벤트통장 들어오는 돈 추가' }));
    let editor = within(event()).getByRole('form', { name: '이벤트통장 들어오는 돈 추가' });
    expect(screen.queryByRole('dialog')).toBeNull();
    // 이벤트통장은 생활비 통장이 아니라 매달 같은 금액 (알아서 맞추기 없음), 보내는 통장은 월급통장이 기본
    expect(within(editor).queryByRole('radio', { name: '알아서 맞추기' })).toBeNull();
    expect(within(editor).getByRole('radio', { name: '매달 같은 금액' }).getAttribute('aria-checked')).toBe('true');
    expect((within(editor).getByLabelText('보내는 통장') as HTMLButtonElement).value).toBe('demo-acc-income');
    // 보내는 통장에는 이 통장이 없어요
    expect(listedAccounts(within(editor).getByLabelText('보내는 통장'))).not.toContain('demo-acc-event');
    fireEvent.keyDown(within(editor).getByRole('listbox'), { key: 'Escape' });
    // 금액 없이 저장하면 그 자리에서 알려 줘요
    fireEvent.click(within(editor).getByRole('button', { name: '저장' }));
    expect(await within(editor).findByText('금액을 입력해 주세요')).toBeTruthy();
    fireEvent.change(within(editor).getByLabelText('금액'), { target: { value: '100000' } });
    fireEvent.change(within(editor).getByLabelText('이체일'), { target: { value: '28' } });
    await act(async () => {
      fireEvent.click(within(editor).getByRole('button', { name: '저장' }));
    });
    await waitFor(() => expect(within(event()).queryByRole('form')).toBeNull());
    const added = current(h).ledger.data!.rules.find((r) => !r.deleted && r.toAccountId === 'demo-acc-event' && r.amount === 100_000)!;
    expect(added).toMatchObject({ fromAccountId: 'demo-acc-income', dayOfMonth: 28, kind: 'fixed' });
    expect(within(event()).getAllByTestId('incoming-row').map((r) => r.textContent)).toContain('28일 · 월급통장에서매달 같은 금액10만');

    // 같은 날(21일) 나머지 배분을 하나 더 만들면 막아요
    fireEvent.click(within(event()).getByRole('button', { name: '이벤트통장 들어오는 돈 추가' }));
    editor = within(event()).getByRole('form', { name: '이벤트통장 들어오는 돈 추가' });
    fireEvent.click(within(editor).getByRole('radio', { name: '남는 돈 전부' }));
    expect(within(editor).queryByLabelText('금액')).toBeNull();
    fireEvent.change(within(editor).getByLabelText('이체일'), { target: { value: '21' } });
    fireEvent.click(within(editor).getByRole('button', { name: '저장' }));
    expect(await within(editor).findByText('이 통장에서 같은 날 나머지를 보내는 배분이 이미 있어요')).toBeTruthy();
    fireEvent.click(within(editor).getByRole('button', { name: '취소' }));
    expect(within(event()).queryByRole('form')).toBeNull();

    // 지우기: 그 자리에서 한 번 더 묻고 지워요
    editor = openIncoming('이벤트통장', /^28일 · 월급통장에서/);
    fireEvent.click(within(editor).getByRole('button', { name: '이 배분 지우기' }));
    const ask = within(editor).getByRole('group', { name: /이 배분을 지울까요/ });
    await act(async () => {
      fireEvent.click(within(ask).getByRole('button', { name: '지우기' }));
    });
    await waitFor(() => expect(current(h).ledger.data!.rules.find((r) => r.id === added.id)!.deleted).toBe(true));
    expect(within(event()).getAllByTestId('incoming-row')).toHaveLength(1);
  });

  it('남는 돈 전부 줄을 매달 같은 금액으로 바꿔요', async () => {
    const h = renderApp(<BudgetPage />, { couple: true });
    await startDemo(h);
    pickOwner('함께');
    const editor = openIncoming('저수지통장', /^25일 · 월급통장에서/);
    expect(within(editor).getByRole('radio', { name: '남는 돈 전부' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(editor).getByRole('radio', { name: '매달 같은 금액' }));
    fireEvent.change(within(editor).getByLabelText('금액'), { target: { value: '500000' } });
    await act(async () => {
      fireEvent.click(within(editor).getByRole('button', { name: '저장' }));
    });
    await waitFor(() => expect(document.getElementById(editor.id)).toBeNull());
    expect(current(h).ledger.data!.rules.find((r) => r.id === 'demo-rule-25-reservoir')!).toMatchObject({ kind: 'fixed', amount: 500_000 });
  });

  it('용돈 통장은 매달 같은 금액만: 고치기 · 추가 칸에 알아서 맞추기가 없어요 (생활비 통장 새 배분은 알아서 맞추기가 기본)', async () => {
    const h = renderApp(<BudgetPage />, { couple: true });
    await startDemo(h);
    const editor = openIncoming('용돈(민지)', /^25일 · 월급통장에서/);
    expect(within(editor).queryByRole('radio', { name: '알아서 맞추기' })).toBeNull();
    expect(within(editor).getByRole('radio', { name: '매달 같은 금액' }).getAttribute('aria-checked')).toBe('true');
    expect(within(editor).getByText('용돈은 매달 같은 금액으로 보내요.')).toBeTruthy();
    fireEvent.click(within(editor).getByRole('button', { name: '취소' }));

    fireEvent.click(within(accountCard('용돈(민지)')).getByRole('button', { name: '용돈(민지) 들어오는 돈 추가' }));
    const add = within(accountCard('용돈(민지)')).getByRole('form', { name: '용돈(민지) 들어오는 돈 추가' });
    expect(within(add).queryByRole('radio', { name: '알아서 맞추기' })).toBeNull();
    expect(within(add).getByRole('radio', { name: '매달 같은 금액' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(add).getByRole('button', { name: '취소' }));

    fireEvent.click(within(accountCard('생활비(민지)')).getByRole('button', { name: '생활비(민지) 들어오는 돈 추가' }));
    const living = within(accountCard('생활비(민지)')).getByRole('form', { name: '생활비(민지) 들어오는 돈 추가' });
    expect(within(living).getByRole('radio', { name: '알아서 맞추기' }).getAttribute('aria-checked')).toBe('true');
    // 가계부도 용돈 통장 알아서 맞추기는 받지 않아요
    const rule = current(h).ledger.data!.rules.find((r) => r.toAccountId === 'demo-acc-allowance-minji')!;
    await expect(current(h).ledger.saveRule({ ...rule, kind: 'auto', amount: 0 })).rejects.toThrow('알아서 맞추기는 생활비 통장으로 보낼 때만 고를 수 있어요');
  });

  it("금액을 찾지 못해 되돌린 용돈 배분 줄에 '용돈 금액을 확인해 주세요' + 그 줄 아래 금액 칸 (4-7)", async () => {
    const h = renderApp(<BudgetPage />, { couple: true });
    await startDemo(h);
    const rule = current(h).ledger.data!.rules.find((r) => r.toAccountId === 'demo-acc-allowance-junho')!;
    await act(async () => {
      await current(h).ledger.saveRule({ ...rule, kind: 'fixed', amount: 50_000, needsReview: true });
    });
    pickOwner('준호');
    const card = accountCard('용돈(준호)');
    expect(within(card).getByTestId('incoming-row').textContent).toContain('용돈 금액을 확인해 주세요');
    expect(screen.getAllByRole('group', { name: '용돈 금액을 확인해 주세요' })).toHaveLength(1);
    const prompt = within(card).getByRole('group', { name: '용돈 금액을 확인해 주세요' });
    const input = within(prompt).getByLabelText(/용돈 금액을 확인해 주세요/) as HTMLInputElement;
    expect(input.value.replace(/\D/g, '')).toBe('50000');
    fireEvent.change(input, { target: { value: '350000' } });
    await act(async () => {
      fireEvent.click(within(prompt).getByRole('button', { name: '확인' }));
    });
    await waitFor(() => expect(screen.queryByRole('group', { name: '용돈 금액을 확인해 주세요' })).toBeNull());
    const saved = current(h).ledger.data!.rules.find((r) => r.id === rule.id)!;
    expect(saved).toMatchObject({ kind: 'fixed', amount: 350_000 });
    expect(saved.needsReview).toBeFalsy();
  });

  it('월급통장 카드: 수입 계획 줄을 눌러 금액을 고치고 [+ 수입]으로 추가해요', async () => {
    const h = renderApp(<BudgetPage />, { couple: true });
    await startDemo(h);
    pickOwner('함께');
    const editor = openIncoming('월급통장', /^25일 · 준호/);
    expect(editor.getAttribute('aria-label')).toBe('준호 수입 고치기');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.change(within(editor).getByLabelText(/한 달 금액/), { target: { value: '3000000' } });
    await act(async () => {
      fireEvent.click(within(editor).getByRole('button', { name: '저장' }));
    });
    await waitFor(() => expect(document.getElementById(editor.id)).toBeNull());
    expect(current(h).ledger.data!.incomePlans.find((p) => p.personName === '준호')!.amount).toBe(3_000_000);
    expect(within(accountCard('월급통장')).getByTestId('incoming-summary').textContent).toBe('한 달 620만');
    expect(screen.getByText('월급통장에 300만 들어와요 (준호)')).toBeTruthy();

    // [+ 수입]: 이 통장으로 받는 수입 계획을 그 자리에서 추가
    fireEvent.click(within(accountCard('월급통장')).getByRole('button', { name: '월급통장 수입 추가' }));
    const add = within(accountCard('월급통장')).getByRole('form', { name: '월급통장 수입 추가' });
    fireEvent.click(within(add).getByRole('button', { name: '저장' }));
    expect(await within(add).findByText('금액을 입력해 주세요')).toBeTruthy();
    fireEvent.click(within(add).getByRole('button', { name: '취소' }));
    expect(within(accountCard('월급통장')).queryByRole('form')).toBeNull();
  });

  it('생활비 항목은 누구 생활비인지 고르고, 같은 항목도 사람마다 따로 둘 수 있어요', async () => {
    const h = renderApp(<BudgetPage />, { couple: true });
    await startDemo(h);
    const living = openOut('생활비(민지)', '생활비 예산');
    fireEvent.click(within(living).getByRole('button', { name: '생활비 항목 추가' }));
    const dialog = screen.getByRole('dialog', { name: '생활비 항목 추가' });
    const who = within(dialog).getByLabelText(/누구 생활비인가요/) as HTMLSelectElement;
    expect(who.value).toBe('demo-acc-living-minji');
    const etc = current(h).ledger.data!.categories.find((c) => c.name === '기타')!.id;
    fireEvent.change(within(dialog).getByLabelText(/항목/), { target: { value: etc } });
    // 누구 생활비: 생활비 통장만
    expect(listedAccounts(who)).toEqual(['demo-acc-living-minji', 'demo-acc-living-junho']);
    pickAccount(who, 'demo-acc-living-junho');
    fireEvent.change(within(dialog).getByLabelText(/한 달 예산/), { target: { value: '15000' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const row = current(h).ledger.data!.fixedExpenses.find((f) => f.kind === 'living' && f.categoryId === etc)!;
    expect(row).toMatchObject({ accountId: 'demo-acc-living-junho', amount: 15_000 });
    expect(current(h).ledger.livingFor('demo-acc-living-junho')!.items.some((i) => i.categoryId === etc && !i.unbudgeted)).toBe(true);
  });
});
