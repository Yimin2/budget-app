export interface GoogleConfig {
  clientId: string;
  apiKey: string;
  appId: string;
}

/**
 * 환경 변수는 반드시 글자 그대로 process.env.NEXT_PUBLIC_... 로 읽는다.
 * (Next 가 빌드할 때 이 표현을 값으로 바꿔 넣는다)
 */
export function getGoogleConfig(): GoogleConfig {
  const clientId = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '').trim();
  const apiKey = (process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? '').trim();
  const appId = (process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? '').trim() || appIdFromClientId(clientId);
  return { clientId, apiKey, appId };
}

/** 클라이언트 ID 앞의 숫자(프로젝트 번호)가 Picker 의 앱 ID 와 같다 */
export function appIdFromClientId(clientId: string): string {
  const m = /^(\d+)-/.exec(clientId);
  return m?.[1] ?? '';
}

export function isGoogleConfigured(): boolean {
  return getGoogleConfig().clientId !== '';
}
