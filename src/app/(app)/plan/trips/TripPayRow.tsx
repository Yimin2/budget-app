'use client';

import { TRIP_ITEM_LABELS, expenseTripItem, formatShortDate, formatWon, isClaimExpense, isClaimSettled } from '@/domain';
import type { Expense } from '@/domain';
import { Badge } from '@/ui';
import type { ReadyLedger } from '../../_components';
import styles from './trips.module.css';

/** 여행에 낸 돈 한 줄. 누르면 지출 고치기 창 (낸 돈 목록 · 날짜별 펼친 칸이 함께 써요) */
export function TripPayRow({ ledger, expense: e, onEdit }: { ledger: ReadyLedger; expense: Expense; onEdit: (e: Expense) => void }) {
  const { data, today } = ledger;
  const eventAccountId = ledger.accountByRole('event')?.id ?? null;
  const accountName = data.accounts.find((a) => a.id === e.accountId)?.name ?? '지운 통장';
  const categoryName = e.categoryId ? data.categories.find((c) => c.id === e.categoryId)?.name : undefined;
  const title = e.memo.trim() || categoryName || '지출';
  const claim = isClaimExpense(e);
  const settled = claim && isClaimSettled(data, e.id);
  const elsewhere = e.accountId !== eventAccountId;
  return (
    <button type="button" className={styles.payRow} onClick={() => onEdit(e)}>
      <span className={styles.payDate}>{formatShortDate(e.date)}</span>
      <span className={styles.payMain}>
        <span className={styles.payTitle}>{title}</span>
        <span className={styles.payMeta}>
          {TRIP_ITEM_LABELS[expenseTripItem(e)]} · {accountName}
          {e.date > today ? ' · 미리 기록' : ''}
        </span>
        {claim || elsewhere ? (
          <span className={styles.badges}>
            {claim ? (
              <Badge size="sm" tone={settled ? 'success' : 'warning'}>
                {settled ? `${e.paidBy} 돌려받음` : `${e.paidBy} 돌려받기 전`}
              </Badge>
            ) : null}
            {elsewhere ? (
              <Badge size="sm" tone="neutral" dot={false}>
                다른 통장
              </Badge>
            ) : null}
          </span>
        ) : null}
      </span>
      <span className={styles.payAmount}>{formatWon(e.amount)}</span>
    </button>
  );
}
