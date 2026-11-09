import type { ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';

export interface PageHeaderProps {
  title: ReactNode;
  /** 제목 위 작은 줄 (예: '11월 10일 월요일') */
  eyebrow?: ReactNode;
  /** 제목 아래 보조 줄 */
  subtitle?: ReactNode;
  /** 주면 왼쪽에 뒤로 가기 링크 */
  backHref?: string;
  backLabel?: string;
  /** 오른쪽 버튼들 */
  actions?: ReactNode;
  /** 제목을 h1 이 아닌 다른 요소로 바꿀 때 (예: 가계부 전환 버튼을 제목으로) */
  titleAs?: 'h1' | 'div';
  className?: string;
}

/** 화면 머리. 모바일은 바탕 없이 22px 제목, 1280px 이상은 28px */
export function PageHeader({ title, eyebrow, subtitle, backHref, backLabel = '뒤로', actions, titleAs = 'h1', className }: PageHeaderProps) {
  const T = titleAs;
  return (
    <header className={cx('page-header', className)}>
      {backHref ? (
        <Button href={backHref} variant="ghost" plain iconOnly icon="chevron-left" aria-label={backLabel} className="back" />
      ) : null}
      <div className="txt">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        {T === 'h1' ? <h1>{title}</h1> : <div role="heading" aria-level={1}>{title}</div>}
        {subtitle ? <span className="sub">{subtitle}</span> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </header>
  );
}
