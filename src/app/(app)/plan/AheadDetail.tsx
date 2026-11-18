'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { forecastCompare, formatManShort, formatShortDate, formatWon, monthOf, monthSpentItems } from '@/domain';
import type {
  ForecastSnapshot, Id, ISODate, LedgerData, MonthSpentRow, PastMonth, ProjectionMonth, ProjectionRangeMonth, SpentOnlyMonth,
  ThisMonthSpending, Won, YearMonth,
} from '@/domain';
import { Badge, Button, Icon, cx } from '@/ui';
import {
  aheadInflowText, capList, claimBadges, futureSpendLines, pastSpendTitle, thisMonthSpendLines, repayByMonth, repayPayersLine,
  repaySummary, monthLabel, monthShortLine, type AheadItem, type AheadSpendSplit, type ClaimBadge, type SpendLines,
} from './selectors';
import { tripHref } from './trips/selectors';
import shared from './events.module.css';
import styles from './AheadCard.module.css';
import { PAST_RECORDS_HREF, SETTLE_SCREEN_HREF, AHEAD_LIST_LIMIT, AHEAD_LIST_KEEP } from './aheadShared';

/** 쓴 돈 · 쓸 돈 목록 한 줄 */
interface ListRow {
  key: string;
  /** 날짜 칸 (없으면 빈 칸) */
  date?: string;
  label: string;
  /** 'N건' 같은 짧은 설명 */
  note?: string;
  amount: Won;
  tripId?: Id;
  badges?: ClaimBadge[];
  muted?: boolean;
  /** 날짜가 지난 일정 (화면 읽기) */
  overdue?: boolean;
}

/** 묶은 쓴 돈 줄 → 목록 한 줄. withDate 면 한 건짜리 줄에 날짜를 보여요 */
function spentRow(r: MonthSpentRow, withDate: boolean): ListRow {
  return {
    key: `${r.phase}:${r.key}`,
    date: withDate && r.date && (r.count === 1 || r.kind === 'event') ? formatShortDate(r.date) : withDate && r.kind === 'trip' ? '여행' : undefined,
    label: r.label,
    note: r.count > 1 && r.expenseIds.length > 1 ? `${r.expenseIds.length}건` : undefined,
    amount: r.amount,
    tripId: r.tripId,
    badges: claimBadges(r.claims, r.amount),
  };
}

/** 예측 항목 → 목록 한 줄 */
function aheadRow(item: AheadItem, today: ISODate): ListRow {
  return {
    key: item.key,
    date: item.date ? formatShortDate(item.date) : item.kind === 'trip' ? '여행' : undefined,
    label: item.label,
    note: item.note ? (item.kind === 'usual' ? `(${item.note})` : item.note) : undefined,
    amount: item.amount,
    tripId: item.tripId,
    muted: item.kind === 'usual',
    overdue: !!item.date && item.date < today,
  };
}

function Row({ row, withDate }: { row: ListRow; withDate: boolean }) {
  return (
    <li className={cx(row.muted && styles.itemMuted)}>
      {withDate ? <span className={styles.d}>{row.date ?? ''}</span> : null}
      <span className={styles.n}>
        {row.tripId ? <Link href={tripHref(row.tripId)}>{row.label}</Link> : row.label}
        {row.overdue ? <span className="sr-only"> (날짜 지남)</span> : null}
        {row.note ? <span className={styles.note}>{row.note.startsWith('(') ? ` ${row.note}` : ` · ${row.note}`}</span> : null}
        {row.badges && row.badges.length > 0 ? (
          <span className={styles.badges}>
            {row.badges.map((b) => (
              <Badge key={b.text} tone={b.tone} variant="soft" size="sm" dot={false}>
                {b.text}
              </Badge>
            ))}
          </span>
        ) : null}
      </span>
      <span className={styles.a}>
        <Man value={row.amount} />
      </span>
    </li>
  );
}

