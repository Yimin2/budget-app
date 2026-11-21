import type { NavItem } from '@/ui';

const HOME: NavItem = { href: '/', label: '홈', icon: 'home', match: ['/check'] };
const HISTORY: NavItem = { href: '/history', label: '내역', icon: 'receipt' };
const PLAN: NavItem = { href: '/plan', label: '이벤트', icon: 'calendar' };
const BUDGET: NavItem = { href: '/budget', label: '예산', icon: 'piggy-bank' };

/**
 * 사이드바 메뉴 (태블릿 · 데스크톱): 홈 · 내역 · 이벤트 · 예산 (통계는 내역의 탭, 2026-11). 메뉴 위에 '+ 기록' 버튼이 있어요.
 * 설정은 메뉴에 두지 않고 오른쪽 위(모바일) · 사이드바 아래(태블릿 · 데스크톱)의 내 정보 버튼에서 열어요.
 */
export const APP_NAV: NavItem[] = [HOME, HISTORY, PLAN, BUDGET];

/**
 * 모바일 하단 메뉴: 홈 · 내역 · 이벤트 · 예산 (사이드바와 같은 네 칸). /history/stats(통계 탭)에서는 내역이 켜져요.
 * 기록은 하단 메뉴가 아니라 오른쪽 아래 떠 있는 + 버튼이에요.
 */
export const MOBILE_NAV: NavItem[] = [HOME, HISTORY, PLAN, BUDGET];

/** 아래 고정 막대가 있어 모바일 + 기록 버튼을 숨기는 화면 */
export const FAB_HIDDEN_PATHS = ['/check'];
/** 그 주소에서만 + 기록 버튼을 숨기는 화면 (이벤트 화면: 달별 내역의 '○만 지급' 막대, 머리에 [+ 추가]가 있어요) */
export const FAB_HIDDEN_EXACT = ['/plan'];

/** 내 정보 버튼이 여는 곳 */
export const SETTINGS_HREF = '/settings';
