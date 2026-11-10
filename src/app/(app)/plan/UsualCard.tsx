'use client';

import { useId, useMemo, useState } from 'react';
import { effectiveExclusions, formatManShort, formatMonthKo, manWon } from '@/domain';
import type { CompromisePlan, EventProjection, ExceptionCandidate, ExclusionDraft, LedgerData, RepayMonths, UsualInsight } from '@/domain';
import { Card, cx } from '@/ui';
import { ExpandButton } from '../_components/ExpandButton';
import { CompromisePanel } from './CompromisePanel';
import { ExceptionPanel, exceptionCounts } from './ExceptionPanel';
import { FoldHead, foldStyles } from './FoldCard';
import { compromiseHeadline } from './selectors';
import { SavingsBarView, UsualDetails, UsualDonut, sliceColor, useUsualBreakdown } from './UsualSpendingViz';
import shared from './events.module.css';
import styles from './UsualCard.module.css';

type Step = 'table' | 'compromise' | 'exceptions';

const STEP_TITLE: Record<Step, string> = {
  table: '항목별 평균 표',
  compromise: '추천 타협안',
  exceptions: '예외 지출 빼기',
};
const STEP_NUM: Record<Step, string> = { table: '①', compromise: '②', exceptions: '③' };

export interface UsualCardProps {
  data: LedgerData;
  /** 저장된 그대로의 예측 */
  projection: EventProjection;
  insight: UsualInsight | null;
  today: string;
  compromise: CompromisePlan | null;
  repayMonths: RepayMonths;
  onRepayMonths: (m: RepayMonths) => void;
  /** 예외 지출 빼기 */
  candidates: ExceptionCandidate[];
  /** 체크한 대로 뺀 예측 (바꾼 것이 있을 때만) */
  tried: EventProjection | null;
  draft: ExclusionDraft;
  onDraft: (draft: ExclusionDraft) => void;
  className?: string;
}

/**
 * 이벤트 화면 카드 3 '평소 쓰는 돈' (PLAN 4-2, 정보만 · 바꾸는 버튼 없음).
 * 접힌 요약: 작은 도넛 + 범례 · 적립 대비 막대(넘는 몫 · 바닥나는 달) · 단계 칩 셋
 * [① 항목별 평균 표] [② 추천 타협안 '적립 70만 + 선물 −5만'] [③ 예외 지출 빼기 '후보 4건'].
 * 칩이나 [자세히]를 누르면 그 단계가 같은 자리에서 펼쳐져요(창 없음). 같은 칩을 다시 누르거나 [접기]로 접어요.
 * 예외를 체크해 미리 보는 동안에는 ③ 이 펼친 채로 있고, '앞으로 12개월' 카드에 '미리 보는 중'이 붙어요
 */
