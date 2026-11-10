'use client';

import { eventMonthUsage, formatManShort, settlementSummary, shortfallText } from '@/domain';
import type { EventProjection, RepayMonths } from '@/domain';
import { useLedger } from '@/state';
import { Badge, Button, Icon } from '@/ui';
import { SETTLE_HREF } from '../_components/SettlementCard';
import { FoldCard } from './FoldCard';
import { LoanLine, hasLoanLine } from './LoanLine';
import { nextContribution, settleLineText } from './selectors';
import styles from './ThisMonthCard.module.css';

/**
 * 이벤트 화면 카드 1 '이번 달 · 11월' (PLAN 4-9 · 4-2).
 * - 칸 셋: 이벤트통장 잔액(아래 매달 적립) · 쓴 돈 + 예정(이번 달 이벤트통장, 여행 뺌 — eventMonthUsage) · 여행 (따로)(0이면 숨김)
 * - 이벤트통장이 음수면 '이벤트통장이 ○원 모자라요'
 * - 정산 한 줄 '11/21 정산 15만' + 넘어가면 '못 준 돈 55만 → 다음 달' (청구가 하나도 없으면 숨김)
 * - 저수지 갚을 돈 한 줄 (매달 · 끝나는 달, [자세히]로 갚기 · 바꾸기 · 정산 화면 링크)
 * - 제목 옆 [정산하기 →] (/plan/settle). 폰에서는 칸 셋만 보이고 [펼치기]로 정산 · 저수지 줄
 */
export function ThisMonthCard({ projection, repayMonths, className }: { projection: EventProjection; repayMonths: RepayMonths; className?: string }) {
  const ledger = useLedger();
  const s = ledger.settlement;
  const data = ledger.data;
  const today = ledger.today;
  const usage = s && data ? eventMonthUsage(data, s, today) : null;
  const sum = s ? settlementSummary(s) : null;
  const line = usage && sum?.hasClaims ? settleLineText(usage, sum) : null;
  const short = s ? shortfallText(s) : null;
  const next = nextContribution(projection);
  const trip = usage ? usage.tripSpent + usage.tripPlanned : 0;
  const month = Number(today.slice(5, 7));

  const lines =
    line || hasLoanLine(ledger) ? (
      <>
        {line ? (
          <div role="group" aria-label="이번 달 정산" className={styles.line}>
            <p className={styles.lineText} data-testid="settlement-line">
              {line.text}
            </p>
            {line.carry ? (
              <Badge tone="warning" variant="soft" size="sm" dot={false} data-testid="settlement-carry">
                {line.carry}
              </Badge>
            ) : null}
          </div>
        ) : null}
        <LoanLine repayMonths={repayMonths} />
      </>
    ) : null;

  return (
    <FoldCard
      id="settlement"
      className={className}
      title={`이번 달 · ${month}월`}
      foldLabel="이번 달 정산 · 저수지"
      actions={
        <Button href={SETTLE_HREF} variant={sum && sum.total > 0 ? 'primary' : 'outline'} iconRight="arrow-right">
          정산하기
        </Button>
      }
      summary={
        <>
          <dl className={styles.kpis}>
            <div className={styles.kpi} data-testid="kpi-balance">
              <dt>이벤트통장 잔액</dt>
              <dd>
                <span className={styles.kpiValue}>{formatManShort(projection.currentBalance)}</span>
                <span className={styles.kpiSub}>
                  매달 {formatManShort(projection.monthlyContribution)} 적립
                  {next !== null ? ` · 다음 달부터 ${formatManShort(next)}` : ''}
                </span>
              </dd>
            </div>
            {usage ? (
              <div className={styles.kpi} data-testid="kpi-usage">
                <dt>쓴 돈 + 예정</dt>
                <dd>
                  <span className={styles.kpiValue}>
                    {formatManShort(usage.spent)}
                    <span className={styles.kpiPlus}> + {formatManShort(usage.planned)}</span>
                  </span>
                  <span className={styles.kpiSub}>여행 빼고</span>
                </dd>
              </div>
            ) : null}
            {usage && trip > 0 ? (
              <div className={styles.kpi} data-testid="kpi-trip">
                <dt>여행 (따로)</dt>
                <dd>
                  <span className={styles.kpiValue}>{formatManShort(trip)}</span>
                  <span className={styles.kpiSub}>
                    {usage.tripSpent > 0 && usage.tripPlanned > 0
                      ? `예정 ${formatManShort(usage.tripPlanned)} 포함`
                      : usage.tripSpent > 0
                        ? '썼어요'
                        : '예정'}
                  </span>
                </dd>
              </div>
            ) : null}
          </dl>
          {short ? (
            <p className={styles.warn} data-testid="settlement-short">
              <Icon name="alert-triangle" size={18} />
              {short}
            </p>
          ) : null}
        </>
      }
    >
      {lines}
    </FoldCard>
  );
}
