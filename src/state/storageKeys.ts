/** 브라우저 저장 키 (state 계층) */

/** 로그인·가계부 선택 상태 {mode, user, recentLedgers, activeLedgerId} */
export const SESSION_KEY = 'budget:session';
/**
 * 로그인이 만료돼 로그아웃됐을 때 남겨 두는 {email, recentLedgers, activeLedgerId}.
 * 같은 계정으로 다시 로그인하면 최근 가계부를 되살린다. 직접 로그아웃하면 지운다
 */
export const REMEMBER_KEY = 'budget:session:remembered';
/** 화면 테마. 로그아웃해도 지우지 않는다 */
export const THEME_KEY = 'budget:theme';
/** 체험 모드 가계부 id (LocalBackend) */
export const DEMO_LEDGER_ID = 'local:demo';

/** localStorage 와 같은 모양의 최소 저장소 */
export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** SSR·사생활 보호 모드에서는 null */
export function browserStorage(): SessionStorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readJson<T>(storage: SessionStorageLike | null, key: string): T | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJson(storage: SessionStorageLike | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장 공간 부족 등은 무시 (다음 접속 때 다시 고르면 된다)
  }
}

export function removeKey(storage: SessionStorageLike | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // 무시
  }
}
/**
 * 이벤트 '추천 타협안'에서 고른 저수지 빚 갚는 개월 수 (12 · 18 · 24 · 36). 기기마다 따로 두는 화면 선택이라 시트에는 쓰지 않는다.
 * 없거나 이상한 값이면 24개월
 */
export const REPAY_MONTHS_KEY = 'budget:repayMonths';
/** 통장 고르기에서 최근 고른 통장 id (기기마다, 최근 것이 앞). 시트 칸 없음 */
export const RECENT_ACCOUNTS_KEY = 'budget:recentAccounts';
/** 이벤트 '일정' 카드의 '지난 기록에서 매년 반복되는 일 N건을 찾았어요' 안내를 이 기기에서 닫았는지 ('1'). 시트 칸 없음 */
export const RECURRING_HINT_KEY = 'budget:recurringHintDismissed';
