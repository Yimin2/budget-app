import { addMonths, daysInMonth, formatMonthKo, monthOf } from './dates';
import { projectEventAccount, suggestShortageFixes } from './events';
import { findLivingItem } from './living';
import { floorTo100, formatWon } from './money';
import type {
  EventProjection, Id, ISODate, LedgerData, LivingItem, LivingStatus, Signal, Verdict, Won, YearMonth,
} from './types';

const TITLES: Record<Signal, string> = { ok: '괜찮아요', warn: '가능하지만', bad: '비추천' };

/** 저축 가정: 하루 생활비 중 이 비율만 쓴다 (PLAN 4-5 초안) */
export const SAVE_SPEND_RATIO = 0.7;

/**
 * '한 달 한도만' 항목에서 남은 날을 위해 남겨 두면 좋은 몫의 비율 (PLAN 4-4).
 * 남겨 둘 돈 = 100원 내림(이번 달 예산 × 내일부터 남은 일수 ÷ 그달 일수 × 0.5)
 */
export const MONTHLY_RESERVE_RATIO = 0.5;

/** '한 달 한도만' 항목에서 사고 나서도 남겨 두면 좋은 돈 */
export function monthlyReserve(monthBudget: Won, daysAfterToday: number, daysInThisMonth: number): Won {
  if (monthBudget <= 0 || daysAfterToday <= 0 || daysInThisMonth <= 0) return 0;
  return floorTo100((monthBudget * daysAfterToday * MONTHLY_RESERVE_RATIO) / daysInThisMonth);
}

/** 예산이 없는 항목 (카테고리 예산도, 생활비 한 줄도 없을 때) */
function emptyItem(name: string): LivingItem {
  return {
    categoryId: null, name, icon: 'dots', spread: 'monthly', base: 0, monthBudget: 0, carryIn: 0, spent: 0,
    spentToday: 0, remaining: 0, dailyBudget: null, todayAvailable: null, unbudgeted: true,
  };
}

/**
 * PLAN 4-4 생활비 기준 "사도 돼?" (항목별) + 4-5 "언제 살 수 있어?"
 * 항목 = categoryId 의 예산 항목, 없으면 null 묶음(예전 '생활비' 한 줄 · '기타(예산 없음)'). 지출이 들어가는 곳과 같다.
 *
 * 하루에 나눠 쓰기(daily) 항목 — 예전 생활비 판단과 같다
 *   ok: A ≤ 오늘 써도 되는 돈 / warn: A ≤ 남은 돈 / bad: 그 외
 *   warn 문구의 X = floorTo100((남은 돈 − A) ÷ 내일부터 남은 일수). 말일이면 '이번 달 마지막 날이에요'
 *   when(warn·bad): 하루 예산의 70%만 쓰면 매일 30%가 쌓인다고 보고 N = ceil((A − 오늘 써도 되는 돈) ÷ (하루 예산 × 0.3)).
 *     N ≤ 내일부터 남은 일수 → '하루 X원씩만 쓰면 N일 뒤에 살 수 있어요', 아니면 '이번 달 ○○ 예산으로는 어려워요 …'
 *
 * 한 달 한도만(monthly) 항목 — 남은 돈 R 과 남은 날의 몫으로 본다
 *   남겨 둘 돈 K = monthlyReserve(이번 달 예산, 내일부터 남은 일수, 그달 일수) (남은 날 몫의 절반)
 *   ok: A ≤ R − K / warn: A ≤ R / bad: A > R
 *   when(warn·bad): 다음 달 1일 기준(예산 = 이월 뺀 base, K = 그달 몫)으로 ok 면 '○월 1일에 사면 … 한도 안이에요',
 *     A ≤ base 면 '○월에 사도 한도를 대부분 써요 …', 아니면 '한 달 … 한도보다 커요 …'
 */
export function judgeLiving(living: LivingStatus, categoryId: Id | null, amount: Won): Verdict {
  const a = Math.max(0, amount);
  const item = findLivingItem(living, categoryId) ?? emptyItem('이 항목');
  const daysAfterToday = Math.max(0, living.daysLeft - 1);
  if (item.unbudgeted && item.monthBudget <= 0) {
    return {
      signal: 'bad',
      title: TITLES.bad,
      message: '이 항목은 이번 달 예산이 없어요',
      details: [
        { label: '이번 달 쓴 돈', value: formatWon(item.spent) },
        { label: '사고 나면 넘는 돈', value: formatWon(item.spent + a - item.monthBudget) },
      ],
      when: '설정에서 생활비 항목 예산을 정하면 알려 드려요',
      projectionAfter: null,
    };
  }
  return item.spread === 'daily'
    ? judgeDaily(item, daysAfterToday, a)
    : judgeMonthly(item, living.month, daysAfterToday, a);
}

