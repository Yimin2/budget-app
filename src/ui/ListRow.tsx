import Link from 'next/link';
import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

export interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** 왼쪽 아이콘 (회색 네모 안) */
  icon?: IconName | (string & {});
  /** 왼쪽에 아이콘 대신 짧은 글자 (예: 날짜 '1/28') */
  leadText?: ReactNode;
  /** 왼쪽에 직접 그릴 것 (Avatar 등). icon·leadText 보다 우선 */
  leading?: ReactNode;
  /** 오른쪽 (금액 등) */
  trailing?: ReactNode;
  /** 주면 링크 행 */
  href?: string;
  /** 주면 버튼 행 */
  onClick?: () => void;
  /** 오른쪽 꺾쇠 (링크·버튼 행 기본 true) */
  chevron?: boolean;
  /** 좌우 16px 안쪽 여백 */
  padded?: boolean;
  className?: string;
}

/** 목록 한 줄. <ul className="list"> 안에서 <li> 로 감싸 쓰거나 그냥 나열해도 돼요 */
export function ListRow({ title, subtitle, icon, leadText, leading, trailing, href, onClick, chevron, padded, className }: ListRowProps) {
  const interactive = href !== undefined || onClick !== undefined;
  const showChevron = chevron ?? interactive;
  const content = (
    <>
      {leading ??
        (leadText !== undefined ? (
          <span className="lead text">{leadText}</span>
        ) : icon ? (
          <span className="lead">
            <Icon name={icon} size={20} />
          </span>
        ) : null)}
      <span className="main">
        <span className="t">{title}</span>
        {subtitle ? <span className="s">{subtitle}</span> : null}
      </span>
      {trailing !== undefined ? <span className="trail">{trailing}</span> : null}
      {showChevron ? <Icon name="chevron-right" size={20} className="chev" /> : null}
    </>
  );
  const cls = cx('lrow', padded && 'pad', className);
  if (href !== undefined) {
    return (
      <Link href={href} className={cls}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className={cls}>{content}</div>;
}
