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
  monthSpentItems,
  pastMonthBars,
  snapshotsByTarget,
  thisMonthSpending,
} from '@/domain';
import type {
  EventProjection,
  ForecastSnapshot,
  Id,
  ISODate,
  LedgerData,
  MonthSpentRow,
  PastMonth,
  ProjectionMonth,
  ProjectionRangeMonth,
  SpentOnlyMonth,
  ThisMonthSpending,
  Won,
  YearMonth,
} from '@/domain';
import { Badge, Button, Card, Icon, cx, useMediaQuery } from '@/ui';
import { CardHead, cardStyles } from './CardHead';
import {
  aheadInflowText,
  aheadMonthItems,
  aheadMonthSummary,
  aheadSpendSplit,
  barsGeometry,
  capList,
  claimBadges,
  futureSpendLines,
  pastSpendTitle,
  thisMonthSpendLines,
  repayByMonth,
  repayPayersLine,
  repaySummary,
  compactWon,
  hasRange,
  hasUsual,
  initialMonth,
  monthLabel,
  monthShortLine,
  rangeNote,
  yOf,
  type AheadItem,
  type AheadSpendSplit,
  type ClaimBadge,
  type SpendLines,
} from './selectors';
import { tripHref } from './trips/selectors';
import shared from './events.module.css';
import styles from './AheadCard.module.css';

/** 카드 id (숫자 띠의 '가장 모자라는 달'에서 스크롤해 와요) */
export const AHEAD_ID = 'ahead';

/** 고른 달 옆 '다가오는 달' 목록에 보일 달 수 */
export const AHEAD_UPCOMING = 4;

