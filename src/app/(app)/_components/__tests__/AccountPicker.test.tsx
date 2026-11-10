// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDemoLedger } from '@/domain';
import type { Account } from '@/domain/types';
import { RECENT_ACCOUNTS_KEY, useLedger } from '@/state';
import { Field, formatAmount } from '@/ui';
import { AccountPicker } from '../AccountPicker';
import { accountShortLabel, baseAccountName, groupAccounts, meKeyOf, pushRecentAccount, readRecentAccounts } from '../accountGroups';
import { current, renderApp, startDemo } from './harness';
import { listedAccounts } from './pickAccount';

const TODAY = '2026-11-20';
const couple = () => createDemoLedger(TODAY, `${TODAY}T10:00:00.000Z`, { couple: true });

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('통장 묶기 (accountGroups)', () => {
  it('나 → 다른 사람 → 함께 순으로 묶고, 로그인한 사람이 맨 앞이에요', () => {
    const data = couple();
    const active = data.accounts.filter((a) => !a.deleted);
    const asJunho = groupAccounts(data, active, { meKey: 'junho@demo' });
    expect(asJunho.map((g) => g.label)).toEqual(['나 · 준호', '민지', '함께']);
    expect(asJunho[0]!.accounts.map((a) => a.id)).toEqual(['demo-acc-living-junho', 'demo-acc-allowance-junho']);
    expect(asJunho[2]!.accounts.map((a) => a.id)).toEqual(['demo-acc-income', 'demo-acc-event', 'demo-acc-reservoir', 'demo-acc-savings']);

    const asMinji = groupAccounts(data, active, { meKey: meKeyOf(data, 'minji@demo', 'demo-acc-living-minji') });
    expect(asMinji.map((g) => g.label)).toEqual(['나 · 민지', '준호', '함께']);
    // 나를 모르면 가계부 사람 순서 그대로
    expect(groupAccounts(data, active, { meKey: null }).map((g) => [g.kind, g.label])).toEqual([
      ['other', '민지'],
      ['other', '준호'],
      ['shared', '함께'],
    ]);
  });

  it('이메일 없이 주인 이름만 있는 통장도 이름이 맞는 사람에게 묶여요', () => {
    const data = couple();
    data.accounts = data.accounts.map((a) => (a.id === 'demo-acc-allowance-junho' ? { ...a, ownerEmail: null } : a));
    const groups = groupAccounts(data, data.accounts, { meKey: 'junho@demo' });
    expect(groups[0]!.accounts.map((a) => a.id)).toContain('demo-acc-allowance-junho');
  });

  it('최근 고른 통장이 묶음 안에서 위로 올라가요 (묶음 순서는 그대로)', () => {
    const data = couple();
    const groups = groupAccounts(data, data.accounts, { meKey: 'minji@demo', recent: ['demo-acc-savings', 'demo-acc-allowance-minji', 'demo-acc-event'] });
    expect(groups.map((g) => g.label)).toEqual(['나 · 민지', '준호', '함께']);
    expect(groups[0]!.accounts.map((a) => a.id)).toEqual(['demo-acc-allowance-minji', 'demo-acc-living-minji']);
    expect(groups[2]!.accounts.map((a) => a.id)).toEqual(['demo-acc-savings', 'demo-acc-event', 'demo-acc-income', 'demo-acc-reservoir']);
  });

  it('앞에 둘 통장(prefer)은 최근 순서보다 먼저예요', () => {
    const data = couple();
    const groups = groupAccounts(data, data.accounts, {
      meKey: 'minji@demo',
      recent: ['demo-acc-event'],
      prefer: (a: Account) => a.role === 'income',
    });
    expect(groups[2]!.accounts.map((a) => a.id).slice(0, 2)).toEqual(['demo-acc-income', 'demo-acc-event']);
  });

  it('짧은 이름: 통장 이름에서 주인을 빼고 뒤에 붙여요 (이메일 없음)', () => {
    const data = couple();
    const byId = (id: string) => data.accounts.find((a) => a.id === id)!;
    expect(accountShortLabel(data, byId('demo-acc-living-minji'))).toBe('생활비 · 민지');
    expect(accountShortLabel(data, byId('demo-acc-event'))).toBe('이벤트통장');
    expect(baseAccountName('민구 수입통장', '민구')).toBe('수입통장');
    expect(baseAccountName('용돈 - 민구', '민구')).toBe('용돈');
    expect(baseAccountName('민구', '민구')).toBe('민구');
    expect(accountShortLabel(data, { ...byId('demo-acc-living-junho'), deleted: true })).toBe('생활비 · 준호 (지운 통장)');
  });

  it('최근 고른 통장은 기기에 최근 순으로 12개까지 남아요', () => {
    for (let i = 0; i < 14; i++) pushRecentAccount(`a${i}`);
    pushRecentAccount('a5');
    const list = readRecentAccounts();
    expect(list[0]).toBe('a5');
    expect(list).toHaveLength(12);
    expect(new Set(list).size).toBe(12);
    window.localStorage.setItem(RECENT_ACCOUNTS_KEY, '{망가진 값');
    expect(readRecentAccounts()).toEqual([]);
  });
});

