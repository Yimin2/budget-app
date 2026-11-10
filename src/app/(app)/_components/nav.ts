import type { NavItem } from '@/ui';

/**
 * 주 메뉴: 홈 · 내역 · (+ 기록) · 예산 · 이벤트.
 * 모바일 하단 메뉴는 가운데에 + 버튼이 끼고, 태블릿 · 데스크톱 사이드바는 메뉴 위에 '+ 기록' 버튼이 있어요.
 * 설정은 메뉴에 두지 않고 오른쪽 위(모바일) · 사이드바 아래(태블릿 · 데스크톱)의 내 정보 버튼에서 열어요.
 */
export const APP_NAV: NavItem[] = [
  { href: '/', label: '홈', icon: 'home', match: ['/check'] },
  { href: '/history', label: '내역', icon: 'receipt' },
  { href: '/budget', label: '예산', icon: 'piggy-bank' },
  { href: '/plan', label: '이벤트', icon: 'calendar' },
];

/** 모바일 하단 메뉴 (가운데 + 버튼과 함께 다섯 칸) */
export const MOBILE_NAV: NavItem[] = APP_NAV;

/** 내 정보 버튼이 여는 곳 */
export const SETTINGS_HREF = '/settings';
