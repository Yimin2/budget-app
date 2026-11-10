'use client';

import Link from 'next/link';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { cx } from './cx';
import { Icon, LogoMark, type IconName } from './Icon';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** href 말고도 이 메뉴를 켜 둘 경로 (예: 모바일 '더보기'가 지출·멤버 화면에서도 켜지게) */
  match?: string[];
}

export interface AppShellProps {
  nav: NavItem[];
  /** 지금 경로 (usePathname()) */
  current: string;
  /** 모바일 하단 메뉴 항목 (최대 5개). 없으면 nav 앞 5개 */
  mobileNav?: NavItem[];
  /** 데스크톱(≥1280px) 사이드바의 가계부 전환 자리. 그보다 좁으면 숨겨지니 화면 머리에서 따로 보여 주세요 (.hide-wide) */
  header?: ReactNode;
  /** 데스크톱 사이드바 아래 (테마 전환 · 사용자). 그보다 좁으면 숨겨져요 */
  footer?: ReactNode;
  /** 로고를 누르면 갈 곳 (기본 '/') */
  homeHref?: string;
  children: ReactNode;
}

/** 지금 경로가 이 메뉴에 속하는지. '/' 는 정확히 같을 때만 */
export function isNavActive(href: string, current: string): boolean {
  if (href === '/') return current === '/';
  return current === href || current.startsWith(`${href}/`);
}

function activeIndex(items: NavItem[], current: string): number {
  // 가장 길게 맞는 항목 (예: /settings/members 는 /settings)
  let best = -1;
  let len = -1;
  items.forEach((it, i) => {
    for (const href of [it.href, ...(it.match ?? [])]) {
      if (isNavActive(href, current) && href.length > len) {
        best = i;
        len = href.length;
      }
    }
  });
  return best;
}

/** 메뉴 칸이 바뀐 순간에만 true (첫 그림 제외) — 하단 메뉴 아이콘이 한 번 튀어 오르게 */
function useBumpOnChange(index: number): boolean {
  const [state, setState] = useState({ index, bumped: false });
  if (state.index !== index) setState({ index, bumped: true });
  return state.bumped;
}

/**
 * 사이드바 선택 배경을 누른 메뉴 자리로 옮겨요 (nav-ind). 처음 자리 잡을 때는 움직이지 않고,
 * 사이드바 폭이 바뀌면(태블릿 ↔ 데스크톱) 다시 맞춰요.
 */
function useNavIndicator(navRef: RefObject<HTMLElement | null>, indRef: RefObject<HTMLElement | null>, index: number) {
  useLayoutEffect(() => {
    const nav = navRef.current;
    const ind = indRef.current;
    if (!nav || !ind) return;
    const place = () => {
      const link = nav.querySelectorAll<HTMLElement>('a')[index];
      if (!link || link.offsetWidth === 0) {
        nav.classList.remove('has-ind');
        return;
      }
      ind.style.setProperty('--ind-x', `${link.offsetLeft}px`);
      ind.style.setProperty('--ind-y', `${link.offsetTop}px`);
      ind.style.width = `${link.offsetWidth}px`;
      ind.style.height = `${link.offsetHeight}px`;
      nav.classList.add('has-ind');
    };
    place();
    let raf = 0;
    if (!nav.classList.contains('ind-ready') && typeof requestAnimationFrame === 'function') {
      raf = requestAnimationFrame(() => nav.classList.add('ind-ready'));
    }
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    ro?.observe(nav);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [navRef, indRef, index]);
}

/** 경로가 바뀌면 본문 자식이 살짝 떠오르며 나타나요 (route-enter 를 다시 붙여 움직임을 처음부터) */
function useRouteEnter(mainRef: RefObject<HTMLElement | null>, current: string) {
  const first = useRef(true);
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    if (first.current) {
      first.current = false;
      main.classList.add('route-enter');
      return;
    }
    main.classList.remove('route-enter');
    void main.offsetWidth;
    main.classList.add('route-enter');
  }, [mainRef, current]);
}

/**
 * 앱 틀. 모바일(<768): 한 줄 + 하단 플로팅 메뉴 · 태블릿(768–1279): 80px 아이콘 사이드바 · 데스크톱(≥1280): 280px 사이드바.
 */
export function AppShell({ nav, current, mobileNav, header, footer, homeHref = '/', children }: AppShellProps) {
  const dockItems = (mobileNav ?? nav).slice(0, 5);
  const sideActive = activeIndex(nav, current);
  const dockActive = activeIndex(dockItems, current);
  const bump = useBumpOnChange(dockActive);
  const navRef = useRef<HTMLElement>(null);
  const indRef = useRef<HTMLSpanElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  useNavIndicator(navRef, indRef, sideActive);
  useRouteEnter(mainRef, current);

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        본문으로 건너뛰기
      </a>
      <div className="shell-side">
        <aside className="side" aria-label="사이드바">
          <Link href={homeHref} className="side-brand" aria-label="가계부 홈">
            <LogoMark className="logo" />
            <span className="name">가계부</span>
          </Link>
          {header ? <div className="side-slot">{header}</div> : null}
          <nav className="side-nav" aria-label="주 메뉴" ref={navRef}>
            {sideActive >= 0 ? <span className="nav-ind" aria-hidden ref={indRef} /> : null}
            {nav.map((item, i) => {
              const on = i === sideActive;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cx(on && 'on')}
                  aria-current={on ? 'page' : undefined}
                  aria-label={item.label}
                >
                  <Icon name={item.icon} size={20} />
                  <span className="lbl">{item.label}</span>
                  <span className="tip-label" aria-hidden>
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </nav>
          {footer ? <div className="side-foot">{footer}</div> : null}
        </aside>
      </div>

      <div className="shell-main">
        <main id="main" className="shell-content" tabIndex={-1} ref={mainRef}>
          {children}
        </main>
      </div>

      <nav
        className="dock"
        aria-label="주 메뉴"
        style={{ '--n': dockItems.length, '--i': Math.max(dockActive, 0) } as CSSProperties}
      >
        {dockActive >= 0 ? <span className="dock-pill" aria-hidden /> : null}
        {dockItems.map((item, i) => {
          const on = i === dockActive;
          return (
            <Link key={item.href} href={item.href} className={cx(on && 'on', on && bump && 'bump')} aria-current={on ? 'page' : undefined}>
              <Icon name={item.icon} size={24} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export interface FocusShellProps {
  /** 헤더 오른쪽 (예: 테마 전환) */
  headerAside?: ReactNode;
  /** 640px 너비 (기본 480px) */
  wide?: boolean;
  homeHref?: string;
  children: ReactNode;
}

/** 집중 틀 (/start 등): 로고만 있는 얇은 헤더 + 가운데 좁은 본문 */
export function FocusShell({ headerAside, wide, homeHref = '/', children }: FocusShellProps) {
  return (
    <div className="focus-shell">
      <header className="focus-head">
        <Link href={homeHref} className="focus-brand" aria-label="가계부 홈">
          <LogoMark className="logo" />
          <span className="name">가계부</span>
        </Link>
        {headerAside}
      </header>
      <main id="main" className={cx('focus-main', wide && 'wide')}>
        {children}
      </main>
    </div>
  );
}