function Picker({ filter }: { filter?: (a: Account) => boolean }) {
  const ledger = useLedger();
  const [value, setValue] = useState('');
  if (ledger.status !== 'ready') return null;
  const accounts = filter ? ledger.activeAccounts.filter(filter) : ledger.activeAccounts;
  return (
    <>
      <Field label="통장" error={value === '' ? '통장을 골라 주세요' : undefined}>
        <AccountPicker value={value} onChange={setValue} accounts={accounts} />
      </Field>
      <output data-testid="value">{value}</output>
    </>
  );
}

async function openPicker(filter?: (a: Account) => boolean) {
  const h = renderApp(<Picker filter={filter} />, { couple: true });
  await startDemo(h);
  return h;
}

const trigger = () => screen.getByLabelText(/^통장/) as HTMLButtonElement;

describe('AccountPicker', () => {
  it('닫힌 단추는 짧은 이름, 펼치면 그 자리 목록에 사람별 묶음 · 이름 · 잔액 (이메일 없음)', async () => {
    const h = await openPicker();
    const t = trigger();
    expect(t.getAttribute('aria-haspopup')).toBe('listbox');
    expect(t.getAttribute('aria-expanded')).toBe('false');
    expect(t.textContent).toBe('통장 고르기');
    // 오류는 단추에 이어져요
    expect(t.getAttribute('aria-describedby')).toBeTruthy();
    expect(t.getAttribute('data-invalid')).toBe('true');

    fireEvent.click(t);
    expect(t.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('listbox', { name: '통장' });
    expect(screen.queryByRole('dialog')).toBeNull();
    const groups = within(list).getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['나 · 민지', '준호', '함께']);
    expect(list.textContent).not.toContain('@');
    const balances = current(h).ledger.balances;
    const mine = within(groups[0]!).getAllByRole('option');
    expect(mine[0]!.textContent).toContain('생활비');
    expect(mine[0]!.textContent).toContain(`${formatAmount(balances['demo-acc-living-minji']!)}원`);
    const shared = within(groups[2]!).getByRole('option', { name: /저수지통장/ });
    expect(shared.textContent).toContain(`${formatAmount(balances['demo-acc-reservoir']!)}원`);

    fireEvent.click(within(groups[1]!).getAllByRole('option')[0]!);
    expect(screen.getByTestId('value').textContent).toBe('demo-acc-living-junho');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger().textContent).toBe('생활비 · 준호');
    expect(trigger().value).toBe('demo-acc-living-junho');
    expect(document.activeElement).toBe(trigger());
  });

  it('키보드: ↓로 열고 ↑↓ · Home · End 로 옮기고 Enter 로 골라요, Esc 는 고르지 않고 닫아요', async () => {
    await openPicker();
    const t = trigger();
    fireEvent.keyDown(t, { key: 'ArrowDown' });
    const list = screen.getByRole('listbox');
    expect(document.activeElement).toBe(list);
    const activeId = () => list.getAttribute('aria-activedescendant');
    const idOf = (accountId: string) => list.querySelector(`[data-value="${accountId}"]`)!.id;
    expect(activeId()).toBe(idOf('demo-acc-living-minji'));
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(activeId()).toBe(idOf('demo-acc-allowance-minji'));
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(activeId()).toBe(idOf('demo-acc-living-junho'));
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(activeId()).toBe(idOf('demo-acc-allowance-minji'));
    fireEvent.keyDown(list, { key: 'End' });
    expect(activeId()).toBe(idOf('demo-acc-savings'));
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(activeId()).toBe(idOf('demo-acc-savings'));
    fireEvent.keyDown(list, { key: 'Home' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(screen.getByTestId('value').textContent).toBe('demo-acc-allowance-minji');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(t);

    // 다시 열면 고른 통장에서 시작, Esc 는 그대로 닫혀요
    fireEvent.keyDown(t, { key: 'ArrowDown' });
    const again = screen.getByRole('listbox');
    expect(again.getAttribute('aria-activedescendant')).toBe(again.querySelector('[data-value="demo-acc-allowance-minji"]')!.id);
    expect(again.querySelector('[aria-selected="true"]')!.getAttribute('data-value')).toBe('demo-acc-allowance-minji');
    fireEvent.keyDown(again, { key: 'ArrowDown' });
    fireEvent.keyDown(again, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByTestId('value').textContent).toBe('demo-acc-allowance-minji');
    expect(document.activeElement).toBe(t);
  });

  it('고른 통장은 기기에 남아 다음에 묶음 안에서 위로 올라가요', async () => {
    await openPicker();
    expect(listedAccounts(trigger()).slice(4)).toEqual(['demo-acc-income', 'demo-acc-event', 'demo-acc-reservoir', 'demo-acc-savings']);
    fireEvent.click(screen.getByRole('listbox').querySelector('[data-value="demo-acc-reservoir"]')!);
    expect(readRecentAccounts()[0]).toBe('demo-acc-reservoir');
    expect(listedAccounts(trigger()).slice(4)).toEqual(['demo-acc-reservoir', 'demo-acc-income', 'demo-acc-event', 'demo-acc-savings']);
  });

  it('바깥을 누르면 닫혀요', async () => {
    await openPicker();
    fireEvent.click(trigger());
    expect(screen.getByRole('listbox')).toBeTruthy();
    act(() => {
      fireEvent.pointerDown(document.body);
    });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('화면이 거른 통장만 보여요', async () => {
    await openPicker((a) => a.role === 'fixed');
    expect(listedAccounts(trigger())).toEqual(['demo-acc-living-minji', 'demo-acc-living-junho']);
  });
});
