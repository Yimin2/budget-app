import { addMonths, formatMonthKo, monthOf } from './dates';
import { projectEventAccount, suggestShortageFixes } from './events';
import { floorTo100, formatWon } from './money';
import type { EventProjection, ISODate, LedgerData, LivingStatus, Signal, Verdict, Won } from './types';

const TITLES: Record<Signal, string> = { ok: '괜찮아요', warn: '가능하지만', bad: '비추천' };

/** 저축 가정: 하루 생활비 중 이 비율만 쓴다 (PLAN 4-5 초안) */
export const SAVE_SPEND_RATIO = 0.7;

/**
 * PLAN 4-4 생활비 기준 "사도 돼?" + 4-5 "언제 살 수 있어?"
 * ok: A ≤ todayAvailable / warn: A ≤ remaining / bad: 그 외
 * warn 문구의 X = floorTo100((remaining − A) ÷ 내일부터 남은 일수). 말일이면 내일부터 0일 → X 대신 '이번 달 마지막 날이에요'
 * when(warn·bad): 하루 생활비의 70%만 쓰면 매일 30%가 쌓인다고 보고 N = ceil((A − todayAvailable) ÷ (dailyBudget × 0.3)).
 *   N ≤ 남은 일수 → '하루 X원씩만 쓰면 N일 뒤에 살 수 있어요', 아니면 '이번 달 생활비로는 어려워요 …'
 *   (N일 뒤가 이번 달 안이어야 하므로 실제 비교는 N ≤ 남은 일수 − 1)
 */
export function judgeLiving(living: LivingStatus, amount: Won): Verdict {
  const a = Math.max(0, amount);
  const after = living.remaining - a;
  const daysAfterToday = Math.max(0, living.daysLeft - 1);
  const details = [
    { label: '오늘 써도 되는 돈', value: formatWon(living.todayAvailable) },
    { label: '이번 달 남은 생활비', value: formatWon(living.remaining) },
    { label: '사고 나면 남는 생활비', value: formatWon(after) },
  ];

  let signal: Signal;
  let message: string;
  if (a <= living.todayAvailable) {
    signal = 'ok';
    message = '오늘 생활비 안이에요';
  } else if (a <= living.remaining) {
    signal = 'warn';
    if (daysAfterToday === 0) {
      message = '이번 달 마지막 날이에요';
    } else {
      const x = floorTo100(after / daysAfterToday);
      message = `사면 남은 날 하루 생활비가 ${formatWon(x)}이 돼요`;
      details.push({ label: '내일부터 하루 생활비', value: formatWon(x) });
    }
  } else {
    signal = 'bad';
    message = `이번 달 생활비를 ${formatWon(a - living.remaining)} 넘어요`;
  }

  let when: string | null = null;
  if (signal !== 'ok') {
    const perDaySaving = living.dailyBudget * (1 - SAVE_SPEND_RATIO);
    const need = a - Math.max(0, living.todayAvailable);
    const n = perDaySaving > 0 ? Math.ceil(need / perDaySaving) : Infinity;
    if (Number.isFinite(n) && n >= 1 && n <= daysAfterToday) {
      const y = floorTo100(living.dailyBudget * SAVE_SPEND_RATIO);
      when = `하루 ${formatWon(y)}씩만 쓰면 ${n}일 뒤에 살 수 있어요`;
    } else {
      when = '이번 달 생활비로는 어려워요. 다음 달 생활비로 사거나 이벤트통장으로 살 수 있는지 확인해 보세요';
    }
  }

  return { signal, title: TITLES[signal], message, details, when, projectionAfter: null };
}

function eventNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0]!;
  return `${names[0]} 외 ${names.length - 1}건`;
}

function minEnd(p: EventProjection): Won {
  return p.months.reduce((m, x) => Math.min(m, x.endBalance), Infinity);
}

/**
 * PLAN 4-4 이벤트통장 기준. A 를 이번 달 extra 로 넣고 예측 재계산.
 * ok: 모든 달 endBalance ≥ 0 / warn: 이번 달은 ≥ 0 이지만 이후 음수 달 생김(이미 있던 부족이 커지는 경우 포함) / bad: 이번 달 endBalance < 0
 * when: A 를 넣어도 이후 모든 달이 0 이상이 되는 가장 빠른 달 → '3월에 사면 일정에 문제없어요', 없으면 적립·저수지 안내
 * projectionAfter 채움
 */
export function judgeEvent(data: LedgerData, today: ISODate, amount: Won): Verdict {
  const a = Math.max(0, amount);
  const thisMonth = monthOf(today);
  const baseYear = Number(thisMonth.slice(0, 4));
  const after = projectEventAccount(data, today, { extra: { month: thisMonth, amount: a } });

  if (after.accountId === null || after.months.length === 0) {
    return {
      signal: 'bad',
      title: TITLES.bad,
      message: '이벤트통장이 없어요. 설정에서 통장을 먼저 만들어 주세요',
      details: [],
      when: null,
      projectionAfter: after,
    };
  }

  const first = after.months[0]!;
  const details = [
    { label: '이벤트통장 잔액', value: formatWon(after.currentBalance) },
    { label: '이번 달 말 예상 잔액', value: formatWon(first.endBalance) },
  ];
  const lowest = minEnd(after);
  if (after.months.length > 1) details.push({ label: '가장 적은 달 예상 잔액', value: formatWon(lowest) });

  let signal: Signal;
  let message: string;
  if (first.endBalance < 0) {
    signal = 'bad';
    const names = eventNames(first.events.map((e) => e.name));
    message = names
      ? `이번 달 ${names} 일정에 쓸 돈이 ${formatWon(-first.endBalance)} 모자라요`
      : `이번 달 이벤트통장 돈이 ${formatWon(-first.endBalance)} 모자라요`;
  } else if (after.shortages.length > 0) {
    signal = 'warn';
    const s = after.shortages[0]!;
    message = `사면 ${formatMonthKo(s.month, baseYear)}에 ${formatWon(s.amount)} 모자라요`;
    const fix = suggestShortageFixes(data, today, after);
    if (fix.increaseMonthly) {
      const f = fix.increaseMonthly;
      details.push({
        label: '① 적립액 늘리기',
        value: `매달 +${formatWon(f.amount)} (${formatMonthKo(f.fromMonth, baseYear)}~${formatMonthKo(f.toMonth, baseYear)} ${f.times}개월)`,
      });
    }
    if (fix.fromReservoir) {
      const f = fix.fromReservoir;
      details.push({
        label: '② 저수지에서 옮기기',
        value: `${formatMonthKo(f.month, baseYear)}에 ${formatWon(f.amount)} (저수지 예상 잔액 ${formatWon(f.reservoirProjected)})`,
      });
    }
  } else {
    signal = 'ok';
    message = '예정된 일정에도 문제없어요';
  }

  let when: string | null = null;
  if (signal !== 'ok') {
    for (let k = 1; k < after.months.length; k++) {
      const month = addMonths(thisMonth, k);
      const p = projectEventAccount(data, today, { extra: { month, amount: a } });
      if (p.months.slice(k).every((m) => m.endBalance >= 0)) {
        when = `${formatMonthKo(month, baseYear)}에 사면 일정에 문제없어요`;
        break;
      }
    }
    if (when === null) when = '앞으로 12개월 안에는 어려워요. 적립액을 늘리거나 저수지에서 옮기면 살 수 있어요';
  }

  return { signal, title: TITLES[signal], message, details, when, projectionAfter: after };
}
