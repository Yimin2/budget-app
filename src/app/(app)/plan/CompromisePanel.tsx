'use client';

import { useId, useState } from 'react';
import { REPAY_MONTH_OPTIONS, formatMan, manWon, normalizeRepayMonths, type CompromisePlan, type RepayMonths } from '@/domain';
import { REPAY_MONTHS_KEY } from '@/state';
import { Chip, ChipGroup, cx } from '@/ui';
import { ExpandButton } from '../_components/ExpandButton';
import styles from './events.module.css';

/** 이 기기에 저장한 저수지 빚 갚는 개월 수 (없거나 못 읽으면 24) */
export function readRepayMonths(): RepayMonths {
  try {
    if (typeof window === 'undefined') return normalizeRepayMonths(null);
    return normalizeRepayMonths(window.localStorage.getItem(REPAY_MONTHS_KEY));
  } catch {
    return normalizeRepayMonths(null);
  }
}

export function writeRepayMonths(months: RepayMonths): void {
  try {
    window.localStorage.setItem(REPAY_MONTHS_KEY, String(months));
  } catch {
    // 사생활 보호 모드 등: 이번 화면에서만 바뀌어요
  }
}

/**
 * 평소 쓰는 돈과 적립 카드 안의 '추천 타협안' (정보만, 자동으로 바꾸는 버튼 없음).
 * 처음에는 한 줄 요약 + 적립이 모자라면 올리라는 안내만. [자세히]로 같은 자리에서 셈 · 갚는 개월 수 칩 · 카테고리별 줄일 금액
 */
export function CompromisePanel({
  plan,
  months,
  onMonths,
}: {
  plan: CompromisePlan;
  months: RepayMonths;
  onMonths: (m: RepayMonths) => void;
}) {
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  const hasDebt = plan.monthlyRepay > 0;
  return (
    <div className={styles.compromise} data-testid="compromise">
      <div className={styles.compromiseRow}>
        <p className={cx(styles.compromiseSummary, plan.shortages.length > 0 && styles.bad)} data-testid="compromise-summary">
          {plan.summary}
        </p>
        <ExpandButton
          open={open}
          onToggle={() => setOpen((o) => !o)}
          controls={bodyId}
          openLabel="자세히"
          label="추천 타협안"
        />
      </div>
      {plan.raiseMessage ? (
        <p className={cx(styles.compromiseLine, styles.bad)} data-testid="compromise-raise">
          {plan.raiseMessage}
        </p>
      ) : null}

      <div id={bodyId} hidden={!open} className={styles.compromiseBody}>
        {open ? (
          <>
            <dl className={styles.insightFacts}>
              <div>
                <dt>평소 쓰는 돈 (예외 뺀 최근 평균)</dt>
                <dd>매달 {manWon(plan.monthlyUsual)}</dd>
              </div>
              <div>
                <dt>등록한 일정 · 여행 ({plan.horizon}개월 평균)</dt>
                <dd>매달 {manWon(plan.monthlyPlanned)}</dd>
              </div>
              <div>
                <dt>실제로 필요한 적립 (만 원 단위 올림)</dt>
                <dd>매달 {manWon(plan.required)}</dd>
              </div>
              <div>
                <dt>지금 적립</dt>
                <dd>매달 {manWon(plan.current)}</dd>
              </div>
            </dl>

            {hasDebt ? (
              <>
                <p className={styles.foot}>
                  적립을 필요보다 더 올리면 배분의 ‘남는 돈 → 저수지’가 그만큼 줄어서, 저수지 돈으로 저수지 빚을 갚는 것과 같아요. 그래서
                  갚을 돈은 쓰는 돈을 줄여서 마련해요
                </p>
                <div className={styles.compromiseMonths}>
                  <span className={styles.foot}>저수지 빚 {formatMan(plan.loanBalance)}을 몇 개월에 갚을까요?</span>
                  <ChipGroup label="저수지 빚 갚는 기간">
                    {REPAY_MONTH_OPTIONS.map((m) => (
                      <Chip key={m} selected={m === months} onClick={() => onMonths(m)}>
                        {m}개월
                      </Chip>
                    ))}
                  </ChipGroup>
                </div>
                <p className={styles.compromiseLine} data-testid="compromise-cut">
                  {plan.cutMessage}
                  <span className={styles.subNote}>
                    {formatMan(plan.loanBalance)} ÷ {plan.repayMonths}개월 = 월 {manWon(plan.monthlyRepay)} (천 원 단위 올림)
                  </span>
                </p>
                {plan.cut.cuts.length > 0 ? (
                  <ul className={styles.compromiseCuts} aria-label="카테고리별 줄일 금액">
                    {plan.cut.cuts.map((c) => (
                      <li key={c.categoryId ?? '_none'}>
                        <span className={styles.compromiseCat}>
                          {c.name}
                          <span className={styles.subNote}>
                            {c.over > 0
                              ? `최근 3개월이 1년 평균보다 월 ${manWon(c.over)} 많아요`
                              : `평소 월 ${manWon(c.usual)}`}
                          </span>
                        </span>
                        <span className={styles.compromiseAmt}>월 {manWon(c.amount)} 줄이기</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {plan.cutGapMessage ? <p className={cx(styles.compromiseLine, styles.bad)}>{plan.cutGapMessage}</p> : null}
                <p className={styles.foot}>평소보다 많이 쓰는 카테고리를 먼저, 나머지는 평소 쓰는 돈에 비례해 천 원 단위로 나눴어요</p>
              </>
            ) : (
              <p className={styles.foot}>저수지에 갚을 돈이 없어서 쓰는 돈을 줄이지 않아도 돼요</p>
            )}

            <p className={cx(styles.compromiseLine, plan.shortageMessage && styles.bad)} data-testid="compromise-check">
              {plan.shortageMessage ?? `추천대로 하면 앞으로 ${plan.horizon}개월 동안 모자라는 달이 없어요`}
              <span className={styles.subNote}>다음 달부터 적립 · 줄인 쓰는 돈 · 갚을 돈을 넣어 다시 예측했어요</span>
            </p>
            <p className={styles.foot}>바꾸는 건 예산의 매달 배분과 평소 지출에서 직접 해요</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
