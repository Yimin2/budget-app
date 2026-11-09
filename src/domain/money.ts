import type { Won } from './types';

/** 21400 → '21,400원'. 음수는 '-21,400원' */
export function formatWon(n: Won): string {
  throw new Error('not implemented');
}

/** 숫자만 — 21400 → '21,400' */
export function formatNumber(n: Won): string {
  throw new Error('not implemented');
}

/** '21,400원' / '21400' / ' 2만 ' 같은 입력에서 정수 원. 해석 불가면 null. '만' 단위 지원 */
export function parseWon(input: string): Won | null {
  throw new Error('not implemented');
}

/** 100원 단위 내림 (하루 생활비 표시용) */
export function floorTo100(n: Won): Won {
  throw new Error('not implemented');
}

/** 1000원 단위 올림 (적립액 제안용) */
export function ceilTo1000(n: Won): Won {
  throw new Error('not implemented');
}
