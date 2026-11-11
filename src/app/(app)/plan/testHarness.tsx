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
import { fireEvent, screen, within } from '@testing-library/react';
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
export function makeHarness(opts: { history?: boolean } = {}) {
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
    demoHistory: opts.history ?? false,
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

/** '일정' 카드의 [+ 추가] 메뉴를 열고 이름이 맞는 항목을 눌러요. 연 메뉴 항목을 돌려줘요 */
export function chooseScheduleAdd(name: string | RegExp): HTMLElement {
  const schedule = screen.getByRole('region', { name: /^일정/ });
  fireEvent.click(within(schedule).getByRole('button', { name: '추가' }));
  const menu = within(schedule).getByRole('menu', { name: '무엇을 추가할까요' });
  const item = within(menu).getByRole('menuitem', { name });
  fireEvent.click(item);
  return item;
}
