'use client';

import { useId, useMemo, useState } from 'react';
import { formatMan, tripDailySpending } from '@/domain';
import type { Expense, TripDayRow, TripStatus } from '@/domain';
import { Badge, Card, ProgressBar, cx } from '@/ui';
import { ExpandButton, type ReadyLedger } from '../../_components';
import { dailySummaryText, dayRowLabel } from './selectors';
import { TripPayRow } from './TripPayRow';
import styles from './trips.module.css';

const rowKey = (r: TripDayRow) => (r.kind === 'day' ? r.date! : r.kind);

/**
 * 여행 날짜별 쓴 돈 (작업정리 15). 처음에는 접힌 요약 한 줄, [펼치기]로 여행 전 · 여행 날마다 · 여행 뒤 줄.
 * 줄마다 가장 큰 줄 대비 얇은 막대, 누르면 같은 자리에서 그날 지출이 펼쳐지고 지출을 누르면 고치기 창
 */
export function TripDailyCard({ ledger, status: s, onEditExpense }: { ledger: ReadyLedger; status: TripStatus; onEditExpense: (e: Expense) => void }) {
  const titleId = useId();
  const ids = useId().replace(/:/g, '');
  const [open, setOpen] = useState(false);
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(() => new Set());
  const daily = useMemo(() => tripDailySpending(s.trip, s.expenses), [s.trip, s.expenses]);
  const summary = dailySummaryText(daily);
  const today = s.phase === 'ongoing' ? ledger.today : null;

  const toggleRow = (key: string) =>
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Card as="section" className={cx(styles.card, styles.wide)} aria-labelledby={titleId}>
      <div className={styles.cardHead}>
        <h2 id={titleId} className="card-title">
          날짜별
        </h2>
        {summary ? (
          <ExpandButton open={open} onToggle={() => setOpen((o) => !o)} controls={`${ids}-days`} openLabel="펼치기" label="날짜별" />
        ) : null}
      </div>
      <p className={summary ? styles.dailySummary : styles.muted} data-testid="trip-daily-summary">
        {summary ?? '아직 날짜별로 정리할 지출이 없어요.'}
      </p>
      {open && summary ? (
        <ul id={`${ids}-days`} className={styles.dayList} aria-label="날짜별 쓴 돈">
          {daily.rows.map((r) => {
            const key = rowKey(r);
            const label = dayRowLabel(r);
            const isToday = today !== null && r.date === today;
            const listId = `${ids}-${key}`;
            const head = (
              <>
                <span className={styles.dayTop}>
                  <span className={styles.dayLabel}>
                    {label}
                    {isToday ? (
                      <Badge size="sm" tone="info" dot={false}>
                        오늘
                      </Badge>
                    ) : null}
                  </span>
                  {r.total > 0 ? (
                    <span className={styles.dayAmount}>{formatMan(r.total)}</span>
                  ) : (
                    <span className={styles.dayNone}>
                      <span aria-hidden>—</span>
                      <span className="sr-only">쓴 돈 없음</span>
                    </span>
                  )}
                </span>
                <ProgressBar value={r.total} max={daily.max} label={label} decorative track="subtle" className={styles.dayBar} />
              </>
            );
            const rowOpen = openRows.has(key);
            return (
              <li key={key} className={cx(styles.dayItem, isToday && styles.dayToday)} aria-current={isToday ? 'date' : undefined}>
                {r.expenses.length > 0 ? (
                  <button
                    type="button"
                    className={styles.dayRow}
                    aria-expanded={rowOpen}
                    aria-controls={listId}
                    onClick={() => toggleRow(key)}
                  >
                    {head}
                  </button>
                ) : (
                  <div className={styles.dayRow}>{head}</div>
                )}
                {rowOpen && r.expenses.length > 0 ? (
                  <ul id={listId} className={cx(styles.payList, styles.dayPays)} aria-label={`${label} 지출`}>
                    {r.expenses.map((e) => (
                      <li key={e.id}>
                        <TripPayRow ledger={ledger} expense={e} onEdit={onEditExpense} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}
