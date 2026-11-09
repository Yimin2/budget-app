import type { NavItem } from '@/ui';

/** 사이드바 메뉴 (태블릿 접힘 · 데스크톱 펼침) */
export const APP_NAV: NavItem[] = [
  { href: '/', label: '홈', icon: 'home' },
  { href: '/check', label: '사도 돼?', icon: 'cart' },
  { href: '/events', label: '이벤트', icon: 'calendar' },
  { href: '/accounts', label: '통장', icon: 'wallet' },
  { href: '/expenses', label: '지출', icon: 'receipt' },
  { href: '/members', label: '멤버', icon: 'users' },
  { href: '/settings', label: '설정', icon: 'settings' },
];

/**
 * 모바일 하단 메뉴 (5개). 지출 · 멤버 · 설정은 '더보기'(설정 화면 맨 위 바로 가기)에서 열어요.
 */
export const MOBILE_NAV: NavItem[] = [
  { href: '/', label: '홈', icon: 'home' },
  { href: '/check', label: '사도 돼?', icon: 'cart' },
  { href: '/events', label: '이벤트', icon: 'calendar' },
  { href: '/accounts', label: '통장', icon: 'wallet' },
  { href: '/settings', label: '더보기', icon: 'menu', match: ['/expenses', '/members'] },
];
