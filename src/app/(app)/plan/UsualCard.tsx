'use client';

import Link from 'next/link';
import { useId, useMemo } from 'react';
import { formatManShort, formatWon, usualBreakdown } from '@/domain';
import type { Id, LedgerData, UsualInsight } from '@/domain';
import { Card, Icon, cx } from '@/ui';
import { CardHead, cardStyles } from './CardHead';
import shared from './events.module.css';
import styles from './UsualCard.module.css';

/** 예외 지출 빼기 화면 */
export const USUAL_HREF = '/plan/usual';

const EMPTY_HINT = '아직 일정 아닌 이벤트 지출 기록이 없어요. 기록이 쌓이면 항목별 평균이 나와요';

export interface UsualCardProps {
  data: LedgerData;
  accountId: Id;
  insight: UsualInsight | null;
  today: string;
  /** 예외 지출 후보가 있으면 '한 번뿐이었던 큰 지출 빼기' 링크 */
  hasCandidates: boolean;
  className?: string;
}

/**
 * 이벤트 화면 '평소 쓰는 돈' 카드 (PLAN 4-2): 한 줄 안내(적립과 견줌) + 항목별 한 달 평균 표.
 * 예외 지출 빼기는 따로 화면(/plan/usual), 추천 타협안은 모자랄 때 상태 카드의 [대처하기]에서 봐요
 */
export function UsualCard({ data, accountId, insight, today, hasCandidates, className }: UsualCardProps) {
  const titleId = useId();
  const tableId = useId();
  const breakdown = useMemo(() => usualBreakdown(data, accountId, today, null), [data, accountId, today]);
  const rows = breakdown.rows.filter((r) => r.monthly > 0);

  return (
    <Card as="section" className={cx(cardStyles.card, className)} aria-labelledby={titleId} data-testid="usual-card">
      <CardHead titleId={titleId} title="평소 쓰는 돈" />
      {insight ? (
        <p className={cx(shared.insightMsg, Math.round(insight.gap / 1000) < 0 && shared.bad)} data-testid="usual-summary">
          {insight.message}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <table className={styles.table} aria-labelledby={tableId} data-testid="usual-table">
          <caption id={tableId} className={styles.caption}>
            항목별 한 달 평균 · 합 {formatManShort(breakdown.monthlyTotal)}
          </caption>
          <tbody>
            {rows.map((r) => (
              <tr key={r.categoryId ?? r.name}>
                <th scope="row">{r.name}</th>
                <td>
                  {formatManShort(r.monthly)}
                  <span className="sr-only"> ({formatWon(r.monthly)})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={shared.foot} data-testid="usual-empty">
          {EMPTY_HINT}
        </p>
      )}
      {hasCandidates ? (
        <Link href={USUAL_HREF} className={styles.link} data-testid="usual-exceptions-link">
          한 번뿐이었던 큰 지출 빼기
          <Icon name="chevron-right" size={16} />
        </Link>
      ) : null}
    </Card>
  );
}
