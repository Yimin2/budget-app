'use client';

import { useId, useState } from 'react';
import { formatManShort, formatMonthKo, manWon } from '@/domain';
import type { CompromisePlan, EventProjection, LedgerData, RepayMonths, UsualInsight } from '@/domain';
import { Card, Icon, cx } from '@/ui';
import { ExpandButton } from '../_components/ExpandButton';
import { CompromisePanel } from './CompromisePanel';
import { UsualDetails, UsualDonut, useUsualBreakdown } from './UsualSpendingViz';
import shared from './events.module.css';
import styles from './UsualInsightCard.module.css';
import vizStyles from './usualViz.module.css';

/* ───────── 평소 쓰는 돈과 적립 (정보만, 바꾸는 버튼 없음) ───────── */

export function UsualInsightCard({
  data,
  projection,
  insight,
  today,
  compromise,
  repayMonths,
  onRepayMonths,
}: {
  data: LedgerData;
  projection: EventProjection;
  insight: UsualInsight;
  today: string;
  compromise: CompromisePlan | null;
  repayMonths: RepayMonths;
  onRepayMonths: (m: RepayMonths) => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  const short = Math.round(insight.gap / 1000) < 0;
  const accountId = projection.accountId ?? '';
  const { breakdown, slices } = useUsualBreakdown(data, accountId, today, null);
  return (
    <Card as="section" className={styles.insight} aria-labelledby={titleId}>
      <div className={shared.insightHead}>
        <Icon name="info" size={20} />
        <div className={shared.txt}>
          <h2 id={titleId} className={shared.insightTitle}>
            평소 쓰는 돈과 적립
          </h2>
          <p className={cx(shared.insightMsg, short && shared.bad)} data-testid="usual-summary">
            {insight.message}
          </p>
        </div>
      </div>
      <div className={vizStyles.summaryRow}>
        <UsualDonut slices={slices} total={breakdown.monthlyTotal} size="sm" />
        <span className={shared.foot}>평소 쓰는 돈 월 {formatManShort(breakdown.monthlyTotal)}</span>
        <ExpandButton
          open={open}
          onToggle={() => setOpen((o) => !o)}
          controls={bodyId}
          openLabel="자세히"
          label="평소 쓰는 돈"
        />
      </div>
      <div id={bodyId} hidden={!open} className={vizStyles.details}>
        {open ? (
          <>
            <UsualDetails
              data={data}
              accountId={accountId}
              today={today}
              contribution={insight.monthlyContribution}
              usual={insight.monthlyUsual}
              planned={insight.monthlyPlanned}
              shortages={projection.shortages}
            />
            <dl className={shared.insightFacts}>
              <div>
                <dt>평소 쓰는 돈 (최근 {insight.months}개월 평균)</dt>
                <dd>매달 {manWon(insight.monthlyUsual)}</dd>
              </div>
              <div>
                <dt>등록한 일정 · 여행 (앞으로 매달 평균)</dt>
                <dd>매달 {manWon(insight.monthlyPlanned)}</dd>
              </div>
              <div>
                <dt>매달 적립</dt>
                <dd>{manWon(insight.monthlyContribution)}</dd>
              </div>
              {insight.heaviest ? (
                <div>
                  <dt>작년 기록 중 가장 많이 쓴 달</dt>
                  <dd>
                    {formatMonthKo(insight.heaviest.month, Number(today.slice(0, 4)))} ·{' '}
                    {manWon(insight.heaviest.amount)}
                  </dd>
                </div>
              ) : null}
            </dl>
            <p className={shared.foot}>
              일정이나 여행에 묶지 않은 이벤트통장 지출을 ‘평소 쓰는 돈’으로 셌어요. 적립액은 예산의 매달 배분에서 직접 정해요
            </p>
          </>
        ) : null}
      </div>
      {compromise ? <CompromisePanel plan={compromise} months={repayMonths} onMonths={onRepayMonths} /> : null}
    </Card>
  );
}
