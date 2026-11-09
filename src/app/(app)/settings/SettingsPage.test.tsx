// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { current, renderApp, startDemo } from '../_components/__tests__/harness';

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => nav.router, usePathname: () => '/settings' }));

import SettingsPage from './page';

afterEach(cleanup);

function card(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 2, name: title });
  return heading.closest('.card') as HTMLElement;
}

describe('설정 화면', () => {
  it('불러오는 동안 뼈대, 준비되면 섹션들', async () => {
    const h = renderApp(<SettingsPage />);
    expect(screen.getByText('설정을 불러오는 중이에요')).toBeTruthy();
    await startDemo(h);
    for (const title of ['가계부', '통장', '매달 배분', '고정 지출', '카테고리', '자주 쓰는 지출', '화면', '계정', '정보']) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeTruthy();
    }
    // 배분 합계 500만 = 이번 달 수입 500만 → 경고 없음
    const rules = card('매달 배분');
    expect(within(rules).getByText('이번 달 배분 합계').nextSibling?.textContent).toBe('5,000,000원');
    expect(within(rules).queryByText(/수입보다/)).toBeNull();
    expect(screen.getByRole('radiogroup', { name: '화면 테마' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '체험 데이터 처음으로 되돌리기' })).toBeTruthy();
  });

  it('자주 쓰는 지출 추가 · 매달 배분 금액 바꾸기 · 이름 바꾸기', async () => {
    const h = renderApp(<SettingsPage />);
    await startDemo(h);

    // 자주 쓰는 지출 추가 (입력 확인 → 저장)
    fireEvent.click(screen.getByRole('button', { name: '자주 쓰는 지출 추가' }));
    let dialog = screen.getByRole('dialog', { name: '자주 쓰는 지출 추가' });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(within(dialog).getByText('이름을 입력해 주세요')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/이름/), { target: { value: '택시' } });
    fireEvent.change(within(dialog).getByLabelText(/금액/), { target: { value: '12000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(current(h).ledger.data!.favorites.find((f) => f.name === '택시')).toMatchObject({ amount: 12_000, deleted: false });

    // 매달 배분: 이벤트 적립 30만 → 35만
    const rules = card('매달 배분');
    fireEvent.click(within(rules).getByRole('button', { name: /수입통장 → 이벤트통장/ }));
    dialog = screen.getByRole('dialog', { name: '매달 배분 고치기' });
    fireEvent.change(within(dialog).getByLabelText('금액'), { target: { value: '350000' } });
    expect(within(dialog).getByText(/새 금액을 적용해요/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
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
    const h = renderApp(<SettingsPage />);
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
    fireEvent.click(within(cats).getByRole('button', { name: /카페/ }));
    const dialog = screen.getByRole('dialog', { name: '카테고리 고치기' });
    const icons = within(dialog).getByRole('radiogroup', { name: '아이콘' });
    expect(within(icons).getByRole('radio', { name: '커피' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(icons).getByRole('radio', { name: '반짝임' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(current(h).ledger.data!.categories.find((c) => c.id === 'demo-cat-cafe')?.icon).toBe('sparkles');
  });
});
