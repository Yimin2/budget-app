/**
 * 구글 연동 계약. 구현: config.ts / gis.ts / picker.ts / session.ts
 * 브라우저 전용 (window 필요). 서버 컴포넌트에서 호출하지 않는다.
 * 오류는 GoogleError (message 는 화면에 보여 줄 한국어 문장, code 로 구분).
 */
import { isGoogleConfigured as configured } from './config';
import { createGisTokenRequester, fetchUserInfo, revokeToken } from './gis';
import { pickSpreadsheetWith, type PickOptions } from './picker';
import { createGoogleSession, type GoogleSession, type KeyValueStore } from './session';

export interface GoogleUser {
  email: string;
  name: string;
  picture: string | null;
}

/** drive.file: 앱이 만들었거나 Picker 로 고른 파일만 */
export const GOOGLE_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'];

export { GoogleError, isGoogleError, GOOGLE_ERROR_MESSAGES, type GoogleErrorCode } from './errors';

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

function getSession(): GoogleSession {
  session ??= createGoogleSession({
    now: () => Date.now(),
    requestToken: (req) => getRequester().requestToken(req),
    fetchUserInfo,
    revoke: revokeToken,
    store: browserStore('sessionStorage'),
    hintStore: browserStore('localStorage'),
  });
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
  return getRequester()
    .preload()
    .catch(() => {});
}

/** 동의 창 → 토큰 + 사용자 정보 */
export function signIn(): Promise<GoogleUser> {
  return getSession().signIn();
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
/** 이 기기에서 로그아웃 (토큰만 지운다). revoke: true 면 앱 권한까지 철회 — 다른 기기도 다시 로그인해야 한다 */
export function signOut(opts?: { revoke?: boolean }): void {
  if (typeof window === 'undefined') return;
  getSession().signOut(opts);
}
/** 구글 파일 선택 창으로 스프레드시트 고르기. 취소면 null. fileId: 그 파일을 미리 골라 둔다 (초대 링크) */
export function pickSpreadsheet(opts?: PickOptions): Promise<{ id: string; name: string } | null> {
  return pickSpreadsheetWith(getAccessToken, opts);
}
