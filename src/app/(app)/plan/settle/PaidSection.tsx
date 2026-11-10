'use client';

import { useId, useMemo } from 'react';
import { formatShortDate, formatWon, paidClaims } from '@/domain';
import type { Expense, LedgerData } from '@/domain';
import { useLedger } from '@/state';
import { Badge, Button, Card } from '@/ui';
import { groupByMonth, monthTitle } from '../../history/_accounts/selectors';
import { useLoanActions } from '../LoanCard';
import claims from '../../_components/claims.module.css';
import styles from './settle.module.css';

function expenseTitle(data: LedgerData, e: Expense): string {
  const memo = e.memo.trim();
  if (memo) return memo;
  const cat = e.categoryId ? data.categories.find((x) => x.id === e.categoryId)?.name : undefined;
  return cat ?? '지출';
}

/**
 * 정산 화면 '지급한 기록' (id="paid", PLAN 4-9). 돌려준 청구(이체 claim:<지출id>)를 최근 순으로 달마다:
 * 지급한 날 · 사람 · 항목 · 금액, 빌려 지급했으면 '저수지에서 빌려 지급'. [지급 취소]를 누르면 다시 '줄 돈'이 돼요 (알림에서 되돌리기)
 */
export function PaidSection() {
  const ledger = useLedger();
  const titleId = useId();
  const { act, lock } = useLoanActions();
  const data = ledger.data;
  const paid = useMemo(() => (data ? paidClaims(data) : []), [data]);
  if (!data || paid.length === 0) return null;
  const thisYear = Number(ledger.today.slice(0, 4));
  const groups = groupByMonth(paid);

  return (
    <Card as="section" id="paid" aria-labelledby={titleId}>
      <h2 id={titleId} className="card-title">
        지급한 기록
      </h2>
      <p className={claims.note}>잘못 기록했으면 [지급 취소]를 눌러 주세요. 다시 줄 돈으로 돌아가요</p>
      {groups.map((g) => (
        <div key={g.month} className={styles.paidMonth}>
          <h3 className={claims.sectionHead}>{monthTitle(g.month, thisYear)}</h3>
          <ul className={claims.moreList} aria-label={`${monthTitle(g.month, thisYear)} 지급한 기록`}>
            {g.items.map((p) => {
              const title = expenseTitle(data, p.expense);
              const id = p.expense.id;
              return (
                <li key={id} className={styles.recordRow}>
                  <span className={claims.moreTitle}>
                    {p.payer} · {title}
                    {p.borrowed ? (
                      <>
                        {' '}
                        <Badge tone="warning" size="sm">
                          저수지에서 빌려 지급
                        </Badge>
                      </>
                    ) : null}
                    <span className={claims.moreMeta}>{formatShortDate(p.date)} 지급</span>
                  </span>
                  <span className={claims.moreAmount}>{formatWon(p.amount)}</span>
                  <Button
                    variant="ghost"
                    className={claims.moreBtn}
                    {...lock(`unpay:${id}`)}
                    onClick={() =>
                      void act(
                        `unpay:${id}`,
                        () => ledger.undoClaimPayments([id]),
                        `${p.payer}에게 ${formatWon(p.amount)} 지급한 기록을 취소했어요`,
                      )
                    }
                    aria-label={`${p.payer} ${title} ${formatWon(p.amount)} 지급 취소`}
                  >
                    지급 취소
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </Card>
  );
}
