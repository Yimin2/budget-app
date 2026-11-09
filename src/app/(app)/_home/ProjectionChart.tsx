'use client';

import { useId, useMemo, useState, type CSSProperties } from 'react';
import { formatMonthKo, formatWon, monthOf } from '@/domain';
import type { ProjectionMonth } from '@/domain';
import { Icon, cx } from '@/ui';
import { chartGeometry } from './selectors';
import styles from './home.module.css';

export interface ProjectionChartProps {
  months: ProjectionMonth[];
  /** 차트 제목 (예: '사면 이벤트통장 예상 잔액') */
  title: string;
  /** 연도 표시 기준 (오늘 날짜) */
  today: string;
  /** 상태색 연한 바탕 위에 그릴 때 (사도 돼? 결과 판) */
  onTint?: boolean;
  /** 막대 칸 전체 높이(px) */
  height?: number;
  className?: string;
}

function monthNumber(month: string): number {
  return Number(month.slice(5, 7));
}

/**
 * 12개월 예상 잔액 막대. 0 이상은 기준선 위(파랑), 0 아래는 기준선 아래(빨강) + 달 이름 강조 + 글로 요약.
 * 막대에 마우스를 올리면 위쪽 줄에 그달 값이 보이고, 화면 읽기 프로그램은 숨긴 표로 모든 달을 읽어요.
 */
export function ProjectionChart({ months, title, today, onTint, height = 88, className }: ProjectionChartProps) {
  const ids = useId().replace(/:/g, '');
  const baseYear = Number(monthOf(today).slice(0, 4));
  const geo = useMemo(() => chartGeometry(months, { height }), [months, height]);
  const shortages = useMemo(() => months.filter((m) => m.endBalance < 0), [months]);
  const lowest = useMemo(
    () => months.reduce<ProjectionMonth | null>((lo, m) => (lo === null || m.endBalance < lo.endBalance ? m : lo), null),
    [months],
  );
  const focusMonth = shortages[0] ?? lowest;
  const [hover, setHover] = useState<string | null>(null);
  const shown = months.find((m) => m.month === hover) ?? focusMonth;
  const transfersIn = months.reduce((s, m) => s + m.transfersIn, 0);

  if (months.length === 0) return null;

  const label = (m: string) => formatMonthKo(m, baseYear);
  const summary =
    shortages.length > 0
      ? shortages.length === 1
        ? `${label(shortages[0]!.month)}에 ${formatWon(-shortages[0]!.endBalance)} 모자라요`
        : `${label(shortages[0]!.month)}에 ${formatWon(-shortages[0]!.endBalance)} 모자라요 · 그 밖에 ${shortages.length - 1}개월 더 모자라요`
      : lowest
        ? `${months.length}개월 동안 0원 아래로 내려가지 않아요 · 가장 적은 달 ${label(lowest.month)} ${formatWon(lowest.endBalance)}`
        : '';

  return (
    <figure className={cx(styles.chart, onTint && styles.onTint, className)} aria-labelledby={`${ids}-t`}>
      <div className={styles.chartHead}>
        <h3 id={`${ids}-t`} className={styles.chartTitle}>
          {title}
        </h3>
        {shown ? (
          <span className={styles.readout} aria-hidden>
            {label(shown.month)} <strong>{formatWon(shown.endBalance)}</strong>
          </span>
        ) : null}
      </div>

      <div
        className={styles.bars}
        style={{ '--n': months.length } as CSSProperties}
        aria-hidden
        onPointerLeave={() => setHover(null)}
      >
        {geo.bars.map((b) => {
          const short = b.value < 0;
          const m = monthNumber(b.month);
          return (
            <div
              key={b.month}
              className={cx(styles.barCol, (hover ?? focusMonth?.month) === b.month && styles.active)}
              title={`${label(b.month)} ${formatWon(b.value)}`}
              onPointerEnter={() => setHover(b.month)}
            >
              <div className={styles.posArea} style={{ height: geo.posArea }}>
                {b.pos > 0 ? <span className={styles.barPos} style={{ height: b.pos }} /> : null}
              </div>
              {geo.negArea > 0 ? (
                <div className={styles.negArea} style={{ height: geo.negArea }}>
                  {b.neg > 0 ? <span className={styles.barNeg} style={{ height: b.neg }} /> : null}
                </div>
              ) : null}
              <span className={cx(styles.barLabel, short && styles.short)}>
                {m}
                <span className={styles.monthSuffix}>월</span>
              </span>
            </div>
          );
        })}
      </div>

      <figcaption className={cx(styles.chartNote, shortages.length > 0 ? styles.bad : styles.ok)}>
        <Icon name={shortages.length > 0 ? 'alert-triangle' : 'check-circle'} size={16} />
        <span>{summary}</span>
      </figcaption>
      {transfersIn > 0 ? (
        <p className={styles.chartFoot}>저수지 등에서 옮길 예정인 {formatWon(transfersIn)}을 반영한 예측이에요</p>
      ) : null}

      <table className="sr-only">
        <caption>{title} (달별)</caption>
        <thead>
          <tr>
            <th scope="col">달</th>
            <th scope="col">예상 잔액</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row">{label(m.month)}</th>
              <td>
                {formatWon(m.endBalance)}
                {m.endBalance < 0 ? ' (모자라요)' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
