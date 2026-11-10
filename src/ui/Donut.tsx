import type { ReactNode } from 'react';
import { cx } from './cx';

/** 도넛 조각 하나. share 는 전체에서 차지하는 몫(0~1), colorIndex 는 차트 색 순서(0~4), null 이면 '기타'(회색) */
export interface DonutPart {
  key: string;
  name: string;
  share: number;
  colorIndex: number | null;
}

/** 조각 색: 디자인 토큰의 차트 색 (--chart-1~5, 라이트 · 다크 모두 정해져 있음). '기타'는 회색 --chart-6 */
const PART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
const OTHER_COLOR = 'var(--chart-6)';

export function donutColor(part: Pick<DonutPart, 'colorIndex'>): string {
  return part.colorIndex === null ? OTHER_COLOR : (PART_COLORS[part.colorIndex] ?? OTHER_COLOR);
}

export interface DonutProps {
  parts: DonutPart[];
  /** 화면 읽기용 글 (조각마다 이름 · 금액 · 몫). 그림은 aria-hidden 이에요 */
  label: string;
  /** sm 48px (가운데 글 없음) · lg 최대 200px */
  size?: 'sm' | 'lg';
  /** 가운데 글 (lg 만, 화면 읽기에서는 숨김 — label 에 같은 내용을 넣어 주세요) */
  center?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

/** 인라인 SVG 도넛 (라이브러리 없음). 조각 사이에 작은 틈 */
export function Donut({ parts, label, size = 'lg', center, className, 'data-testid': testId }: DonutProps) {
  const r = 40;
  const stroke = size === 'sm' ? 16 : 12;
  const gap = parts.length > 1 ? 0.6 : 0; // pathLength 100 기준
  const starts = parts.map((_, i) => parts.slice(0, i).reduce((t, x) => t + x.share * 100, 0));
  return (
    <div className={cx('donut', size === 'sm' ? 'donut-sm' : 'donut-lg', className)} role="img" aria-label={label} data-testid={testId}>
      <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <circle cx="50" cy="50" r={r} fill="none" className="donut-track" strokeWidth={stroke} />
        {parts.map((p, i) => {
          const dash = Math.max(0, p.share * 100 - gap);
          return (
            <circle
              key={p.key}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              pathLength={100}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${100 - dash}`}
              strokeDashoffset={-(starts[i] ?? 0)}
              transform="rotate(-90 50 50)"
              style={{ stroke: donutColor(p) }}
            />
          );
        })}
      </svg>
      {size === 'lg' && center ? (
        <span className="donut-center" aria-hidden="true">
          {center}
        </span>
      ) : null}
    </div>
  );
}
