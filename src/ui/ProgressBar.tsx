import { cx } from './cx';

export interface ProgressBarProps {
  value: number;
  max?: number;
  /** 화면 읽기용 이름 (예: '이번 달 생활비 사용') */
  label: string;
  /** 읽어 줄 값 문구 (예: '600,000원 중 150,000원') */
  valueText?: string;
  tone?: 'primary' | 'success' | 'warning' | 'danger';
  /** 바탕 위 색: default(연한 파랑) · brand(brand 카드 위 흰 트랙) · subtle(회색 트랙) */
  track?: 'default' | 'brand' | 'subtle';
  className?: string;
  /** 링크 · 버튼 안처럼 같은 숫자를 글로 이미 보여 줄 때 true: 화면 읽기에서 숨겨 이름에 값이 두 번 들어가지 않게 */
  decorative?: boolean;
}

export function ProgressBar({
  value,
  max = 100,
  label,
  valueText,
  tone = 'primary',
  track = 'default',
  className,
  decorative = false,
}: ProgressBarProps) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));
  const a11y = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({
        role: 'progressbar',
        'aria-label': label,
        'aria-valuemin': 0,
        'aria-valuemax': safeMax,
        'aria-valuenow': Math.max(0, Math.min(value, safeMax)),
        'aria-valuetext': valueText,
      } as const);
  return (
    <span
      {...a11y}
      className={cx('bar', tone !== 'primary' && tone, track === 'brand' && 'on-brand', track === 'subtle' && 'on-subtle', className)}
    >
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}
