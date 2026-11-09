/* 화면 테스트 도우미: 메모리 저장소로 AppProviders 를 띄우고 체험 모드를 시작해요.
   next/navigation 은 각 테스트 파일에서 vi.mock 으로 바꿔 주세요. */
import { act, render, waitFor, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { AppProviders, useLedger, useSession, type GoogleDeps, type LedgerApi, type SessionApi, type StateDeps } from '@/state';
import { createMemoryStorage, LocalBackend, type KeyValueStorage } from '@/storage';
import type { LedgerBackend } from '@/storage/types';
import { ToastProvider } from '@/ui';

export function fakeGoogle(overrides: Partial<GoogleDeps> = {}): GoogleDeps {
  return {
    isGoogleConfigured: () => false,
    signIn: async () => ({ email: 'a@b.c', name: 'A', picture: null }),
    signOut: () => {},
    restoreSession: () => new Promise(() => {}),
    pickSpreadsheet: async () => null,
    getAccessToken: async () => 'token',
    ...overrides,
  };
}

export interface Probe {
  session: SessionApi;
  ledger: LedgerApi;
}

export interface AppHarness {
  probe: { current: Probe | null };
  clock: { now: Date };
  ledgerStorage: KeyValueStorage;
  local: LocalBackend;
  view: RenderResult;
  rerender(ui: ReactElement): void;
}

function ProbeView({ target }: { target: { current: Probe | null } }) {
  // eslint-disable-next-line react-hooks/immutability -- 테스트에서 최신 값을 읽으려고 씀
  target.current = { session: useSession(), ledger: useLedger() };
  return null;
}

export function renderApp(
  ui: ReactElement,
  opts: { now?: Date; ledgerStorage?: KeyValueStorage; google?: GoogleDeps } = {},
): AppHarness {
  const clock = { now: opts.now ?? new Date(2026, 10, 20, 10, 0, 0) };
  const ledgerStorage = opts.ledgerStorage ?? createMemoryStorage();
  const local = new LocalBackend(ledgerStorage);
  const deps: Partial<StateDeps> = {
    google: opts.google ?? fakeGoogle(),
    local,
    sheets: {} as LedgerBackend,
    now: () => clock.now,
    storage: createMemoryStorage(),
    restoreTimeoutMs: 50,
  };
  const probe: { current: Probe | null } = { current: null };
  const wrap = (children: ReactNode) => (
    <ToastProvider>
      <AppProviders deps={deps}>
        <ProbeView target={probe} />
        {children}
      </AppProviders>
    </ToastProvider>
  );
  const view = render(wrap(ui));
  return { probe, clock, ledgerStorage, local, view, rerender: (next) => view.rerender(wrap(next)) };
}

/** 세션을 읽은 뒤 체험 모드를 시작하고 가계부가 준비될 때까지 기다려요 */
export async function startDemo(h: AppHarness): Promise<void> {
  await waitFor(() => expect(h.probe.current?.session.status).toBe('signedOut'));
  await act(async () => {
    await h.probe.current!.session.startDemo();
  });
  await waitFor(() => expect(h.probe.current?.ledger.status).toBe('ready'));
}

export function current(h: AppHarness): Probe {
  if (!h.probe.current) throw new Error('앱이 아직 그려지지 않았어요');
  return h.probe.current;
}
