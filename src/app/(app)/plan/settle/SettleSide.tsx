'use client';

import { useId, useState } from 'react';
import {
  formatMan, formatMonthKo, formatShortDate, formatWon, loanPayoff, loanRecords, monthOf, settleExplanation, settlePeopleDue,
} from '@/domain';
import type { Settlement } from '@/domain';
import { useLedger } from '@/state';
import { Button, Card, ProgressBar, cx } from '@/ui';
import { ExpandButton } from '../../_components/ExpandButton';
import { readRepayMonths } from '../CompromisePanel';
import { LoanRecords, loanSummaryText, useLoanActions } from '../LoanLine';
import styles from './settle.module.css';

interface Picked {
  count: number;
  total: number;
  /** 고른 이벤트통장 청구 중 줄 수 있는 돈 안에 드는 합 */
  eventWithin: number;
  eventTotal: number;
  excess: number;
  fits: boolean;
}

export function SideColumn({
  s,
  baseYear,
  today,
  picked,
  open,
  onOpen,
  loanOpen,
  onLoanOpen,
}: {
  s: Settlement;
  baseYear: number;
  today: string;
  picked: Picked;
  open: boolean;
  onOpen: (open: boolean) => void;
  loanOpen: boolean;
  onLoanOpen: (open: boolean) => void;
}) {
  const bodyId = useId();
  return (
    <aside className={cx(styles.side, open && styles.sideOpen)} aria-label="정산 요약">
      <button type="button" className={styles.sideToggle} aria-expanded={open} aria-controls={bodyId} onClick={() => onOpen(!open)}>
        <span>
          줄 수 있는 돈 <strong>{formatMan(s.payable)}</strong> · 고른 <strong>{formatMan(picked.total)}</strong>
        </span>
        <span className={styles.sideToggleHint}>{open ? '접기' : '자세히'}</span>
      </button>
      <div id={bodyId} className={styles.sideBody}>
        <PayableCard s={s} baseYear={baseYear} picked={picked} />
        <PeopleCard s={s} baseYear={baseYear} />
        <LoanSideCard s={s} baseYear={baseYear} today={today} open={loanOpen} onOpen={onLoanOpen} />
      </div>
    </aside>
  );
}

