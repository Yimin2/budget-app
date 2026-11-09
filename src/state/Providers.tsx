'use client';

import type { ReactNode } from 'react';
import { LedgerProvider } from './ledger';
import { SessionProvider, type StateDeps } from './session';

/** 앱 전체 상태 (화면 요소 없음). deps 는 테스트에서만 넘긴다 */
export function AppProviders({ children, deps }: { children: ReactNode; deps?: Partial<StateDeps> }) {
  return (
    <SessionProvider deps={deps}>
      <LedgerProvider>{children}</LedgerProvider>
    </SessionProvider>
  );
}