/** 긴 목록: 6줄을 넘으면 앞 5줄 + 'N건 더' */
function RowList({ rows, label, withDate = true, testId }: { rows: ListRow[]; label: string; withDate?: boolean; testId?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? { shown: rows, more: 0 } : capList(rows, AHEAD_LIST_LIMIT, AHEAD_LIST_KEEP);
  return (
    <>
      <ul className={styles.items} aria-label={label} data-testid={testId}>
        {shown.shown.map((r) => (
          <Row key={r.key} row={r} withDate={withDate} />
        ))}
      </ul>
      {shown.more > 0 ? <MoreButton count={shown.more} onClick={() => setAll(true)} /> : null}
    </>
  );
}

/** 고른 달 맨 위 합계 (굵게) + 작은 줄 */
function TotalBox({ lines }: { lines: SpendLines }) {
  return (
    <div className={styles.totalBox} data-testid="ahead-total">
      <p className={styles.totalTitle}>{lines.title}</p>
      {lines.split ? <p className={styles.totalSub}>= {lines.split}</p> : null}
      {lines.trip ? (
        <p className={styles.totalSub} data-testid="ahead-trip">
          {lines.trip}
        </p>
      ) : null}
    </div>
  );
}

/** 보이는 금액은 만 단위, 화면 읽기는 정확한 원 단위 */
function Man({ value }: { value: number }) {
  return (
    <>
      <span aria-hidden>{formatManShort(value)}</span>
      <span className="sr-only">{formatWon(value)}</span>
    </>
  );
}

/** 'N건 더' (누르면 나머지를 보여요) */
function MoreButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button type="button" className={styles.moreBtn} onClick={onClick}>
      {count}건 더
      <Icon name="chevron-down" size={16} />
    </button>
  );
}

/**
 * 지난 지출 돌려주기 묶음 (PLAN 4-2): 처음엔 접어서 머리 한 줄 '지난 지출 돌려주기 440만 · 25건 (6~10월에 쓴 것)' +
 * 낸 사람별 합 '민구 420만 · 기쁜 20만' + [펼치기] · 정산 화면 링크. 펼치면 쓴 달별 한 줄 '6월 · 3건 45만'(오래된 달 먼저),
 * 달을 누르면 그달 항목(5줄 + 'N건 더'). 청구 한 건씩 목록이 없으면(합만) 한 줄 그대로
 */
