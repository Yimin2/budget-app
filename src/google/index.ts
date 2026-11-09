/**
 * 구글 연동 계약. 구현: config.ts / gis.ts / picker.ts
 * 브라우저 전용 (window 필요). 서버 컴포넌트에서 호출하지 않는다.
 */
export interface GoogleUser {
  email: string;
  name: string;
  picture: string | null;
}

/** drive.file: 앱이 만들었거나 Picker 로 고른 파일만 */
export const GOOGLE_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'];

/** NEXT_PUBLIC_GOOGLE_CLIENT_ID 가 있으면 true */
export function isGoogleConfigured(): boolean {
  throw new Error('not implemented');
}
/** 동의 창 → 토큰 + 사용자 정보 */
export function signIn(): Promise<GoogleUser> {
  throw new Error('not implemented');
}
/** 유효한 액세스 토큰. 만료(또는 1분 전)면 조용히 재발급 시도, 실패하면 동의 창 */
export function getAccessToken(): Promise<string> {
  throw new Error('not implemented');
}
/** 이전 로그인 힌트로 조용히 복구 (실패 시 null) */
export function restoreSession(emailHint: string): Promise<GoogleUser | null> {
  throw new Error('not implemented');
}
export function signOut(): void {
  throw new Error('not implemented');
}
/** 구글 파일 선택 창으로 스프레드시트 고르기. 취소면 null */
export function pickSpreadsheet(): Promise<{ id: string; name: string } | null> {
  throw new Error('not implemented');
}
