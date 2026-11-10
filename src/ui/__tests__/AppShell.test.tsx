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

  it('match 로 다른 경로에서도 메뉴를 켜요 (홈이 사도 돼? 화면에서도)', () => {
    const mobileNav: NavItem[] = [
      { href: '/', label: '홈', icon: 'home', match: ['/check'] },
      { href: '/history', label: '내역', icon: 'receipt' },
    ];
    render(
      <AppShell nav={nav} mobileNav={mobileNav} current="/check">
        <p>본문</p>
      </AppShell>,
    );
    const [side, dock] = screen.getAllByRole('navigation', { name: '주 메뉴' }) as [HTMLElement, HTMLElement];
    expect(within(side).getByRole('link', { current: 'page' }).textContent).toContain('사도 돼?');
    expect(within(dock).getByRole('link', { current: 'page' }).textContent).toContain('홈');
  });

  it('기록 버튼은 모바일 오른쪽 아래 떠 있는 + · 사이드바 위, 내 정보 버튼은 머리 · 사이드바 아래', () => {
    const items: NavItem[] = [
      { href: '/', label: '홈', icon: 'home' },
      { href: '/history', label: '내역', icon: 'receipt' },
      { href: '/budget', label: '예산', icon: 'piggy-bank' },
      { href: '/plan', label: '이벤트', icon: 'calendar' },
      { href: '/extra', label: '그 밖', icon: 'dots' },
    ];
    let opened = 0;
    render(
      <AppShell
        nav={items}
        current="/settings"
        create={{ label: '기록', onClick: () => (opened += 1) }}
        profile={{ href: '/settings', name: '하늘', caption: '설정', avatar: <span>하늘</span> }}
      >
        <p>본문</p>
      </AppShell>,
    );
    const [, dock] = screen.getAllByRole('navigation', { name: '주 메뉴' }) as [HTMLElement, HTMLElement];
    // 하단 메뉴는 링크 다섯 칸 그대로, + 는 메뉴 밖 오른쪽 아래 버튼
    expect(within(dock).getAllByRole('link')).toHaveLength(5);
    expect(within(dock).queryByRole('button')).toBeNull();
    const plus = document.querySelector('.fab') as HTMLButtonElement;
    expect(plus.getAttribute('aria-label')).toBe('기록');
    expect(plus.getAttribute('aria-haspopup')).toBe('dialog');
    expect(plus.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.shell')?.classList.contains('has-fab')).toBe(true);
    plus.click();
    (document.querySelector('.side-create') as HTMLButtonElement).click();
    expect(opened).toBe(2);
    // 모바일 머리 오른쪽은 설정 톱니바퀴만 (사진 없음), 사이드바 아래는 내 정보 버튼 그대로
    const profiles = screen.getAllByRole('link', { name: '내 정보와 설정' });
    expect(profiles.map((p) => p.className)).toEqual(['side-profile on']);
    expect(profiles[0]!.getAttribute('aria-current')).toBe('page');
    const gear = screen.getByRole('link', { name: '설정' });
    expect(gear.className).toBe('top-settings on');
    expect(gear.getAttribute('href')).toBe('/settings');
    expect(gear.closest('.shell-top')).not.toBeNull();
    expect(gear.querySelector('.pf-av')).toBeNull();
    expect(document.querySelector('.shell-top .pf-av')).toBeNull();
  });

  it('홈은 정확히 / 일 때만 켜져요', () => {
    expect(isNavActive('/', '/')).toBe(true);
    expect(isNavActive('/', '/events')).toBe(false);
    expect(isNavActive('/events', '/events/1')).toBe(true);
    expect(isNavActive('/event', '/events')).toBe(false);
  });

  it('통계(/history/stats)에서는 내역이 아니라 통계 칸만 켜지고 알약은 그 칸으로 (--n: 5)', () => {
    const items: NavItem[] = [
      { href: '/', label: '홈', icon: 'home' },
      { href: '/history', label: '내역', icon: 'receipt' },
      { href: '/history/stats', label: '통계', icon: 'trending-up' },
      { href: '/plan', label: '이벤트', icon: 'calendar' },
      { href: '/budget', label: '예산', icon: 'piggy-bank' },
    ];
    render(
      <AppShell nav={items} current="/history/stats" create={{ label: '기록', onClick: () => {} }}>
        <p>본문</p>
      </AppShell>,
    );
    const [side, dock] = screen.getAllByRole('navigation', { name: '주 메뉴' }) as [HTMLElement, HTMLElement];
    expect(within(dock).getAllByRole('link', { current: 'page' }).map((a) => a.textContent)).toEqual(['통계']);
    expect(within(side).getAllByRole('link', { current: 'page' }).map((a) => a.getAttribute('href'))).toEqual(['/history/stats']);
    expect(dock.style.getPropertyValue('--n')).toBe('5');
    expect(dock.style.getPropertyValue('--i')).toBe('2');
  });

  it('create.fab 이 false 면 오른쪽 아래 + 는 숨기고 사이드바 + 기록은 그대로', () => {
    render(
      <AppShell nav={nav} current="/plan/settle" create={{ label: '기록', onClick: () => {}, fab: false }}>
        <p>본문</p>
      </AppShell>,
    );
    expect(document.querySelector('.fab')).toBeNull();
    expect(document.querySelector('.shell')?.classList.contains('has-fab')).toBe(false);
    expect(document.querySelector('.side-create')?.getAttribute('aria-label')).toBe('기록');
  });
});
