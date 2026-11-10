'use client';

import { useId } from 'react';
import { formatDateKo, formatWon, groupByPerson, isReservoirEventExpense, nextSettleDate } from '@/domain';
import { useLedger } from '@/state';
import { Badge, Button, Card, Money, cx } from '@/ui';
import { SETTLE_HREF } from './SettlementCard';
import styles from './claims.module.css';

/**
 * 사람별 돌려받을 돈 (PLAN 4-9). 홈에 보여요. 아직 돌려주지 않은 청구가 없으면 그리지 않아요.
 * 사람마다 합(저수지 돈으로 낸 이벤트 청구는 '저수지에서 빌려 지급' 몫을 함께 표시) · 다음 정산일 · [이번 달 정산 보기].
 * 저수지는 받는 사람이 아니에요. 지급 기록은 정산 화면에서 해요
 */
export function ClaimsCard({ className }: { className?: string }) {
  const ledger = useLedger();
  const titleId = useId();
  const claims = ledger.claims;
  const data = ledger.data;
  if (!claims || !data || claims.total <= 0) return null;

  const people = groupByPerson(claims.pending).sort(
    (a, b) => b.amount - a.amount || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  const nextSettle = nextSettleDate(data, ledger.today);

  return (
    <Card
      as="section"
      aria-labelledby={titleId}
      title={<span id={titleId}>사람별 돌려받을 돈</span>}
      aside={<Money amount={claims.total} />}
      className={cx(className)}
    >
      <ul className={styles.personList} aria-label="사람마다 돌려받을 돈">
        {people.map((g) => {
          const borrowed = g.claims.filter((c) => isReservoirEventExpense(data, c.expense)).reduce((t, c) => t + c.amount, 0);
          return (
            <li key={g.name}>
              <span>
                {g.name}
                {borrowed > 0 ? (
                  <>
                    {' '}
                    <Badge tone="warning" size="sm">
                      저수지에서 빌려 지급 {formatWon(borrowed)}
                    </Badge>
                  </>
                ) : null}
              </span>
              <span className={styles.personAmount}>{formatWon(g.amount)}</span>
            </li>
          );
        })}
      </ul>
      <p className={styles.note}>
        다음 정산일 <strong>{formatDateKo(nextSettle, false)}</strong>
      </p>
      {ledger.settlement ? (
        <div className={styles.actions}>
          <Button href={SETTLE_HREF} variant="outline">
            이번 달 정산 보기
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
