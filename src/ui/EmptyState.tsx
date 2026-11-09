import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

export interface EmptyStateProps {
  icon?: IconName;
  title: ReactNode;
  description?: ReactNode;
  /** 버튼 등 */
  action?: ReactNode;
  /** 제목 태그 (기본 h2) */
  headingLevel?: 2 | 3;
  className?: string;
}

export function EmptyState({ icon = 'list', title, description, action, headingLevel = 2, className }: EmptyStateProps) {
  const H = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <div className={cx('empty', className)}>
      <Icon name={icon} size={48} className="ic" />
      <H>{title}</H>
      {description ? <p>{description}</p> : null}
      {action ? <div className="actions">{action}</div> : null}
    </div>
  );
}
