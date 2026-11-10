import type { NavItem } from '@/ui';

/** 통계 화면 (내역 안의 [내역 · 통계]) */
export const STATS_HREF = '/history/stats';

const HOME: NavItem = { href: '/', label: '홈', icon: 'home', match: ['/check'] };
const HISTORY: NavItem = { href: '/history', label: '내역', icon: 'receipt' };
const STATS: NavItem = { href: STATS_HREF, label: '통계', icon: 'trending-up' };
const PLAN: NavItem = { href: '/plan', label: '이벤트', icon: 'calendar' };
const BUDGET: NavItem = { href: '/budget', label: '예산', icon: 'piggy-bank' };

/**
 * 사이드바 메뉴 (태블릿 · 데스크톱): 홈 · 내역 · 통계 · 이벤트 · 예산. 메뉴 위에 '+ 기록' 버튼이 있어요.
 * 통계는 내역 안의 화면이라 모바일 하단 메뉴에는 없고, 내역 맨 위 [내역 · 통계]로 들어가요.
 * 설정은 메뉴에 두지 않고 오른쪽 위(모바일) · 사이드바 아래(태블릿 · 데스크톱)의 내 정보 버튼에서 열어요.
 */
export const APP_NAV: NavItem[] = [HOME, HISTORY, STATS, PLAN, BUDGET];

/** 모바일 하단 메뉴: 홈 · 내역 · (+ 기록) · 이벤트 · 예산 (가운데 + 버튼과 함께 다섯 칸). /history/stats 에서는 내역이 켜져요 */
export const MOBILE_NAV: NavItem[] = [HOME, HISTORY, PLAN, BUDGET];

/** 내 정보 버튼이 여는 곳 */
export const SETTINGS_HREF = '/settings';