export function UsualCard({
  data,
  projection,
  insight,
  today,
  compromise,
  repayMonths,
  onRepayMonths,
  candidates,
  tried,
  draft,
  onDraft,
  className,
}: UsualCardProps) {
  const titleId = useId();
  const panelId = useId();
  const panelTitleId = useId();
  const [step, setStep] = useState<Step>('table');
  const [open, setOpen] = useState(false);
  const accountId = projection.accountId ?? '';
  const { breakdown, slices } = useUsualBreakdown(data, accountId, today, null);
  const previewing = useMemo(() => effectiveExclusions(data, draft).length > 0, [data, draft]);
  const counts = exceptionCounts(candidates, draft);

  const steps: Step[] = [];
  if (insight) steps.push('table');
  if (insight && compromise) steps.push('compromise');
  if (candidates.length > 0) steps.push('exceptions');
  const shownStep: Step | null = previewing ? 'exceptions' : steps.includes(step) ? step : (steps[0] ?? null);
  const isOpen = (open || previewing) && shownStep !== null;

  const chip = (s: Step) => {
    if (isOpen && shownStep === s) {
      if (!previewing) setOpen(false);
      return;
    }
    setStep(s);
    setOpen(true);
  };
  const chipSub: Record<Step, string> = {
    table: insight ? `월 ${formatManShort(breakdown.monthlyTotal)} · ${breakdown.rows.length}개 항목` : '',
    compromise: compromise ? compromiseHeadline(compromise) : '',
    exceptions: counts.marked > 0 ? `예외 ${counts.marked}건 · 후보 ${counts.candidates}건` : `후보 ${counts.candidates}건`,
  };

  return (
    <Card as="section" className={cx(foldStyles.card, className)} aria-labelledby={titleId} data-testid="usual-card">
      <FoldHead
        titleId={titleId}
        title="평소 쓰는 돈"
        actions={
          shownStep ? (
            <ExpandButton
              open={isOpen}
              onToggle={() => setOpen(!isOpen)}
              controls={panelId}
              openLabel="자세히"
              label="평소 쓰는 돈"
              disabled={previewing}
            />
          ) : undefined
        }
      />

      {insight ? (
        <>
          <div className={styles.donutWrap}>
            <UsualDonut slices={slices} total={breakdown.monthlyTotal} size="sm" />
            {slices.length > 0 ? (
              <ul className={styles.legend} aria-label="평소 쓰는 돈 항목 (한 달 평균)">
                {slices.map((s) => (
                  <li key={s.key}>
                    <span className={styles.swatch} style={{ background: sliceColor(s) }} aria-hidden="true" />
                    <span className={styles.legendName}>{s.name}</span>
                    <span className={styles.legendAmt}>{formatManShort(s.amount)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <SavingsBarView
            contribution={insight.monthlyContribution}
            usual={insight.monthlyUsual}
            planned={insight.monthlyPlanned}
            shortages={projection.shortages}
            year={Number(today.slice(0, 4))}
          />
        </>
      ) : (
        <p className={shared.foot} data-testid="usual-empty">
          일정이나 여행에 묶지 않은 이벤트통장 지출이 쌓이면 한 달에 얼마쯤 쓰는지 여기서 보여 드려요
        </p>
      )}

      {steps.length > 0 ? (
        <ul className={styles.steps} aria-label="평소 쓰는 돈 살펴보기">
          {steps.map((s) => {
            const on = isOpen && shownStep === s;
            return (
              <li key={s}>
                <button
                  type="button"
                  className={cx(styles.step, on && styles.stepOn)}
                  aria-expanded={on}
                  aria-controls={panelId}
                  disabled={previewing && s !== 'exceptions'}
                  onClick={() => chip(s)}
                  data-testid={`usual-step-${s}`}
                >
                  <span className={styles.stepTitle}>
                    <span aria-hidden="true">{STEP_NUM[s]} </span>
                    {STEP_TITLE[s]}
                  </span>
                  {chipSub[s] ? <span className={styles.stepSub}>{chipSub[s]}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {shownStep ? (
        <section
          id={panelId}
          hidden={!isOpen}
          className={cx(styles.panel, previewing && styles.panelOn)}
          aria-labelledby={panelTitleId}
        >
          <h3 id={panelTitleId} className={styles.panelTitle}>
            {STEP_TITLE[shownStep]}
          </h3>
          {isOpen && shownStep === 'table' && insight ? (
            <>
              <p className={cx(shared.insightMsg, Math.round(insight.gap / 1000) < 0 && shared.bad)} data-testid="usual-summary">
                {insight.message}
              </p>
              <UsualDetails
                data={data}
                accountId={accountId}
                today={today}
                contribution={insight.monthlyContribution}
                usual={insight.monthlyUsual}
                planned={insight.monthlyPlanned}
                shortages={projection.shortages}
                bar={false}
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
                      {formatMonthKo(insight.heaviest.month, Number(today.slice(0, 4)))} · {manWon(insight.heaviest.amount)}
                    </dd>
                  </div>
                ) : null}
              </dl>
              <p className={shared.foot}>
                일정이나 여행에 묶지 않은 이벤트통장 지출을 ‘평소 쓰는 돈’으로 셌어요. 적립액은 예산의 매달 배분에서 직접 정해요
              </p>
            </>
          ) : null}
          {isOpen && shownStep === 'compromise' && compromise ? (
            <CompromisePanel plan={compromise} months={repayMonths} onMonths={onRepayMonths} />
          ) : null}
          {isOpen && shownStep === 'exceptions' ? (
            <ExceptionPanel
              data={data}
              today={today}
              candidates={candidates}
              before={projection}
              after={tried}
              draft={draft}
              onChange={onDraft}
            />
          ) : null}
        </section>
      ) : null}
    </Card>
  );
}
