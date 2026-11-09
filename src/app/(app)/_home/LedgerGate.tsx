'use client';

import type { ReactNode } from 'react';
import { useLedger, useSession } from '@/state';
import { LedgerLoadError } from '../_components';
import { Button, Card, EmptyState, Skeleton, cx } from '@/ui';
import styles from './home.module.css';

/**
 * 가계부 데이터가 아직 없을 때 보여 줄 것 (불러오는 중 · 오류 · 가계부 안 고름).
 * 데이터가 있으면 null 을 돌려줘요. 데이터가 있는 채로 다시 불러오다 실패하면 화면은 그대로 둬요.
 */
export function useLedgerFallback(skeleton: ReactNode): ReactNode | null {
  const ledger = useLedger();
  const session = useSession();
  if (ledger.data) return null;
  if (ledger.status === 'error') return <LedgerLoadError message={ledger.error} onRetry={ledger.reload} />;
  if (ledger.status === 'idle' && session.status !== 'loading') {
    return (
      <EmptyState
        icon="wallet"
        title="가계부를 골라 주세요"
        description="최근에 연 가계부를 고르거나 새로 만들 수 있어요"
        action={<Button href="/start">가계부 고르기</Button>}
      />
    );
  }
  return skeleton;
}

/** 홈 불러오는 중 모양 */
export function HomeSkeleton() {
  return (
    <div className={styles.home} role="status">
      <div className={styles.col}>
        <Card variant="brand" className={cx(styles.skelCard, styles.oHero)}>
          <Skeleton width={160} height={22} />
          <Skeleton width={220} height={52} radius="md" />
          <Skeleton height={8} radius="full" />
          <Skeleton width="70%" height={18} />
        </Card>
        <Skeleton className={styles.oCta} height={52} radius="md" />
        <div className={cx(styles.section, styles.oFav)}>
          <Skeleton width={96} height={18} />
          <div className="chips">
            <Skeleton width={88} height={36} radius="full" />
            <Skeleton width={88} height={36} radius="full" />
            <Skeleton width={88} height={36} radius="full" />
          </div>
        </div>
        <Card className={cx(styles.skelCard, styles.oRecent, styles.half)}>
          <Skeleton width={96} height={22} />
          <Skeleton height={44} />
          <Skeleton height={44} />
          <Skeleton height={44} />
        </Card>
      </div>
      <div className={styles.col}>
        <Card className={cx(styles.skelCard, styles.oEvent, styles.half)}>
          <Skeleton width={120} height={22} />
          <Skeleton height={44} />
          <Skeleton height={44} />
        </Card>
      </div>
      <span className="sr-only">불러오는 중이에요</span>
    </div>
  );
}

/** 사도 돼? 불러오는 중 모양 */
export function CheckSkeleton() {
  return (
    <div className={styles.checkGrid} role="status">
      <div className={styles.checkCol}>
        <div className={cx(styles.section, styles.cAmount)}>
          <Skeleton width={96} height={20} />
          <Skeleton height={64} radius="md" />
        </div>
        <div className={cx('chips', styles.cQuick)}>
          <Skeleton width={72} height={36} radius="full" />
          <Skeleton width={72} height={36} radius="full" />
          <Skeleton width={72} height={36} radius="full" />
          <Skeleton width={72} height={36} radius="full" />
        </div>
        <Skeleton className={styles.cSource} height={44} radius="full" />
      </div>
      <div className={styles.checkCol}>
        <Skeleton className={styles.cVerdict} height={200} radius="lg" />
      </div>
      <span className="sr-only">불러오는 중이에요</span>
    </div>
  );
}
