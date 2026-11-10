// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { current, fakeGoogle, renderApp } from '@/app/(app)/_components/__tests__/harness';

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => nav.router, usePathname: () => '/start' }));

import type { LedgerBackend, LedgerRef } from '@/storage/types';
import StartPage from './page';

const SHEET_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
const SHARED_REF: LedgerRef = { id: SHEET_ID, name: '민지·준호 가계부', kind: 'shared', source: 'sheets' };

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** describe 만 쓰는 가짜 시트 백엔드. allowed 에 있는 id 만 읽혀요 (drive.file) */
function fakeSheets(allowed: Set<string>, opts: { notLedger?: boolean } = {}): LedgerBackend {
  return {
    source: 'sheets',
    create: async () => Promise.reject(new Error('unused')),
    // 홈으로 가면 불러오기가 시작돼요. 이 테스트에서는 끝나지 않게 둬요
    open: (ref) => ({
      ref,
      load: () => new Promise(() => {}),
      insert: async () => {},
      upsert: async () => {},
      upsertMany: async () => {},
      updateSettings: async () => {},
    }),
    share: async () => {},
    describe: vi.fn(async (id: string) => {
      if (!allowed.has(id)) throw new HttpError('권한이 없어요', 404);
      if (opts.notLedger) throw new HttpError('이 파일은 가계부로 열 수 없어요. 이 앱에서 만든 가계부 파일을 골라 주세요', 400);
      return { ...SHARED_REF, id };
    }),
  };
}

function setSearch(search: string) {
  window.history.replaceState({}, '', `/start${search}`);
}

afterEach(() => {
  cleanup();
  setSearch('');
});
beforeEach(() => vi.clearAllMocks());

describe('/start', () => {
  it('로그인 전: 앱 약속 · 구글 설정이 없으면 버튼을 막고 이유를 보여 줘요 · 체험해 보기 → 홈', async () => {
    const h = renderApp(<StartPage />);
    expect(await screen.findByRole('heading', { level: 1, name: '사기 전에 써도 되는지 알려주는 가계부' })).toBeTruthy();
    const google = screen.getByRole('button', { name: '구글로 시작하기' }) as HTMLButtonElement;
    expect(google.disabled).toBe(true);
    expect(google.getAttribute('aria-describedby')).toBe('sp-google-off');
    expect(screen.getByText(/구글 로그인이 아직 설정되지 않았어요/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '체험해 보기' }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/'));
    expect(current(h).session.mode).toBe('demo');
  });

  it('구글 로그인 뒤 고른 가계부가 없으면 "공유받은 가계부가 있나요?"를 먼저 보여 줘요', async () => {
    const pickSpreadsheet = vi.fn(async () => null);
    const h = renderApp(<StartPage />, { google: fakeGoogle({ isGoogleConfigured: () => true, pickSpreadsheet }) });
    const google = (await screen.findByRole('button', { name: '구글로 시작하기' })) as HTMLButtonElement;
    expect(google.disabled).toBe(false);
    fireEvent.click(google);
    expect(await screen.findByRole('heading', { level: 1, name: '어떤 가계부를 열까요?' })).toBeTruthy();
    expect(current(h).session.status).toBe('signedIn');
    expect(nav.router.replace).not.toHaveBeenCalledWith('/');
    const prompt = screen.getByRole('region', { name: '공유받은 가계부가 있나요?' });
    // 공유받은 가계부 열기가 먼저, 새로 만들기는 그 아래
    const open = within(prompt).getByRole('button', { name: '공유받은 가계부 열기' });
    const create = within(prompt).getByRole('link', { name: '새 가계부 만들기' });
    expect(create.getAttribute('href')).toBe('/start/new');
    expect(open.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('아직 연 가계부가 없어요')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '공유받은 가계부 열기' }));
    await waitFor(() => expect(pickSpreadsheet).toHaveBeenCalled());
    // 고르지 않고 닫으면 그대로
    expect(screen.getByRole('heading', { level: 1, name: '어떤 가계부를 열까요?' })).toBeTruthy();
  });

  it('로그인했으면 최근 가계부를 열거나 목록에서 뺄 수 있어요', async () => {
    const h = renderApp(<StartPage />);
    fireEvent.click(await screen.findByRole('button', { name: '체험해 보기' }));
    await waitFor(() => expect(current(h).session.status).toBe('signedIn'));
    const list = screen.getByRole('heading', { level: 2, name: '최근 가계부' }).closest('.card') as HTMLElement;
    expect(within(list).getByText('지금 가계부')).toBeTruthy();
    expect((screen.getByRole('button', { name: '공유받은 가계부 열기' }) as HTMLButtonElement).disabled).toBe(true);

    nav.router.push.mockClear();
    fireEvent.click(within(list).getByRole('button', { name: '민지·준호 가계부, 공용 가계부, 이 브라우저, 지금 가계부' }));
    expect(nav.router.push).toHaveBeenCalledWith('/');

    fireEvent.click(within(list).getByRole('button', { name: '민지·준호 가계부 목록에서 빼기' }));
    await waitFor(() => expect(current(h).session.recentLedgers).toHaveLength(0));
    expect(current(h).session.activeLedger).toBeNull();
    expect(screen.getByText('아직 연 가계부가 없어요')).toBeTruthy();
  });

  it('최근 가계부가 있으면 첫 로그인 안내는 보이지 않아요', async () => {
    const allowed = new Set([SHEET_ID]);
    const pickSpreadsheet = vi.fn(async () => ({ id: SHEET_ID, name: '민지·준호 가계부' }));
    const h = renderApp(<StartPage />, { google: fakeGoogle({ isGoogleConfigured: () => true, pickSpreadsheet }), sheets: fakeSheets(allowed) });
    fireEvent.click(await screen.findByRole('button', { name: '구글로 시작하기' }));
    fireEvent.click(await screen.findByRole('button', { name: '공유받은 가계부 열기' }));
    await waitFor(() => expect(current(h).session.recentLedgers).toHaveLength(1));
    expect(screen.queryByRole('region', { name: '공유받은 가계부가 있나요?' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: '최근 가계부' })).toBeTruthy();
  });
});

