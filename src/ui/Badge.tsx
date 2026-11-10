import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type Tone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** 앞에 색 점 (기본 true). 색만으로 뜻을 전하지 않도록 글자는 꼭 함께 써요 */
  dot?: boolean;
  size?: 'md' | 'sm';
  /** outline: 흰 바탕 + 색 점 (기본) · soft: 상태 색 옅은 바탕 + 진한 상태 글자 (밝은 · 어두운 화면 모두 대비 4.5:1 이상) */
  variant?: 'outline' | 'soft';
  children: ReactNode;
}

export function Badge({ tone = 'neutral', dot = true, size = 'md', variant = 'outline', className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx('badge', tone !== 'neutral' && tone, size === 'sm' && 'sm', variant === 'soft' && 'soft', className)} {...rest}>
      {dot ? <span className="dot" aria-hidden /> : null}
      {children}
    </span>
  );
}
