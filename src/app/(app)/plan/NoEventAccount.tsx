'use client';

import { useId } from 'react';
import { Button, Card, Icon } from '@/ui';
import type { ReadyLedger } from '../_components';
import styles from './events.module.css';

/* ───────── 이벤트통장이 없을 때 (개인 가계부 등) ───────── */

export function NoEventAccount({ ledger }: { ledger: ReadyLedger }) {
  const titleId = useId();
  const fallback = ledger.accountByRole('allowance') ?? ledger.activeAccounts[0] ?? null;
  return (
    <Card as="section" className={styles.noAccount} aria-labelledby={titleId}>
      <Icon name="info" size={20} />
      <div className={styles.txt}>
        <h2 id={titleId}>이 가계부에는 이벤트통장이 없어요</h2>
        <p>
          {fallback ? `일정은 ${fallback.name}에서 나가는 걸로 기록해요. ` : ''}
          이벤트통장을 만들면 12개월 예상 잔액과 모자라는 달을 알려 드려요.
        </p>
        <Button href="/settings#st-accounts" variant="outline" icon="plus" className={styles.act}>
          통장 추가하기
        </Button>
      </div>
    </Card>
  );
}
