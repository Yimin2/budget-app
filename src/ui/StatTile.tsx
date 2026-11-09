import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

export interface StatTileProps {
  label: ReactNode;
  /** 큰 값 (보통 <Money />) */
  value: ReactNode;
  /** 아래 보조 줄 */
  sub?: ReactNode;
  icon?: IconName;
  variant?: 'default' | 'brand' | 'subtle';
  className?: string;
}

export function StatTile({ label, value, sub, icon, variant = 'default', className }: StatTileProps) {
  return (
    <div className={cx('stat', variant !== 'default' && variant, className)}>
      <span className="lbl">
        {icon ? <Icon name={icon} size={16} /> : null}
        {label}
      </span>
      <span className="val">{value}</span>
      {sub ? <span className="sub">{sub}</span> : null}
    </div>
  );
}
