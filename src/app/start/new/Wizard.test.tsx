// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { current, renderApp, startDemo } from '@/app/(app)/_components/__tests__/harness';

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => nav.router, usePathname: () => '/start/new' }));

import NewLedgerPage from './page';

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

function typeMoney(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('새 가계부 만들기 마법사', () => {
  it('공용: 만들기 → 시작 잔액 → 매달 배분(월급통장 하나 · 사람별 수입 계획) → 고정 지출 → 생활비 → 홈', async () => {
    const h = renderApp(<NewLedgerPage />);
    await startDemo(h);

    // ① 종류 · 이름
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('새 가계부 만들기');
    expect(screen.getByRole('list', { name: '5단계 중 1단계' })).toBeTruthy();
    const nameInput = screen.getByLabelText(/가계부 이름/) as HTMLInputElement;
    expect(nameInput.value).toBe('우리 집 가계부');
    fireEvent.change(nameInput, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '가계부 만들기' }));
    expect(await screen.findByText('가계부 이름을 입력해 주세요')).toBeTruthy();
    fireEvent.change(nameInput, { target: { value: '테스트 가계부' } });
    fireEvent.click(screen.getByRole('button', { name: '가계부 만들기' }));

    // ② 시작 잔액
    await screen.findByRole('heading', { level: 1, name: '통장 시작 잔액' });
    await screen.findByLabelText('수입통장');
    expect(current(h).ledger.data?.settings.name).toBe('테스트 가계부');
    typeMoney('수입통장', '1,000,000');
    typeMoney('이벤트통장', '600000');
    fireEvent.click(screen.getByRole('button', { name: /다음/ }));

    // ③ 매달 배분: 만든 사람(민지)이 먼저 있고, 사람을 더할 수 있어요. 월급은 모두 월급통장으로
    await screen.findByRole('heading', { level: 1, name: '매달 배분' });
    const minji = screen.getByRole('group', { name: '민지' });
    // 남은 돈은 저수지로 보내기가 기본이라 저수지 금액 칸은 없어요
    expect((within(minji).getByLabelText('남은 돈은 모두 저수지통장으로 보내기') as HTMLInputElement).checked).toBe(true);
    expect(within(minji).queryByLabelText('저수지통장')).toBeNull();
    const money = (group: HTMLElement, label: string, value: string) =>
      fireEvent.change(within(group).getByLabelText(label), { target: { value } });
    money(minji, '한 달 월급', '3000000');
    money(minji, '고정지출통장', '2000000');
    money(minji, '이벤트통장', '1500000');
    expect(within(minji).getByText(/배분 합계가 월급보다 500,000원 많아요/)).toBeTruthy();
    money(minji, '이벤트통장', '300000');
    expect(within(minji).queryByText(/월급보다/)).toBeNull();
    expect(within(minji).getByText('나머지 → 저수지통장').parentElement!.textContent).toContain('700,000원');

    fireEvent.click(screen.getByRole('button', { name: '사람 추가' }));
    const second = screen.getByRole('group', { name: '2번째 사람' });
    money(second, '한 달 월급', '2000000');
    // 이름 없이 금액만 있으면 멈춰요
    fireEvent.click(screen.getByRole('button', { name: /다음/ }));
    expect(await within(second).findByText('이름을 입력해 주세요')).toBeTruthy();
    fireEvent.change(within(second).getByLabelText('이름'), { target: { value: '준호' } });
    const junho = screen.getByRole('group', { name: '준호' });
    fireEvent.change(within(junho).getByLabelText('월급날'), { target: { value: '21' } });
    money(junho, '고정지출통장', '800000');
    money(junho, '저축투자통장', '1500000');
    expect(within(junho).getByText(/배분 합계가 월급보다 300,000원 많아요/)).toBeTruthy();
    money(junho, '저축투자통장', '1200000');
    expect(within(junho).getByText('월급을 남김없이 나눴어요')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /다음/ }));

    // ④ 고정 지출
    await screen.findByRole('heading', { level: 1, name: '고정 지출과 용돈' });
    fireEvent.click(within(screen.getByRole('group', { name: '고정 지출 추가' })).getByRole('button', { name: '월세' }));
    fireEvent.click(screen.getByRole('button', { name: /다음/ }));
    // 월세 금액이 없어서 멈춰요
    expect(await screen.findByText('금액을 입력해 주세요')).toBeTruthy();
    const rent = screen.getByRole('group', { name: '월세' });
    fireEvent.change(within(rent).getByLabelText('금액'), { target: { value: '800000' } });
    fireEvent.click(screen.getByRole('button', { name: /다음/ }));

    // ⑤ 생활비: 기본 항목이 비어 있는 금액으로 있어요
    await screen.findByRole('heading', { level: 1, name: '생활비 예산' });
    for (const n of ['식비', '카페', '교통', '생활', '쇼핑', '의료', '문화']) expect(screen.getByRole('group', { name: n })).toBeTruthy();
    money(screen.getByRole('group', { name: '식비' }), '한 달 예산', '300000');
    money(screen.getByRole('group', { name: '쇼핑' }), '한 달 예산', '50000');
    fireEvent.click(within(screen.getByRole('group', { name: '교통' })).getByRole('button', { name: '교통 빼기' }));
    expect(screen.queryByRole('group', { name: '교통' })).toBeNull();
    // 카페는 한 달 한도로 바꿔요
    fireEvent.click(within(screen.getByRole('radiogroup', { name: '카페 쓰는 방식' })).getByRole('radio', { name: '한 달 한도만' }));
    money(screen.getByRole('group', { name: '카페' }), '한 달 예산', '40000');
    expect(screen.getByText('한 달 생활비 합계').parentElement!.textContent).toContain('390,000원');
    fireEvent.click(screen.getByRole('button', { name: '완료' }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/'));

    const data = current(h).ledger.data!;
    const byRole = (role: string) => data.accounts.find((a) => !a.deleted && a.role === role)!;
    const incomes = data.accounts.filter((a) => !a.deleted && a.role === 'income');
    expect(incomes.map((a) => [a.name, a.ownerName, a.ownerEmail])).toEqual([['월급통장', null, null]]);
    expect(incomes[0]!.openingBalance).toBe(1_000_000);
    expect(byRole('event').openingBalance).toBe(600_000);
    const plans = data.incomePlans.filter((p) => !p.deleted);
    expect(plans.map((p) => [p.personName, p.personEmail, p.amount, p.dayOfMonth, p.accountId])).toEqual([
      ['민지', 'minji@demo', 3_000_000, 25, incomes[0]!.id],
      ['준호', null, 2_000_000, 21, incomes[0]!.id],
    ]);
    const rules = data.rules.filter((r) => !r.deleted);
    expect(rules.map((r) => [r.fromAccountId, r.toAccountId, r.kind ?? 'fixed', r.amount, r.dayOfMonth])).toEqual([
      [incomes[0]!.id, byRole('fixed').id, 'fixed', 2_000_000, 25],
      [incomes[0]!.id, byRole('event').id, 'fixed', 300_000, 25],
      [incomes[0]!.id, byRole('fixed').id, 'fixed', 800_000, 21],
      [incomes[0]!.id, byRole('savings').id, 'fixed', 1_200_000, 21],
      [incomes[0]!.id, byRole('reservoir').id, 'remainder', 0, 25],
      [incomes[0]!.id, byRole('reservoir').id, 'remainder', 0, 21],
    ]);
    expect(rules.every((r) => r.startMonth === '2026-11')).toBe(true);
    const fixed = data.fixedExpenses.filter((f) => !f.deleted);
    expect(fixed.map((f) => [f.kind, f.name, f.amount, f.kind === 'living' ? f.spread : '-'])).toEqual([
      ['bill', '월세', 800_000, '-'],
      ['living', '식비', 300_000, 'daily'],
      ['living', '카페', 40_000, 'monthly'],
      ['living', '쇼핑', 50_000, 'monthly'],
    ]);
    const cat = (n: string) => data.categories.find((c) => c.name === n)!.id;
    expect(fixed.filter((f) => f.kind === 'living').map((f) => f.categoryId)).toEqual([cat('식비'), cat('카페'), cat('쇼핑')]);
  });

  it('이전 단계로 돌아가 다시 저장해도 배분 규칙 · 수입 계획이 중복되지 않고, 뺀 사람의 계획은 지워요', async () => {
    const h = renderApp(<NewLedgerPage />);
    await startDemo(h);
    fireEvent.click(screen.getByRole('button', { name: '가계부 만들기' }));
    await screen.findByLabelText('수입통장');
    fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }));
    await screen.findByRole('heading', { level: 1, name: '매달 배분' });
    fireEvent.change(within(screen.getByRole('group', { name: '민지' })).getByLabelText('저축투자통장'), {
      target: { value: '1000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: '사람 추가' }));
    const second = screen.getByRole('group', { name: '2번째 사람' });
    fireEvent.change(within(second).getByLabelText('이름'), { target: { value: '준호' } });
    fireEvent.change(within(screen.getByRole('group', { name: '준호' })).getByLabelText('한 달 월급'), { target: { value: '2000000' } });
    fireEvent.click(screen.getByRole('button', { name: /다음/ }));
    await screen.findByRole('heading', { level: 1, name: '고정 지출과 용돈' });
    const incomes = () => current(h).ledger.data!.accounts.filter((a) => !a.deleted && a.role === 'income');
    const plans = () => current(h).ledger.data!.incomePlans.filter((p) => !p.deleted);
    expect(incomes().map((a) => a.name)).toEqual(['월급통장']);
    expect(plans().map((p) => p.personName)).toEqual(['준호']);

    fireEvent.click(screen.getByRole('button', { name: /이전/ }));
    await screen.findByRole('heading', { level: 1, name: '매달 배분' });
    fireEvent.change(within(screen.getByRole('group', { name: '민지' })).getByLabelText('저축투자통장'), {
      target: { value: '1200000' },
    });
    fireEvent.click(screen.getByRole('button', { name: '준호 빼기' }));
    fireEvent.click(screen.getByRole('button', { name: /다음/ }));
    await screen.findByRole('heading', { level: 1, name: '고정 지출과 용돈' });
    const rules = current(h).ledger.data!.rules.filter((r) => !r.deleted);
    expect(rules.map((r) => [r.kind ?? 'fixed', r.amount])).toEqual([
      ['fixed', 1_200_000],
      ['remainder', 0],
    ]);
    expect(incomes().map((a) => a.name)).toEqual(['월급통장']);
    expect(plans()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }));
    await screen.findByRole('heading', { level: 1, name: '생활비 예산' });
    fireEvent.click(screen.getByRole('button', { name: '나중에 할게요' }));
    expect(nav.router.replace).toHaveBeenCalledWith('/');
  });

  it('개인: 이름 + 공용 가계부 연결 → 용돈 통장 시작 잔액 → 홈', async () => {
    const h = renderApp(<NewLedgerPage />);
    await startDemo(h);
    fireEvent.click(screen.getByRole('radio', { name: /개인 가계부/ }));
    expect((screen.getByLabelText(/가계부 이름/) as HTMLInputElement).value).toBe('내 용돈 가계부');
    expect(screen.getByRole('list', { name: '2단계 중 1단계' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/공용 가계부 연결/), { target: { value: 'local:demo' } });
    fireEvent.click(screen.getByRole('button', { name: '가계부 만들기' }));
    await screen.findByLabelText('용돈');
    const settings = current(h).ledger.data!.settings;
    expect(settings.kind).toBe('personal');
    expect(settings.sharedLedgerId).toBe('local:demo');
    typeMoney('용돈', '50000');
    fireEvent.click(screen.getByRole('button', { name: '완료' }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/'));
    expect(current(h).ledger.data!.accounts[0]!.openingBalance).toBe(50_000);
  });
});
