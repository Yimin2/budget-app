import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type CardVariant = 'default' | 'brand' | 'subtle' | 'flat';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  as?: 'div' | 'section' | 'article' | 'li';
  /** default: 흰 면 + 테두리 + 그림자 · brand: 연한 파랑(홈 요약) · subtle: 회색 면 · flat: 그림자 없음 */
  variant?: CardVariant;
  /** md 24px(기본) · sm 20px · none */
  padding?: 'md' | 'sm' | 'none';
  /** 카드 위쪽 제목 (16px 굵게) */
  title?: ReactNode;
  /** 제목 오른쪽 (금액, 링크 등) */
  aside?: ReactNode;
  children?: ReactNode;
}

export function Card({ as: Tag = 'div', variant = 'default', padding = 'md', title, aside, className, children, ...rest }: CardProps) {
  return (
    <Tag
      className={cx(
        'card',
        variant !== 'default' && variant,
        padding === 'sm' && 'pad-sm',
        padding === 'none' && 'pad-none',
        className,
      )}
      {...rest}
    >
      {title || aside ? (
        <div className="row between" style={{ alignItems: 'baseline' }}>
          {title ? <h2 className="card-title">{title}</h2> : <span />}
          {aside}
        </div>
      ) : null}
      {children}
    </Tag>
  );
}
