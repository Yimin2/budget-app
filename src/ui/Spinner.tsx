import type { CSSProperties } from 'react';
import { cx } from './cx';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  /** 화면 읽기용 문구 */
  label?: string;
  className?: string;
}

export function Spinner({ size = 'md', label = '불러오는 중이에요', className }: SpinnerProps) {
  return (
    <span role="status" className={className} style={{ display: 'inline-flex' }}>
      <span className={cx('spin', size !== 'md' && size)} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** 화면 가운데 큰 스피너 + 문구 */
export function LoadingBlock({ label = '불러오는 중이에요' }: { label?: string }) {
  return (
    <div className="loading-block" role="status">
      <span className="spin lg" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export interface SkeletonProps {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  radius?: 'sm' | 'md' | 'lg' | 'full';
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({ width = '100%', height = 16, radius = 'sm', className, style }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={cx('skel', className)}
      style={{ width, height, borderRadius: `var(--radius-${radius})`, ...style }}
    />
  );
}
