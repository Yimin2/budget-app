'use client';

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import Link from 'next/link';
import {
  eventMonthlyCosts, forecastCompare, formatManShort, formatWon, highOnlyShortageMessage, lastMonthForecasts, monthOf, pastMonthBars,
  snapshotsByTarget, spentSoFarThisMonth,
} from '@/domain';
import type { EventProjection, ISODate, LedgerData, PastMonth, ProjectionMonth, SpentOnlyMonth, YearMonth } from '@/domain';
import { Badge, Card, Icon, cx, useMediaQuery } from '@/ui';
import { CardHead, cardStyles } from './CardHead';
import {
  aheadMonthItems, aheadMonthSummary, barsGeometry, compactWon, hasRange, hasUsual, initialMonth, monthLabel, rangeNote,
} from './selectors';
import shared from './events.module.css';
import styles from './AheadCard.module.css';
import { AHEAD_ID, AHEAD_UPCOMING, PAST_RECORDS_HREF, AHEAD_PAST_MONTHS } from './aheadShared';
import { MonthDetail, SpentDetail, PastDetail } from './AheadDetail';
import { SpentCol, BandOverlay, Mark, Whisker } from './AheadChartParts';
export { AHEAD_ID, AHEAD_UPCOMING, PAST_RECORDS_HREF, SETTLE_SCREEN_HREF, AHEAD_LIST_LIMIT, AHEAD_LIST_KEEP, AHEAD_PAST_MONTHS } from './aheadShared';

type Col =
  | { kind: 'spent'; month: YearMonth; value: number; spent: SpentOnlyMonth }
  | { kind: 'past'; month: YearMonth; value: number; past: PastMonth }
  | { kind: 'ahead'; month: YearMonth; value: number; m: ProjectionMonth; i: number };

export interface AheadCardProps {
  /** 그리는 예측 (예외 지출 빼기를 미리 보는 중이면 덮어씌운 예측) */
  projection: EventProjection;
  data: LedgerData;
  today: ISODate;
  /** 미리 보는 중이면(예외 지출 빼기) 제목 옆에 붙일 표시 */
  badge?: string;
  /** 고른 달 (밖에서 들고 있을 때. 없으면 카드 안에서) */
  picked?: YearMonth | null;
  onPick?: (month: YearMonth) => void;
  className?: string;
}

/**
 * 이벤트 화면 '지난 · 앞으로 12개월' 카드 (PLAN 4-2, 지난 달 막대가 없으면 '앞으로 12개월'): 왼쪽은 지난 12개월 실제 달 말 잔액(회색 막대, 기록으로 계산) + 그때 예상한 잔액(점선, 예측 기록),
 * 이번 달부터는 달 말 예상 잔액 막대(범위 띠 · 미리 보는 중 표시). 0 이상은 기준선 위(파랑), 0 아래는 기준선 아래(빨강) + 모자라는 금액.
 * 이번 달은 달 숫자에 파란 동그라미. 처음엔 이번 달을 골라 두고, 막대를 누르면(마우스는 올리기만 해도) 아래에 그달이 보여요:
 * - 지난 달: 시작 잔액 · 들어온 돈 · 나간 돈 · 끝 잔액, 그때 예상과 견주기, 정산 화면 링크
 * - 이번 달 · 앞으로 달: 모자라면 맨 위 한 줄 '4월에 30만 모자라요 · 결혼식 4건 · 어버이날' → 나갈 돈 합계(굵게) → 새로 나갈 돈 · 지난 지출 돌려주기 두 묶음 → 들어오는 돈 · 그 달 끝 예상 잔액
 * 옆에 다가오는 달 한 줄씩(합계 먼저, 모자라는 달은 경고 색 '−30만'). 화면 읽기 프로그램은 숨긴 표로 모든 달을 읽어요.
 * 폰에서도 막대 · 고른 달(이번 달 합계)이 늘 보여요 (접기 없음). 막대는 가로로 밀어 지난 달을 봐요
 */
