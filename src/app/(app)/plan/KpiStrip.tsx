'use client';

import Link from 'next/link';
import { useId, useMemo } from 'react';
import {
  eventMonthUsage,
  formatManShort,
  formatMonthKo,
  formatWon,
  loanPayoff,
  monthOf,
  settledReservoirEventClaims,
  settlementSummary,
  shortfallText,
  spentSoFarThisMonth,
} from '@/domain';
import type { EventProjection, LedgerData, RepayMonths, YearMonth } from '@/domain';
import { useLedger } from '@/state';
import { Badge, Button, Icon, cx } from '@/ui';
import { SETTLE_HREF } from '../_components/SettlementCard';
import { LOAN_HREF, hasLoanLine, useLoanActions } from './LoanLine';
import { aheadTotals, firstShortMonth, monthLabel, nextContribution, settleTileText, worstShortMonth } from './selectors';
import styles from './KpiStrip.module.css';

export interface KpiStripProps {
  projection: EventProjection;
  data: LedgerData;
  today: string;
  repayMonths: RepayMonths;
  /** 가장 모자라는 달 칸을 누르면: 12개월 카드에서 그 달을 고르고 그 카드로 스크롤 */
  onPickMonth: (month: YearMonth) => void;
}

/**
 * 이벤트 화면 맨 위 숫자 띠 (PLAN 4-2 · 4-9). 넓은 화면은 네 칸 한 줄, 폰은 2×2. 늘 펼쳐 있어요 (접기 없음).
 * ① 이벤트통장 잔액 + '21일 +30만 들어와요'(정산일까지 들어올 돈) 또는 '매달 30만 적립'
 * ② 이번 달 쓴 돈 = 이번 달 날짜로 쓴 이벤트 지출(지금까지) + 이번 달 예정 (여행 빼고, 지난 청구 돌려주기는 정산 칸에서) + '지금까지 ○ · 예정 ○' · 이번 달 여행이 있으면 '여행 ○'
 * ③ '11/21 정산 32.4만'(이번에 실제로 줄 돈, 넘어가는 돈은 아래 '못 준 돈' 배지) + [정산하기 →] (#settlement). 줄 돈이 없으면 '정산할 돈 없어요'.
 *    저수지 갚을 돈이 있으면 작은 줄 + 그 자리 [갚았어요] / [되돌리기]. 이벤트통장이 음수면 '이벤트통장이 ○ 모자라요'
 * ④ 처음 모자라는 달 '1월 −10.5만' + '가장 많이 10월 −613만'(경고 색, 누르면 12개월 카드에서 그 달) 또는 '12개월 동안 모자라는 달 없어요'
 */
