import { decodeSecret } from './crypto';

/** 서버 로그인에 쓰는 값. 서버 전용 — 브라우저로 보내지 않는다 */
export interface ServerAuthConfig {
  clientId: string;
  clientSecret: string;
  cookieSecret: Uint8Array;
}

export type AuthEnv = Record<string, string | undefined>;

/**
 * 셋 다 있어야 서버 로그인을 쓴다. 하나라도 없으면 null (→ /api/auth/token 은 501, 브라우저는 팝업 로그인으로).
 * - NEXT_PUBLIC_GOOGLE_CLIENT_ID: 브라우저와 같은 OAuth 클라이언트 ID
 * - GOOGLE_CLIENT_SECRET: 그 클라이언트의 보안 비밀번호 (NEXT_PUBLIC 아님)
 * - AUTH_COOKIE_SECRET: 쿠키 암호화 키, base64 로 32바이트 이상
 */
export function readServerAuthConfig(env: AuthEnv): ServerAuthConfig | null {
  const clientId = (env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '').trim();
  const clientSecret = (env.GOOGLE_CLIENT_SECRET ?? '').trim();
  const cookieSecret = decodeSecret(env.AUTH_COOKIE_SECRET);
  if (!clientId || !clientSecret || !cookieSecret) return null;
  return { clientId, clientSecret, cookieSecret };
}

/** 라우트에서 쓰는 실제 환경 변수 (요청 때마다 읽는다) */
export function processEnv(): AuthEnv {
  return {
    // NEXT_PUBLIC_ 값은 빌드 때 글자 그대로 바뀌어 들어가므로 이렇게 따로 읽는다
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    AUTH_COOKIE_SECRET: process.env.AUTH_COOKIE_SECRET,
  };
}
