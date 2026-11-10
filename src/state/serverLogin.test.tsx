// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { GoogleError } from '@/google';
import { createMemoryStorage, LocalBackend } from '@/storage';
import type { LedgerBackend, LedgerRef } from '@/storage/types';
import { SessionProvider, useSession, type GoogleDeps, type StateDeps } from './session';
import { REMEMBER_KEY, SESSION_KEY } from './storageKeys';

const USER = { email: 'a@gmail.com', name: '가나', picture: null };
const REF: LedgerRef = { id: 'sheet-1', name: '우리 가계부', kind: 'shared', source: 'sheets' };

function fakeGoogle(over: Partial<GoogleDeps> = {}): GoogleDeps {
  return {
    isGoogleConfigured: () => true,
    signIn: async () => USER,
    signOut: vi.fn(),
    restoreSession: async () => null,
    pickSpreadsheet: async () => null,
    getAccessToken: async () => 'token',
    ...over,
  };
}

function setup(google: GoogleDeps, storage = createMemoryStorage()) {
  const deps: Partial<StateDeps> = {
    google,
    local: new LocalBackend(createMemoryStorage()),
    sheets: {} as LedgerBackend,
    storage,
    restoreTimeoutMs: 200,
  };
  const wrapper = ({ children }: { children: ReactNode }) => <SessionProvider deps={deps}>{children}</SessionProvider>;
  return { ...renderHook(() => useSession(), { wrapper }), storage };
}

describe('세션 — 로그인 서버', () => {
  it('구글 로그인 화면에서 돌아오면(?auth=1) 팝업 없이 서버 쿠키로 로그인돼요', async () => {
    const resume = vi.fn(async () => USER);
    const r = setup(fakeGoogle({ resumeServerSession: resume, consumeAuthReturn: () => ({ returned: true, error: null }) }));
    expect(r.result.current.status).toBe('loading');
    await waitFor(() => expect(r.result.current.status).toBe('signedIn'));
    expect(resume).toHaveBeenCalledWith({ force: true });
    expect(r.result.current.mode).toBe('google');
    expect(r.result.current.user?.email).toBe(USER.email);
  });

  it('서버 쿠키가 없으면 로그인 화면 그대로', async () => {
    const r = setup(fakeGoogle({ resumeServerSession: async () => null }));
    await waitFor(() => expect(r.result.current.status).toBe('signedOut'));
    expect(r.result.current.notice).toBeNull();
  });

  it('돌아왔는데 만료면 로그인 버튼과 만료 안내', async () => {
    const r = setup(fakeGoogle({ resumeServerSession: async () => Promise.reject(new GoogleError('session_expired')) }));
    await waitFor(() => expect(r.result.current.status).toBe('signedOut'));
    expect(r.result.current.notice).toBe('로그인이 만료됐어요. 다시 로그인해 주세요');
  });

  it('로그인 서버가 돌려보낸 오류 (?auth_error=consent_denied) 를 안내해요', async () => {
    const r = setup(fakeGoogle({ resumeServerSession: async () => null, consumeAuthReturn: () => ({ returned: false, error: 'consent_denied' }) }));
    await waitFor(() => expect(r.result.current.status).toBe('signedOut'));
    expect(r.result.current.notice).toContain('구글 드라이브 권한');
  });

  it('쓰는 중에 만료되면 로그아웃 + 안내, 같은 계정으로 돌아오면 최근 가계부를 되살려요', async () => {
    let ended: ((reason: 'expired' | 'signed_out') => void) | null = null;
    const storage = createMemoryStorage();
    storage.setItem(SESSION_KEY, JSON.stringify({ mode: 'google', user: USER, recentLedgers: [REF], activeLedgerId: REF.id }));
    const google = fakeGoogle({
      restoreSession: async () => USER,
      onSessionEnded: (l) => {
        ended = l;
        return () => {
          ended = null;
        };
      },
    });
    const r = setup(google, storage);
    await waitFor(() => expect(r.result.current.activeLedger?.id).toBe(REF.id));

    act(() => ended!('expired'));
    expect(r.result.current.status).toBe('signedOut');
    expect(r.result.current.notice).toBe('로그인이 만료됐어요. 다시 로그인해 주세요');
    expect(JSON.parse(storage.getItem(REMEMBER_KEY)!)).toMatchObject({ email: USER.email, activeLedgerId: REF.id });

    await act(async () => {
      await r.result.current.signInWithGoogle();
    });
    expect(r.result.current.status).toBe('signedIn');
    expect(r.result.current.activeLedger?.id).toBe(REF.id);
    expect(r.result.current.notice).toBeNull();
    expect(storage.getItem(REMEMBER_KEY)).toBeNull();
  });

  it('모든 기기에서 로그아웃은 권한 철회로 넘겨요', async () => {
    const signOut = vi.fn();
    const storage = createMemoryStorage();
    storage.setItem(SESSION_KEY, JSON.stringify({ mode: 'google', user: USER, recentLedgers: [], activeLedgerId: null }));
    const r = setup(fakeGoogle({ signOut }), storage);
    await waitFor(() => expect(r.result.current.status).toBe('signedIn'));
    act(() => r.result.current.signOut({ everywhere: true }));
    expect(signOut).toHaveBeenCalledWith({ revoke: true });
    expect(r.result.current.status).toBe('signedOut');
  });
});
