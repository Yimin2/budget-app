// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage, LocalBackend } from '@/storage';
import type { LedgerBackend, LedgerRef } from '@/storage/types';
import { current, fakeGoogle, renderApp, startDemo } from '../_components/__tests__/harness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/settings',
}));

import { RequireLedger } from '../_components/RequireLedger';
import { MembersCards } from './sections/MembersCard';

/** 설정 화면의 멤버 · 공유 묶음 (예전 /members 는 /settings#members 로 와요) */
function MembersPage() {
  return <RequireLedger>{(ledger) => <MembersCards ledger={ledger} />}</RequireLedger>;
}

afterEach(cleanup);

describe('설정 · 멤버 · 공유', () => {
  it('목록(나 표시) · 체험 모드 안내 · 이메일로 초대', async () => {
    const h = renderApp(<MembersPage />);
    await startDemo(h);

    const list = screen.getByRole('heading', { level: 2, name: '함께 쓰는 사람' }).closest('.card') as HTMLElement;
    expect(within(list).getByText('2명')).toBeTruthy();
    // 예전 /members 주소는 /settings#members 로 와서 이 카드로 스크롤해요
    expect(list.id).toBe('members');
    expect(within(list).getByText('나')).toBeTruthy();
    expect(screen.getByText('체험 모드에서는 이름만 기록돼요')).toBeTruthy();
    expect(screen.getByText('초대하면 이렇게 돼요')).toBeTruthy();

    const email = screen.getByLabelText(/이메일/);
    fireEvent.change(email, { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: '초대하기' }));
    expect(screen.getByText('이메일 주소를 확인해 주세요')).toBeTruthy();

    fireEvent.change(email, { target: { value: 'junho@demo' } });
    fireEvent.click(screen.getByRole('button', { name: '초대하기' }));
    expect(screen.getByText('이미 멤버예요')).toBeTruthy();

    fireEvent.change(email, { target: { value: 'sora@example.com' } });
    fireEvent.change(screen.getByLabelText(/표시 이름/), { target: { value: '소라' } });
    fireEvent.click(screen.getByRole('button', { name: '초대하기' }));
    await waitFor(() =>
      expect(current(h).ledger.data!.members.find((m) => m.email === 'sora@example.com')?.displayName).toBe('소라'),
    );
    expect(await screen.findByText('멤버로 기록했어요')).toBeTruthy();
    expect((email as HTMLInputElement).value).toBe('');
  });

  it('수입통장: 초대할 때 고르고, 멤버 줄에서 바꿔 이어요', async () => {
    const h = renderApp(<MembersPage />);
    await startDemo(h);
    let extraId = '';
    await act(async () => {
      extraId = (await current(h).ledger.addAccount({ name: '새 수입통장', role: 'income', openingBalance: 0 })).id;
    });
    const accountOf = (id: string) => current(h).ledger.data!.accounts.find((a) => a.id === id)!;
    const junhoIncome = current(h).ledger.data!.accounts.find((a) => a.ownerEmail === 'junho@demo')!.id;

    // 멤버 줄마다 수입통장이 보여요 (체험: 민지 · 준호)
    const rowOf = (email: string) => screen.getByText(email).closest('li') as HTMLElement;
    const junhoSelect = within(rowOf('junho@demo')).getByRole('combobox', { name: '수입통장' }) as HTMLSelectElement;
    expect(junhoSelect.value).toBe(junhoIncome);

    // 초대하면서 수입통장을 고르면 그 통장 주인이 돼요
    fireEvent.change(screen.getByLabelText(/^이메일/), { target: { value: 'sora@example.com' } });
    fireEvent.change(screen.getByLabelText(/표시 이름/), { target: { value: '최소라' } });
    const inviteCard = screen.getByRole('heading', { level: 2, name: '멤버 초대' }).closest('.card') as HTMLElement;
    fireEvent.change(within(inviteCard).getByRole('combobox', { name: /수입통장/ }), { target: { value: extraId } });
    fireEvent.click(screen.getByRole('button', { name: '초대하기' }));
    await waitFor(() => expect(accountOf(extraId).ownerEmail).toBe('sora@example.com'));
    expect(accountOf(extraId).ownerName).toBe('최소라');

    // 준호 줄에서 그 통장으로 바꾸면: 그 통장은 준호 것, 준호의 예전 통장 · 소라는 이메일이 비워져요
    fireEvent.change(within(rowOf('junho@demo')).getByRole('combobox', { name: '수입통장' }), { target: { value: extraId } });
    await waitFor(() => expect(accountOf(extraId).ownerEmail).toBe('junho@demo'));
    expect(accountOf(junhoIncome).ownerEmail).toBeNull();
    expect(await screen.findByText('수입통장을 이었어요')).toBeTruthy();
  });

  it('개인 가계부는 초대 대신 안내', async () => {
    const h = renderApp(<MembersPage />);
    await startDemo(h);
    await act(async () => {
      await current(h).session.createLedger({ kind: 'personal', name: '내 용돈' });
    });
    expect(await screen.findByRole('heading', { level: 2, name: '개인 가계부예요' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '초대하기' })).toBeNull();
  });

  it('체험 모드: 링크 복사는 구글 가계부에서만 된다고 알려요', async () => {
    const h = renderApp(<MembersPage />);
    await startDemo(h);
    expect(screen.getByText(/링크로 공유할 수 없어요/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '링크 복사' }));
    expect(await screen.findByText(/초대 링크는 구글 시트 가계부에서만 쓸 수 있어요/)).toBeTruthy();
  });

  it('구글 가계부: 초대 뒤 링크를 보내 달라고 알리고 /start?open=<id> 를 복사해요', async () => {
    // 브라우저 저장소로 시트 백엔드를 흉내 내요 (source 만 sheets)
    const inner = new LocalBackend(createMemoryStorage());
    const asSheets = (r: LedgerRef): LedgerRef => ({ ...r, source: 'sheets' });
    const sheets: LedgerBackend = {
      source: 'sheets',
      create: async (data) => asSheets(await inner.create(data)),
      open: (ref) => {
        const r = inner.open({ ...ref, source: 'local' });
        return {
          ref,
          load: () => r.load(),
          insert: (t, rows) => r.insert(t, rows),
          upsert: (t, row) => r.upsert(t, row),
          upsertMany: (t, rows) => r.upsertMany(t, rows),
          updateSettings: (patch) => r.updateSettings(patch),
        };
      },
      share: (ref, email) => inner.share({ ...ref, source: 'local' }, email),
      describe: async (id) => asSheets(await inner.describe(id)),
    };
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const h = renderApp(<MembersPage />, { google: fakeGoogle({ isGoogleConfigured: () => true }), sheets });
    await waitFor(() => expect(current(h).session.status).toBe('signedOut'));
    await act(async () => {
      await current(h).session.signInWithGoogle();
    });
    let ref: LedgerRef | null = null;
    await act(async () => {
      ref = await current(h).session.createLedger({ kind: 'shared', name: '우리집' });
    });
    await waitFor(() => expect(current(h).ledger.status).toBe('ready'));
    const id = (ref as LedgerRef | null)!.id;
    const link = `${window.location.origin}/start?open=${encodeURIComponent(id)}`;
    expect((screen.getByRole('textbox', { name: '초대 링크' }) as HTMLInputElement).value).toBe(link);

    fireEvent.change(screen.getByLabelText(/이메일/), { target: { value: 'junho@example.com' } });
    fireEvent.change(screen.getByLabelText(/표시 이름/), { target: { value: '준호' } });
    fireEvent.click(screen.getByRole('button', { name: '초대하기' }));
    expect(await screen.findByText('준호님에게 이 링크를 보내 주세요')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '링크 복사' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(link));
    expect(await screen.findByText('초대 링크를 복사했어요')).toBeTruthy();
    Reflect.deleteProperty(navigator, 'clipboard');
  });
});
