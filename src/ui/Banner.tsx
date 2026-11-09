import Link from 'next/link';
import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

export type BannerTone = 'success' | 'warning' | 'danger' | 'info';

const TONE_ICON: Record<BannerTone, IconName> = {
  success: 'check-circle',
  warning: 'alert-triangle',
  danger: 'alert-circle',
  info: 'info',
};

export type BannerAction = { label: string; href: string; onClick?: never } | { label: string; onClick: () => void; href?: never };

export interface BannerProps {
  tone?: BannerTone;
  /** 굵은 첫 줄 */
  title: ReactNode;
  /** 둘째 줄 (14px 보조) */
  children?: ReactNode;
  action?: BannerAction;
  icon?: IconName;
  /** tinted: 상태색 연한 바탕(기본, 목업과 같음) · plain: 흰 바탕 + 그림자 */
  variant?: 'tinted' | 'plain';
  /** 화면 읽기 프로그램에 바로 알릴지. danger 는 alert, 나머지는 status */
  role?: 'status' | 'alert' | 'none';
  className?: string;
}

export function Banner({ tone = 'info', title, children, action, icon, variant = 'tinted', role, className }: BannerProps) {
  const r = role ?? (tone === 'danger' ? 'alert' : 'status');
  return (
    <div className={cx('banner', tone, variant, className)} role={r === 'none' ? undefined : r}>
      <Icon name={icon ?? TONE_ICON[tone]} size={20} className="ic" />
      <div className="txt">
        <strong>{title}</strong>
        {children ? <span className="desc">{children}</span> : null}
      </div>
      {action ? (
        action.href !== undefined ? (
          <Link href={action.href} className="act">
            {action.label}
          </Link>
        ) : (
          <button type="button" className="act" onClick={action.onClick}>
            {action.label}
          </button>
        )
      ) : null}
    </div>
  );
}
