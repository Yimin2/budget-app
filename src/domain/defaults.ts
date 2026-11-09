import type { LedgerData, LedgerKind } from './types';

export const SCHEMA_VERSION = 1;

/**
 * 새 가계부 기본 데이터.
 * shared: 통장 5개(수입/고정지출/이벤트/저수지/저축투자, 시작 잔액 0, openingDate=today), 기본 카테고리, 규칙·고정지출 없음
 * personal: 통장 1개(용돈, role='allowance'), 기본 카테고리(기본 통장 역할 allowance)
 * 기본 카테고리 (PLAN 5): 식비 카페 교통 생활 쇼핑 의료 문화 → fixed / 경조사 여행 명절 선물 큰구매 → event / 기타 → fixed
 * members: [{ email: authorEmail, displayName }]
 */
export function createDefaultLedger(kind: LedgerKind, name: string, today: string, now: string, authorEmail: string, displayName: string): LedgerData {
  throw new Error('not implemented');
}

/** 체험 모드용 예시 데이터 (민지·준호 부부 예시: 월급 500만, 배분 고정 200 / 이벤트 30 / 저축투자 150 / 저수지 120, 생활비 60, 이벤트 일정: 설날·제주 여행·5월 결혼식 4건·어버이날 → 5월 부족 발생) — today 기준 상대 날짜 */
export function createDemoLedger(today: string, now: string): LedgerData {
  throw new Error('not implemented');
}
