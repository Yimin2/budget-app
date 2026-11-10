/**
 * 구글 연동 계약. 구현: config.ts / gis.ts / picker.ts / session.ts
 * 브라우저 전용 (window 필요). 서버 컴포넌트에서 호출하지 않는다.
 * 오류는 GoogleError (message 는 화면에 보여 줄 한국어 문장, code 로 구분).
 */
import { isGoogleConfigured as configured } from './config';
import { createGisTokenRequester, fetchUserInfo, revokeToken } from './gis';
import { pickSpreadsheetWith, type PickOptions } from './picker';
import { createServerAuthClient } from './server';
import { createGoogleSession, STORAGE_KEY, type EndReason, type GoogleSession, type KeyValueStore, type LoginFlow } from './session';

export interface GoogleUser {
  email: string;
  name: string;
  picture: string | null;
}

/** drive.file: 앱이 만들었거나 Picker 로 고른 파일만 */
export const GOOGLE_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'];

export { GoogleError, isGoogleError, GOOGLE_ERROR_MESSAGES, type GoogleErrorCode } from './errors';
export type { EndReason, LoginFlow } from './session';

function browserStore(kind: 'sessionStorage' | 'localStorage'): KeyValueStore | null {
  try {
    if (typeof window === 'undefined' || !window[kind]) return null;
    const s = window[kind];
    return {
      get: (k) => s.getItem(k),
      set: (k, v) => s.setItem(k, v),
      remove: (k) => s.removeItem(k),
    };
  } catch {
    return null;
  }
}

let requester: ReturnType<typeof createGisTokenRequester> | null = null;
let session: GoogleSession | null = null;

function getRequester(): ReturnType<typeof createGisTokenRequester> {
  requester ??= createGisTokenRequester(GOOGLE_SCOPES);
  return requester;
}

/** 전체 페이지로 이동 (구글 로그인 화면). 뒤로 가기로 캐시된 페이지가 다시 보이면 새로 읽어 멈춘 버튼을 풀어요 */
function navigate(url: string): void {
  window.addEventListener(
    'pageshow',
    (e) => {
      if (e.persisted) window.location.reload();
    },
    { once: true },
  );
  window.location.assign(url);
}

function getSession(): GoogleSession {
  if (!session) {
    // 예전에는 토큰을 sessionStorage 에 뒀어요. 이제 localStorage (만료까지) 라서 옛 값은 지워요
    browserStore('sessionStorage')?.remove(STORAGE_KEY);
    session = createGoogleSession({
      now: () => Date.now(),
      requestToken: (req) => getRequester().requestToken(req),
      fetchUserInfo,
      revoke: revokeToken,
      store: browserStore('localStorage'),
      hintStore: browserStore('localStorage'),
      server: createServerAuthClient({ fetch: (input, init) => fetch(input, init), navigate }),
      currentPath: () => window.location.pathname + window.location.search,
    });
  }
  return session;
}

/** NEXT_PUBLIC_GOOGLE_CLIENT_ID 가 있으면 true */
export function isGoogleConfigured(): boolean {
  return configured();
}

/**
 * 구글 스크립트를 미리 불러 둔다 (로그인 화면이 뜰 때 한 번 부르면 좋음).
 * 미리 불러 두면 signIn 이 클릭과 같은 순간에 창을 열어 팝업 차단을 피한다. 실패해도 조용히 넘어간다.
 */
export function preloadGoogle(): Promise<void> {
  if (!configured() || typeof window === 'undefined') return Promise.resolve();
  // 어떤 로그인을 쓸지 먼저 정해 둬요. 서버 로그인이면 팝업 스크립트는 필요 없어요
  return getSession()
    .resolveFlow()
    .then((flow) => (flow === 'gis' ? getRequester().preload() : undefined))
    .catch(() => {});
}

/** 서버 로그인(갱신 토큰)인지 팝업 로그인인지. 설정이 없으면 null */
export function resolveLoginFlow(): Promise<LoginFlow | null> {
  if (!configured() || typeof window === 'undefined') return Promise.resolve(null);
  return getSession().resolveFlow();
}

/**
 * 구글로 시작하기. 서버 로그인이면 구글 로그인 화면으로 이동하고(돌아오면 returnTo, 기본은 지금 주소) 약속은 끝나지 않아요.
 * 팝업 로그인이면 동의 창 → 토큰 + 사용자 정보
 */
export function signIn(opts?: { returnTo?: string }): Promise<GoogleUser> {
  return getSession().signIn(opts);
}

/**
 * 로그인 서버 쿠키로 이어서 쓰기 (로그아웃 상태에서 앱을 열었을 때). 구글 로그인 화면에서 막 돌아왔으면 꼭 묻고,
 * 아니면 예전에 로그인한 적이 있을 때만 묻는다. 만료면 GoogleError('session_expired')
 */
export function resumeServerSession(opts?: { force?: boolean }): Promise<GoogleUser | null> {
  if (!configured() || typeof window === 'undefined') return Promise.resolve(null);
  return getSession().resumeServerSession(opts);
}

/** 서버가 로그인 만료(갱신 토큰 끝남) · 로그인 없음을 알리면 불러요 */
export function onSessionEnded(listener: (reason: EndReason) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  return getSession().onEnded(listener);
}

/** 로그인 서버가 돌려보낸 표시 (?auth=1 · ?auth_error=<코드>) 를 읽고 주소에서 지워요 */
export function consumeAuthReturn(): { returned: boolean; error: string | null } {
  if (typeof window === 'undefined') return { returned: false, error: null };
  try {
    const url = new URL(window.location.href);
    const returned = url.searchParams.get('auth') === '1';
    const error = url.searchParams.get('auth_error');
    if (!returned && !error) return { returned: false, error: null };
    url.searchParams.delete('auth');
    url.searchParams.delete('auth_error');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    return { returned, error };
  } catch {
    return { returned: false, error: null };
  }
}
/**
 * 유효한 액세스 토큰. 만료(또는 1분 전)면 조용히 재발급 시도 (예전에 동의한 계정이면 login_hint 로).
 * forceRefresh: 토큰이 거절됐을 때(401) 캐시를 버리고 새로 받는다
 */
export function getAccessToken(forceRefresh?: boolean): Promise<string> {
  return getSession().getAccessToken(forceRefresh === true);
}
/** 사용자 클릭 안에서 불러 구글 연결을 다시 맺는다 (조용한 복구가 막혔을 때). 같은 계정이 아니면 오류 */
export function reconnect(emailHint?: string): Promise<GoogleUser | null> {
  if (!configured() || typeof window === 'undefined') return Promise.resolve(null);
  return getSession().reconnect(emailHint);
}
/** 이전 로그인 힌트로 조용히 복구 (실패 시 null) */
export function restoreSession(emailHint: string): Promise<GoogleUser | null> {
  if (!configured() || typeof window === 'undefined') return Promise.resolve(null);
  return getSession().restoreSession(emailHint);
}
/** 이 기기에서 로그아웃 (토큰 · 로그인 쿠키를 지운다). revoke: true 면 앱 권한까지 철회 — 다른 기기도 다시 로그인해야 한다 */
export function signOut(opts?: { revoke?: boolean }): void {
  if (typeof window === 'undefined') return;
  getSession().signOut(opts);
}
/** 구글 파일 선택 창으로 스프레드시트 고르기. 취소면 null. fileId: 그 파일을 미리 골라 둔다 (초대 링크) */
export function pickSpreadsheet(opts?: PickOptions): Promise<{ id: string; name: string } | null> {
  return pickSpreadsheetWith(getAccessToken, opts);
}