export function AheadCard({ projection, data, today, badge, picked: pickedProp, onPick, className }: AheadCardProps) {
  const ids = useId().replace(/:/g, '');
  const titleId = `${ids}-title`;
  const months = projection.months;
  const thisMonth = monthOf(today);
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
  // 통장 시작 전 달은 잔액을 되살릴 수 없어 그달 쓴 돈만 (kind 'spentOnly')
  const pastBars = useMemo(
    () => (accountId && months.length > 0 ? pastMonthBars(data, accountId, today, AHEAD_PAST_MONTHS) : []),
    [data, accountId, today, months.length],
  );
  const past = useMemo(() => pastBars.flatMap((b) => (b.kind === 'balance' ? [b] : [])), [pastBars]);
  const spentOnly = useMemo(() => pastBars.flatMap((b) => (b.kind === 'spentOnly' ? [b] : [])), [pastBars]);
  /** 이번 달 왼쪽 칸 수 (쓴 돈만 아는 달 + 잔액 막대) */
  const preCount = spentOnly.length + past.length;
  const spentMax = spentOnly.reduce((mx, b) => Math.max(mx, b.spent), 0);
  const snapshots = useMemo(() => snapshotsByTarget(data, past.map((p) => p.month)), [data, past]);
  const prevForecasts = useMemo(() => lastMonthForecasts(data, today), [data, today]);
  const spentSoFar = useMemo(() => (accountId ? spentSoFarThisMonth(data, accountId, today) : null), [data, accountId, today]);

  const cols = useMemo<Col[]>(
    () => [
      // 쓴 돈만 아는 달은 잔액 축에 넣지 않아요 (value 0, 따로 그려요)
      ...spentOnly.map((b) => ({ kind: 'spent' as const, month: b.month, value: 0, spent: b })),
      ...past.map((p) => ({ kind: 'past' as const, month: p.month, value: p.endBalance, past: p })),
      ...months.map((m, i) => ({ kind: 'ahead' as const, month: m.month, value: m.endBalance, m, i })),
    ],
    [spentOnly, past, months],
  );

  const [pickedOwn, setPickedOwn] = useState<YearMonth | null>(null);
  const picked = pickedProp !== undefined ? pickedProp : pickedOwn;
  const setPicked = (month: YearMonth) => (onPick ? onPick(month) : setPickedOwn(month));
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
  /** 좁은 화면은 범례를 접어 두고 '막대 색 설명'으로 펼쳐요 (차트가 위로 올라오게) */
  const [legendOpen, setLegendOpen] = useState(false);
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
    if (!el || preCount === 0 || el.scrollWidth <= el.clientWidth) return;
    const colW = el.scrollWidth / Math.max(1, cols.length);
    el.scrollLeft = Math.max(0, colW * (preCount - 2));
  }, [preCount, cols.length, wide]);

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
    } else if (c?.kind === 'spent') {
      setAnnounce(`${label(month)}, 통장 기록 전. 쓴 돈 ${formatWon(c.spent.spent)}, ${c.spent.count}건`);
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
      ? `${months.length}개월 중 ${shortages.length}개월이 모자라요 · 가장 모자라는 달 ${label(lowest.month)} ${formatManShort(-lowest.endBalance)}`
      : `${months.length}개월 동안 모자라는 달이 없어요 · 가장 적은 달 ${label(lowest.month)} ${formatManShort(lowest.endBalance)}`;
  const selIndex = cols.findIndex((c) => c.month === selected);

  const upcoming = months.slice(0, AHEAD_UPCOMING);
  const hasSnapshotMarks = snapshots.size > 0;
  const hasPrevMarks = prevMarks.some(Boolean);

  return (
    <Card as="section" id={AHEAD_ID} className={cx(cardStyles.card, className)} aria-labelledby={titleId}>
      <CardHead
        titleId={titleId}
        title={preCount > 0 ? `지난 · 앞으로 ${months.length}개월` : `앞으로 ${months.length}개월`}
        badge={
          badge ? (
            <Badge tone="info" size="sm">
              {badge}
            </Badge>
          ) : undefined
        }
        actions={<span className={styles.chartHint}>막대를 누르면 그 달이 아래에 · 처음엔 이번 달</span>}
      />
      <p className={cx(styles.caption, shortages.length > 0 ? shared.bad : shared.ok)} data-testid="ahead-status">
        <Icon name={shortages.length > 0 ? 'alert-triangle' : 'check-circle'} size={16} />
        <span>{caption}</span>
      </p>
      <div className={cardStyles.body}>
        <figure className={cx(styles.figure, canDropUnit && styles.canDropUnit)}>
          {!wide ? (
            <button type="button" className={styles.legendToggle} aria-expanded={legendOpen} onClick={() => setLegendOpen((v) => !v)}>
              <Icon name="info" size={16} />
              막대 색 설명
            </button>
          ) : null}
          <ul className={styles.legend} aria-hidden hidden={!wide && !legendOpen}>
            {past.length > 0 ? (
              <li>
                <span className={cx(styles.swatch, styles.pastSwatch)} />
                지난 달 실제 잔액
              </li>
            ) : null}
            {spentOnly.length > 0 ? (
              <li>
                <span className={cx(styles.swatch, styles.spentSwatch)} />
                통장 기록 전 쓴 돈
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
              className={cx(styles.bars, preCount > 0 && styles.withPast)}
              style={{ '--n': cols.length } as CSSProperties}
              role="group"
              aria-label="달 고르기"
              onPointerLeave={() => setHover(null)}
            >
              {range ? <BandOverlay range={range} months={months} geo={geo} height={chartH} offset={preCount} total={cols.length} /> : null}
              {spentOnly.length > 0 ? (
                <span
                  className={styles.spentSeg}
                  style={{ width: `${(spentOnly.length / cols.length) * 100}%` }}
                  aria-hidden
                  data-testid="ahead-spent-seg"
                >
                  통장 기록 전 · 쓴 돈
                </span>
              ) : null}
              {geo.bars.map((b, i) => {
                const col = cols[i]!;
                if (col.kind === 'spent') {
                  return (
                    <SpentCol
                      key={b.month}
                      ref={(el) => {
                        colRefs.current[i] = el;
                      }}
                      s={col.spent}
                      max={spentMax}
                      height={chartH}
                      label={label(b.month)}
                      newYear={i > 0 && Number(b.month.slice(5, 7)) === 1}
                      selected={b.month === selected}
                      preview={hover === b.month && b.month !== selected}
                      tabIndex={i === (selIndex < 0 ? 0 : selIndex) ? 0 : -1}
                      onHover={() => setHover(b.month)}
                      onPick={() => pick(b.month)}
                      onKeyDown={onKeyDown}
                    />
                  );
                }
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
                      isNow && preCount > 0 && styles.firstAhead,
                      i > 0 && i === spentOnly.length && col.kind === 'past' && styles.firstAhead,
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
            {spentOnly.length > 0 ? '이벤트통장 시작 전 달마다 쓴 돈, ' : ''}
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
          {spentOnly.length > 0 ? (
            <p className={shared.foot}>
              빗금 막대는 통장 기록을 시작하기 전 달이라 잔액 대신 그달 쓴 돈이에요 (잔액 막대와 높이 기준이 달라요)
            </p>
          ) : null}
          {banded ? <p className={shared.foot}>{rangeNote(projection)}</p> : null}
          {withUsual ? (
            <p className={shared.foot}>
              등록한 일정 말고도 늘 나가는 ‘평소 쓰는 돈’을 빼고 계산했어요. 작년 같은 달 기록 30%와 최근 12개월 평균 70%를 섞어요 (작년 기록이 없으면 최근 12개월 평균)
            </p>
          ) : null}
          {transfersIn > 0 ? (
            <p className={shared.foot}>저수지 등에서 옮겨 올 예정인 {formatManShort(transfersIn)}을 넣어서 계산했어요</p>
          ) : null}

          {/* 표는 width: 1px 로 줄어들지 않아서, 숨김 상자로 한 번 감싸요 (가로 스크롤 방지) */}
          <div className="sr-only">
            {spentOnly.length > 0 ? (
              <table>
                <caption>이벤트통장 시작 전 쓴 돈</caption>
                <thead>
                  <tr>
                    <th scope="col">달</th>
                    <th scope="col">쓴 돈</th>
                    <th scope="col">건수</th>
                  </tr>
                </thead>
                <tbody>
                  {spentOnly.map((b) => (
                    <tr key={b.month}>
                      <th scope="row">{label(b.month)} (통장 기록 전)</th>
                      <td>{formatWon(b.spent)}</td>
                      <td>{b.count}건</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
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
              key={shownCol.month}
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
          ) : shownCol?.kind === 'spent' ? (
            <SpentDetail
              key={shownCol.month}
              s={shownCol.spent}
              today={today}
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
                const full = sum.tail ? `${sum.head} · ${sum.tail}` : sum.head;
                return (
                  <li key={m.month}>
                    <button
                      type="button"
                      className={cx(styles.upRow, m.month === selected && styles.upOn, m.endBalance < 0 && styles.upShort)}
                      aria-pressed={m.month === selected}
                      onClick={() => pick(m.month)}
                    >
                      <span className={styles.upText} title={full}>
                        <strong className={styles.upHead}>{sum.head}</strong>
                        {sum.tail ? ` · ${sum.tail}` : ''}
                        {m.month === thisMonth ? <span className="sr-only"> (이번 달)</span> : null}
                      </span>
                      {m.endBalance < 0 ? (
                        <span className={styles.upBadge}>
                          <Icon name="alert-triangle" size={16} />
                          −{formatManShort(-m.endBalance)}
                          <span className="sr-only"> 모자라요</span>
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

      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </Card>
  );
}