describe('/start?open=<id> 초대 링크', () => {
  it('로그인 전: 초대 안내 → 구글 로그인 → 그 파일을 골라 둔 선택 창 → 열고 최근 목록에 넣어요', async () => {
    setSearch(`?open=${SHEET_ID}`);
    const allowed = new Set<string>();
    const pickSpreadsheet = vi.fn(async (opts?: { fileId?: string }) => {
      allowed.add(opts?.fileId ?? '');
      return { id: opts?.fileId ?? '', name: '민지·준호 가계부' };
    });
    const h = renderApp(<StartPage />, { google: fakeGoogle({ isGoogleConfigured: () => true, pickSpreadsheet }), sheets: fakeSheets(allowed) });
    expect(await screen.findByRole('heading', { level: 1, name: '가계부에 초대받았어요' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '체험해 보기' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '구글로 로그인하고 열기' }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/'));
    expect(pickSpreadsheet).toHaveBeenCalledTimes(1);
    expect(pickSpreadsheet).toHaveBeenCalledWith({ fileId: SHEET_ID });
    expect(current(h).session.activeLedger).toEqual(SHARED_REF);
    expect(current(h).session.recentLedgers).toEqual([SHARED_REF]);
  });

  it('이미 읽을 수 있는 파일(내 링크)은 선택 창 없이 바로 열어요', async () => {
    setSearch(`?open=${SHEET_ID}`);
    const pickSpreadsheet = vi.fn(async () => null);
    const h = renderApp(<StartPage />, {
      google: fakeGoogle({ isGoogleConfigured: () => true, pickSpreadsheet }),
      sheets: fakeSheets(new Set([SHEET_ID])),
    });
    fireEvent.click(await screen.findByRole('button', { name: '구글로 로그인하고 열기' }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/'));
    expect(pickSpreadsheet).not.toHaveBeenCalled();
    expect(current(h).session.activeLedger?.id).toBe(SHEET_ID);
  });

  it('선택 창을 닫으면 안내 + 다시 열기 · 다른 가계부 고르기', async () => {
    setSearch(`?open=${SHEET_ID}`);
    const allowed = new Set<string>();
    let cancel = true;
    const pickSpreadsheet = vi.fn(async (opts?: { fileId?: string }) => {
      if (cancel) return null;
      allowed.add(opts?.fileId ?? '');
      return { id: opts?.fileId ?? '', name: '' };
    });
    const h = renderApp(<StartPage />, { google: fakeGoogle({ isGoogleConfigured: () => true, pickSpreadsheet }), sheets: fakeSheets(allowed) });
    fireEvent.click(await screen.findByRole('button', { name: '구글로 로그인하고 열기' }));
    expect(await screen.findByText('아직 열지 않았어요')).toBeTruthy();
    expect(current(h).session.recentLedgers).toHaveLength(0);

    cancel = false;
    fireEvent.click(screen.getByRole('button', { name: '다시 열기' }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/'));
    expect(pickSpreadsheet).toHaveBeenCalledTimes(2);
    expect(current(h).session.activeLedger?.id).toBe(SHEET_ID);
  });

  it('가계부가 아닌 파일이면 오류 문구, 다른 가계부 고르기로 평소 화면', async () => {
    setSearch(`?open=${SHEET_ID}`);
    renderApp(<StartPage />, {
      google: fakeGoogle({ isGoogleConfigured: () => true }),
      sheets: fakeSheets(new Set([SHEET_ID]), { notLedger: true }),
    });
    fireEvent.click(await screen.findByRole('button', { name: '구글로 로그인하고 열기' }));
    expect(await screen.findByText(/이 파일은 가계부로 열 수 없어요/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다른 가계부 고르기' }));
    expect(nav.router.replace).toHaveBeenCalledWith('/start');
    expect(await screen.findByRole('heading', { level: 1, name: '어떤 가계부를 열까요?' })).toBeTruthy();
  });

  it('구글 설정이 없으면 로그인 버튼을 막고 이유를 보여 줘요', async () => {
    setSearch(`?open=${SHEET_ID}`);
    renderApp(<StartPage />);
    const btn = (await screen.findByRole('button', { name: '구글로 로그인하고 열기' })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/초대받은 가계부를 열 수 없어요/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '초대 없이 둘러보기' }));
    expect(await screen.findByRole('heading', { level: 1, name: '사기 전에 써도 되는지 알려주는 가계부' })).toBeTruthy();
  });

  it('체험 모드에서는 구글 가계부에서만 된다고 알려요', async () => {
    setSearch(`?open=${SHEET_ID}`);
    const h = renderApp(<StartPage />);
    expect(await screen.findByRole('heading', { level: 1, name: '가계부에 초대받았어요' })).toBeTruthy();
    await act(async () => {
      await current(h).session.startDemo();
    });
    expect(await screen.findByText('지금은 체험 모드예요')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '체험 모드 끝내기' }));
    await waitFor(() => expect(current(h).session.status).toBe('signedOut'));
    expect(screen.getByRole('button', { name: '구글로 로그인하고 열기' })).toBeTruthy();
  });
});
