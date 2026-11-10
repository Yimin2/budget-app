// @vitest-environment jsdom
/** 설정 > 파일에서 가져오기: 파일 고르기 → 미리보기 → 가져오기 (체험 가계부 · 가짜 데이터) */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseImportFile } from '@/domain';
import { current, renderApp, startDemo, type AppHarness } from '../_components/__tests__/harness';

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => nav.router, usePathname: () => '/settings' }));

import SettingsPage from './page';

afterEach(cleanup);

const FILE = {
  format: 'budget-import',
  version: 1,
  source: 'ui-test',
  name: '옮길 가계부',
  accounts: [
    { key: 'inc', name: '다온 수입통장', role: 'income', openingDate: '2026-11-15', ownerName: '다온' },
    { key: 'event', name: '이벤트통장', role: 'event', openingDate: '2026-11-15' },
    { key: 'fixed', name: '고정지출통장', role: 'fixed', openingDate: '2026-11-15' },
  ],
  categories: [{ key: 'hobby', name: '취미', icon: 'sparkles', note: '한 달 5만' }],
  rules: [{ key: 'r1', from: 'inc', to: 'event', amount: 100_000, dayOfMonth: 25, startMonth: '2026-12' }],
  fixedExpenses: [{ key: 'net', name: '인터넷', amount: 33_000, account: 'fixed', kind: 'bill', dayOfMonth: 28, startMonth: '2026-12', memo: '2년 약정' }],
  expenses: [
    { key: 'e1', date: '2026-11-16', amount: 12_000, account: 'event', category: 'hobby', memo: '퍼즐' },
    { key: 'e2', date: '2026-11-17', amount: 48_000, account: 'event', memo: '선물 세트', claim: { payer: '다온', status: 'pending', due: '2026-11-25' } },
  ],
};

function pick(json: unknown, name = 'import.json') {
  const input = screen.getByLabelText('가져올 파일') as HTMLInputElement;
  const file = new File([typeof json === 'string' ? json : JSON.stringify(json)], name, { type: 'application/json' });
  fireEvent.change(input, { target: { files: [file] } });
}

async function open(): Promise<AppHarness> {
  const h = renderApp(<SettingsPage />);
  await startDemo(h);
  expect(screen.getByRole('heading', { level: 2, name: '파일에서 가져오기' })).toBeTruthy();
  return h;
}

describe('파일에서 가져오기', () => {
  it('미리보기를 보여 주고, 가져오기를 눌러야 쓰고, 다시 가져와도 늘지 않아요', async () => {
    const h = await open();
    const before = current(h).ledger.data!;
    pick(FILE);
    const dialog = await screen.findByRole('dialog', { name: '가져오기 미리보기' });
    const preview = within(dialog).getByTestId('import-preview');
    const row = (label: string) => within(preview).getByRole('rowheader', { name: label }).closest('tr')!;
    expect(row('통장').textContent).toContain('새로 1개 · 합침 2개');
    expect(row('지출').textContent).toContain('60,000원');
    expect(row('고정 지출').textContent).toContain('33,000원');
    expect(within(preview).getByText(/돌려받을 돈 48,000원 \(다온 48,000원\)/)).toBeTruthy();
    expect(within(preview).getByText(/통장 이벤트통장: 있던 통장에 합쳐요/)).toBeTruthy();
    expect(within(preview).getByText('취미: 한 달 5만')).toBeTruthy();
    // 미리보기만으로는 아무것도 쓰지 않아요
    expect(current(h).ledger.data!.expenses).toHaveLength(before.expenses.length);

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '가져오기' }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '가져오기 미리보기' })).toBeNull());
    expect(await screen.findByText('6개를 가져왔어요')).toBeTruthy();

    const stored = await h.local.open(current(h).ledger.ref!).load();
    const event = before.accounts.find((a) => a.role === 'event')!;
    const claim = stored.expenses.find((e) => e.id === 'imp:ui-test:exp:e2')!;
    expect(claim).toMatchObject({ accountId: event.id, paidBy: '다온', claimAccountId: 'imp:ui-test:acc:inc', claimDue: '2026-11-25' });
    expect(stored.fixedExpenses.find((f) => f.id === 'imp:ui-test:fx:net')).toMatchObject({ memo: '2년 약정', amount: 33_000 });
    expect(stored.accounts.filter((a) => a.name === '이벤트통장')).toHaveLength(1);
    expect(current(h).ledger.claims!.byPayer).toContainEqual({ name: '다온', amount: 48_000 });

    // 같은 파일 다시: 미리보기는 '이미 모두 가져온 파일'이고 가져오기 버튼이 꺼져 있어요
    pick(FILE);
    const again = await screen.findByRole('dialog', { name: '가져오기 미리보기' });
    expect(within(again).getByText('이미 모두 가져온 파일이에요')).toBeTruthy();
    expect((within(again).getByRole('button', { name: '가져오기' }) as HTMLButtonElement).disabled).toBe(true);
    // 상태 계층에서 바로 다시 가져와도 행이 늘지 않아요
    const counts = (d: typeof stored) => [d.accounts.length, d.categories.length, d.rules.length, d.fixedExpenses.length, d.expenses.length];
    let written = -1;
    await act(async () => {
      written = (await current(h).ledger.importFile(parsedFile())).total;
    });
    expect(written).toBe(0);
    expect(counts(await h.local.open(current(h).ledger.ref!).load())).toEqual(counts(stored));
  });

  it('틀린 파일은 미리보기 없이 고칠 곳을 알려요', async () => {
    await open();
    pick({ ...FILE, version: 9 });
    expect(await screen.findByText('이 파일은 가져올 수 없어요')).toBeTruthy();
    expect(screen.getByText(/버전 1 파일만 읽어요/)).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: '가져오기 미리보기' })).toBeNull();
    pick('not json');
    expect(await screen.findByText(/JSON 파일인지 확인해 주세요/)).toBeTruthy();
  });
});

function parsedFile() {
  const r = parseImportFile(JSON.stringify(FILE));
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.file;
}
