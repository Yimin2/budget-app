import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

interface CommonProps {
  variant?: ButtonVariant;
  /** md 44px · lg 52px */
  size?: ButtonSize;
  /** 글자 왼쪽 아이콘 */
  icon?: IconName;
  /** 글자 오른쪽 아이콘 */
  iconRight?: IconName;
  /** 너비 100% */
  block?: boolean;
  /** ghost 버튼을 파란 글자 대신 기본 글자색으로 (헤더 아이콘 버튼 등) */
  plain?: boolean;
  /** 진행 중: 스피너를 보여 주고 누를 수 없어요 */
  loading?: boolean;
  className?: string;
  children?: ReactNode;
}

/** 아이콘만 있는 버튼은 aria-label 이 꼭 있어야 해요 */
type IconOnly = { iconOnly: true; icon: IconName; 'aria-label': string; children?: never };
type WithText = { iconOnly?: false };

export type ButtonAsButton = CommonProps &
  (IconOnly | WithText) &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> & { href?: undefined };

export type ButtonAsLink = CommonProps &
  (IconOnly | WithText) &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'className' | 'href'> & {
    /** 주면 링크(next/link)로 그려요 */
    href: string;
    /** 바깥 주소: <a> 로 새 창 */
    external?: boolean;
    replace?: boolean;
    scroll?: boolean;
    prefetch?: boolean;
  };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

function classes(p: CommonProps & { iconOnly?: boolean }) {
  return cx(
    'btn',
    p.variant ?? 'primary',
    p.size === 'lg' && 'lg',
    p.iconOnly && 'icon',
    p.block && 'block',
    p.plain && 'plain',
    p.className,
  );
}

function Inner({ icon, iconRight, iconOnly, loading, size, children }: CommonProps & { iconOnly?: boolean }) {
  const iconSize = size === 'lg' || iconOnly ? 24 : 20;
  return (
    <>
      {loading ? <span className="spin sm" aria-hidden /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {!iconOnly && children}
      {!iconOnly && iconRight && !loading ? <Icon name={iconRight} size={20} /> : null}
    </>
  );
}

export function Button(props: ButtonProps) {
  if (props.href !== undefined) {
    const {
      variant, size, icon, iconRight, block, plain, loading, className, children, iconOnly,
      href, external, replace, scroll, prefetch, ...rest
    } = props as ButtonAsLink;
    const cls = classes({ variant, size, iconOnly, block, plain, className });
    const inner = (
      <Inner icon={icon} iconRight={iconRight} iconOnly={iconOnly} loading={loading} size={size}>
        {children}
      </Inner>
    );
    if (external) {
      return (
        <a href={href} className={cls} target="_blank" rel="noopener noreferrer" {...rest}>
          {inner}
        </a>
      );
    }
    return (
      <Link href={href} className={cls} replace={replace} scroll={scroll} prefetch={prefetch} {...rest}>
        {inner}
      </Link>
    );
  }

  const {
    variant, size, icon, iconRight, block, plain, loading, className, children, iconOnly,
    type = 'button', disabled, ...rest
  } = props as ButtonAsButton;
  return (
    <button
      type={type}
      className={classes({ variant, size, iconOnly, block, plain, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <Inner icon={icon} iconRight={iconRight} iconOnly={iconOnly} loading={loading} size={size}>
        {children}
      </Inner>
    </button>
  );
}
