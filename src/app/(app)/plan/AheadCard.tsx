'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import Link from 'next/link';
import {
  eventMonthlyCosts,
  forecastCompare,
  formatManShort,
  formatShortDate,
  formatWon,
  highOnlyShortageMessage,
  lastMonthForecasts,
  monthOf,
  pastMonthEnds,
  snapshotsByTarget,
  spentSoFarThisMonth,
} from '@/domain';
import type {
  EventProjection,
  ForecastSnapshot,
  ISODate,
  LedgerData,
  PastMonth,
  ProjectionMonth,
  ProjectionRangeMonth,
  ShortageFix,
  YearMonth,
} from '@/domain';
import { Badge, Button, Card, Icon, cx, useMediaQuery } from '@/ui';
import { FoldHead, useMobileFold, foldStyles } from './FoldCard';
import {
  aheadInflowText,
  aheadMonthItems,
  aheadMonthSummary,
  aheadTotalLines,
  aheadTotals,
  barsGeometry,
  isNewSpend,
  repaySummary,
  compactWon,
  hasRange,
  hasUsual,
  initialMonth,
  monthLabel,
  rangeNote,
  yOf,
  type AheadItem,
} from './selectors';
import { ShortagePanel } from './ShortagePanel';
import { tripHref } from './trips/selectors';
import shared from './events.module.css';
import styles from './AheadCard.module.css';

/** 고른 달 옆 '다가오는 달' 목록에 보일 달 수 */
export const AHEAD_UPCOMING = 4;

/** 정산 화면 전체 기록 (지난 달 쓴 돈) */
export const PAST_RECORDS_HREF = '/plan/settle#paid';
/** 정산 화면 (돌려줄 돈) */
export const SETTLE_SCREEN_HREF = '/plan/settle';
/** 차트 왼쪽 지난 달 실제 잔액 막대 수 (폰은 가로로 밀어 봐요) */
export const AHEAD_PAST_MONTHS = 12;

type Col =
  | { kind: 'past'; month: YearMonth; value: number; past: PastMonth }
  | { kind: 'ahead'; month: YearMonth; value: number; m: ProjectionMonth; i: number };

export interface AheadCardProps {
  /** 그리는 예측 (예외 지출 빼기를 미리 보는 중이면 덮어씌운 예측) */
  projection: EventProjection;
  data: LedgerData;
  today: ISODate;
  /** 미리 보는 중이면(예외 지출 빼기) 제목 옆에 붙일 표시 */
  badge?: string;
  /** 부족 알림의 두 가지 방법 (미리 보는 중이 아니고 모자라는 달이 있을 때만 알림을 보여요) */
  fix?: ShortageFix | null;
  showShortage?: boolean;
  className?: string;
}

/**
 * 이벤트 화면 카드 2 '앞으로 12개월' (PLAN 4-2): 왼쪽은 지난 12개월 실제 달 말 잔액(회색 막대, 기록으로 계산) + 그때 예상한 잔액(점선, 예측 기록),
 * 이번 달부터는 달 말 예상 잔액 막대(범위 띠 · 미리 보는 중 표시). 0 이상은 기준선 위(파랑), 0 아래는 기준선 아래(빨강) + 모자라는 금액.
 * 이번 달은 달 숫자에 파란 동그라미. 막대를 누르면(마우스는 올리기만 해도) 아래에 그달이 보여요:
 * - 지난 달: 시작 잔액 · 들어온 돈 · 나간 돈 · 끝 잔액, 그때 예상과 견주기, 정산 화면 링크
 * - 이번 달 · 앞으로 달: 나갈 돈 합계(굵게) → 새로 나갈 돈 · 지난 지출 돌려주기 두 묶음 → 들어오는 돈 · 그 달 끝 예상 잔액
 * 옆에 다가오는 달 한 줄씩(합계 먼저) → 모자라는 달이 있으면 부족 알림(두 가지 방법). 화면 읽기 프로그램은 숨긴 표로 모든 달을 읽어요.
 * 폰에서는 상태 한 줄만 보이고 [펼치기]로 나머지. 막대는 가로로 밀어 지난 달을 봐요
 */