function judgeDaily(item: LivingItem, daysAfterToday: number, a: Won): Verdict {
  const today = item.todayAvailable ?? 0;
  const daily = item.dailyBudget ?? 0;
  const after = item.remaining - a;
  const details = [
    { label: '오늘 써도 되는 돈', value: formatWon(today) },
    { label: `이번 달 남은 ${item.name}`, value: formatWon(item.remaining) },
    { label: '사고 나면 남는 돈', value: formatWon(after) },
  ];

  let signal: Signal;
  let message: string;
  if (a <= today) {
    signal = 'ok';
    message = `오늘 ${item.name} 예산 안이에요`;
  } else if (a <= item.remaining) {
    signal = 'warn';
    if (daysAfterToday === 0) {
      message = '이번 달 마지막 날이에요';
    } else {
      const x = floorTo100(after / daysAfterToday);
      message = `사면 내일부터 ${item.name}에 하루 ${formatWon(x)}씩 쓸 수 있어요`;
      details.push({ label: '내일부터 하루 예산', value: formatWon(x) });
    }
  } else {
    signal = 'bad';
    message = `이번 달 ${item.name} 예산을 ${formatWon(a - item.remaining)} 넘어요`;
  }

  let when: string | null = null;
  if (signal !== 'ok') {
    const perDaySaving = daily * (1 - SAVE_SPEND_RATIO);
    const need = a - Math.max(0, today);
    const n = perDaySaving > 0 ? Math.ceil(need / perDaySaving) : Infinity;
    if (Number.isFinite(n) && n >= 1 && n <= daysAfterToday) {
      const y = floorTo100(daily * SAVE_SPEND_RATIO);
      when = `하루 ${formatWon(y)}씩만 쓰면 ${n}일 뒤에 살 수 있어요`;
    } else {
      when = `이번 달 ${item.name} 예산으로는 어려워요. 다음 달 예산으로 사거나 이벤트통장으로 살 수 있는지 확인해 보세요`;
    }
  }

  return { signal, title: TITLES[signal], message, details, when, projectionAfter: null };
}

function judgeMonthly(item: LivingItem, month: YearMonth, daysAfterToday: number, a: Won): Verdict {
  const r = item.remaining;
  const reserve = monthlyReserve(item.monthBudget, daysAfterToday, daysInMonth(month));
  const after = r - a;
  const details = [
    { label: `이번 달 남은 ${item.name}`, value: formatWon(r) },
    { label: '사고 나면 남는 돈', value: formatWon(after) },
  ];

  let signal: Signal;
  let message: string;
  if (a <= r - reserve) {
    signal = 'ok';
    message = `이번 달 ${item.name} 한도 안이에요`;
  } else if (a <= r) {
    signal = 'warn';
    message = `사면 이번 달 ${item.name} 한도가 ${formatWon(after)} 남아요`;
    if (daysAfterToday > 0) details.push({ label: `남은 ${daysAfterToday}일을 위해 남겨 둘 돈`, value: formatWon(reserve) });
  } else {
    signal = 'bad';
    message = `이번 달 ${item.name} 한도를 ${formatWon(a - r)} 넘어요`;
  }

  let when: string | null = null;
  if (signal !== 'ok') {
    const next = addMonths(month, 1);
    const nextText = formatMonthKo(next, Number(month.slice(0, 4)));
    const dimNext = daysInMonth(next);
    const nextReserve = monthlyReserve(item.base, dimNext - 1, dimNext);
    if (item.base > 0 && a <= item.base - nextReserve) {
      when = `${nextText} 1일에 사면 ${item.name} 한도 안이에요`;
    } else if (item.base > 0 && a <= item.base) {
      when = `${nextText}에 사도 ${item.name} 한도를 대부분 써요. 이벤트통장으로 살 수 있는지 확인해 보세요`;
    } else {
      when = `한 달 ${item.name} 한도보다 커요. 이벤트통장으로 살 수 있는지 확인해 보세요`;
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
