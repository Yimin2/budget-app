'use client';

import { useState, type ReactNode } from 'react';
import type { LedgerData } from '@/domain/types';
import { useLedger, useSession, type LedgerApi } from '@/state';
import type { LedgerRef } from '@/storage/types';
import { Button, Card, EmptyState } from '@/ui';
import { PageSkeleton } from './PageSkeleton';
import './screens.css';

/** 데이터가 준비된 가계부 (data · ref 가 null 이 아님) */
export type ReadyLedger = LedgerApi & { data: LedgerData; ref: LedgerRef };

export function isLedgerReady(ledger: LedgerApi): ledger is ReadyLedger {
  return ledger.data !== null && ledger.ref !== null;
}

export interface RequireLedgerProps {
  /** 데이터가 준비되면 그려요 */
  children: (ledger: ReadyLedger) => ReactNode;
  /** 기다리는 동안 보여 줄 뼈대 (기본 PageSkeleton) */
  skeleton?: ReactNode;
}

/**
 * 가계부 데이터가 있을 때만 화면을 그려요.
 * 불러오는 중이면 뼈대, 처음 불러오기에 실패하면 다시 시도 카드를 보여요.
 * (뒤에서 다시 읽다가 실패한 경우는 데이터가 그대로 보이고, 알림은 앱 틀이 띄워요)
 */
export function RequireLedger({ children, skeleton }: RequireLedgerProps) {
  const ledger = useLedger();
  if (isLedgerReady(ledger)) return <>{children(ledger)}</>;
  if (ledger.status === 'error') return <LedgerLoadError message={ledger.error} onRetry={ledger.reload} />;
  return <>{skeleton ?? <PageSkeleton />}</>;
}

export function LedgerLoadError({ message, onRetry }: { message: string | null; onRetry: () => Promise<void> }) {
  const ledger = useLedger();
  const session = useSession();
  const [retrying, setRetrying] = useState(false);
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  const reconnect = ledger.needsReconnect && session.mode === 'google';
  async function retry() {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }
  function reconnectGoogle() {
    setRetrying(true);
    setReconnectError(null);
    // 클릭 안에서 바로 요청해야 구글 창이 막히지 않는다 (await 전에 부름)
    session
      .reconnectGoogle()
      .then(() => onRetry())
      .catch((e: unknown) => setReconnectError(e instanceof Error && /[가-힣]/.test(e.message) ? e.message : '다시 연결하지 못했어요'))
      .finally(() => setRetrying(false));
  }
  return (
    <Card className="sx-error">
      <EmptyState
        icon="alert-circle"
        title={reconnect ? '구글 연결이 끊겼어요' : '가계부를 불러오지 못했어요'}
        description={reconnectError ?? (reconnect ? '구글 다시 연결을 누르면 같은 계정으로 이어서 써요' : message ?? '잠시 뒤 다시 시도해 주세요')}
        action={
          <>
            {reconnect ? (
              <Button onClick={reconnectGoogle} loading={retrying} icon="refresh">
                구글 다시 연결
              </Button>
            ) : (
              <Button onClick={retry} loading={retrying} icon="refresh">
                다시 시도
              </Button>
            )}
            <Button variant="outline" href="/start">
              다른 가계부 열기
            </Button>
          </>
        }
      />
    </Card>
  );
}
