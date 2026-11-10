'use client';

import { useId } from 'react';
import { formatWon } from '@/domain';
import type { EventProjection } from '@/domain';
import { Card, Icon, cx } from '@/ui';
import { nextContribution, projectionTotals } from './selectors';
import shared from './events.module.css';
import styles from './SummaryCard.module.css';

/* ───────── 잔액 · 매달 적립 ───────── */

export function SummaryCard({ projection }: { projection: EventProjection }) {
  const titleId = useId();
  const totals = projectionTotals(projection);
  const next = nextContribution(projection);
  const short = projection.shortages.length;
  return (
    <Card as="section" variant="brand" className={styles.summary} aria-labelledby={titleId}>
      <div className={styles.sumMain}>
        <h2 id={titleId} className={styles.sumLabel}>
          이벤트통장 잔액
        </h2>
        <p className={styles.sumValue}>{formatWon(projection.currentBalance)}</p>
      </div>
      <dl className={styles.sumStats}>
        <div className={shared.sumStat}>
          <dt>매달 적립</dt>
          <dd>
            {formatWon(projection.monthlyContribution)}
            {next !== null ? <span className={shared.subNote}>다음 달부터 {formatWon(next)}</span> : null}
          </dd>
        </div>
        <div className={shared.sumStat}>
          <dt>{projection.months.length}개월 예정 일정</dt>
          <dd>
            {totals.count}건<span className={shared.subNote}>{formatWon(totals.amount)}</span>
          </dd>
        </div>
        <div className={cx(shared.sumStat, styles.sumStatWide)}>
          <dt>모자라는 달</dt>
          <dd>
            <span className={cx(shared.statusLine, short > 0 ? shared.bad : shared.ok)}>
              <Icon name={short > 0 ? 'alert-triangle' : 'check-circle'} size={20} />
              {short > 0 ? `${short}개월` : '없어요'}
            </span>
          </dd>
        </div>
      </dl>
    </Card>
  );
}
