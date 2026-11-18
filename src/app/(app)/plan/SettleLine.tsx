'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { eventMonthUsage, formatManShort, formatMonthKo, formatWon, loanPayoff, monthOf, settledReservoirEventClaims, settlementSummary, shortfallText } from '@/domain';
import type { LedgerData, RepayMonths } from '@/domain';
import { useLedger } from '@/state';
import { Badge, Button, Icon } from '@/ui';
import { SETTLE_HREF } from '../_components/SettlementCard';
import { LOAN_HREF, hasLoanLine, useLoanActions } from './LoanLine';
import { settleTileText } from './selectors';
import styles from './eventsHome.module.css';
import loanStyles from './LoanMini.module.css';

/**
 * 이벤트 화면 정산 줄 (PLAN 4-9): '11/21 정산 · 줄 돈 32.4만' + [정산하기], 넘어가는 돈('못 준 돈 → 다음 달') ·
 * 이벤트통장이 모자라면 경고, 저수지에 갚을 돈이 있으면 작은 줄과 그 자리 [갚았어요]. 청구도 갚을 돈도 없으면 숨겨요
 */
export function SettleLine({ data, today, repayMonths }: { data: LedgerData; today: string; repayMonths: RepayMonths }) {
  const ledger = useLedger();
  const s = ledger.settlement;
  const usage = useMemo(() => (s ? eventMonthUsage(data, s, today) : null), [data, s, today]);
  const sum = useMemo(() => (s ? settlementSummary(s) : null), [s]);
  if (!s) return null;
  const settle = settleTileText(usage, sum, s.date ?? today);
  const short = shortfallText(s);
  const hasLoan = hasLoanLine(ledger);
  if (!settle.value && !settle.note && !short && !hasLoan) return null;
  return (
    <section id="settlement" className={styles.settle} aria-label="정산" data-testid="events-settle">
      <div className={styles.settleRow}>
        <span className={styles.settleText}>
          <span className={styles.settleLabel}>{settle.label}</span>
          {settle.value ? (
            <strong className={styles.settleValue}>줄 돈 {settle.value}</strong>
          ) : (
            <strong>정산할 돈 없어요</strong>
          )}
          {settle.note ? (
            <span className={styles.settleNote} data-testid="settlement-note">
              {settle.note}
            </span>
          ) : null}
        </span>
        <Link href={SETTLE_HREF} className={styles.settleLink}>
          정산하기
          <Icon name="chevron-right" size={16} />
        </Link>
      </div>
      {settle.carry ? (
        <Badge tone="warning" variant="soft" size="sm" dot={false} className={styles.carry} data-testid="settlement-carry">
          {settle.carry}
        </Badge>
      ) : null}
      {short ? (
        <p className={styles.warnLine} data-testid="settlement-short">
          <Icon name="alert-triangle" size={16} />
          {short}
        </p>
      ) : null}
      <LoanMini repayMonths={repayMonths} />
    </section>
  );
}

/**
 * 정산 줄 안의 작은 저수지 줄 (PLAN 4-9). 저수지에 '줄' 돈은 없고, 빌린 돈을 '갚을' 돈만 있어요:
 * '저수지 갚을 돈 365만 · 매달 16만' (매달 금액은 추천 타협안에서 고른 갚는 개월 수로, 끝나는 달은 화면 읽기 · 툴팁에).
 * 그 자리에서 [갚았어요](갚았으면 '이번 달 10만 갚았어요 · [되돌리기]'), 저수지에서 이미 지급한 이벤트 청구를 한 번에 바꾸는 버튼,
 * 빌리고 갚은 기록 · 바꿀 지출이 있으면 정산 화면(/plan/settle#loan) 링크. 창은 띄우지 않고, 자동으로 옮기지 않아요
 */
export function LoanMini({ repayMonths }: { repayMonths: number }) {
  const ledger = useLedger();
  const { act, lock } = useLoanActions();
  const s = ledger.settlement;
  const data = ledger.data;
  if (!s || !data || !hasLoanLine(ledger)) return null;
  const { loan, repay } = s;
  const candidates = ledger.loanCandidates;
  const settled = settledReservoirEventClaims(data);
  const settledIds = settled.map((e) => e.id);
  const settledTotal = settled.reduce((t, e) => t + e.amount, 0);
  const history = loan.entries.length + loan.repayments.length;
  const linkText = [history > 0 ? `빌리고 갚은 기록 ${history}건` : null, candidates.length > 0 ? `바꿀 수 있는 지출 ${candidates.length}건` : null]
    .filter(Boolean)
    .join(' · ');
  const payoff = loanPayoff(loan.balance, repayMonths, monthOf(ledger.today));
  const end = payoff ? `${formatMonthKo(payoff.endMonth, Number(ledger.today.slice(0, 4)))}에 끝` : null;

  return (
    <div role="group" aria-label="저수지 갚을 돈" className={loanStyles.loanMini}>
      <p className={loanStyles.loanMiniText} data-testid="loan-line" title={end ?? undefined}>
        저수지 갚을 돈 <strong>{formatManShort(loan.balance)}</strong>
        {payoff ? ` · 매달 ${formatManShort(payoff.monthly)}` : ''}
        {end ? <span className="sr-only"> · {end}</span> : null}
      </p>
      <div className={loanStyles.loanMiniActions}>
        {loan.repaidThisMonth ? (
          <>
            <span className={loanStyles.loanMiniNote}>이번 달 {formatManShort(loan.repaidThisMonth.amount)} 갚았어요</span>
            <Button
              variant="ghost"
              {...lock('undoRepay')}
              onClick={() => void act('undoRepay', () => ledger.undoRepayLoan(), '갚은 기록을 되돌렸어요')}
              aria-label={`이번 달 ${formatWon(loan.repaidThisMonth.amount)} 갚은 기록 되돌리기`}
            >
              되돌리기
            </Button>
          </>
        ) : repay ? (
          <Button
            variant="outline"
            icon="check"
            {...lock('repay')}
            onClick={() =>
              void act('repay', () => ledger.repayLoan(repay.amount), `저수지에 ${formatWon(repay.amount)} 갚았다고 기록했어요`, () =>
                ledger.undoRepayLoan(),
              )
            }
            aria-label={`저수지에 ${formatWon(repay.amount)} 갚았어요`}
          >
            {formatManShort(repay.amount)} 갚았어요
          </Button>
        ) : null}
        {linkText ? (
          <Link href={LOAN_HREF} className={loanStyles.loanMiniLink} aria-label={linkText}>
            기록
            <Icon name="chevron-right" size={16} />
          </Link>
        ) : null}
      </div>
      {settled.length > 0 ? (
        <Button
          variant="outline"
          icon="arrow-right"
          className={loanStyles.loanMiniConvert}
          {...lock('convert')}
          onClick={() =>
            void act(
              'convert',
              () => ledger.convertSettledReservoirClaims(settledIds),
              `${settledIds.length}건 ${formatWon(settledTotal)}을 저수지에 갚을 돈으로 바꿨어요`,
              () => ledger.undoReservoirClaims(settledIds, 'converted'),
            )
          }
          aria-label={`저수지에서 이미 지급한 이벤트 청구 ${settled.length}건 ${formatWon(settledTotal)}을 갚을 돈으로 바꾸기`}
        >
          이미 지급한 청구 {settled.length}건 갚을 돈으로
        </Button>
      ) : null}
    </div>
  );
}

