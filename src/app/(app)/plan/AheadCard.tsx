'use client';

import {
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import Link from 'next/link';
import { eventMonthlyCosts, formatMan, formatShortDate, formatWon, highOnlyShortageMessage, monthOf } from '@/domain';
import type { EventProjection, ISODate, LedgerData, ProjectionMonth, ProjectionRangeMonth, ShortageFix, YearMonth } from '@/domain';
import { Badge, Button, Card, Icon, cx, useMediaQuery } from '@/ui';
import { FoldHead, useMobileFold, foldStyles } from './FoldCard';
import {
  aheadInflowText,
  aheadMonthItems,
  aheadMonthLine,
  barsGeometry,
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
 * 이벤트 화면 카드 2 '앞으로 12개월' (PLAN 4-2): 달 말 예상 잔액 막대(범위 띠 · 미리 보는 중 표시) → 고른 달 항목
 * (일정 · 여행 남은 예산 · 할부 · 평소 쓰는 돈(근거) · 그달 끝 예상 잔액) + 옆에 다가오는 달 한 줄씩 → 모자라는 달이 있으면 부족 알림(두 가지 방법).
 * 0 이상은 기준선 위(파랑), 0 아래는 기준선 아래(빨강) + 모자라는 금액. 이번 달은 달 숫자에 파란 동그라미.
 * 막대를 누르면(마우스는 올리기만 해도) 그달 항목이 보여요. 화면 읽기 프로그램은 숨긴 표로 모든 달을 읽어요.
 * 지난 달 쓴 돈은 정산 화면(#paid 전체 기록)에 있어요. 폰에서는 상태 한 줄만 보이고 [펼치기]로 나머지
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
        height: wide ? 200 : 152,
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

  const upcoming = months.slice(0, AHEAD_UPCOMING);

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

          <figcaption className="sr-only">이벤트통장 달 말 예상 잔액 막대 (아래 표에 모든 달)</figcaption>
          {highOnly ? (
            <p className={cx(styles.caption, shared.warn)} role="note">
              <Icon name="alert-circle" size={16} />
              <span>{highOnly}</span>
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
          {shown ? (
            <MonthDetail
              month={shown}
              items={aheadMonthItems(shown, installmentsByMonth.get(shown.month))}
              range={range?.find((r) => r.month === shown.month) ?? null}
              highCount={highCount}
              today={today}
              onPrev={selIndex > 0 && !hover ? () => step(-1) : undefined}
              onNext={selIndex < months.length - 1 && !hover ? () => step(1) : undefined}
            />
          ) : null}
          <div className={styles.upcoming}>
            <h3 id={`${ids}-up`} className={styles.upTitle}>
              다가오는 달
            </h3>
            <ul className={styles.upList} aria-labelledby={`${ids}-up`}>
              {upcoming.map((m) => (
                <li key={m.month}>
                  <button
                    type="button"
                    className={cx(styles.upRow, m.month === selected && styles.upOn, m.endBalance < 0 && styles.upShort)}
                    aria-pressed={m.month === selected}
                    onClick={() => pick(m.month)}
                  >
                    <span className={styles.upText}>
                      {aheadMonthLine(m, today)}
                      {m.month === thisMonth ? <span className="sr-only"> (이번 달)</span> : null}
                    </span>
                    {m.endBalance < 0 ? (
                      <span className={cx(styles.upBadge, shared.bad)}>
                        <Icon name="alert-triangle" size={16} />
                        {formatMan(-m.endBalance)} 모자라요
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
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
  return (
    <li className={cx(item.kind === 'usual' && styles.itemMuted)}>
      <span className={styles.d}>{item.date ? formatShortDate(item.date) : item.kind === 'trip' ? '여행' : ''}</span>
      <span className={styles.n}>
        {item.tripId ? <Link href={tripHref(item.tripId)}>{item.label}</Link> : item.label}
        {item.date && item.date < today ? <span className="sr-only"> (날짜 지남)</span> : null}
        {item.note ? <span className={styles.note}>{item.kind === 'usual' ? ` (${item.note})` : ` · ${item.note}`}</span> : null}
      </span>
      <span className={styles.a}>{formatWon(item.amount)}</span>
    </li>
  );
}

function MonthDetail({
  month,
  items,
  range,
  highCount,
  today,
  onPrev,
  onNext,
}: {
  month: ProjectionMonth;
  items: AheadItem[];
  range: ProjectionRangeMonth | null;
  highCount: number;
  today: ISODate;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const isThis = month.month === monthOf(today);
  const short = month.endBalance < 0;
  const label = monthLabel(month.month, today);
  const total = items.reduce((s, i) => s + i.amount, 0);
  return (
    <div className={styles.detail} data-testid="ahead-month">
      <div className={shared.detailHead}>
        <div className={shared.txt}>
          <h3 className={styles.detailTitle}>
            {label}
            {isThis ? ' · 이번 달' : ''}
          </h3>
          <span className={styles.detailSub}>
            예정 {formatWon(total)} ·{' '}
            <span className={cx(shared.statusLine, short ? shared.bad : shared.ok)}>
              <Icon name={short ? 'alert-triangle' : 'check-circle'} size={16} />
              {short ? `${formatWon(-month.endBalance)} 모자라요` : '모자라지 않아요'}
            </span>
          </span>
        </div>
        <div className={shared.nav}>
          <Button variant="ghost" plain iconOnly icon="chevron-left" aria-label="이전 달" onClick={onPrev} disabled={!onPrev} />
          <Button variant="ghost" plain iconOnly icon="chevron-right" aria-label="다음 달" onClick={onNext} disabled={!onNext} />
        </div>
      </div>
      {items.length > 0 ? (
        <ul className={styles.items} aria-label={`${label} 나갈 돈`}>
          {items.map((i) => (
            <ItemRow key={i.key} item={i} today={today} />
          ))}
        </ul>
      ) : (
        <p className={styles.detailEmpty}>이 달에는 나갈 돈이 없어요</p>
      )}
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
      </dl>
      {range && range.endHigh < 0 && !short && highCount > 0 ? (
        <p className={styles.detailWarn}>많이 쓰면 이 달에 {formatWon(-range.endHigh)} 모자라요</p>
      ) : null}
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