function RepayGroup({ month, items, label, today }: { month: ProjectionMonth; items: AheadItem[]; label: string; today: ISODate }) {
  const ids = useId().replace(/:/g, '');
  const [open, setOpen] = useState(false);
  const [openMonths, setOpenMonths] = useState<ReadonlySet<YearMonth>>(new Set());
  const [allMonths, setAllMonths] = useState<ReadonlySet<YearMonth>>(new Set());
  const groups = repayByMonth(items, month);
  const payers = repayPayersLine(month);
  const head = repaySummary(month) ?? '지난 지출 돌려주기';
  const toggleMonth = (m: YearMonth) =>
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  const listId = `${ids}-repay`;
  return (
    <div className={styles.group} data-testid="ahead-repay">
      <h4 className={styles.groupTitle} data-testid="ahead-repay-head">
        {head}
      </h4>
      {payers ? (
        <p className={styles.repayPayers} data-testid="ahead-repay-payers">
          {payers}
        </p>
      ) : null}
      <div className={styles.repayActions}>
        {groups.length > 0 ? (
          <button
            type="button"
            className={styles.toggleBtn}
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? '접기' : '펼치기'}
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
          </button>
        ) : null}
        <Link href={SETTLE_SCREEN_HREF} className={styles.repayLink}>
          정산 화면
          <Icon name="chevron-right" size={16} />
        </Link>
      </div>
      {groups.length === 0 ? (
        <ul className={styles.items} aria-label={`${label} 지난 지출 돌려주기`}>
          {items.map((i) => (
            <Row key={i.key} row={aheadRow(i, today)} withDate />
          ))}
        </ul>
      ) : open ? (
        <ul id={listId} className={styles.repayMonths} aria-label={`${label} 지난 지출 돌려주기`}>
          {groups.map((g) => {
            const mOpen = openMonths.has(g.month);
            const rows = allMonths.has(g.month) ? { shown: g.items, more: 0 } : capList(g.items, AHEAD_LIST_LIMIT, AHEAD_LIST_KEEP);
            const rowsId = `${ids}-repay-${g.month}`;
            return (
              <li key={g.month} className={styles.repayMonth}>
                <button
                  type="button"
                  className={styles.monthToggle}
                  aria-expanded={mOpen}
                  aria-controls={rowsId}
                  onClick={() => toggleMonth(g.month)}
                >
                  <span className={styles.monthToggleText}>
                    {g.label}에 쓴 것 · {g.count}건
                  </span>
                  <span className={styles.groupAmount}>
                    <Man value={g.amount} />
                  </span>
                  <Icon name={mOpen ? 'chevron-up' : 'chevron-down'} size={16} />
                </button>
                {mOpen ? (
                  <>
                    <ul id={rowsId} className={styles.items} aria-label={`${g.label}에 쓴 것`}>
                      {rows.shown.map((i) => (
                        <li key={i.key}>
                          <span className={styles.d}>{i.date ? formatShortDate(i.date) : ''}</span>
                          <span className={styles.n}>{i.payer ?? i.label}</span>
                          <span className={styles.a}>
                            <Man value={i.amount} />
                          </span>
                        </li>
                      ))}
                    </ul>
                    {rows.more > 0 ? (
                      <MoreButton count={rows.more} onClick={() => setAllMonths((prev) => new Set(prev).add(g.month))} />
                    ) : null}
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {open || groups.length === 0 ? (
        <p className={styles.groupNote}>이미 쓴 돈이라 지출은 그때 달에 세고, 여기선 통장에서 돈이 나가는 날로 잡아요</p>
      ) : null}
    </div>
  );
}

function DetailNav({ onPrev, onNext }: { onPrev?: () => void; onNext?: () => void }) {
  return (
    <div className={shared.nav}>
      <Button variant="ghost" plain iconOnly icon="chevron-left" aria-label="이전 달" onClick={onPrev} disabled={!onPrev} />
      <Button variant="ghost" plain iconOnly icon="chevron-right" aria-label="다음 달" onClick={onNext} disabled={!onNext} />
    </div>
  );
}

/**
 * 이번 달 · 앞으로 달 (PLAN 4-2): 그달 쓴 돈 · 쓸 돈 (쓴 날 기준) → 합계 밖 돈(여행 · 평소 쓰는 돈 예상) → 아래 잔액 묶음
 * (통장에서 나갈 돈: 지난 지출 돌려주기 · 옮겨 갈 돈 → 들어오는 돈 · 그 달 끝 예상 잔액)
 */
export function MonthDetail({
  month,
  split,
  thisSpend,
  range,
  highCount,
  today,
  prevForecast,
  onPrev,
  onNext,
}: {
  month: ProjectionMonth;
  split: AheadSpendSplit;
  /** 이번 달이면 쓴 날 기준 이번 달 쓴 돈 */
  thisSpend: ThisMonthSpending | null;
  range: ProjectionRangeMonth | null;
  highCount: number;
  today: ISODate;
  prevForecast: ForecastSnapshot | null;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const isThis = month.month === monthOf(today);
  const short = month.endBalance < 0;
  const label = monthLabel(month.month, today);
  const lines = thisSpend ? thisMonthSpendLines(thisSpend) : futureSpendLines(month, today);
  const rows: ListRow[] = thisSpend
    ? [...thisSpend.spentRows.map((r) => spentRow(r, true)), ...thisSpend.plannedRows.map((r) => spentRow(r, true))]
    : split.spend.map((i) => aheadRow(i, today));
  // 합계 밖: 여행(따로 세요) · 이번 달 평소 쓰는 돈 예상 · 살까 하는 지출 (잔액 계산엔 넣어요)
  const aside: ListRow[] = thisSpend
    ? [
        ...thisSpend.tripRows.map((r) => spentRow(r, true)),
        ...split.spend.filter((i) => i.kind === 'usual' || i.kind === 'extra').map((i) => aheadRow(i, today)),
      ]
    : split.trips.map((i) => aheadRow(i, today));
  const overdue = thisSpend?.overdue ?? 0;
  const repay = split.outflow.filter((i) => i.kind === 'claims');
  const hasOut = repay.length > 0 || split.transferOut > 0 || overdue > 0;
  const emptyText = thisSpend ? '이번 달에 쓴 돈 · 쓸 돈이 없어요' : '이 달에 쓸 돈은 없어요';
  return (
    <div className={styles.detail} data-testid="ahead-month">
      <div className={shared.detailHead}>
        <div className={shared.txt}>
          <h3 className={styles.detailTitle}>
            {label}
            {isThis ? ' · 이번 달' : ''}
          </h3>
          <span className={styles.detailSub}>
            <span className={cx(shared.statusLine, short ? shared.bad : shared.ok)} data-testid="ahead-month-status">
              <Icon name={short ? 'alert-triangle' : 'check-circle'} size={16} />
              {monthShortLine(month, today) ?? '모자라지 않아요'}
            </span>
          </span>
        </div>
        <DetailNav onPrev={onPrev} onNext={onNext} />
      </div>
      <TotalBox lines={lines} />
      {rows.length > 0 ? (
        <div className={styles.group}>
          <RowList rows={rows} label={thisSpend ? `${label} 쓴 돈` : `${label} 쓸 돈`} />
        </div>
      ) : (
        <p className={styles.detailEmpty}>{emptyText}</p>
      )}
      {aside.length > 0 ? (
        <div className={styles.group} data-testid="ahead-aside">
          <h4 className={styles.groupTitle}>합계에 안 넣은 돈</h4>
          <RowList rows={aside} label={`${label} 합계에 안 넣은 돈`} />
          <p className={styles.groupNote}>
            {thisSpend ? '여행은 따로 세고, 평소 쓰는 돈은 예상이라 합계에 안 넣어요. 잔액 계산엔 넣어요' : '여행은 따로 세요. 잔액 계산엔 넣어요'}
          </p>
        </div>
      ) : null}
      <div className={styles.balance} data-testid="ahead-balance">
        {hasOut ? <h4 className={styles.balanceTitle}>통장에서 나갈 돈</h4> : null}
        {repay.length > 0 ? <RepayGroup month={month} items={repay} label={label} today={today} /> : null}
        <dl className={styles.calc}>
          {split.transferOut > 0 ? (
            <div className={cx(styles.calcRow, styles.calcMuted)}>
              <dt>옮겨 갈 돈</dt>
              <dd>
                −<Man value={split.transferOut} />
              </dd>
            </div>
          ) : null}
          {overdue > 0 ? (
            <div className={cx(styles.calcRow, styles.calcMuted)} data-testid="ahead-overdue">
              <dt>날짜 지난 일정 · 할부</dt>
              <dd>
                −<Man value={overdue} />
              </dd>
            </div>
          ) : null}
          <div className={cx(styles.calcRow, styles.calcMuted)}>
            <dt>들어오는 돈</dt>
            <dd data-testid="ahead-inflow">{aheadInflowText(month, isThis)}</dd>
          </div>
          <div className={cx(styles.calcRow, styles.calcTotal)}>
            <dt>그 달 끝 예상 잔액</dt>
            <dd className={short ? shared.bad : undefined}>
              <Man value={month.endBalance} />
            </dd>
          </div>
          {range ? (
            <div className={cx(styles.calcRow, styles.calcMuted)}>
              <dt>아끼면 · 많이 쓰면</dt>
              <dd>
                {formatManShort(range.endLow)} · <span className={range.endHigh < 0 ? shared.bad : undefined}>{formatManShort(range.endHigh)}</span>
              </dd>
            </div>
          ) : null}
          {prevForecast ? (
            <div className={cx(styles.calcRow, styles.calcMuted)}>
              <dt>지난달 예상</dt>
              <dd data-testid="ahead-prev-forecast">{formatManShort(prevForecast.expected)}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      {range && range.endHigh < 0 && !short && highCount > 0 ? (
        <p className={styles.detailWarn}>많이 쓰면 이 달에 {formatManShort(-range.endHigh)} 모자라요</p>
      ) : null}
    </div>
  );
}

/** 지난 달 쓴 돈 (쓴 날 기준): 굵은 '9월 쓴 돈 37.2만' + 묶은 줄(정산 상태 배지, 5줄 + 'N건 더') */
function PastSpent({ data, accountId, month, today, totalTestId }: { data: LedgerData; accountId: Id; month: YearMonth; today: ISODate; totalTestId?: string }) {
  const spent = useMemo(() => monthSpentItems(data, accountId, month), [data, accountId, month]);
  const label = monthLabel(month, today);
  return (
    <>
      <div className={styles.totalBox} data-testid="ahead-total">
        <p className={styles.totalTitle} data-testid={totalTestId}>
          <span aria-hidden>{pastSpendTitle(month, today, spent.total)}</span>
          <span className="sr-only">
            {label} 쓴 돈 {formatWon(spent.total)}
          </span>
        </p>
        {spent.count > 0 ? <p className={styles.totalSub}>{spent.count}건 · 쓴 날 기준 (청구는 돌려준 달이 아니라 쓴 달에 세요)</p> : null}
      </div>
      {spent.rows.length > 0 ? (
        <div className={styles.group}>
          <RowList rows={spent.rows.map((r) => spentRow(r, false))} label={`${label} 쓴 돈`} withDate={false} />
        </div>
      ) : (
        <p className={styles.detailEmpty}>이 달에 쓴 돈이 없어요</p>
      )}
    </>
  );
}

/** 통장 시작 전 달: '○월 · 통장 기록 전' + 그달 쓴 돈 · 묶은 줄 + 정산 화면 링크. 잔액 · 예측 견주기는 없어요 */
export function SpentDetail({
  s,
  data,
  accountId,
  today,
  onPrev,
  onNext,
}: {
  s: SpentOnlyMonth;
  data: LedgerData;
  accountId: Id;
  today: ISODate;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const label = monthLabel(s.month, today);
  return (
    <div className={styles.detail} data-testid="ahead-spent-month">
      <div className={shared.detailHead}>
        <div className={shared.txt}>
          <h3 className={styles.detailTitle}>{label} · 통장 기록 전</h3>
          <span className={styles.detailSub}>통장을 시작하기 전이라 잔액 대신 쓴 돈만 보여요</span>
        </div>
        <DetailNav onPrev={onPrev} onNext={onNext} />
      </div>
      <PastSpent data={data} accountId={accountId} month={s.month} today={today} totalTestId="ahead-spent-total" />
      <Link href={PAST_RECORDS_HREF} className={styles.pastLink}>
        그 달 쓴 돈은 정산 화면에서
        <Icon name="chevron-right" size={16} />
      </Link>
    </div>
  );
}

/**
 * 지난 달: 그달 쓴 돈(쓴 날 기준, 정산 상태 배지) → 아래 작은 잔액 묶음 (시작 잔액 · 들어온 돈 · 나간 돈 · 끝 잔액 + 그때 예상과 견주기) + 정산 화면 링크.
 * 나간 돈은 통장에서 나간 돈이라 앞서 쓴 청구를 돌려준 돈도 들어 있어요
 */
export function PastDetail({
  past,
  data,
  accountId,
  snapshot,
  today,
  onPrev,
  onNext,
}: {
  past: PastMonth;
  data: LedgerData;
  accountId: Id;
  snapshot: ForecastSnapshot | null;
  today: ISODate;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const label = monthLabel(past.month, today);
  const cmp = snapshot ? forecastCompare(snapshot, past) : null;
  return (
    <div className={styles.detail} data-testid="ahead-past-month">
      <div className={shared.detailHead}>
        <div className={shared.txt}>
          <h3 className={styles.detailTitle}>{label} · 지난 달</h3>
          <span className={styles.detailSub}>그달 쓴 돈과 기록으로 계산한 실제 잔액</span>
        </div>
        <DetailNav onPrev={onPrev} onNext={onNext} />
      </div>
      <PastSpent data={data} accountId={accountId} month={past.month} today={today} />
      <div className={styles.balance} data-testid="ahead-balance">
        <h4 className={styles.balanceTitle}>통장 잔액</h4>
        <dl className={cx(styles.calc, styles.calcCompact)}>
          <div className={cx(styles.calcRow, styles.calcMuted)}>
            <dt>시작 잔액</dt>
            <dd>
              <Man value={past.startBalance} />
            </dd>
          </div>
          <div className={cx(styles.calcRow, styles.calcMuted)}>
            <dt>들어온 돈</dt>
            <dd>
              +<Man value={past.inflow} />
            </dd>
          </div>
          <div className={cx(styles.calcRow, styles.calcMuted)}>
            <dt>나간 돈</dt>
            <dd>
              −<Man value={past.outflow} />
            </dd>
          </div>
          <div className={styles.calcRow}>
            <dt>끝 잔액</dt>
            <dd className={past.endBalance < 0 ? shared.bad : undefined}>
              <Man value={past.endBalance} />
            </dd>
          </div>
        </dl>
        <p className={styles.groupNote} data-testid="ahead-outflow-note">
          나간 돈은 통장에서 나간 돈이라, 앞서 쓴 돈을 이 달에 돌려준 것도 들어 있어요
        </p>
        {cmp ? (
          <div className={styles.compare} data-testid="ahead-compare">
            <p className={styles.compareHead}>{cmp.headline}</p>
            {cmp.detail ? <p className={styles.compareSub}>{cmp.detail}</p> : null}
            {cmp.inflowNote ? <p className={styles.compareSub}>{cmp.inflowNote}</p> : null}
          </div>
        ) : (
          <p className={styles.compareSub}>이 달은 그때 남긴 예측 기록이 없어요</p>
        )}
      </div>
      <Link href={PAST_RECORDS_HREF} className={styles.pastLink}>
        그 달 쓴 돈은 정산 화면에서
        <Icon name="chevron-right" size={16} />
      </Link>
    </div>
  );
}
