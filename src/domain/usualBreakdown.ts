/**
 * PLAN 4-2 '평소 쓰는 돈과 적립' 카드의 그림 — 도넛 · 적립 대비 막대 · 항목별 평균 표 (정보만).
 *
 * - 기록 · 기간은 카드의 '평소 쓰는 돈'과 같다: 이벤트통장 평소 지출(일정 · 여행 · 고정 지출 자동 기록 · 예외 표시 뺌,
 *   저수지에서 빌려 낸 이벤트 청구 포함, usualHistory)의 다 지난 기록 달 중 최근 12개월(recentHistoryMonths)
 * - 항목(카테고리)마다 월 평균 = 기간 합 ÷ 기간 달 수 (원 단위 반올림, recentUsualAverage 와 같음). 그래서 '전체'의 합은
 *   카드의 평소 쓰는 돈(usualSpendingInsight.monthlyUsual)과 같다
 * - 건수 = 기간 안의 지출 건수, 건당 = 기간 합 ÷ 건수. 지난달 = 지난달 그 항목 합, 화살표는 지난달과 월 평균을 천 원 단위로 견준다
 * - 사람 고르기: 실제로 쓴 사람(expenseSpender)의 키로 거른다. 거르면 월 평균 · 건수 · 도넛이 그 사람 것만 된다
 * - 도넛: 월 평균이 큰 항목 5개 + 나머지는 '기타' 하나
 */
import { addMonths, monthOf } from './dates';
import { ledgerPeople, type LedgerPerson } from './people';
import { expenseSpender } from './spender';
import { asEventRecord, isUsualEventExpense, recentHistoryMonths, usualHistory } from './usual';
import type { Id, ISODate, LedgerData, Shortage, Won, YearMonth } from './types';

/** 도넛에서 색으로 보이는 항목 수 (나머지는 '기타') */
export const USUAL_DONUT_TOP = 5;
/** 카테고리가 빈 지출의 이름 */
export const USUAL_NO_CATEGORY = '분류 없음';

export interface UsualBreakdownItem {
  id: Id;
  date: ISODate;
  amount: Won;
  memo: string;
  /** 실제로 쓴 사람 키 · 이름 */
  spenderKey: string;
  spenderName: string;
}

export type UsualTrend = 'up' | 'down' | 'same';

export interface UsualBreakdownRow {
  categoryId: Id | null;
  name: string;
  /** 월 평균 (원 단위 반올림) */
  monthly: Won;
  /** 기간 합 */
  sum: Won;
  /** 기간 안의 건수 */
  count: number;
  /** 건당 평균 (원 단위 반올림) */
  perItem: Won;
  /** 지난달 합 */
  lastMonth: Won;
  /** 지난달이 월 평균보다 많은지 (천 원 단위) */
  trend: UsualTrend;
  /** 그 항목 지출 (최근 것 먼저) */
  items: UsualBreakdownItem[];
}

export interface UsualBreakdown {
  /** 평균에 쓴 달 (오래된 순) */
  months: YearMonth[];
  /** 월 평균 합 */
  monthlyTotal: Won;
  /** 월 평균이 큰 순 (같으면 이름 순) */
  rows: UsualBreakdownRow[];
}

/** 천 원 단위로 견준 화살표 방향 */
export function usualTrend(lastMonth: Won, monthly: Won): UsualTrend {
  const d = Math.round(lastMonth / 1000) - Math.round(monthly / 1000);
  return d > 0 ? 'up' : d < 0 ? 'down' : 'same';
}

/**
 * 평소 쓰는 돈 항목별 평균. spenderKey 를 주면 그 사람이 쓴 지출만 센다 (null · 빈 값 = 전체).
 * 다 지난 기록 달이 없으면 빈 결과
 */
