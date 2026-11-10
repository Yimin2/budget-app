'use client';

import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import Link from 'next/link';
import { formatShortDate, formatWon, highOnlyShortageMessage, monthOf } from '@/domain';
import type { EventProjection, ISODate, ProjectionMonth, ProjectionRangeMonth, YearMonth } from '@/domain';
import { Badge, Button, Card, Icon, cx, useMediaQuery } from '@/ui';
import { barsGeometry, compactWon, hasRange, hasUsual, initialMonth, monthDetailRows, monthLabel, rangeNote, yOf } from './selectors';
import { tripHref } from './trips/selectors';
import styles from './events.module.css';

export interface ProjectionCardProps {
  projection: EventProjection;
  today: ISODate;
  /** 해 보기 중이면 제목 옆에 붙일 표시 */
  badge?: string;
}

/**
 * 이벤트통장 12개월 예상 잔액 막대 + 고른 달 자세히.
 * 0 이상은 기준선 위(파랑), 0 아래는 기준선 아래(빨강) + 모자라는 금액. 이번 달은 달 숫자에 파란 동그라미.
 * 막대를 누르면(마우스는 올리기만 해도) 그달 계산과 일정이 보여요. 화면 읽기 프로그램은 숨긴 표로 모든 달을 읽어요.
 */
