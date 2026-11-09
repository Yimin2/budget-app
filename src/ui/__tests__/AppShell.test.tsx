// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppShell, isNavActive, type NavItem } from '../AppShell';

afterEach(cleanup);

const nav: NavItem[] = [
  { href: '/', label: '홈', icon: 'home' },
  { href: '/check', label: '사도 돼?', icon: 'cart' },
  { href: '/events', label: '이벤트', icon: 'calendar' },
  { href: '/accounts', label: '통장', icon: 'wallet' },
  { href: '/expenses', label: '지출', icon: 'list' },
  { href: '/settings', label: '설정', icon: 'settings' },
];

describe('AppShell', () => {
  it('지금 메뉴에 aria-current 를 달고 하단 메뉴는 5개까지만', () => {
    render(
      <AppShell nav={nav} current="/events/abc">
        <p>본문</p>
      </AppShell>,
    );
    const menus = screen.getAllByRole('navigation', { name: '주 메뉴' });
    expect(menus).toHaveLength(2);
    const [side, dock] = menus as [HTMLElement, HTMLElement];
    expect(within(side).getAllByRole('link')).toHaveLength(6);
    expect(within(dock).getAllByRole('link')).toHaveLength(5);
    const current = within(dock).getByRole('link', { current: 'page' });
    expect(current.textContent).toContain('이벤트');
    expect(screen.getByRole('main').textContent).toBe('본문');
  });

  it('match 로 다른 경로에서도 메뉴를 켜요 (모바일 더보기)', () => {
    const mobileNav: NavItem[] = [
      { href: '/', label: '홈', icon: 'home' },
      { href: '/settings', label: '더보기', icon: 'menu', match: ['/expenses', '/members'] },
    ];
    render(
      <AppShell nav={nav} mobileNav={mobileNav} current="/expenses">
        <p>본문</p>
      </AppShell>,
    );
    const [side, dock] = screen.getAllByRole('navigation', { name: '주 메뉴' }) as [HTMLElement, HTMLElement];
    expect(within(side).getByRole('link', { current: 'page' }).textContent).toContain('지출');
    expect(within(dock).getByRole('link', { current: 'page' }).textContent).toContain('더보기');
  });

  it('홈은 정확히 / 일 때만 켜져요', () => {
    expect(isNavActive('/', '/')).toBe(true);
    expect(isNavActive('/', '/events')).toBe(false);
    expect(isNavActive('/events', '/events/1')).toBe(true);
    expect(isNavActive('/event', '/events')).toBe(false);
  });
});
