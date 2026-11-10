'use client';

import { useId } from 'react';
import { claimsBySource, formatDateKo, formatWon, nextSettleDate } from '@/domain';
import { useLedger } from '@/state';
import { Badge, Button, Card, Money, cx } from '@/ui';
import styles from './claims.module.css';

/**
 * 사람별 돌려받을 돈 (PLAN 4-9). 홈에 보여요. 아직 돌려주지 않은 청구가 없으면 그리지 않아요.
 * 사람마다 합 · 저수지에서 빌려 줄 돈(이벤트 지출) · 저수지에 쓸 돈은 따로 · 다음 정산일 · [이번 달 정산 보기]. 지급 기록은 정산 카드에서 해요
 */
export function ClaimsCard({ className }: { className?: string }) {
  const ledger = useLedger();
  const titleId = useId();
  const claims = ledger.claims;
  const data = ledger.data;
  if (!claims || !data || claims.total <= 0) return null;

  const { shared, reservoir, reservoirLoan } = claimsBySource(data, claims.pending);
  const nextSettle = nextSettleDate(data, ledger.today);

  return (
    <Card
      as="section"
      aria-labelledby={titleId}
      title={<span id={titleId}>사람별 돌려받을 돈</span>}
      aside={<Money amount={claims.total} />}
      className={cx(className)}
    >
      {shared.length > 0 ? (
        <ul className={styles.personList} aria-label="함께 쓰는 통장에서 돌려받을 돈">
          {shared.map((g) => (
            <li key={g.name}>
              <span>{g.name}</span>
              <span className={styles.personAmount}>{formatWon(g.amount)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {reservoirLoan.length > 0 ? (
        <>
          <h3 className={styles.groupTitle}>
            저수지에서 빌려 줄 돈
            <Badge tone="warning" size="sm">
              빌린 돈
            </Badge>
          </h3>
          <ul className={styles.personList} aria-label="저수지에서 빌려 줄 돈">
            {reservoirLoan.map((g) => (
              <li key={g.name}>
                <span>
                  {g.name} · {g.claims.length}건
                </span>
                <span className={styles.personAmount}>{formatWon(g.amount)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {reservoir.length > 0 ? (
        <>
          <h3 className={styles.groupTitle}>
            저수지에 쓸 돈
            <Badge tone="info" size="sm">
              저수지
            </Badge>
          </h3>
          <ul className={styles.personList} aria-label="저수지에 쓸 돈">
            {reservoir.map((g) => (
              <li key={g.name}>
                <span>
                  {g.name} · {g.claims.length}건
                </span>
                <span className={styles.personAmount}>{formatWon(g.amount)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className={styles.note}>
        다음 정산일 <strong>{formatDateKo(nextSettle, false)}</strong>
      </p>
      {ledger.settlement ? (
        <div className={styles.actions}>
          <Button href="/plan#settlement" variant="outline">
            이번 달 정산 보기
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