export function usualBreakdown(
  data: LedgerData,
  eventAccountId: Id,
  today: ISODate,
  spenderKey: string | null = null,
): UsualBreakdown {
  const thisMonth = monthOf(today);
  const months = recentHistoryMonths(usualHistory(data, eventAccountId), thisMonth);
  if (months.length === 0) return { months, monthlyTotal: 0, rows: [] };
  const inPeriod = new Set(months);
  const lastMonth = addMonths(thisMonth, -1);
  const people = ledgerPeople(data);
  const names = new Map(data.categories.map((c) => [c.id, c.name]));

  const groups = new Map<Id | null, { items: UsualBreakdownItem[]; last: Won }>();
  for (const raw of data.expenses) {
    const e = asEventRecord(data, raw, eventAccountId);
    if (!e || !isUsualEventExpense(e, eventAccountId)) continue;
    const m = monthOf(e.date);
    if (!inPeriod.has(m)) continue;
    const who = expenseSpender(data, raw, people);
    if (spenderKey && who.key !== spenderKey) continue;
    const key = e.categoryId ?? null;
    const g = groups.get(key) ?? { items: [], last: 0 };
    g.items.push({ id: e.id, date: e.date, amount: e.amount, memo: e.memo, spenderKey: who.key, spenderName: who.name });
    if (m === lastMonth) g.last += e.amount;
    groups.set(key, g);
  }

  const rows: UsualBreakdownRow[] = [...groups.entries()].map(([categoryId, g]) => {
    const sum = g.items.reduce((s, i) => s + i.amount, 0);
    const monthly = Math.round(sum / months.length);
    const items = [...g.items].sort((a, b) => (a.date === b.date ? b.id.localeCompare(a.id) : b.date.localeCompare(a.date)));
    return {
      categoryId,
      name: (categoryId !== null ? names.get(categoryId) : undefined) ?? USUAL_NO_CATEGORY,
      monthly,
      sum,
      count: items.length,
      perItem: Math.round(sum / items.length),
      lastMonth: g.last,
      trend: usualTrend(g.last, monthly),
      items,
    };
  });
  rows.sort((a, b) => b.monthly - a.monthly || a.name.localeCompare(b.name, 'ko'));
  return { months, monthlyTotal: rows.reduce((s, r) => s + r.monthly, 0), rows };
}

export interface DonutSlice {
  /** 항목 키 ('기타' 묶음은 '_other') */
  key: string;
  name: string;
  amount: Won;
  /** 전체에서 차지하는 몫 (0~1) */
  share: number;
  /** 색 순서 (0~4), '기타'는 null (회색) */
  colorIndex: number | null;
}

/** 도넛 조각: 월 평균이 큰 항목 top 개 + 나머지 '기타' 하나. 0원 항목은 빼요 */
export function usualDonutSlices(rows: UsualBreakdownRow[], top = USUAL_DONUT_TOP): DonutSlice[] {
  const live = rows.filter((r) => r.monthly > 0);
  const total = live.reduce((s, r) => s + r.monthly, 0);
  if (total <= 0) return [];
  const head = live.slice(0, top);
  const rest = live.slice(top).reduce((s, r) => s + r.monthly, 0);
  const slices: DonutSlice[] = head.map((r, i) => ({
    key: r.categoryId ?? '_none',
    name: r.name,
    amount: r.monthly,
    share: r.monthly / total,
    colorIndex: i,
  }));
  if (rest > 0) slices.push({ key: '_other', name: '기타', amount: rest, share: rest / total, colorIndex: null });
  return slices;
}

export interface SavingsBar {
  /** short = 적립보다 많이 써요, enough = 적립으로 충분해요 */
  kind: 'short' | 'enough';
  contribution: Won;
  spending: Won;
  /** 적립을 넘는 몫 (short 일 때) */
  over: Won;
  /** 남는 몫 (enough 일 때) */
  left: Won;
  /** 막대 전체(둘 중 큰 쪽) 대비 적립 · 지출 비율 (0~1) */
  contributionRatio: number;
  spendingRatio: number;
  /** 이대로면 처음 바닥나는 달 (예측의 첫 모자라는 달, short 일 때만) */
  runOut: YearMonth | null;
}

/** 적립 대비 평소 지출 막대. 천 원 단위로 견줘요 */
export function savingsBar(contribution: Won, spending: Won, shortages: Shortage[] = []): SavingsBar {
  const c = Math.max(0, contribution);
  const s = Math.max(0, spending);
  const scale = Math.max(c, s, 1);
  const short = Math.round(s / 1000) > Math.round(c / 1000);
  return {
    kind: short ? 'short' : 'enough',
    contribution: c,
    spending: s,
    over: short ? s - c : 0,
    left: short ? 0 : Math.max(0, c - s),
    contributionRatio: c / scale,
    spendingRatio: s / scale,
    runOut: short ? (shortages[0]?.month ?? null) : null,
  };
}

/** 사람 고르기 선택지: 가계부의 사람 (키 = 실제로 쓴 사람 키). 두 사람 이상일 때만 고를 게 있어요 */
export function usualSpenderOptions(data: LedgerData, people: LedgerPerson[] = ledgerPeople(data)): { key: string; name: string }[] {
  return people.map((p) => ({ key: p.email.trim().toLowerCase(), name: p.name }));
}
