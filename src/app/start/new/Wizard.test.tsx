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
  it('공용: 만들기 → 시작 잔액 → 매달 배분 → 고정 지출 → 홈', async () => {
    const h = renderApp(<NewLedgerPage />);
    await startDemo(h);

    // ① 종류 · 이름
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('새 가계부 만들기');
    expect(screen.getByRole('list', { name: '4단계 중 1단계' })).toBeTruthy();
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

    // ③ 매달 배분
    await screen.findByRole('heading', { level: 1, name: '매달 배분' });
    typeMoney('한 달 월급', '3000000');
    typeMoney('고정지출통장', '2000000');
    typeMoney('이벤트통장', '1500000');
    expect(screen.getByText(/배분 합계가 월급보다 500,000원 많아요/)).toBeTruthy();
    typeMoney('이벤트통장', '300000');
    expect(screen.queryByText(/월급보다/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /다음/ }));

    // ④ 고정 지출
    await screen.findByRole('heading', { level: 1, name: '고정 지출과 생활비' });
    typeMoney('한 달 생활비', '600000');
    fireEvent.click(within(screen.getByRole('group', { name: '고정 지출 추가' })).getByRole('button', { name: '월세' }));
    fireEvent.click(screen.getByRole('button', { name: '완료' }));
    // 월세 금액이 없어서 멈춰요
    expect(await screen.findByText('금액을 입력해 주세요')).toBeTruthy();
    expect(nav.router.replace).not.toHaveBeenCalledWith('/');
    const rent = screen.getByRole('group', { name: '월세' });
    fireEvent.change(within(rent).getByLabelText('금액'), { target: { value: '800000' } });
    fireEvent.click(screen.getByRole('button', { name: '완료' }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/'));

    const data = current(h).ledger.data!;
    const byRole = (role: string) => data.accounts.find((a) => a.role === role)!;
    expect(byRole('income').openingBalance).toBe(1_000_000);
    expect(byRole('event').openingBalance).toBe(600_000);
    const rules = data.rules.filter((r) => !r.deleted);
    expect(rules.map((r) => [r.toAccountId, r.amount])).toEqual([
      [byRole('fixed').id, 2_000_000],
      [byRole('event').id, 300_000],
    ]);
    expect(rules.every((r) => r.fromAccountId === byRole('income').id && r.startMonth === '2026-11')).toBe(true);
    const fixed = data.fixedExpenses.filter((f) => !f.deleted);
    expect(fixed.map((f) => [f.kind, f.name, f.amount])).toEqual([
      ['living', '생활비', 600_000],
      ['bill', '월세', 800_000],
    ]);
  });

  it('이전 단계로 돌아가 다시 저장해도 배분 규칙이 중복되지 않아요', async () => {
    const h = renderApp(<NewLedgerPage />);
    await startDemo(h);
    fireEvent.click(screen.getByRole('button', { name: '가계부 만들기' }));
    await screen.findByLabelText('수입통장');
    fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }));
    await screen.findByRole('heading', { level: 1, name: '매달 배분' });
    typeMoney('저축투자통장', '1000000');
    fireEvent.click(screen.getByRole('button', { name: /다음/ }));
    await screen.findByRole('heading', { level: 1, name: '고정 지출과 생활비' });
    fireEvent.click(screen.getByRole('button', { name: /이전/ }));
    await screen.findByRole('heading', { level: 1, name: '매달 배분' });
    typeMoney('저축투자통장', '1200000');
    fireEvent.click(screen.getByRole('button', { name: /다음/ }));
    await screen.findByRole('heading', { level: 1, name: '고정 지출과 생활비' });
    const rules = current(h).ledger.data!.rules.filter((r) => !r.deleted);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.amount).toBe(1_200_000);
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
