/**
 * 지금 앱이 열린 환경 (PLAN 6장 · 아이폰 홈 화면 앱 · 앱 안 브라우저).
 * - 아이폰 홈 화면 앱(standalone): 구글 파일 선택 창이 "Google 계정에 액세스할 수 없습니다"로 실패해요 → 초대 링크 붙여넣기
 * - 앱 안 브라우저(카카오톡 · 네이버 · 인스타그램 등): 구글 로그인이 막혀요 → Chrome · Safari 로 열기 안내
 * - 안드로이드 Chrome · 설치한 앱 · 그 밖의 브라우저: 그대로
 * 이 파일은 React · 브라우저 전역에 닿지 않아요 (단위 테스트용). 브라우저 값은 호출하는 쪽이 넘겨요
 */

export type BrowserOs = 'ios' | 'android' | 'other';

export type InAppBrowser = 'kakaotalk' | 'naver' | 'instagram' | 'facebook' | 'line' | 'daum' | 'everytime' | 'webview';

export type BrowserEnvKind = 'ios-standalone' | 'in-app' | 'normal';

export interface BrowserEnv {
  os: BrowserOs;
  /** 앱 안 브라우저면 그 앱, 아니면 null */
  inApp: InAppBrowser | null;
  /** 홈 화면에 추가한 앱으로 열렸는지 (iOS · 안드로이드 모두) */
  standalone: boolean;
  /** 화면이 다르게 해야 하는 경우. 앱 안 브라우저가 먼저예요 */
  kind: BrowserEnvKind;
}

export interface BrowserEnvInput {
  userAgent: string;
  /** iOS Safari 의 navigator.standalone */
  navigatorStandalone?: boolean | null;
  /** matchMedia('(display-mode: standalone)').matches */
  displayModeStandalone?: boolean | null;
  /** navigator.maxTouchPoints (iPadOS 는 Mac 처럼 보여서 터치로 가려요) */
  maxTouchPoints?: number | null;
}

export const NORMAL_ENV: BrowserEnv = { os: 'other', inApp: null, standalone: false, kind: 'normal' };

/** 앱 안 브라우저 표시: 앞에서부터 맞는 것 하나 */
const IN_APP_RULES: readonly [InAppBrowser, RegExp][] = [
  ['kakaotalk', /KAKAOTALK/i],
  ['naver', /\bNAVER\b/],
  ['instagram', /Instagram/i],
  ['facebook', /FBAN|FBAV|FB_IAB/],
  ['line', /\bLine\//],
  ['daum', /DaumApps/i],
  ['everytime', /everytime/i],
];

export function detectOs(userAgent: string, maxTouchPoints?: number | null): BrowserOs {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'ios';
  // iPadOS 13+ Safari 는 Mac 과 같은 UA 를 보내요
  if (/Macintosh/.test(userAgent) && (maxTouchPoints ?? 0) > 1) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'other';
}

export function detectInApp(userAgent: string, os: BrowserOs = detectOs(userAgent)): InAppBrowser | null {
  for (const [name, re] of IN_APP_RULES) if (re.test(userAgent)) return name;
  // 안드로이드 WebView (앱이 화면 안에 띄운 브라우저): "; wv)" 표시
  if (os === 'android' && /;\s?wv\)/.test(userAgent)) return 'webview';
  return null;
}

export function detectBrowserEnv(input: BrowserEnvInput): BrowserEnv {
  const ua = input.userAgent ?? '';
  const os = detectOs(ua, input.maxTouchPoints);
  const inApp = detectInApp(ua, os);
  const standalone = input.navigatorStandalone === true || input.displayModeStandalone === true;
  const kind: BrowserEnvKind = inApp ? 'in-app' : os === 'ios' && standalone ? 'ios-standalone' : 'normal';
  return { os, inApp, standalone, kind };
}

/* ---------- 바깥 브라우저로 열기 ---------- */

/** 안드로이드: Chrome 으로 이 주소를 여는 intent 링크. https 주소가 아니면 null */
export function chromeIntentUrl(href: string): string | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const scheme = u.protocol.slice(0, -1);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${scheme};package=com.android.chrome;end`;
}

/** 카카오톡 앱 안 브라우저: 기본 브라우저(아이폰은 Safari)로 열기 */
export function kakaoOpenExternalUrl(href: string): string {
  return `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`;
}

/** 아이폰: Safari 로 바로 여는 주소 (x-safari-https://). https · http 가 아니면 null */
export function safariSchemeUrl(href: string): string | null {
  const m = /^(https?):\/\//i.exec(href);
  if (!m) return null;
  return `x-safari-${m[1]!.toLowerCase()}://${href.slice(m[0].length)}`;
}

export interface OpenInSafariDeps {
  /** location.href = … */
  navigate(url: string): void;
  /** window.open(url, '_blank') */
  open(url: string): unknown;
  /** 다른 앱(Safari)으로 넘어갔으면 true (document.hidden) */
  isHidden(): boolean;
  /** setTimeout */
  later(fn: () => void, ms: number): void;
}

/** Safari 로 넘어갔는지 기다리는 시간 */
export const SAFARI_FALLBACK_MS = 800;

/**
 * 아이폰 홈 화면 앱에서 Safari 로 열기: x-safari-https:// 를 먼저 시도하고,
 * 잠시 뒤에도 이 화면이 그대로면 window.open 으로 다시 열어요 (링크 복사는 호출하는 쪽이 함께 해요)
 */
export function openInSafari(href: string, deps: OpenInSafariDeps, opts: { standalone: boolean }): void {
  const scheme = opts.standalone ? safariSchemeUrl(href) : null;
  if (!scheme) {
    deps.open(href);
    return;
  }
  try {
    deps.navigate(scheme);
  } catch {
    deps.open(href);
    return;
  }
  deps.later(() => {
    if (!deps.isHidden()) deps.open(href);
  }, SAFARI_FALLBACK_MS);
}

/** 앱 안 브라우저 이름 (안내 문구) */
export const IN_APP_LABEL: Record<InAppBrowser, string> = {
  kakaotalk: '카카오톡',
  naver: '네이버 앱',
  instagram: '인스타그램',
  facebook: '페이스북',
  line: '라인',
  daum: '다음 앱',
  everytime: '에브리타임',
  webview: '앱 안 브라우저',
};
