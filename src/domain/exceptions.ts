/**
 * PLAN 4-2 '예외 지출 빼기' — 지난 이벤트통장 지출 중 한 번뿐인 큰 지출(예외)을 골라 '평소 쓰는 돈'에서 뺀다.
 *
 * - 살펴보는 지출: 오늘까지 최근 24개월, 이벤트통장의 계획하지 않은 지출 (일정 · 여행 · 고정 지출 자동 기록이 아닌 것,
 *   저수지에서 빌려 낸 이벤트 청구 포함 — '평소 쓰는 돈'이 세는 지출과 같다). 예외 표시는 기준을 셀 때 보지 않는다
 * - 후보: 그 카테고리의 한 달 평소 지출 중앙값(쓴 달만)의 2.5배 이상이거나, 그 카테고리 한 건 지출(5건 이상일 때)의
 *   P90 이상이면서 한 건 중앙값보다 큰 지출. 금액 큰 순 10건 + 이미 예외로 표시한 지출(날짜와 상관없이) 전부
 * - 미리 보기: 체크한 대로 예외 표시를 덮어씌운 가계부로 예측을 다시 돌린다 (저장하지 않는 순수 덮어씌우기)
 * - 잔액 · 다른 합계에는 그대로 쓴 돈으로 들어간다 (balances 는 예외 표시를 보지 않는다)
 */
import { addMonths, compareMonth, formatMonthKo, monthOf } from './dates';
import { projectEventAccount } from './events';
import { firstAccountByRole } from './internal';
import { eventRecords } from './eventRecords';
import { manWon, percentile } from './usual';
import type { EventProjection, Expense, Id, ISODate, LedgerData, Won, YearMonth } from './types';

/** 카테고리 한 달 중앙값의 몇 배부터 후보인지 */
export const EXCEPTION_MEDIAN_RATIO = 2.5;
/** 한 건 지출 백분위 기준 */
export const EXCEPTION_PERCENTILE = 0.9;
/** 백분위 기준을 쓰는 최소 건수 (적으면 P90 이 그냥 가장 큰 지출이 된다) */
export const EXCEPTION_PERCENTILE_MIN = 5;
/** 보여 줄 후보 수 (이미 표시한 것은 따로 더한다) */
export const EXCEPTION_LIMIT = 10;
/** 살펴보는 지난 달 수 */
export const EXCEPTION_LOOKBACK_MONTHS = 24;

export interface ExceptionCandidate {
  expense: Expense;
  /** 메모, 없으면 카테고리 이름, 없으면 '이벤트 지출' */
  name: string;
  /** median = 한 달 중앙값의 2.5배 이상, p90 = 한 건 P90 이상, marked = 기준에는 안 들지만 이미 예외로 표시함 */
  reason: 'median' | 'p90' | 'marked';
  /** 카테고리 한 달 중앙값 대비 배수 (중앙값이 0 이면 null) */
  ratio: number | null;
  /** 지금 가계부에 예외로 저장돼 있는지 */
  marked: boolean;
}

/** 예외 표시 초안: 지출 id → 예외인지 (없으면 지금 저장된 값 그대로) */
export type ExclusionDraft = Readonly<Record<Id, boolean>>;

const isMarked = (e: Expense) => e.excluded === true;

/** 예외 후보 (금액 큰 순 10건 + 이미 표시한 것, 금액 큰 순). 이벤트통장이 없으면 [] */
export function findExceptionCandidates(data: LedgerData, today: ISODate): ExceptionCandidate[] {
  const acc = firstAccountByRole(data, 'event');
  if (!acc) return [];
  const since = addMonths(monthOf(today), -EXCEPTION_LOOKBACK_MONTHS);
  const all = eventRecords(data, acc.id, { scope: 'unplanned' });
  const recent = all.filter((r) => r.record.date <= today && compareMonth(r.month, since) >= 0).map((r) => r.record);

  // 카테고리별 기준: 한 달 합의 중앙값(쓴 달만) · 한 건 P90 · 한 건 중앙값
  const byCat = new Map<Id | null, Expense[]>();
  for (const e of recent) byCat.set(e.categoryId ?? null, [...(byCat.get(e.categoryId ?? null) ?? []), e]);
  const stats = new Map<Id | null, { monthly: number; p90: number; single: number }>();
  for (const [cat, list] of byCat) {
    const months = new Map<YearMonth, Won>();
    for (const e of list) months.set(monthOf(e.date), (months.get(monthOf(e.date)) ?? 0) + e.amount);
    const singles = list.map((e) => e.amount).sort((a, b) => a - b);
    stats.set(cat, {
      monthly: percentile([...months.values()].sort((a, b) => a - b), 0.5),
      p90: singles.length >= EXCEPTION_PERCENTILE_MIN ? percentile(singles, EXCEPTION_PERCENTILE) : Infinity,
      single: percentile(singles, 0.5),
    });
  }

  const names = new Map(data.categories.map((c) => [c.id, c.name]));
  const describe = (e: Expense): ExceptionCandidate => {
    const s = stats.get(e.categoryId ?? null);
    const ratio = s && s.monthly > 0 ? e.amount / s.monthly : null;
    const reason: ExceptionCandidate['reason'] =
      ratio !== null && ratio >= EXCEPTION_MEDIAN_RATIO
        ? 'median'
        : s && e.amount >= s.p90 && e.amount > s.single
          ? 'p90'
          : 'marked';
    const name = e.memo.trim() || (e.categoryId !== null ? names.get(e.categoryId) : undefined) || '이벤트 지출';
    const original = data.expenses.find((x) => x.id === e.id) ?? e;
    return { expense: original, name, reason, ratio, marked: isMarked(e) };
  };

  const byAmount = (a: ExceptionCandidate, b: ExceptionCandidate) =>
    b.expense.amount - a.expense.amount || (a.expense.date < b.expense.date ? 1 : a.expense.date > b.expense.date ? -1 : 0);
  const found = recent
    .filter((e) => !isMarked(e))
    .map(describe)
    .filter((c) => c.reason !== 'marked')
    .sort(byAmount)
    .slice(0, EXCEPTION_LIMIT);
  const marked = all.map((r) => r.record).filter(isMarked).map(describe);
  return [...found, ...marked].sort(byAmount);
}

