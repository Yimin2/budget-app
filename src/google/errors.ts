/** 구글 연동 오류. message 는 화면에 그대로 보여 줄 수 있는 한국어 문장 */
export type GoogleErrorCode =
  | 'not_configured'
  | 'popup_blocked'
  | 'popup_closed'
  | 'consent_denied'
  | 'script_failed'
  | 'network'
  | 'timeout'
  | 'not_signed_in'
  | 'account_mismatch'
  | 'unknown';

export const GOOGLE_ERROR_MESSAGES: Record<GoogleErrorCode, string> = {
  not_configured: '구글 연동이 설정되지 않았어요. 체험 모드로 써 주세요.',
  popup_blocked: '로그인 창이 차단됐어요. 브라우저에서 팝업을 허용해 주세요.',
  popup_closed: '로그인 창이 닫혔어요. 다시 시도해 주세요.',
  consent_denied: '구글 드라이브 권한을 허용해야 쓸 수 있어요.',
  script_failed: '구글 연결을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.',
  network: '구글 계정 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.',
  timeout: '구글 응답이 늦어요. 잠시 뒤 다시 시도해 주세요.',
  not_signed_in: '구글 로그인이 필요해요.',
  account_mismatch: '다른 구글 계정으로 연결됐어요. 처음 로그인한 계정으로 다시 연결해 주세요.',
  unknown: '구글 로그인 중 문제가 생겼어요. 다시 시도해 주세요.',
};

export class GoogleError extends Error {
  readonly code: GoogleErrorCode;
  /** 개발자용 상세 (화면에 보이지 않음) */
  readonly detail?: string;
  constructor(code: GoogleErrorCode, detail?: string) {
    super(GOOGLE_ERROR_MESSAGES[code]);
    this.name = 'GoogleError';
    this.code = code;
    this.detail = detail;
  }
}

export function isGoogleError(e: unknown): e is GoogleError {
  return e instanceof GoogleError;
}
