// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { current, renderApp, startDemo } from '../_components/__tests__/harness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/members',
}));

import MembersPage from './page';

afterEach(cleanup);

describe('멤버 화면', () => {
  it('목록(나 표시) · 체험 모드 안내 · 이메일로 초대', async () => {
    const h = renderApp(<MembersPage />);
    await startDemo(h);

    const list = screen.getByRole('heading', { level: 2, name: '함께 쓰는 사람' }).closest('.card') as HTMLElement;
    expect(within(list).getByText('2명')).toBeTruthy();
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

  it('개인 가계부는 초대 대신 안내', async () => {
    const h = renderApp(<MembersPage />);
    await startDemo(h);
    await act(async () => {
      await current(h).session.createLedger({ kind: 'personal', name: '내 용돈' });
    });
    expect(await screen.findByRole('heading', { level: 2, name: '개인 가계부예요' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '초대하기' })).toBeNull();
  });
});