export function AheadCard({ projection, data, today, badge, fix = null, showShortage = false, className }: AheadCardProps) {
  const ids = useId().replace(/:/g, '');
  const titleId = `${ids}-title`;
  const months = projection.months;
  const thisMonth = monthOf(today);
  const fold = useMobileFold('앞으로 12개월');
  // 할부 이름: 월별 이벤트 비용(eventMonthlyCosts)의 앞으로 달 할부 줄
  const installmentsByMonth = useMemo(() => {
    const map = new Map<YearMonth, { key: string; label: string; amount: number }[]>();
    for (const c of eventMonthlyCosts(data, today, { pastMonths: 0, futureMonths: Math.max(0, months.length - 1) })) {
      const list = c.items.filter((i) => i.kind === 'installment' && i.planned > 0).map((i) => ({ key: i.key, label: i.label, amount: i.planned }));
      if (list.length > 0) map.set(c.month, list);
    }
    return map;
  }, [data, today, months.length]);

  // 지난 달 실제 잔액 (기록으로 계산) · 그때 예상한 잔액 (예측 기록) · 앞으로 달의 지난달 예측
  const accountId = projection.accountId;
  const past = useMemo(
    () => (accountId && months.length > 0 ? pastMonthEnds(data, accountId, today, AHEAD_PAST_MONTHS) : []),
    [data, accountId, today, months.length],
  );
  const snapshots = useMemo(() => snapshotsByTarget(data, past.map((p) => p.month)), [data, past]);
  const prevForecasts = useMemo(() => lastMonthForecasts(data, today), [data, today]);
  const spentSoFar = useMemo(() => (accountId ? spentSoFarThisMonth(data, accountId, today) : null), [data, accountId, today]);

  const cols = useMemo<Col[]>(
    () => [
      ...past.map((p) => ({ kind: 'past' as const, month: p.month, value: p.endBalance, past: p })),
      ...months.map((m, i) => ({ kind: 'ahead' as const, month: m.month, value: m.endBalance, m, i })),
    ],
    [past, months],
  );

  const [picked, setPicked] = useState<YearMonth | null>(null);
  const [hover, setHover] = useState<YearMonth | null>(null);
  const [announce, setAnnounce] = useState('');
  const colRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // 고른 달이 범위를 벗어나면(날짜가 바뀌어서 등) 처음 달로 돌아가요
  const fallback = initialMonth(projection, today);
  const selected = picked && cols.some((c) => c.month === picked) ? picked : fallback;
  const shownMonth = hover ?? selected;
  const shownCol = cols.find((c) => c.month === shownMonth) ?? null;

  // 넓은 화면은 옆의 '고른 달' 상자와 높이를 맞추려고 막대 칸을 키워요
  const wide = useMediaQuery('(min-width: 1024px)');
  const banded = hasRange(projection);
  const range = banded ? projection.range!.months : null;
  const prevMarks = useMemo(
    () => months.map((m) => (m.month === thisMonth ? null : (prevForecasts.get(m.month) ?? null))),
    [months, prevForecasts, thisMonth],
  );
  const geo = useMemo(
    () =>
      barsGeometry(cols.map((c) => ({ month: c.month, endBalance: c.value })), {
        height: wide ? 200 : 152,
        labelRoom: 22,
        extent: [
          ...(range ? range.flatMap((r) => [r.endLow, r.endHigh]) : []),
          ...[...snapshots.values()].map((s) => s.expected),
          ...prevMarks.flatMap((s) => (s ? [s.expected] : [])),
        ],
      }),
    [cols, wide, range, snapshots, prevMarks],
  );
  const chartH = geo.posArea + geo.negArea;
  const highOnly = highOnlyShortageMessage(projection, today);
  const highCount = projection.range?.highShortages.length ?? 0;
  const shortages = months.filter((m) => m.endBalance < 0);
  const negatives = geo.bars.filter((b, i) => b.value < 0 && cols[i]?.kind === 'ahead');
  // 모자라는 금액이 모두 '만' 단위면 좁은 화면에서 단위를 떼고 위에 따로 적어요
  const canDropUnit =
    negatives.length > 0 && geo.bars.filter((b) => b.value < 0).every((b) => compactWon(b.value).unit === '만');
  const transfersIn = months.reduce((s, m) => s + m.transfersIn, 0);
  const withUsual = hasUsual(projection);

  // 폰: 막대가 넓으면 가로로 밀어요. 처음에는 이번 달 바로 앞 두 달이 보이게
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || past.length === 0 || el.scrollWidth <= el.clientWidth) return;
    const colW = el.scrollWidth / Math.max(1, cols.length);
    el.scrollLeft = Math.max(0, colW * (past.length - 2));
  }, [fold.open, past.length, cols.length, wide]);

  if (months.length === 0) return null;

  const label = (m: YearMonth) => monthLabel(m, today);

  function pick(month: YearMonth, focus = false) {
    setPicked(month);
    const c = cols.find((x) => x.month === month);
    if (c?.kind === 'ahead') {
      const m = c.m;
      const tail = m.endBalance < 0 ? ` ${formatWon(-m.endBalance)} 모자라요` : '';
      const usual = m.usual > 0 ? `, 평소 쓰는 돈 ${formatWon(m.usual)}` : '';
      const r = range?.find((x) => x.month === month);
      const band = r ? `, 아끼면 ${formatWon(r.endLow)} · 많이 쓰면 ${formatWon(r.endHigh)}` : '';
      setAnnounce(`${label(month)}, 달 말 예상 잔액 ${formatWon(m.endBalance)}.${tail} 일정 ${m.events.length}건${usual}${band}`);
    } else if (c?.kind === 'past') {
      const s = snapshots.get(month);
      const cmp = s ? ` ${forecastCompare(s, c.past).headline}` : '';
      setAnnounce(`${label(month)}, 실제 달 말 잔액 ${formatWon(c.past.endBalance)}.${cmp}`);
    }
    if (focus) {
      const i = cols.findIndex((x) => x.month === month);
      colRefs.current[i]?.focus();
    }
  }

  function step(delta: number, focus = false) {
    const i = cols.findIndex((c) => c.month === selected);
    const next = cols[Math.min(cols.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta))];
    if (next) pick(next.month, focus);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      step(1, true);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      step(-1, true);
    } else if (e.key === 'Home') {
      e.preventDefault();
      pick(cols[0]!.month, true);
    } else if (e.key === 'End') {
      e.preventDefault();
      pick(cols[cols.length - 1]!.month, true);
    }
  }

  const lowest = months.reduce((lo, m) => (m.endBalance < lo.endBalance ? m : lo), months[0]!);
  const caption =
    shortages.length > 0
      ? `${months.length}개월 중 ${shortages.length}개월이 모자라요 · 가장 모자라는 달 ${label(lowest.month)} ${formatWon(-lowest.endBalance)}`
      : `${months.length}개월 동안 모자라는 달이 없어요 · 가장 적은 달 ${label(lowest.month)} ${formatWon(lowest.endBalance)}`;
  const selIndex = cols.findIndex((c) => c.month === selected);

  const upcoming = months.slice(0, AHEAD_UPCOMING);
  const hasSnapshotMarks = snapshots.size > 0;
  const hasPrevMarks = prevMarks.some(Boolean);

  return (
    <Card as="section" className={cx(foldStyles.card, className)} aria-labelledby={titleId}>
      <FoldHead
        titleId={titleId}
        title={`앞으로 ${months.length}개월`}
        badge={
          badge ? (
            <Badge tone="info" size="sm">
              {badge}
            </Badge>
          ) : undefined
        }
        actions={<span className={styles.chartHint}>막대를 누르면 그달 항목이 보여요</span>}
      />
      <p className={cx(styles.caption, shortages.length > 0 ? shared.bad : shared.ok)} data-testid="ahead-status">
        <Icon name={shortages.length > 0 ? 'alert-triangle' : 'check-circle'} size={16} />
        <span>{caption}</span>
      </p>
      {fold.toggle}
      <div id={fold.bodyId} className={cx(foldStyles.body, fold.bodyClass)}>
        <figure className={cx(styles.figure, canDropUnit && styles.canDropUnit)}>
          <ul className={styles.legend} aria-hidden>
            {past.length > 0 ? (
              <li>
                <span className={cx(styles.swatch, styles.pastSwatch)} />
                지난 달 실제 잔액
              </li>
            ) : null}
            {hasSnapshotMarks ? (
              <li>
                <span className={styles.markSwatch} />
                그때 예상한 잔액
              </li>
            ) : null}
            <li>
              <span className={styles.swatch} />
              {banded ? '보통 쓰면 달 말 잔액' : '달 말 예상 잔액'}
            </li>
            {banded ? (
              <li>
                <span className={cx(styles.swatch, styles.bandSwatch)} />
                아끼면 ~ 많이 쓰면
              </li>
            ) : null}
            {hasPrevMarks ? (
              <li>
                <span className={cx(styles.markSwatch, styles.prevSwatch)} />
                지난달 예상
              </li>
            ) : null}
            {negatives.length > 0 ? (
              <li>
                <span className={cx(styles.swatch, styles.neg)} />
                모자라는 달<span className={styles.unitNote}>(금액은 만원 단위)</span>
              </li>
            ) : null}
            <li>
              <span className={cx(styles.swatch, styles.now)} />
              이번 달
            </li>
          </ul>

          <div className={styles.scroller} ref={scrollerRef} data-testid="ahead-scroller">
            <div
              className={cx(styles.bars, past.length > 0 && styles.withPast)}
              style={{ '--n': cols.length } as CSSProperties}
              role="group"
              aria-label="달 고르기"
              onPointerLeave={() => setHover(null)}
            >
              {range ? <BandOverlay range={range} months={months} geo={geo} height={chartH} offset={past.length} total={cols.length} /> : null}
              {geo.bars.map((b, i) => {
                const col = cols[i]!;
                const isPast = col.kind === 'past';
                const short = b.value < 0;
                const isNow = b.month === thisMonth;
                const mNum = Number(b.month.slice(5, 7));
                const newYear = i > 0 && mNum === 1;
                const c = compactWon(b.value);
                const snap = isPast ? (snapshots.get(b.month) ?? null) : null;
                const prev = col.kind === 'ahead' ? prevMarks[col.i] : null;
                const r = col.kind === 'ahead' && range ? range[col.i] : undefined;
                return (
                  <button
                    key={b.month}
                    ref={(el) => {
                      colRefs.current[i] = el;
                    }}
                    type="button"
                    className={cx(
                      styles.col,
                      isPast && styles.past,
                      short && styles.short,
                      isNow && styles.now,
                      isNow && past.length > 0 && styles.firstAhead,
                      b.month === selected && styles.selected,
                      hover === b.month && b.month !== selected && styles.preview,
                    )}
                    aria-pressed={b.month === selected}
                    aria-label={`${label(b.month)}${isNow ? ' (이번 달)' : isPast ? ' (지난 달)' : ''} 자세히 보기`}
                    tabIndex={i === (selIndex < 0 ? 0 : selIndex) ? 0 : -1}
                    title={`${label(b.month)} ${isPast ? '실제 ' : ''}${formatWon(b.value)}`}
                    data-testid={isPast ? 'ahead-past-bar' : undefined}
                    onPointerEnter={(e) => {
                      if (e.pointerType === 'mouse') setHover(b.month);
                    }}
                    onClick={() => pick(b.month)}
                    onKeyDown={onKeyDown}
                  >
                    {r ? <Whisker r={r} geo={geo} /> : null}
                    {snap ? <Mark value={snap.expected} geo={geo} testId="ahead-snapshot-mark" /> : null}
                    {prev ? <Mark value={prev.expected} geo={geo} faint testId="ahead-prev-mark" /> : null}
                    <span className={styles.posArea} style={{ height: geo.posArea }} aria-hidden>
                      {b.pos > 0 ? <span className={styles.barPos} style={{ height: b.pos }} /> : null}
                    </span>
                    {geo.negArea > 0 ? (
                      <span className={styles.negArea} style={{ height: geo.negArea }} aria-hidden>
                        {short ? (
                          <>
                            <span className={styles.barNeg} style={{ height: b.neg }} />
                            <span className={styles.negLabel}>
                              {c.sign}
                              {c.num}
                              <span className={styles.negUnit}>{c.unit}</span>
                            </span>
                          </>
                        ) : null}
                      </span>
                    ) : null}
                    <span className={styles.colLabel} aria-hidden>
                      <span className={styles.monthNum}>
                        {mNum}
                        <span className={styles.monthSuffix}>월</span>
                      </span>
                      <span className={cx(styles.yr, !newYear && styles.yrSpacer)}>
                        {newYear ? `${b.month.slice(2, 4)}년` : '-'}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <figcaption className="sr-only">
            {past.length > 0 ? '이벤트통장 지난 달 실제 잔액과 ' : '이벤트통장 '}달 말 예상 잔액 막대 (아래 표에 모든 달)
          </figcaption>
          {highOnly ? (
            <p className={cx(styles.caption, shared.warn)} role="note">
              <Icon name="alert-circle" size={16} />
              <span>{highOnly}</span>
            </p>
          ) : null}
          {past.length > 0 ? (
            <p className={shared.foot}>
              회색 막대는 기록(이체 · 지출)으로 계산한 지난 달 실제 달 말 잔액이에요
              {hasSnapshotMarks ? '. 점선은 그달 처음 연 날 예상한 잔액이에요' : ''}
            </p>
          ) : null}
          {banded ? <p className={shared.foot}>{rangeNote(projection)}</p> : null}
          {withUsual ? (
            <p className={shared.foot}>
              등록한 일정 말고도 늘 나가는 ‘평소 쓰는 돈’을 빼고 계산했어요. 작년 같은 달 기록 30%와 최근 12개월 평균 70%를 섞어요 (작년 기록이 없으면 최근 12개월 평균)
            </p>
          ) : null}
          {transfersIn > 0 ? (
            <p className={shared.foot}>저수지 등에서 옮겨 올 예정인 {formatWon(transfersIn)}을 넣어서 계산했어요</p>
          ) : null}

          {/* 표는 width: 1px 로 줄어들지 않아서, 숨김 상자로 한 번 감싸요 (가로 스크롤 방지) */}
          <div className="sr-only">
            {past.length > 0 ? (
              <table>
                <caption>이벤트통장 지난 달 실제 잔액</caption>
                <thead>
                  <tr>
                    <th scope="col">달</th>
                    <th scope="col">시작 잔액</th>
                    <th scope="col">들어온 돈</th>
                    <th scope="col">나간 돈</th>
                    <th scope="col">끝 잔액</th>
                    {hasSnapshotMarks ? <th scope="col">그때 예상한 잔액</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {past.map((p) => {
                    const snap = snapshots.get(p.month);
                    return (
                      <tr key={p.month}>
                        <th scope="row">{label(p.month)}</th>
                        <td>{formatWon(p.startBalance)}</td>
                        <td>{formatWon(p.inflow)}</td>
                        <td>{formatWon(p.outflow)}</td>
                        <td>{formatWon(p.endBalance)}</td>
                        {hasSnapshotMarks ? <td>{snap ? formatWon(snap.expected) : '기록 없음'}</td> : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
            <table>
              <caption>이벤트통장 달별 예상 잔액</caption>
              <thead>
                <tr>
                  <th scope="col">달</th>
                  <th scope="col">예정 일정</th>
                  {withUsual ? <th scope="col">평소 쓰는 돈</th> : null}
                  <th scope="col">{banded ? '보통 쓰면 달 말 잔액' : '달 말 예상 잔액'}</th>
                  {banded ? <th scope="col">아끼면</th> : null}
                  {banded ? <th scope="col">많이 쓰면</th> : null}
                </tr>
              </thead>
              <tbody>
                {months.map((m, i) => (
                  <tr key={m.month}>
                    <th scope="row">
                      {label(m.month)}
                      {m.month === thisMonth ? ' (이번 달)' : ''}
                    </th>
                    <td>{m.events.length > 0 ? `${m.events.length}건 ${formatWon(m.planned)}` : '없음'}</td>
                    {withUsual ? <td>{formatWon(m.usual)}</td> : null}
                    <td>
                      {formatWon(m.endBalance)}
                      {m.endBalance < 0 ? ` (${formatWon(-m.endBalance)} 모자라요)` : ''}
                    </td>
                    {range ? <td>{formatWon(range[i]!.endLow)}</td> : null}
                    {range ? (
                      <td>
                        {formatWon(range[i]!.endHigh)}
                        {range[i]!.endHigh < 0 ? ` (${formatWon(-range[i]!.endHigh)} 모자라요)` : ''}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </figure>

        <div className={styles.monthsRow}>
          {shownCol?.kind === 'ahead' ? (
            <MonthDetail
              month={shownCol.m}
              items={aheadMonthItems(shownCol.m, installmentsByMonth.get(shownCol.m.month))}
              range={range?.find((r) => r.month === shownCol.month) ?? null}
              highCount={highCount}
              today={today}
              spentSoFar={spentSoFar}
              prevForecast={prevMarks[shownCol.i] ?? null}
              onPrev={selIndex > 0 && !hover ? () => step(-1) : undefined}
              onNext={selIndex < cols.length - 1 && !hover ? () => step(1) : undefined}
            />
          ) : shownCol?.kind === 'past' ? (
            <PastDetail
              past={shownCol.past}
              snapshot={snapshots.get(shownCol.month) ?? null}
              today={today}
              onPrev={selIndex > 0 && !hover ? () => step(-1) : undefined}
              onNext={selIndex < cols.length - 1 && !hover ? () => step(1) : undefined}
            />
          ) : null}
          <div className={styles.upcoming}>
            <h3 id={`${ids}-up`} className={styles.upTitle}>
              다가오는 달
            </h3>
            <ul className={styles.upList} aria-labelledby={`${ids}-up`}>
              {upcoming.map((m) => {
                const sum = aheadMonthSummary(m, today);
                return (
                  <li key={m.month}>
                    <button
                      type="button"
                      className={cx(styles.upRow, m.month === selected && styles.upOn, m.endBalance < 0 && styles.upShort)}
                      aria-pressed={m.month === selected}
                      onClick={() => pick(m.month)}
                    >
                      <span className={styles.upText}>
                        <strong className={styles.upHead}>{sum.head}</strong>
                        {sum.tail ? ` · ${sum.tail}` : ''}
                        {m.month === thisMonth ? <span className="sr-only"> (이번 달)</span> : null}
                      </span>
                      {m.endBalance < 0 ? (
                        <span className={cx(styles.upBadge, shared.bad)}>
                          <Icon name="alert-triangle" size={16} />
                          {formatManShort(-m.endBalance)} 모자라요
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            <Link href={PAST_RECORDS_HREF} className={styles.pastLink}>
              지난 달 쓴 돈은 정산 화면에서
              <Icon name="chevron-right" size={16} />
            </Link>
          </div>
        </div>

        {showShortage && projection.shortages.length > 0 ? <ShortagePanel projection={projection} fix={fix} today={today} /> : null}
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </Card>
  );
}

function ItemRow({ item, today }: { item: AheadItem; today: ISODate }) {
  const claim = item.kind === 'claims';
  return (
    <li className={cx(item.kind === 'usual' && styles.itemMuted)}>
      <span className={styles.d}>{item.date && !claim ? formatShortDate(item.date) : item.kind === 'trip' ? '여행' : ''}</span>
      <span className={styles.n}>
        {item.tripId ? <Link href={tripHref(item.tripId)}>{item.label}</Link> : item.label}
        {item.date && !claim && item.date < today ? <span className="sr-only"> (날짜 지남)</span> : null}
        {item.note ? <span className={styles.note}>{item.kind === 'usual' ? ` (${item.note})` : ` · ${item.note}`}</span> : null}
      </span>
      <span className={styles.a}>{formatWon(item.amount)}</span>
    </li>
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

function MonthDetail({
  month,
  items,
  range,
  highCount,
  today,
  spentSoFar,
  prevForecast,
  onPrev,
  onNext,
}: {
  month: ProjectionMonth;
  items: AheadItem[];
  range: ProjectionRangeMonth | null;
  highCount: number;
  today: ISODate;
  spentSoFar: number | null;
  prevForecast: ForecastSnapshot | null;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const isThis = month.month === monthOf(today);
  const short = month.endBalance < 0;
  const label = monthLabel(month.month, today);
  const spend = items.filter(isNewSpend);
  const repay = items.filter((i) => !isNewSpend(i));
  const totals = aheadTotals(month);
  const lines = aheadTotalLines(month, today, spentSoFar);
  const repayLine = repaySummary(month);
  return (
    <div className={styles.detail} data-testid="ahead-month">
      <div className={shared.detailHead}>
        <div className={shared.txt}>
          <h3 className={styles.detailTitle}>
            {label}
            {isThis ? ' · 이번 달' : ''}
          </h3>
          <span className={styles.detailSub}>
            <span className={cx(shared.statusLine, short ? shared.bad : shared.ok)}>
              <Icon name={short ? 'alert-triangle' : 'check-circle'} size={16} />
              {short ? `${formatWon(-month.endBalance)} 모자라요` : '모자라지 않아요'}
            </span>
          </span>
        </div>
        <DetailNav onPrev={onPrev} onNext={onNext} />
      </div>
      <div className={styles.totalBox} data-testid="ahead-total">
        <p className={styles.totalTitle}>{lines.title}</p>
        {lines.split ? <p className={styles.totalSub}>= {lines.split}</p> : null}
        {lines.parts ? <p className={styles.totalSub}>{lines.parts}</p> : null}
      </div>
      {spend.length > 0 ? (
        <div className={styles.group}>
          {repay.length > 0 ? (
            <h4 className={styles.groupTitle}>
              새로 나갈 돈 <span className={styles.groupAmount}>{formatWon(totals.spend)}</span>
            </h4>
          ) : null}
          <ul className={styles.items} aria-label={`${label} 나갈 돈`}>
            {spend.map((i) => (
              <ItemRow key={i.key} item={i} today={today} />
            ))}
          </ul>
        </div>
      ) : (
        <p className={styles.detailEmpty}>{repay.length > 0 ? '새로 나갈 돈은 없어요' : '이 달에는 나갈 돈이 없어요'}</p>
      )}
      {repay.length > 0 ? (
        <div className={styles.group} data-testid="ahead-repay">
          <h4 className={styles.groupTitle}>
            {repayLine ?? '지난 지출 돌려주기'}
          </h4>
          <ul className={styles.items} aria-label={`${label} 지난 지출 돌려주기`}>
            {repay.map((i) => (
              <ItemRow key={i.key} item={i} today={today} />
            ))}
          </ul>
          <p className={styles.groupNote}>
            이미 쓴 돈이라 지출은 그때 달에 세고, 여기선 통장에서 돈이 나가는 날로 잡아요{' '}
            <Link href={SETTLE_SCREEN_HREF} className={styles.inlineLink}>
              정산 화면
              <Icon name="chevron-right" size={16} />
            </Link>
          </p>
        </div>
      ) : null}
      <dl className={styles.calc}>
        <div className={cx(styles.calcRow, styles.calcMuted)}>
          <dt>들어오는 돈</dt>
          <dd data-testid="ahead-inflow">{aheadInflowText(month, isThis)}</dd>
        </div>
        <div className={cx(styles.calcRow, styles.calcTotal)}>
          <dt>그 달 끝 예상 잔액</dt>
          <dd className={short ? shared.bad : undefined}>{formatWon(month.endBalance)}</dd>
        </div>
        {range ? (
          <div className={cx(styles.calcRow, styles.calcMuted)}>
            <dt>아끼면 · 많이 쓰면</dt>
            <dd>
              {formatWon(range.endLow)} · <span className={range.endHigh < 0 ? shared.bad : undefined}>{formatWon(range.endHigh)}</span>
            </dd>
          </div>
        ) : null}
        {prevForecast ? (
          <div className={cx(styles.calcRow, styles.calcMuted)}>
            <dt>지난달 예상</dt>
            <dd data-testid="ahead-prev-forecast">{formatWon(prevForecast.expected)}</dd>
          </div>
        ) : null}
      </dl>
      {range && range.endHigh < 0 && !short && highCount > 0 ? (
        <p className={styles.detailWarn}>많이 쓰면 이 달에 {formatWon(-range.endHigh)} 모자라요</p>
      ) : null}
    </div>
  );
}

/** 지난 달 요약: 시작 잔액 · 들어온 돈 · 나간 돈 · 끝 잔액 + 그때 예상과 견주기 + 정산 화면 링크 */
function PastDetail({
  past,
  snapshot,
  today,
  onPrev,
  onNext,
}: {
  past: PastMonth;
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
          <span className={styles.detailSub}>기록으로 계산한 실제 잔액</span>
        </div>
        <DetailNav onPrev={onPrev} onNext={onNext} />
      </div>
      <dl className={styles.calc}>
        <div className={styles.calcRow}>
          <dt>시작 잔액</dt>
          <dd>{formatWon(past.startBalance)}</dd>
        </div>
        <div className={styles.calcRow}>
          <dt>들어온 돈</dt>
          <dd>+{formatWon(past.inflow)}</dd>
        </div>
        <div className={styles.calcRow}>
          <dt>나간 돈</dt>
          <dd>−{formatWon(past.outflow)}</dd>
        </div>
        <div className={cx(styles.calcRow, styles.calcTotal)}>
          <dt>끝 잔액</dt>
          <dd className={past.endBalance < 0 ? shared.bad : undefined}>{formatWon(past.endBalance)}</dd>
        </div>
      </dl>
      {cmp ? (
        <div className={styles.compare} data-testid="ahead-compare">
          <p className={styles.compareHead}>{cmp.headline}</p>
          {cmp.detail ? <p className={styles.compareSub}>{cmp.detail}</p> : null}
          {cmp.inflowNote ? <p className={styles.compareSub}>{cmp.inflowNote}</p> : null}
        </div>
      ) : (
        <p className={styles.compareSub}>이 달은 그때 남긴 예측 기록이 없어요</p>
      )}
      <Link href={PAST_RECORDS_HREF} className={styles.pastLink}>
        그 달 쓴 돈은 정산 화면에서
        <Icon name="chevron-right" size={16} />
      </Link>
    </div>
  );
}

/** 넓은 화면: 달마다 아끼면 ~ 많이 쓰면 띠와 보통 선 (막대 칸 위에 겹쳐 그려요). offset = 앞의 지난 달 칸 수 */
function BandOverlay({
  range,
  months,
  geo,
  height,
  offset,
  total,
}: {
  range: ProjectionRangeMonth[];
  months: ProjectionMonth[];
  geo: Parameters<typeof yOf>[0];
  height: number;
  offset: number;
  total: number;
}) {
  const x = (i: number) => offset + i + 0.5;
  const top = range.map((r, i) => `${x(i)},${yOf(geo, r.endLow)}`);
  const bottom = range.map((r, i) => `${x(i)},${yOf(geo, r.endHigh)}`).reverse();
  const line = months.map((m, i) => `${x(i)},${yOf(geo, m.endBalance)}`).join(' ');
  return (
    <svg
      className={styles.band}
      viewBox={`0 0 ${total} ${Math.max(1, height)}`}
      preserveAspectRatio="none"
      style={{ height }}
      aria-hidden
      focusable="false"
      data-testid="projection-band"
    >
      <polygon className={styles.bandArea} points={[...top, ...bottom].join(' ')} />
      <polyline className={styles.bandLine} points={line} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** 그때 예상한 잔액(점선) · 지난달 예상(옅은 점선) 가로 표시 */
function Mark({ value, geo, faint = false, testId }: { value: number; geo: Parameters<typeof yOf>[0]; faint?: boolean; testId: string }) {
  const y = yOf(geo, value);
  return (
    <span
      className={cx(styles.mark, faint && styles.markFaint)}
      style={{ top: `calc(var(--space-2) + ${y}px - 1px)` }}
      aria-hidden
      data-testid={testId}
    />
  );
}

/** 좁은 화면: 달마다 가는 세로 막대로 범위만 (칸이 좁아 띠 대신) */
function Whisker({ r, geo }: { r: ProjectionRangeMonth; geo: Parameters<typeof yOf>[0] }) {
  const y1 = yOf(geo, r.endLow);
  const y2 = yOf(geo, r.endHigh);
  if (y2 - y1 < 1) return null;
  return <span className={styles.whisker} style={{ top: `calc(var(--space-2) + ${y1}px)`, height: y2 - y1 }} aria-hidden data-testid="projection-whisker" />;
}
