// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
    for (const title of ['가계부', '통장', '매달 배분', '생활비 예산', '고정 지출', '카테고리', '자주 쓰는 지출', '화면', '계정', '정보']) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeTruthy();
    }
    // 사람별 수입통장마다 배분 합계 = 그 사람 수입 → 경고 없음
    const rules = card('매달 배분');
    const minji = within(rules).getByRole('group', { name: '민지 수입통장 배분' });
    expect(within(minji).getByText('이번 달 배분 합계').nextSibling?.textContent).toBe('3,000,000원');
    const junho = within(rules).getByRole('group', { name: '준호 수입통장 배분' });
    expect(within(junho).getByText('이번 달 배분 합계').nextSibling?.textContent).toBe('2,000,000원');
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

  it('한 사람 수입통장만 넘치면 그 통장 이름으로 경고해요', async () => {
    const h = renderApp(<SettingsPage />);
    await startDemo(h);
    const rules = card('매달 배분');
    fireEvent.click(within(rules).getByRole('button', { name: /준호 수입통장 → 고정지출통장/ }));
    const dialog = screen.getByRole('dialog', { name: '매달 배분 고치기' });
    fireEvent.change(within(dialog).getByLabelText('금액'), { target: { value: '1000000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await within(card('매달 배분')).findByText('준호 수입통장에서 보내는 돈이 수입보다 200,000원 많아요')).toBeTruthy();
    expect(within(card('매달 배분')).queryByText(/민지 수입통장에서 보내는/)).toBeNull();
    expect(current(h).ledger.data).not.toBeNull();
  });

  it('다른 사람 수입통장 추가: 주인 이름으로 통장 이름을 지어요', async () => {
    const h = renderApp(<SettingsPage />);
    await startDemo(h);
    fireEvent.click(within(card('통장')).getByRole('button', { name: '다른 사람 수입통장 추가' }));
    const dialog = screen.getByRole('dialog', { name: '수입통장 추가' });
    fireEvent.change(within(dialog).getByLabelText(/^주인(?! 이메일)/), { target: { value: '서연' } });
    fireEvent.change(within(dialog).getByLabelText(/주인 이메일/), { target: { value: 'nope' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(within(dialog).getByText('이메일 주소를 확인해 주세요')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/주인 이메일/), { target: { value: 'seo@x.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const added = current(h).ledger.data!.accounts.find((a) => a.name === '서연 수입통장');
    expect(added).toMatchObject({ role: 'income', ownerName: '서연', ownerEmail: 'seo@x.com' });
    expect(current(h).ledger.incomeAccounts).toHaveLength(3);
  });

  it('생활비 예산: 항목 추가 · 쓰는 방식 · 예전 생활비 한 줄을 항목으로 나누기', async () => {
    const h = renderApp(<SettingsPage />);
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
    const banner = await within(card('생활비 예산')).findByText('생활비를 항목별로 나눠 보세요');
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
    expect(within(card('생활비 예산')).queryByText('생활비를 항목별로 나눠 보세요')).toBeNull();
  });
});