export function ProjectionCard({ projection, today, badge }: ProjectionCardProps) {
  const ids = useId().replace(/:/g, '');
  const titleId = `${ids}-title`;
  const months = projection.months;
  const thisMonth = monthOf(today);

  const [picked, setPicked] = useState<YearMonth | null>(null);
  const [hover, setHover] = useState<YearMonth | null>(null);
  const [announce, setAnnounce] = useState('');
  const colRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 고른 달이 예측 범위를 벗어나면(날짜가 바뀌어서 등) 처음 달로 돌아가요
  const fallback = initialMonth(projection, today);
  const selected = picked && months.some((m) => m.month === picked) ? picked : fallback;
  const shownMonth = hover ?? selected;
  const shown = months.find((m) => m.month === shownMonth) ?? null;

  // 넓은 화면은 옆의 '고른 달' 상자와 높이를 맞추려고 막대 칸을 키워요
  const wide = useMediaQuery('(min-width: 1024px)');
  const banded = hasRange(projection);
  const range = banded ? projection.range!.months : null;
  const geo = useMemo(
    () =>
      barsGeometry(months, {
        height: wide ? 232 : 152,
        labelRoom: 22,
        extent: range ? range.flatMap((r) => [r.endLow, r.endHigh]) : undefined,
      }),
    [months, wide, range],
  );
  const chartH = geo.posArea + geo.negArea;
  const highOnly = highOnlyShortageMessage(projection, today);
  const highCount = projection.range?.highShortages.length ?? 0;
  const shortages = months.filter((m) => m.endBalance < 0);
  const negatives = geo.bars.filter((b) => b.value < 0);
  // 모자라는 금액이 모두 '만' 단위면 좁은 화면에서 단위를 떼고 위에 따로 적어요
  const canDropUnit = negatives.length > 0 && negatives.every((b) => compactWon(b.value).unit === '만');
  const transfersIn = months.reduce((s, m) => s + m.transfersIn, 0);
  const withUsual = hasUsual(projection);

  if (months.length === 0) return null;

  const label = (m: YearMonth) => monthLabel(m, today);

  function pick(month: YearMonth, focus = false) {
    setPicked(month);
    const m = months.find((x) => x.month === month);
    if (m) {
      const tail = m.endBalance < 0 ? ` ${formatWon(-m.endBalance)} 모자라요` : '';
      const usual = m.usual > 0 ? `, 평소 쓰는 돈 ${formatWon(m.usual)}` : '';
      const r = range?.find((x) => x.month === month);
      const band = r ? `, 아끼면 ${formatWon(r.endLow)} · 많이 쓰면 ${formatWon(r.endHigh)}` : '';
      setAnnounce(`${label(month)}, 달 말 예상 잔액 ${formatWon(m.endBalance)}.${tail} 일정 ${m.events.length}건${usual}${band}`);
    }
    if (focus) {
      const i = months.findIndex((x) => x.month === month);
      colRefs.current[i]?.focus();
    }
  }

  function step(delta: number, focus = false) {
    const i = months.findIndex((m) => m.month === selected);
    const next = months[Math.min(months.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta))];
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
      pick(months[0]!.month, true);
    } else if (e.key === 'End') {
      e.preventDefault();
      pick(months[months.length - 1]!.month, true);
    }
  }

  const lowest = months.reduce((lo, m) => (m.endBalance < lo.endBalance ? m : lo), months[0]!);
  const caption =
    shortages.length > 0
      ? `${months.length}개월 중 ${shortages.length}개월이 모자라요 · 가장 모자라는 달 ${label(lowest.month)} ${formatWon(-lowest.endBalance)}`
      : `${months.length}개월 동안 모자라는 달이 없어요 · 가장 적은 달 ${label(lowest.month)} ${formatWon(lowest.endBalance)}`;
  const selIndex = months.findIndex((m) => m.month === selected);

  return (
    <Card as="section" className={styles.chartCard} aria-labelledby={titleId}>
      <div className={styles.chartTitleRow}>
        <h2 id={titleId} className={styles.chartTitle}>
          앞으로 {months.length}개월 예상 잔액
        </h2>
        {badge ? (
          <Badge tone="info" size="sm">
            {badge}
          </Badge>
        ) : null}
        <span className={styles.chartHint}>막대를 누르면 그달 일정이 보여요</span>
      </div>

      <div className={styles.chartBody}>
        <figure className={cx(styles.figure, canDropUnit && styles.canDropUnit)}>
          <ul className={styles.legend} aria-hidden>
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

          <div
            className={styles.bars}
            style={{ '--n': months.length } as CSSProperties}
            role="group"
            aria-label="달 고르기"
            onPointerLeave={() => setHover(null)}
          >
            {range ? <BandOverlay range={range} months={months} geo={geo} height={chartH} /> : null}
            {geo.bars.map((b, i) => {
              const short = b.value < 0;
              const isNow = b.month === thisMonth;
              const mNum = Number(b.month.slice(5, 7));
              const newYear = i > 0 && mNum === 1;
              const c = compactWon(b.value);
              return (
                <button
                  key={b.month}
                  ref={(el) => {
                    colRefs.current[i] = el;
                  }}
                  type="button"
                  className={cx(
                    styles.col,
                    short && styles.short,
                    isNow && styles.now,
                    b.month === selected && styles.selected,
                    hover === b.month && b.month !== selected && styles.preview,
                  )}
                  aria-pressed={b.month === selected}
                  aria-label={`${label(b.month)}${isNow ? ' (이번 달)' : ''} 자세히 보기`}
                  tabIndex={i === (selIndex < 0 ? 0 : selIndex) ? 0 : -1}
                  title={`${label(b.month)} ${formatWon(b.value)}`}
                  onPointerEnter={(e) => {
                    if (e.pointerType === 'mouse') setHover(b.month);
                  }}
                  onClick={() => pick(b.month)}
                  onKeyDown={onKeyDown}
                >
                  {range && range[i] ? <Whisker r={range[i]!} geo={geo} /> : null}
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

          <figcaption className={cx(styles.caption, shortages.length > 0 ? styles.bad : styles.ok)}>
            <Icon name={shortages.length > 0 ? 'alert-triangle' : 'check-circle'} size={16} />
            <span>{caption}</span>
          </figcaption>
          {highOnly ? (
            <p className={cx(styles.caption, styles.warn)} role="note">
              <Icon name="alert-circle" size={16} />
              <span>{highOnly}</span>
            </p>
          ) : null}
          {banded ? <p className={styles.foot}>{rangeNote(projection)}</p> : null}
          {withUsual ? (
            <p className={styles.foot}>
              등록한 일정 말고도 늘 나가는 ‘평소 쓰는 돈’을 빼고 계산했어요. 작년 같은 달 기록, 없으면 최근 6개월 평균이에요
            </p>
          ) : null}
          {transfersIn > 0 ? (
            <p className={styles.foot}>저수지 등에서 옮겨 올 예정인 {formatWon(transfersIn)}을 넣어서 계산했어요</p>
          ) : null}

          {/* 표는 width: 1px 로 줄어들지 않아서, 숨김 상자로 한 번 감싸요 (가로 스크롤 방지) */}
          <div className="sr-only">
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

        {shown ? (
          <MonthDetail
            month={shown}
            range={range?.find((r) => r.month === shown.month) ?? null}
            highCount={highCount}
            today={today}
            onPrev={selIndex > 0 && !hover ? () => step(-1) : undefined}
            onNext={selIndex < months.length - 1 && !hover ? () => step(1) : undefined}
          />
        ) : null}
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </Card>
  );
}

function MonthDetail({
  month,
  range,
  highCount,
  today,
  onPrev,
  onNext,
}: {
  month: ProjectionMonth;
  range: ProjectionRangeMonth | null;
  highCount: number;
  today: ISODate;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const isThis = month.month === monthOf(today);
  const rows = monthDetailRows(month, isThis);
  const short = month.endBalance < 0;
  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <div className={styles.txt}>
          <h3 className={styles.detailTitle}>
            {monthLabel(month.month, today)}
            {isThis ? ' · 이번 달' : ''}
          </h3>
          <span className={cx(styles.statusLine, styles.detailStatus, short ? styles.bad : styles.ok)}>
            <Icon name={short ? 'alert-triangle' : 'check-circle'} size={16} />
            {short ? `${formatWon(-month.endBalance)} 모자라요` : '모자라지 않아요'}
          </span>
        </div>
        <div className={styles.nav}>
          <Button
            variant="ghost"
            plain
            iconOnly
            icon="chevron-left"
            aria-label="이전 달"
            onClick={onPrev}
            disabled={!onPrev}
          />
          <Button
            variant="ghost"
            plain
            iconOnly
            icon="chevron-right"
            aria-label="다음 달"
            onClick={onNext}
            disabled={!onNext}
          />
        </div>
      </div>
      <dl className={styles.calc}>
        {rows.map((r) => (
          <div key={r.label} className={cx(styles.calcRow, r.muted && styles.calcMuted)}>
            <dt>{r.label}</dt>
            <dd>
              {r.sign}
              {formatWon(r.amount)}
            </dd>
          </div>
        ))}
        <div className={cx(styles.calcRow, styles.calcTotal)}>
          <dt>달 말 예상 잔액</dt>
          <dd className={short ? styles.bad : undefined}>{formatWon(month.endBalance)}</dd>
        </div>
        {range ? (
          <div className={cx(styles.calcRow, styles.calcMuted)}>
            <dt>아끼면 · 많이 쓰면</dt>
            <dd>
              {formatWon(range.endLow)} · <span className={range.endHigh < 0 ? styles.bad : undefined}>{formatWon(range.endHigh)}</span>
            </dd>
          </div>
        ) : null}
      </dl>
      {range && range.endHigh < 0 && !short && highCount > 0 ? (
        <p className={styles.detailWarn}>많이 쓰면 이 달에 {formatWon(-range.endHigh)} 모자라요</p>
      ) : null}
      {month.events.length > 0 || (month.tripList?.length ?? 0) > 0 ? (
        <ul className={styles.detailEvents} aria-label={`${monthLabel(month.month, today)} 예정 일정`}>
          {month.events.map((e, i) => (
            <li key={`${e.id}@${e.date}@${i}`}>
              <span className={styles.d}>{formatShortDate(e.date)}</span>
              <span className={styles.n}>
                {e.name}
                {e.date < today ? <span className="sr-only"> (날짜 지남)</span> : null}
              </span>
              <span className={styles.a}>{formatWon(e.amount)}</span>
            </li>
          ))}
          {(month.tripList ?? []).map((t) => (
            <li key={`trip:${t.id}`}>
              <span className={styles.d}>여행</span>
              <span className={styles.n}>
                <Link href={tripHref(t.id)}>{t.name}</Link>
                <span className="sr-only"> 남은 예산</span>
              </span>
              <span className={styles.a}>{formatWon(t.amount)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.detailEmpty}>이 달에는 예정된 일정이 없어요</p>
      )}
    </div>
  );
}

/** 넓은 화면: 달마다 아끼면 ~ 많이 쓰면 띠와 보통 선 (막대 칸 위에 겹쳐 그려요) */
function BandOverlay({
  range,
  months,
  geo,
  height,
}: {
  range: ProjectionRangeMonth[];
  months: ProjectionMonth[];
  geo: Parameters<typeof yOf>[0];
  height: number;
}) {
  const n = months.length;
  const top = range.map((r, i) => `${i + 0.5},${yOf(geo, r.endLow)}`);
  const bottom = range.map((r, i) => `${i + 0.5},${yOf(geo, r.endHigh)}`).reverse();
  const line = months.map((m, i) => `${i + 0.5},${yOf(geo, m.endBalance)}`).join(' ');
  return (
    <svg
      className={styles.band}
      viewBox={`0 0 ${n} ${Math.max(1, height)}`}
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

/** 좁은 화면: 달마다 가는 세로 막대로 범위만 (칸이 좁아 띠 대신) */
function Whisker({ r, geo }: { r: ProjectionRangeMonth; geo: Parameters<typeof yOf>[0] }) {
  const y1 = yOf(geo, r.endLow);
  const y2 = yOf(geo, r.endHigh);
  if (y2 - y1 < 1) return null;
  return <span className={styles.whisker} style={{ top: `calc(var(--space-2) + ${y1}px)`, height: y2 - y1 }} aria-hidden data-testid="projection-whisker" />;
}
