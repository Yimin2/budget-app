/* 이벤트 화면 테스트 도우미 — 체험 가계부로 상태 계층을 실제로 돌려요 */
import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import { createMemoryStorage, LocalBackend } from '@/storage';
import type { LedgerBackend } from '@/storage/types';
import {
  AppProviders,
  useLedger,
  useSession,
  type GoogleDeps,
  type LedgerApi,
  type SessionApi,
  type StateDeps,
} from '@/state';
import { ToastProvider } from '@/ui';

export const TEST_NOW = new Date(2026, 10, 20, 10, 0, 0); // 2026-11-20 (금)

function fakeGoogle(): GoogleDeps {
  return {
    isGoogleConfigured: () => false,
    signIn: async () => ({ email: 'a@b.c', name: 'A', picture: null }),
    signOut: () => {},
    restoreSession: () => new Promise(() => {}),
    pickSpreadsheet: async () => null,
    getAccessToken: async () => 'token',
  };
}

export interface Probe {
  ledger: LedgerApi | null;
  session: SessionApi | null;
}

/** 체험 모드를 시작하는 감싸개와, 지금 상태를 들여다보는 probe */
export function makeHarness() {
  const probe: Probe = { ledger: null, session: null };

  function ProbeAndStart() {
    const session = useSession();
    const ledger = useLedger();
    useLayoutEffect(() => {
      probe.session = session;
      probe.ledger = ledger;
    });
    useEffect(() => {
      if (session.status === 'signedOut') void session.startDemo();
    }, [session]);
    return null;
  }
  const deps: Partial<StateDeps> = {
    google: fakeGoogle(),
    local: new LocalBackend(createMemoryStorage()),
    sheets: {} as LedgerBackend,
    now: () => TEST_NOW,
    storage: createMemoryStorage(),
    restoreTimeoutMs: 20,
    demoCouple: false,
  };
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ToastProvider>
        <AppProviders deps={deps}>
          <ProbeAndStart />
          {children}
        </AppProviders>
      </ToastProvider>
    );
  }
  return { probe, Wrapper };
}
