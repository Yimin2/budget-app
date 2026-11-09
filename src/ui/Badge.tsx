import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type Tone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** 앞에 색 점 (기본 true). 색만으로 뜻을 전하지 않도록 글자는 꼭 함께 써요 */
  dot?: boolean;
  size?: 'md' | 'sm';
  children: ReactNode;
}

export function Badge({ tone = 'neutral', dot = true, size = 'md', className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx('badge', tone !== 'neutral' && tone, size === 'sm' && 'sm', className)} {...rest}>
      {dot ? <span className="dot" aria-hidden /> : null}
      {children}
    </span>
  );
}
