import type { ISODate, LedgerData, LivingStatus, Verdict, Won } from './types';

/**
 * PLAN 4-4 생활비 기준 "사도 돼?" + 4-5 "언제 살 수 있어?"
 * ok: A ≤ todayAvailable / warn: A ≤ remaining / bad: 그 외
 * warn 문구의 X = floorTo100((remaining − A) ÷ 내일부터 남은 일수). 말일이면 내일부터 0일 → X 대신 '이번 달 마지막 날이에요'
 * when(warn·bad): 하루 생활비의 70%만 쓰면 매일 30%가 쌓인다고 보고 N = ceil((A − todayAvailable) ÷ (dailyBudget × 0.3)).
 *   N ≤ 남은 일수 → '하루 X원씩만 쓰면 N일 뒤에 살 수 있어요', 아니면 '이번 달 생활비로는 어려워요 …'
 */
export function judgeLiving(living: LivingStatus, amount: Won): Verdict {
  throw new Error('not implemented');
}

/**
 * PLAN 4-4 이벤트통장 기준. A 를 이번 달 extra 로 넣고 예측 재계산.
 * ok: 모든 달 endBalance ≥ 0 / warn: 이번 달은 ≥ 0 이지만 이후 음수 달 생김(이미 있던 부족이 커지는 경우 포함) / bad: 이번 달 endBalance < 0
 * when: A 를 넣어도 이후 모든 달이 0 이상이 되는 가장 빠른 달 → '3월에 사면 일정에 문제없어요', 없으면 적립·저수지 안내
 * projectionAfter 채움
 */
export function judgeEvent(data: LedgerData, today: ISODate, amount: Won): Verdict {
  throw new Error('not implemented');
}
