'use client';

import Link from 'next/link';
import { useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { eventMonthlyCosts, formatManShort, formatShortDate, formatWon, monthOf, pastMonthRows } from '@/domain';
import type { Id, ISODate, LedgerData, MonthSpentRow, SpentBasisMonth, SpentBasisView, Won, YearMonth } from '@/domain';
import { Badge, Button, Card, Dialog, Icon, cx } from '@/ui';
import { CardHead, cardStyles } from './CardHead';
import { aheadSpendSplit, claimBadges, monthLabel, type AheadItem, type ClaimBadge } from './selectors';
import { tripHref } from './trips/selectors';
import styles from './eventsHome.module.css';

/** 차트 높이 (양수 영역) */
const POS_H = 140;
/** 음수 영역 최대 높이 */
const NEG_MAX = 70;

export interface BalanceChartProps {
  view: SpentBasisView;
  data: LedgerData;
  today: ISODate;
  accountId: Id;
  /** 차트 위 한 줄 (모자라는 달 알림 · 대처하기) */
  notice?: ReactNode;
}

/**
 * 이벤트 화면 '달 말 잔액' 카드 (PLAN 4-2, 쓴 날 기준): 지난 3개월(회색) + 이번 달부터 예측(파랑, 0 아래는 빨강).
 * 막대를 누르면 그달 상세가 시트로 올라와요 (휴대폰은 아래에서, 넓은 화면은 가운데 창)
 */
export function BalanceChart({ view, data, today, accountId, notice }: BalanceChartProps) {
  const titleId = useId();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const months = view.months;
  const thisMonth = monthOf(today);
  // 시작일 전 달(쓴 돈만)은 쓴 돈 높이로
  const height = (m: SpentBasisMonth) => (m.spentOnly ? m.spent : m.end);
  const maxPos = Math.max(1, ...months.map(height));
  const maxNeg = Math.max(0, ...months.map((m) => -m.end));
  const scale = POS_H / Math.max(maxPos, maxNeg * (POS_H / NEG_MAX));
  const negH = maxNeg > 0 ? Math.min(NEG_MAX, Math.ceil(maxNeg * scale)) : 0;
  const open = openIndex !== null ? (months[openIndex] ?? null) : null;

  return (
    <Card as="section" className={cardStyles.card} aria-labelledby={titleId} data-testid="balance-chart">
      <CardHead titleId={titleId} title="달 말 잔액" actions={<span className={styles.basis}>막대 위 = 그달 말 잔액(예상)</span>} />
      {notice}
      <ul className={styles.chart} style={{ '--cols': months.length } as CSSProperties} aria-label="달마다 달 말 잔액">
        {months.map((m, i) => {
          const isThis = m.month === thisMonth;
          const short = !m.spentOnly && m.end < 0;
          const name = monthLabel(m.month, today);
          const value = m.spentOnly ? `쓴 ${formatManShort(m.spent)}` : formatManShort(m.end);
          return (
            <li key={m.month} style={{ display: 'flex', minWidth: 0 }}>
              <button
                type="button"
                className={styles.col}
                onClick={() => setOpenIndex(i)}
                aria-label={
                  m.spentOnly
                    ? `${name} 쓴 돈 ${formatWon(m.spent)} · 통장 시작 전이라 잔액은 몰라요. 자세히 보기`
                    : `${name}${isThis ? '(이번 달)' : ''} 달 말 ${formatWon(m.end)}${short ? ' · 모자라요' : ''}${m.kind === 'past' ? ' · 지난 달' : ''}. 자세히 보기`
                }
                data-testid={`bar-${m.month}`}
              >
                <span className={styles.pos} aria-hidden="true">
                  {/* 막대 위 금액: 달 말 잔액(예상), 시작일 전 달은 '쓴 ○만' */}
                  <span className={cx(styles.val, isThis && styles.valThis, short && styles.valShort, m.spentOnly && styles.valSpent)}>{value}</span>
                  <span
                    className={cx(styles.bar, m.kind === 'past' && styles.barPast, m.spentOnly && styles.barSpent, height(m) <= 0 && styles.barZero)}
                    style={{ height: height(m) > 0 ? Math.max(2, Math.round(height(m) * scale)) : 0 }}
                  />
                </span>
                <span className={styles.neg} style={{ '--neg-h': `${negH}px` } as CSSProperties} aria-hidden="true">
                  {short ? <span className={cx(styles.bar, styles.barNeg)} style={{ height: Math.max(2, Math.round(-m.end * scale)) }} /> : null}
                </span>
                <span className={cx(styles.label, isThis && styles.labelThis, short && styles.labelShort)} aria-hidden="true">
                  {Number(m.month.slice(5))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className={styles.chartFoot}>
        막대를 누르면 그 달을 자세히 봐요 · 회색은 지난 달{months.some((m) => m.spentOnly) ? ' · 줄무늬는 통장 시작 전이라 쓴 돈만' : ''}
      </p>
      {open ? (
        <Dialog open onClose={() => setOpenIndex(null)} title={`${monthLabel(open.month, today)}${open.month === thisMonth ? ' · 이번 달' : ''}`}>
          <MonthSheet
            key={open.month}
            m={open}
            view={view}
            data={data}
            today={today}
            accountId={accountId}
            onPrev={openIndex! > 0 ? () => setOpenIndex(openIndex! - 1) : undefined}
            onNext={openIndex! < months.length - 1 ? () => setOpenIndex(openIndex! + 1) : undefined}
          />
        </Dialog>
      ) : null}
    </Card>
  );
}

/** 시트 목록 한 줄 */
interface SheetRow {
  key: string;
  date?: string;
  label: string;
  note?: string;
  amount: Won;
  tripId?: Id;
  badges?: ClaimBadge[];
  muted?: boolean;
}

function spentRow(r: MonthSpentRow, note?: string): SheetRow {
  return {
    key: `${r.phase}:${r.key}`,
    date: r.date && (r.count === 1 || r.kind === 'event') ? formatShortDate(r.date) : r.kind === 'trip' ? '여행' : undefined,
    label: r.label,
    note: [r.count > 1 && r.expenseIds.length > 1 ? `${r.expenseIds.length}건` : '', note ?? ''].filter(Boolean).join(' · ') || undefined,
    amount: r.amount,
    tripId: r.tripId,
    badges: claimBadges(r.claims, r.amount),
  };
}

function aheadRow(i: AheadItem): SheetRow {
  return {
    key: i.key,
    date: i.date ? formatShortDate(i.date) : i.kind === 'trip' ? '여행' : undefined,
    label: i.label,
    note: i.kind === 'usual' ? `예상 · ${i.note ?? ''}`.replace(/ · $/, '') : i.note,
    amount: i.amount,
    tripId: i.tripId,
    muted: i.kind === 'usual',
  };
}

/** 그달 쓴 돈(쓸 돈) 줄 */
function sheetRows(m: SpentBasisMonth, view: SpentBasisView, data: LedgerData, today: ISODate, accountId: Id): SheetRow[] {
  if (m.kind === 'past') return pastMonthRows(data, accountId, m.month).map((r) => spentRow(r));
  const p = m.projection!;
  const inst = new Map<YearMonth, { key: string; label: string; amount: Won }[]>();
  for (const c of eventMonthlyCosts(data, today, { pastMonths: 0, futureMonths: 12 })) {
    const list = c.items.filter((i) => i.kind === 'installment' && i.planned > 0).map((i) => ({ key: i.key, label: i.label, amount: i.planned }));
    if (list.length > 0) inst.set(c.month, list);
  }
  const split = aheadSpendSplit(p, inst.get(m.month));
  if (m.kind === 'this' && view.thisMonth) {
    const t = view.thisMonth;
    const rows: SheetRow[] = [
      ...t.spentRows.map((r) => spentRow(r)),
      ...t.plannedRows.map((r) => spentRow(r, '예정')),
      ...t.tripRows.map((r) => spentRow(r, '여행')),
    ];
    if (t.overdue > 0) rows.push({ key: 'overdue', label: '날짜 지난 일정 · 할부', note: '아직 쓴 것으로 표시하지 않았어요', amount: t.overdue });
    for (const i of split.spend) if (i.kind === 'usual' || i.kind === 'extra') rows.push(aheadRow(i));
    return rows;
  }
  return [...split.spend, ...split.trips].map(aheadRow);
}

function MonthSheet({
  m,
  view,
  data,
  today,
  accountId,
  onPrev,
  onNext,
}: {
  m: SpentBasisMonth;
  view: SpentBasisView;
  data: LedgerData;
  today: ISODate;
  accountId: Id;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const rows = useMemo(() => sheetRows(m, view, data, today, accountId), [m, view, data, today, accountId]);
  const name = monthLabel(m.month, today);
  const short = !m.spentOnly && m.end < 0;
  const past = m.kind === 'past';
  const totalLabel = past ? `${name}에 쓴 돈` : m.kind === 'this' ? '이번 달 쓴 돈 (예정 포함)' : `${name}에 쓸 돈 (예정)`;
  const won = (v: Won) => (
    <>
      {formatManShort(v)}
      <span className="sr-only"> ({formatWon(v)})</span>
    </>
  );

  return (
    <div className={styles.sheet} data-testid="month-sheet">
      <div className={styles.sheetNav}>
        <span className={cx(styles.sheetState, short ? styles.bad : styles.ok)}>
          <Icon name={short ? 'alert-triangle' : 'check-circle'} size={16} />
          {m.spentOnly ? '통장 시작 전 달' : short ? `${formatManShort(-m.end)} 모자라요` : past ? '지난 달' : '모자라지 않아요'}
        </span>
        <span className={styles.navButtons}>
          <Button variant="ghost" iconOnly icon="chevron-left" aria-label="이전 달" onClick={onPrev} disabled={!onPrev} />
          <Button variant="ghost" iconOnly icon="chevron-right" aria-label="다음 달" onClick={onNext} disabled={!onNext} />
        </span>
      </div>

      <div className={styles.total}>
        <span className={styles.totalLabel}>{totalLabel}</span>
        <strong className={styles.totalValue} data-testid="sheet-total">
          {won(m.spent)}
        </strong>
      </div>

      {rows.length > 0 ? (
        <ul className={styles.rows} aria-label={totalLabel}>
          {rows.map((r) => (
            <li key={r.key} className={cx(styles.row, r.muted && styles.rowMuted)}>
              <span className={styles.rowDate}>{r.date ?? ''}</span>
              <span className={styles.rowMain}>
                <span>{r.tripId ? <Link href={tripHref(r.tripId)}>{r.label}</Link> : r.label}</span>
                {r.note ? <span className={styles.rowNote}>{r.note}</span> : null}
                {r.badges && r.badges.length > 0 ? (
                  <span className={styles.rowBadges}>
                    {r.badges.map((b) => (
                      <Badge key={b.text} tone={b.tone} variant="soft" size="sm" dot={false}>
                        {b.text}
                      </Badge>
                    ))}
                  </span>
                ) : null}
              </span>
              <span className={styles.rowAmount}>{won(r.amount)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>{past ? '이 달에 쓴 돈이 없어요' : '이 달에 쓸 돈이 없어요'}</p>
      )}

      {m.spentOnly ? (
        <p className={styles.sheetNote} data-testid="sheet-note">
          이벤트통장 시작일 전이라 들어온 돈 기록이 없어 잔액은 몰라요. 쓴 돈만 보여 줘요. 설정 › 통장에서 시작일 · 시작 잔액을 앞당기면 잔액도 나와요.
        </p>
      ) : (
      <dl className={styles.calc} data-testid="sheet-calc">
        <div>
          <dt>{name} 1일 잔액</dt>
          <dd>{won(m.start)}</dd>
        </div>
        <div>
          <dt>{past ? '들어온 돈' : '들어올 돈'}</dt>
          <dd>+{won(m.inflow)}</dd>
        </div>
        <div>
          <dt>{past ? '쓴 돈' : '쓸 돈'}</dt>
          <dd>−{won(m.spent)}</dd>
        </div>
        {m.transferOut > 0 ? (
          <div>
            <dt>옮겨 갈 돈</dt>
            <dd>−{won(m.transferOut)}</dd>
          </div>
        ) : null}
        {m.other !== 0 ? (
          <div>
            <dt>{m.other > 0 ? '그 밖에 나간 돈' : '그 밖에 들어온 돈'}</dt>
            <dd>
              {m.other > 0 ? '−' : '+'}
              {won(Math.abs(m.other))}
            </dd>
          </div>
        ) : null}
        <div className={styles.calcTotal}>
          <dt>{name} 말 잔액</dt>
          <dd className={short ? styles.bad : undefined}>{won(m.end)}</dd>
        </div>
      </dl>
      )}

      {m.repaid > 0 || m.owed > 0 ? (
        <p className={styles.sheetNote} data-testid="sheet-note">
          {m.repaid > 0
            ? `통장에서는 이 달에 개인 돈으로 낸 청구 ${formatManShort(m.repaid)}를 돌려${past ? '줬어요' : '줘요'}. 쓴 달에 셌으니 다시 빼지 않아요. `
            : ''}
          {m.owed > 0 ? `달 말 통장 잔액은 ${formatManShort(m.bankEnd)}이고, 그중 ${formatManShort(m.owed)}는 돌려줄 돈이에요.` : ''}
        </p>
      ) : null}
    </div>
  );
}
