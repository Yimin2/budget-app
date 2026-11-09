import type { EventProjection, ISODate, LedgerData, PlannedEvent, ShortageFix, YearMonth, Won } from './types';

/** planned 일정의 반복을 [fromMonth, toMonth] 안에서 펼친 회차들 (원래 행 포함, 같은 id 에 회차 날짜) */
export function expandOccurrences(event: PlannedEvent, fromMonth: YearMonth, toMonth: YearMonth): { id: string; name: string; date: ISODate; amount: Won }[] {
  throw new Error('not implemented');
}

/**
 * PLAN 4-2. 이벤트통장 12개월(기본) 예측.
 * - 이벤트통장 = role='event' 첫 통장 (없으면 accountId=null, 빈 예측)
 * - 이번 달 시작값 = 오늘 기준 잔액. 이번 달: 아직 기록 안 된(자동 이체 id 없음) 월배분 적립 + 이번 달 planned 이체 − 오늘 이후(포함)·지난 날짜라도 아직 planned 인 이번 달 일정
 * - 다음 달부터: 전월 말 + 월배분 적립 + planned 이체 − 그달 planned 일정(반복 펼침)
 * - extra: 가정 지출 {month, amount} (사도 돼? 판단용)
 * - endBalance < 0 인 달 = shortages
 */
export function projectEventAccount(
  data: LedgerData,
  today: ISODate,
  opts?: { horizonMonths?: number; extra?: { month: YearMonth; amount: Won } },
): EventProjection {
  throw new Error('not implemented');
}

/**
 * PLAN 4-2 부족 대처 제안.
 * ① 늘릴 금액 = 부족한 달마다 (그달까지 누적 부족액 ÷ 다음 달부터 그달까지 적립 횟수) 의 최댓값, 1000원 올림
 * ② 첫 부족 달에 저수지(role='reservoir')에서 부족액만큼. 저수지 예상 잔액 = 그달 말 저수지 잔액 예측(월배분 포함)
 */
export function suggestShortageFixes(data: LedgerData, today: ISODate, projection: EventProjection): ShortageFix {
  throw new Error('not implemented');
}
