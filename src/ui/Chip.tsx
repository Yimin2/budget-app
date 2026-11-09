'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** 켜짐/꺼짐이 있는 칩이면 주세요 (aria-pressed). 없으면 일반 버튼 칩 */
  selected?: boolean;
  icon?: IconName;
  /** 주면 오른쪽에 지우기 버튼이 생겨요 */
  onRemove?: () => void;
  removeLabel?: string;
  children?: ReactNode;
}

export function Chip({ selected, icon, onRemove, removeLabel = '지우기', className, children, type = 'button', ...rest }: ChipProps) {
  const chip = (
    <button
      type={type}
      className={cx('chip', selected && 'on', className)}
      aria-pressed={selected === undefined ? undefined : selected}
      {...rest}
    >
      {icon ? <Icon name={icon} size={16} strokeWidth={icon === 'plus' || icon === 'check' ? 2.4 : 2} /> : null}
      {children}
    </button>
  );
  if (!onRemove) return chip;
  return (
    <span className={cx('chip', selected && 'on')} style={{ cursor: 'default' }}>
      {icon ? <Icon name={icon} size={16} /> : null}
      {children}
      <button type="button" className="x" aria-label={removeLabel} onClick={onRemove}>
        <Icon name="x" size={16} />
      </button>
    </span>
  );
}

/** 칩 여러 개를 줄바꿈하며 나열 */
export function ChipGroup({ label, children, className }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('chips', className)} role={label ? 'group' : undefined} aria-label={label}>
      {children}
    </div>
  );
}
