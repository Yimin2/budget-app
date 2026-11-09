/* 테마 저장 키와 첫 화면 깜빡임을 막는 인라인 스크립트. 서버·클라이언트 어디서나 import 할 수 있어요. */

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'budget:theme';

export const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#F9FAFB', dark: '#0F1115' };

export function isThemeMode(v: unknown): v is ThemeMode {
  return v === 'system' || v === 'light' || v === 'dark';
}

/**
 * <head> 에 넣는 스크립트. 그리기 전에 <html data-theme> 를 정해요.
 * 'system' 이면 data-theme 를 빼고 CSS 의 prefers-color-scheme 이 정하게 둬요.
 */
export const themeInitScript = `(function(){try{var m=localStorage.getItem('${THEME_STORAGE_KEY}');var d=document.documentElement;if(m==='light'||m==='dark'){d.setAttribute('data-theme',m);}else{d.removeAttribute('data-theme');}}catch(e){}})();`;