function PayableCard({ s, baseYear, picked }: { s: Settlement; baseYear: number; picked: Picked }) {
  const titleId = useId();
  const when = s.asOf === s.date ? `이벤트통장 · ${formatShortDate(s.date)} 적립 포함` : '이벤트통장 · 오늘 잔액 기준';
  const left = Math.max(0, s.payable - picked.eventWithin);
  return (
    <Card as="section" aria-labelledby={titleId} padding="sm" className={styles.sideCard}>
      <h2 id={titleId} className={styles.sideTitle}>
        줄 수 있는 돈 <span className={styles.sideHint}>({when})</span>
      </h2>
      <p className={styles.big}>{formatMan(s.payable)}</p>
      <ProgressBar
        value={Math.min(picked.eventTotal, Math.max(s.payable, 1))}
        max={Math.max(s.payable, picked.eventTotal, 1)}
        tone={picked.fits ? 'primary' : 'danger'}
        track="subtle"
        label="고른 돈 / 줄 수 있는 돈"
        valueText={`${formatWon(s.payable)} 중 ${formatWon(picked.eventTotal)}`}
      />
      <dl className={styles.stats}>
        <div>
          <dt>고른 것 {picked.count}건</dt>
          <dd>{formatMan(picked.total)}</dd>
        </div>
        {picked.fits ? (
          <div>
            <dt>남는 돈</dt>
            <dd className={styles.good}>{formatMan(left)}</dd>
          </div>
        ) : (
          <div>
            <dt>넘는 돈</dt>
            <dd className={styles.bad}>{formatMan(picked.excess)}</dd>
          </div>
        )}
        {s.oldPay > 0 ? (
          <div className={styles.mutedStat}>
            <dt>지난달에 못 준 돈 (먼저)</dt>
            <dd>{formatMan(s.oldPay)}</dd>
          </div>
        ) : null}
        <div className={styles.mutedStat}>
          <dt>이번 달 일정 몫 (빼 둠)</dt>
          <dd>{formatMan(s.reserved)}</dd>
        </div>
      </dl>
      <p className={styles.explain} data-testid="settle-explain">
        {settleExplanation(s)}
      </p>
      {s.plannedShort ? (
        <p className={styles.shortNote} role="status">
          이 돈을 먼저 돌려주면 {formatMonthKo(s.plannedShort.month, baseYear)} 일정에 {formatWon(s.plannedShort.amount)}이 모자라요
        </p>
      ) : null}
      {s.carry.length > 0 ? (
        <div className={styles.carry}>
          <strong>다음 달로 넘어가요 · {formatMan(s.carryTotal)}</strong>
          <ul>
            {s.carry.map((g) => (
              <li key={g.name}>
                {g.name} {formatMan(g.amount)} · {g.estimate ? `${formatMonthKo(g.estimate, baseYear)}쯤` : '12개월 안에는 어려워요'}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function PeopleCard({ s, baseYear }: { s: Settlement; baseYear: number }) {
  const titleId = useId();
  const people = settlePeopleDue(s);
  if (people.length === 0) return null;
  return (
    <Card as="section" aria-labelledby={titleId} padding="sm" className={styles.sideCard}>
      <div className={styles.sideHead}>
        <h2 id={titleId} className={styles.sideTitle}>
          사람별
        </h2>
        <span className={styles.sideHint}>줄 돈</span>
      </div>
      <ul className={styles.peopleList} aria-label="사람별 줄 돈">
        {people.map((p) => (
          <li key={p.name}>
            <span>{p.name}</span>
            <span className={styles.num}>
              {formatMan(p.amount)}
              {p.overdue > 0 && p.overdueMonth ? (
                <span className={styles.sideHint}>
                  {' '}
                  (못 준 돈{p.overdue < p.amount ? ` ${formatMan(p.overdue)}` : ''} · {formatMonthKo(p.overdueMonth, baseYear)})
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function LoanSideCard({
  s,
  baseYear,
  today,
  open,
  onOpen,
}: {
  s: Settlement;
  baseYear: number;
  today: string;
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  const ledger = useLedger();
  const { act, lock } = useLoanActions();
  const titleId = useId();
  const bodyId = useId();
  const [months] = useState(readRepayMonths);
  if (!s.reservoirAccountId) return null;
  const { loan } = s;
  const candidates = ledger.loanCandidates;
  const records = loanRecords(loan);
  if (records.length === 0 && candidates.length === 0 && loan.balance <= 0) return null;
  const payoff = loanPayoff(loan.balance, months, monthOf(today));
  return (
    <Card as="section" id="loan" aria-labelledby={titleId} padding="sm" className={styles.sideCard}>
      <div className={styles.sideHead}>
        <h2 id={titleId} className={styles.sideTitle}>
          저수지 갚을 돈
        </h2>
        <strong className={styles.num}>{formatMan(loan.balance)}</strong>
      </div>
      {payoff ? (
        <p className={styles.sideNote} data-testid="loan-payoff">
          매달 {formatMan(payoff.monthly)}씩 · {formatMonthKo(payoff.endMonth, baseYear)}에 끝 · 빌린 건 목록에서 &lsquo;저수지에서 빌려 줌&rsquo;으로 보여요
        </p>
      ) : null}
      <p className={styles.sideNote} data-testid="loan-section-summary">
        {loanSummaryText(loan)}
        {candidates.length > 0 ? ` · 바꿀 수 있는 지출 ${candidates.length}건` : ''}
      </p>
      {loan.repaidThisMonth ? (
        <div className={styles.lineRow}>
          <p>이번 달 {formatMan(loan.repaidThisMonth.amount)} 갚았어요</p>
          <Button
            variant="ghost"
            {...lock('undoRepay')}
            onClick={() => void act('undoRepay', () => ledger.undoRepayLoan(), '갚은 기록을 되돌렸어요')}
            aria-label={`이번 달 ${formatWon(loan.repaidThisMonth.amount)} 갚은 기록 되돌리기`}
          >
            되돌리기
          </Button>
        </div>
      ) : null}
      {s.repay ? (
        <div className={styles.lineRow}>
          <p>이번 달 {formatMan(s.repay.amount)} 갚기</p>
          <Button
            icon="check"
            {...lock('repay')}
            onClick={() =>
              void act('repay', () => ledger.repayLoan(s.repay!.amount), `저수지에 ${formatWon(s.repay!.amount)} 갚았다고 기록했어요`, () =>
                ledger.undoRepayLoan(),
              )
            }
            aria-label={`저수지에 ${formatWon(s.repay.amount)} 갚았어요`}
          >
            갚았어요
          </Button>
        </div>
      ) : null}
      {records.length > 0 || candidates.length > 0 ? (
        <>
          <ExpandButton open={open} onToggle={() => onOpen(!open)} controls={bodyId} openLabel="갚은 기록 · 금액 고치기" closeLabel="접기" label="저수지 기록" />
          {open ? (
            <div id={bodyId} className={styles.loanBody}>
              <LoanRecords />
            </div>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
