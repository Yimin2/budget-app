import type { NavItem } from '@/ui';

/** 통계 화면 (사이드바 · 모바일 하단 메뉴의 통계 칸) */
export const STATS_HREF = '/history/stats';

const HOME: NavItem = { href: '/', label: '홈', icon: 'home', match: ['/check'] };
const HISTORY: NavItem = { href: '/history', label: '내역', icon: 'receipt' };
const STATS: NavItem = { href: STATS_HREF, label: '통계', icon: 'trending-up' };
const PLAN: NavItem = { href: '/plan', label: '이벤트', icon: 'calendar' };
const BUDGET: NavItem = { href: '/budget', label: '예산', icon: 'piggy-bank' };

/**
 * 사이드바 메뉴 (태블릿 · 데스크톱): 홈 · 내역 · 통계 · 이벤트 · 예산. 메뉴 위에 '+ 기록' 버튼이 있어요.
 * 설정은 메뉴에 두지 않고 오른쪽 위(모바일) · 사이드바 아래(태블릿 · 데스크톱)의 내 정보 버튼에서 열어요.
 */
export const APP_NAV: NavItem[] = [HOME, HISTORY, STATS, PLAN, BUDGET];

/**
 * 모바일 하단 메뉴: 홈 · 내역 · 통계 · 이벤트 · 예산 (사이드바와 같은 다섯 칸). /history/stats 에서는 통계만 켜져요 (가장 길게 맞는 칸).
 * 기록은 하단 메뉴가 아니라 오른쪽 아래 떠 있는 + 버튼이에요.
 */
export const MOBILE_NAV: NavItem[] = [HOME, HISTORY, STATS, PLAN, BUDGET];

/** 아래 고정 막대가 있어 모바일 + 기록 버튼을 숨기는 화면 (정산: '○만 지급' 막대) */
export const FAB_HIDDEN_PATHS = ['/plan/settle'];

/** 내 정보 버튼이 여는 곳 */
export const SETTINGS_HREF = '/settings';
