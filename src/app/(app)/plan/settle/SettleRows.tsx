'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { formatMan, formatMonthKo, formatShortDate, formatWon, hasBatchim, isCarriedOverClaim } from '@/domain';
import type { Expense, Id, LedgerData, Settlement, SettleMonth, SettleRow } from '@/domain';
import { useLedger } from '@/state';
import { Badge, Button, Icon, cx, type Tone } from '@/ui';
import { ExpandButton } from '../../_components/ExpandButton';
import { tripHref } from '../trips/selectors';
import { LoanAmountForm, loanRecordName, useLoanActions } from '../LoanLine';
import styles from './settle.module.css';

function expenseTitle(data: LedgerData, e: Expense): string {
  const memo = e.memo.trim();
  if (memo) return memo;
  const cat = e.categoryId ? data.categories.find((x) => x.id === e.categoryId)?.name : undefined;
  return cat ?? '지출';
}

/** 체크박스 (indeterminate 지원) */
function TriCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" className={className} checked={checked} onChange={onChange} aria-label={label} />;
}

export function MonthBlock({
  m,
  data,
  s,
  baseYear,
  open,
  onToggle,
  isOn,
  setMany,
  onOpen,
}: {
  m: SettleMonth;
  data: LedgerData;
  s: Settlement;
  baseYear: number;
  open: boolean;
  onToggle: () => void;
  isOn: (id: Id) => boolean;
  setMany: (ids: Id[], on: boolean) => void;
  onOpen: (e: Expense) => void;
}) {
  const label = formatMonthKo(m.month, baseYear);
  const listId = useId();
  const pendingIds = m.rows.filter((r) => r.item).map((r) => r.expense.id);
  const on = pendingIds.filter(isOn).length;
  const all = pendingIds.length > 0 && on === pendingIds.length;
  return (
    <li className={styles.month} data-month={m.month}>
      <div className={styles.monthHead}>
        <h3 className={styles.monthTitle}>
          {label}
          <span className={styles.monthSum}>
            {' '}
            · 합계 {formatMan(m.total)} · {m.pendingCount > 0 ? `줄 돈 ${formatMan(m.pendingTotal)}` : '다 정리됨'}
          </span>
        </h3>
        {pendingIds.length > 0 ? (
          <label className={styles.monthAll}>
            모두 고르기
            <TriCheckbox
              className={styles.check}
              checked={all}
              indeterminate={on > 0 && !all}
              onChange={() => setMany(pendingIds, !all)}
              label={`${label} 모두 고르기`}
            />
          </label>
        ) : (
          <ExpandButton open={open} onToggle={onToggle} controls={listId} openLabel="펼치기" closeLabel="접기" label={label} />
        )}
      </div>
      {open ? (
        <ul id={listId} className={styles.rows} aria-label={`${label} 기록`}>
          {m.rows.map((r) => (
            <Row
              key={r.expense.id}
              r={r}
              data={data}
              s={s}
              baseYear={baseYear}
              on={isOn(r.expense.id)}
              onToggle={() => setMany([r.expense.id], !isOn(r.expense.id))}
              onOpen={() => onOpen(r.expense)}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

const STATUS_BADGE: Record<SettleRow['status'], { text: string; tone: Tone }> = {
  claimPending: { text: '줄 돈', tone: 'warning' },
  claimPaid: { text: '지급함', tone: 'success' },
  borrowed: { text: '저수지에서 빌려 줌', tone: 'info' },
  plain: { text: '그냥 지출', tone: 'neutral' },
};

const paidByText = (name: string) => `${name}${hasBatchim(name) ? '이' : '가'} 냄`;

function Row({
  r,
  data,
  s,
  baseYear,
  on,
  onToggle,
  onOpen,
}: {
  r: SettleRow;
  data: LedgerData;
  s: Settlement;
  baseYear: number;
  on: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const ledger = useLedger();
  const { act, lock } = useLoanActions();
  const [editingLoan, setEditingLoan] = useState(false);
  const e = r.expense;
  const title = expenseTitle(data, e);
  const badge = STATUS_BADGE[r.status];
  const payer = (e.paidBy ?? '').trim();
  const pending = r.item !== null;
  // 지우지 않은 여행에 묶인 지출이면 보라 여행 배지
  const trip = e.tripId ? (data.trips.find((t) => t.id === e.tripId && !t.deleted) ?? null) : null;

  const meta: string[] = [];
  const notes: { text: string; warn?: boolean }[] = [];
  if (pending) {
    const item = r.item!;
    if (payer) meta.push(paidByText(payer));
    if ((item.kind === 'pay' || item.kind === 'carry') && isCarriedOverClaim(s, item.claim)) notes.push({ text: '지난달부터', warn: true });
    if (item.kind === 'borrow') notes.push({ text: '저수지에서 빌려 지급' });
    if (item.kind === 'reservoir') notes.push({ text: '저수지에서 지급' });
    if (item.kind === 'carry') {
      const est = s.carry.find((g) => g.name === item.claim.payer)?.estimate ?? null;
      notes.push({ text: est ? `다음 달로 넘어가요 · ${formatMonthKo(est, baseYear)}쯤` : '다음 달로 넘어가요' });
    }
    if (item.kind === 'upcoming') notes.push({ text: `정산일 ${formatShortDate(item.claim.due)}` });
    if (!e.claimDue) notes.push({ text: '날짜 추정' });
  } else if (r.paid) {
    meta.push(r.paid.payer || payer, `${formatShortDate(r.paid.date)} 지급`);
  } else if (r.loan) {
    meta.push(`${formatShortDate(r.loan.transfer.date)} 빌림`);
  } else {
    meta.push(e.accountId === s.eventAccountId ? '이벤트통장' : (data.accounts.find((a) => a.id === e.accountId)?.name ?? ''));
  }
  const metaText = meta.filter(Boolean).join(' · ');
  const loanName = r.loan ? loanRecordName(data, { kind: r.loan.kind, transfer: r.loan.transfer, expenseId: r.loan.expenseId }) : '';

  return (
    <li className={cx(styles.row, !pending && styles.rowMuted)}>
      {pending ? (
        <input type="checkbox" className={styles.check} checked={on} onChange={onToggle} aria-label={`${title} ${formatWon(r.amount)} 고르기`} />
      ) : (
        <span className={cx(styles.dot, styles[`dot_${r.status}`])} aria-hidden />
      )}
      <span className={styles.date}>{formatShortDate(e.date)}</span>
      <div className={styles.main}>
        <span className={styles.titleLine}>
          <button type="button" className={styles.titleBtn} onClick={onOpen} aria-label={`${title} 자세히 보기`}>
            {title}
          </button>
          {trip ? (
            <Link href={tripHref(trip.id)} className={cx('badge', 'sm', 'soft', 'violet', styles.tripBadge)} aria-label={`여행 ${trip.name} 보기`}>
              <Icon name="plane" size={16} />
              {trip.name}
            </Link>
          ) : null}
        </span>
        <span className={styles.meta}>
          <span className={styles.metaDate}>{formatShortDate(e.date)} · </span>
          {metaText}
          {notes.map((n) => (
            <span key={n.text} className={cx(n.warn && styles.warnNote)}>
              {' · '}
              {n.text}
            </span>
          ))}
        </span>
      </div>
      <span className={styles.badge}>
        <Badge tone={badge.tone} variant="soft" size="sm" dot={false}>
          {badge.text}
        </Badge>
      </span>
      <span className={cx(styles.amount, pending && styles.amountStrong)}>{formatMan(r.amount)}</span>
      {!pending && (r.paid || r.loan) ? (
        <div className={styles.actions}>
          {editingLoan && r.loan ? (
            <LoanAmountForm name={loanName} transferId={r.loan.transfer.id} amount={r.loan.transfer.amount} onDone={() => setEditingLoan(false)} />
          ) : (
            <>
              {r.paid ? (
                <Button
                  variant="ghost"
                  className={styles.actionBtn}
                  {...lock(`unpay:${e.id}`)}
                  onClick={() =>
                    void act(`unpay:${e.id}`, () => ledger.undoClaimPayments([e.id]), `${r.paid!.payer}에게 ${formatWon(r.paid!.amount)} 지급한 기록을 취소했어요`)
                  }
                  aria-label={`${r.paid.payer} ${title} ${formatWon(r.paid.amount)} 지급 취소`}
                >
                  지급 취소
                </Button>
              ) : null}
              {r.loan ? (
                <Button variant="ghost" className={styles.actionBtn} onClick={() => setEditingLoan(true)} aria-label={`${loanName} 빌린 금액 고치기`}>
                  금액 고치기
                </Button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

/* ───────── 오른쪽: 줄 수 있는 돈 · 사람별 · 저수지 ───────── */