/** 초안 중 지금 저장된 값과 다른 것만 (없는 · 지운 지출은 뺀다) */
export function effectiveExclusions(data: LedgerData, draft: ExclusionDraft): { id: Id; excluded: boolean }[] {
  const out: { id: Id; excluded: boolean }[] = [];
  for (const [id, excluded] of Object.entries(draft)) {
    const e = data.expenses.find((x) => x.id === id && !x.deleted);
    if (e && isMarked(e) !== excluded) out.push({ id, excluded });
  }
  return out;
}

/** 초안을 덮어씌운 가계부 (원본은 그대로). 바뀌는 게 없으면 원본 그대로 */
export function applyExclusions(data: LedgerData, draft: ExclusionDraft): LedgerData {
  const list = effectiveExclusions(data, draft);
  if (list.length === 0) return data;
  const next = new Map(list.map((c) => [c.id, c.excluded]));
  return {
    ...data,
    expenses: data.expenses.map((e) => {
      if (!next.has(e.id)) return e;
      const { excluded: _old, ...rest } = e;
      return next.get(e.id) ? { ...rest, excluded: true } : rest;
    }),
  };
}

/** 초안대로 뺀 예측 */
export function projectWithExclusions(data: LedgerData, today: ISODate, draft: ExclusionDraft): EventProjection {
  return projectEventAccount(applyExclusions(data, draft), today);
}

/** 예측 기간 평소 쓰는 돈의 한 달 평균 (원 단위 반올림) */
export function averageUsual(p: EventProjection): Won {
  if (p.months.length === 0) return 0;
  return Math.round(p.months.reduce((s, m) => s + m.usual, 0) / p.months.length);
}

/**
 * 미리 보기 한 줄: '평소 쓰는 돈 한 달 평균 62만원 → 48만원 · 4월 부족이 없어져요 · 2027년 10월 예상 잔액 +40만원'
 */
export function exclusionPreviewMessage(before: EventProjection, after: EventProjection, today: ISODate): string {
  const baseYear = Number(today.slice(0, 4));
  const label = (m: YearMonth) => (m === monthOf(today) ? '이번 달' : formatMonthKo(m, baseYear));
  const parts = [`평소 쓰는 돈 한 달 평균 ${manWon(averageUsual(before))} → ${manWon(averageUsual(after))}`];
  const afterShort = new Set(after.shortages.map((s) => s.month));
  const beforeShort = new Set(before.shortages.map((s) => s.month));
  const resolved = before.shortages.filter((s) => !afterShort.has(s.month)).map((s) => s.month);
  const added = after.shortages.filter((s) => !beforeShort.has(s.month));
  if (resolved.length > 0) {
    const months = resolved.length <= 2 ? resolved.map(label).join(' · ') : `${label(resolved[0]!)} 등 ${resolved.length}개월`;
    parts.push(`${months} 부족이 없어져요`);
  }
  if (added.length > 0) parts.push(`${label(added[0]!.month)}에 ${manWon(added[0]!.amount)} 모자라게 돼요`);
  const lastB = before.months[before.months.length - 1];
  const lastA = after.months[after.months.length - 1];
  if (lastA && lastB) {
    const delta = lastA.endBalance - lastB.endBalance;
    const rounded = Math.round(delta / 1000) * 1000;
    if (rounded !== 0) parts.push(`${label(lastA.month)} 예상 잔액 ${rounded > 0 ? '+' : '−'}${manWon(delta)}`);
  }
  return parts.join(' · ');
}