export function KpiStrip({ projection, data, today, repayMonths, onPickMonth }: KpiStripProps) {
  const ledger = useLedger();
  const titleId = useId();
  const s = ledger.settlement;
  const usage = useMemo(() => (s ? eventMonthUsage(data, s, today) : null), [data, s, today]);
  const sum = useMemo(() => (s ? settlementSummary(s) : null), [s]);
  const accountId = projection.accountId;
  const spentSoFar = useMemo(() => (accountId ? spentSoFarThisMonth(data, accountId, today) : 0), [data, accountId, today]);
  const now = projection.months[0];
  const totals = now ? aheadTotals(now) : { spend: 0, repay: 0, total: 0 };
  const trip = usage ? usage.tripSpent + usage.tripPlanned : 0;
  const next = nextContribution(projection);
  const settle = settleTileText(usage, sum, s?.date ?? today);
  const short = s ? shortfallText(s) : null;
  const first = firstShortMonth(projection);
  const worst = worstShortMonth(projection);
  const month = Number(today.slice(5, 7));

  const incoming =
    s && s.incoming > 0 && s.incomingOn
      ? `${Number(s.incomingOn.slice(8))}일 +${formatManShort(s.incoming)} 들어와요`
      : `매달 ${formatManShort(projection.monthlyContribution)} 적립${next !== null ? ` · 다음 달부터 ${formatManShort(next)}` : ''}`;

  // 이번 달 쓴 돈 = 이번 달 날짜로 쓴 이벤트 지출(지금까지) + 이번 달 예정. 지난달에 쓴 청구를 돌려주는 돈은 넣지 않아요 (정산 칸에서 따로)
  const usedNow = usage ? usage.spent : spentSoFar;
  const usedPlanned = usage ? usage.planned : totals.spend;
  const spendSub = `지금까지 ${formatManShort(usedNow)} · 예정 ${formatManShort(usedPlanned)}`;

  return (
    <section className={styles.strip} aria-labelledby={titleId} data-testid="kpi-strip">
      <h2 id={titleId} className="sr-only">
        이번 달 · {month}월
      </h2>
      <div className={styles.tile} data-testid="kpi-balance">
        <span className={styles.label}>이벤트통장 잔액</span>
        <strong className={styles.value}>{formatManShort(projection.currentBalance)}</strong>
        <span className={styles.sub}>{incoming}</span>
      </div>

      <div className={styles.tile} data-testid="kpi-spend">
        <span className={styles.label}>이번 달 쓴 돈</span>
        <strong className={styles.value}>{formatManShort(usedNow + usedPlanned)}</strong>
        <span className={styles.sub}>
          {spendSub}
        </span>
        {trip > 0 ? (
          <span className={styles.sub} data-testid="kpi-trip">
            여행 {formatManShort(trip)}
          </span>
        ) : null}
      </div>

      <div id="settlement" className={cx(styles.tile, styles.settleTile)} data-testid="kpi-settle">
        <span className={styles.label}>{settle.label}</span>
        {settle.value ? (
          <strong className={styles.value}>{settle.value}</strong>
        ) : (
          <strong className={cx(styles.value, styles.valueText)}>정산할 돈 없어요</strong>
        )}
        {settle.note ? (
          <span className={styles.sub} data-testid="settlement-note">
            {settle.note}
          </span>
        ) : null}
        {settle.carry ? (
          <Badge tone="warning" variant="soft" size="sm" dot={false} className={styles.carry} data-testid="settlement-carry">
            {settle.carry}
          </Badge>
        ) : null}
        <Link href={SETTLE_HREF} className={styles.link}>
          정산하기
          <Icon name="arrow-right" size={16} />
        </Link>
        {short ? (
          <p className={styles.warn} data-testid="settlement-short">
            <Icon name="alert-triangle" size={16} />
            {short}
          </p>
        ) : null}
        <LoanMini repayMonths={repayMonths} />
      </div>

      {first ? (
        <button type="button" className={cx(styles.tile, styles.tileButton, styles.warnTile)} onClick={() => onPickMonth(first.month)} data-testid="kpi-short">
          <span className={styles.label}>처음 모자라는 달</span>
          <strong className={styles.value}>
            {monthLabel(first.month, today)} −{formatManShort(-first.endBalance)}
          </strong>
          <span className={styles.sub}>
            {worst && worst.month !== first.month
              ? `가장 많이 ${monthLabel(worst.month, today)} −${formatManShort(-worst.endBalance)}`
              : '12개월 카드에서 보기'}
            <span className="sr-only"> ({formatWon(-first.endBalance)} 모자라요)</span>
          </span>
        </button>
      ) : (
        <div className={cx(styles.tile, styles.okTile)} data-testid="kpi-short">
          <span className={styles.label}>모자라는 달</span>
          <strong className={cx(styles.value, styles.valueText)}>
            <Icon name="check-circle" size={18} />
            {projection.months.length}개월 동안 모자라는 달 없어요
          </strong>
        </div>
      )}
    </section>
  );
}

/**
 * 숫자 띠 '정산' 칸 안의 작은 저수지 줄 (PLAN 4-9). 저수지에 '줄' 돈은 없고, 빌린 돈을 '갚을' 돈만 있어요:
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
    <div role="group" aria-label="저수지 갚을 돈" className={styles.loanMini}>
      <p className={styles.loanMiniText} data-testid="loan-line" title={end ?? undefined}>
        저수지 갚을 돈 <strong>{formatManShort(loan.balance)}</strong>
        {payoff ? ` · 매달 ${formatManShort(payoff.monthly)}` : ''}
        {end ? <span className="sr-only"> · {end}</span> : null}
      </p>
      <div className={styles.loanMiniActions}>
        {loan.repaidThisMonth ? (
          <>
            <span className={styles.loanMiniNote}>이번 달 {formatManShort(loan.repaidThisMonth.amount)} 갚았어요</span>
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
          <Link href={LOAN_HREF} className={styles.loanMiniLink} aria-label={linkText}>
            기록
            <Icon name="chevron-right" size={16} />
          </Link>
        ) : null}
      </div>
      {settled.length > 0 ? (
        <Button
          variant="outline"
          icon="arrow-right"
          className={styles.loanMiniConvert}
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

