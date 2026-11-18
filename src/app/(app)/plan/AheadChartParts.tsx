'use client';

import { type KeyboardEvent } from 'react';
import { formatWon } from '@/domain';
import type { ProjectionMonth, ProjectionRangeMonth, SpentOnlyMonth } from '@/domain';
import { cx } from '@/ui';
import { compactWon, yOf } from './selectors';
import styles from './AheadCard.module.css';

/** 빗금 막대 위 금액·막대가 들어갈 칸 높이에서 '통장 기록 전 · 쓴 돈' 글자 자리 */
const SPENT_SEG_ROOM = 20;

/** 막대 위 금액 글자 자리 */
const SPENT_LABEL_ROOM = 18;

/**
 * 통장 시작 전 달 한 칸: 잔액 축과 따로, 이 달들 중 가장 많이 쓴 달을 칸 높이로 하는 빗금 막대 + 위에 금액.
 * 바닥은 잔액 기준선이 아니라 차트 바닥 (잔액으로 읽지 않게)
 */
export function SpentCol({
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

/** 넓은 화면: 달마다 아끼면 ~ 많이 쓰면 띠와 보통 선 (막대 칸 위에 겹쳐 그려요). offset = 앞의 지난 달 칸 수 */
export function BandOverlay({
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
export function Mark({ value, geo, faint = false, testId }: { value: number; geo: Parameters<typeof yOf>[0]; faint?: boolean; testId: string }) {
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
export function Whisker({ r, geo }: { r: ProjectionRangeMonth; geo: Parameters<typeof yOf>[0] }) {
  const y1 = yOf(geo, r.endLow);
  const y2 = yOf(geo, r.endHigh);
  if (y2 - y1 < 1) return null;
  return <span className={styles.whisker} style={{ top: `calc(var(--space-2) + ${y1}px)`, height: y2 - y1 }} aria-hidden data-testid="projection-whisker" />;
}