/** 정산 화면 전체 기록 (지난 달 쓴 돈) */
export const PAST_RECORDS_HREF = '/plan/settle#paid';
/** 정산 화면 (돌려줄 돈) */
export const SETTLE_SCREEN_HREF = '/plan/settle';
/** 긴 목록: 이 줄 수를 넘으면 앞 AHEAD_LIST_KEEP 줄 + 'N건 더' */
export const AHEAD_LIST_LIMIT = 6;
export const AHEAD_LIST_KEEP = 5;
/** 차트 왼쪽 지난 달 실제 잔액 막대 수 (폰은 가로로 밀어 봐요) */
export const AHEAD_PAST_MONTHS = 12;

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
 * 고른 달 목록은 통장에서 나간 날이 아니라 **쓴 날** 기준이에요 (8월에 쓴 청구는 11월에 돌려줘도 8월 항목, '줄 돈' · '11/10 지급' 배지).
 * - 지난 달(잔액 막대 · 통장 기록 전 빗금 막대): 굵은 '9월 쓴 돈 37.2만' + 묶은 줄(5줄 + 'N건 더') → 잔액 막대 달은 아래 작은 잔액 묶음
 *   (시작 잔액 · 들어온 돈 · 나간 돈 · 끝 잔액, 나간 돈엔 앞서 쓴 돈 돌려준 것도 있다는 설명, 그때 예상과 견주기) → 정산 화면 링크
 * - 이번 달: '이번 달 쓴 돈 ○ = 지금까지 ○ + 예정 ○' (숫자 띠와 같은 합, 여행 빼고 '여행 ○' 따로) → 지금까지 쓴 줄 + 예정 줄 →
 *   합계에 안 넣은 돈(여행 · 평소 쓰는 돈 예상) → 아래 잔액 묶음 '통장에서 나갈 돈'(지난 지출 돌려주기는 처음엔 접어 둬요) · 들어오는 돈 · 그 달 끝 예상 잔액
 * - 앞으로 달: '12월 쓸 돈 (예정) ○' + 예정 줄 → 여행 → 아래 잔액 묶음 (그달 돌려줄 청구 · 옮겨 갈 돈 · 그 달 끝 예상 잔액)
 * 모자라면 맨 위 한 줄 '4월에 30만 모자라요 · 결혼식 4건 · 어버이날'.
 * 옆에 다가오는 달 한 줄씩(쓸 돈 합계 먼저, 돌려주기는 뒤에 '돌려주기 ○', 모자라는 달은 경고 색 '−30만'). 화면 읽기 프로그램은 숨긴 표로 모든 달을 읽어요.
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
  // 이번 달 쓴 돈 (쓴 날 기준, 숫자 띠 '이번 달 쓴 돈'과 같은 합)
  const thisSpend = useMemo(
    () => (accountId && months[0]?.month === thisMonth ? thisMonthSpending(data, accountId, today, months[0]) : null),
    [data, accountId, today, months, thisMonth],
  );

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
          <ul className={styles.legend} aria-hidden>
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
              split={aheadSpendSplit(shownCol.m, installmentsByMonth.get(shownCol.m.month))}
              thisSpend={shownCol.m.month === thisMonth ? thisSpend : null}
              range={range?.find((r) => r.month === shownCol.month) ?? null}
              highCount={highCount}
              today={today}
              prevForecast={prevMarks[shownCol.i] ?? null}
              onPrev={selIndex > 0 && !hover ? () => step(-1) : undefined}
              onNext={selIndex < cols.length - 1 && !hover ? () => step(1) : undefined}
            />
          ) : shownCol?.kind === 'spent' && accountId ? (
            <SpentDetail
              key={shownCol.month}
              s={shownCol.spent}
              data={data}
              accountId={accountId}
              today={today}
              onPrev={selIndex > 0 && !hover ? () => step(-1) : undefined}
              onNext={selIndex < cols.length - 1 && !hover ? () => step(1) : undefined}
            />
          ) : shownCol?.kind === 'past' && accountId ? (
            <PastDetail
              key={shownCol.month}
              past={shownCol.past}
              data={data}
              accountId={accountId}
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
                const sum = aheadMonthSummary(m, today, m.month === thisMonth ? (thisSpend?.total ?? null) : null);
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
function MonthDetail({
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

/** 빗금 막대 위 금액·막대가 들어갈 칸 높이에서 '통장 기록 전 · 쓴 돈' 글자 자리 */
const SPENT_SEG_ROOM = 20;
/** 막대 위 금액 글자 자리 */
const SPENT_LABEL_ROOM = 18;

/**
 * 통장 시작 전 달 한 칸: 잔액 축과 따로, 이 달들 중 가장 많이 쓴 달을 칸 높이로 하는 빗금 막대 + 위에 금액.
 * 바닥은 잔액 기준선이 아니라 차트 바닥 (잔액으로 읽지 않게)
 */
function SpentCol({
  ref,
  s,
  max,
  height,
  label,
  newYear,
  selected,
  preview,
  tabIndex,
  onHover,
  onPick,
  onKeyDown,
}: {
  ref: (el: HTMLButtonElement | null) => void;
  s: SpentOnlyMonth;
  max: number;
  height: number;
  label: string;
  newYear: boolean;
  selected: boolean;
  preview: boolean;
  tabIndex: number;
  onHover: () => void;
  onPick: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const room = Math.max(8, height - SPENT_SEG_ROOM - SPENT_LABEL_ROOM);
  const h = max > 0 ? Math.max(3, Math.round((s.spent / max) * room)) : 0;
  const c = compactWon(s.spent);
  const mNum = Number(s.month.slice(5, 7));
  return (
    <button
      ref={ref}
      type="button"
      className={cx(styles.col, styles.spentCol, selected && styles.selected, preview && styles.preview)}
      aria-pressed={selected}
      aria-label={`${label} (통장 기록 전) 자세히 보기`}
      tabIndex={tabIndex}
      title={`${label} 통장 기록 전 · 쓴 돈 ${formatWon(s.spent)}`}
      data-testid="ahead-spent-bar"
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') onHover();
      }}
      onClick={onPick}
      onKeyDown={onKeyDown}
    >
      <span className={styles.spentArea} style={{ height }} aria-hidden>
        <span className={styles.spentLabel}>
          {c.num}
          <span className={styles.spentUnit}>{c.unit}</span>
        </span>
        <span className={styles.barSpent} style={{ height: h }} data-testid="ahead-spent-fill" />
      </span>
      <span className={styles.colLabel} aria-hidden>
        <span className={styles.monthNum}>
          {mNum}
          <span className={styles.monthSuffix}>월</span>
        </span>
        <span className={cx(styles.yr, !newYear && styles.yrSpacer)}>{newYear ? `${s.month.slice(2, 4)}년` : '-'}</span>
      </span>
    </button>
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
function SpentDetail({
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
function PastDetail({
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
