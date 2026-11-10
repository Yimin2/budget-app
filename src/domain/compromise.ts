/**
 * PLAN 4-2 '추천 타협안' — 평소 쓰는 돈과 적립 카드 (정보만, 바꾸는 버튼 없음).
 *
 * - 필요 적립 = 최근 평균 평소 쓰는 돈(예외 뺀) + 앞으로 예측 기간(12개월) 등록한 일정(매년 · 음력 반복 펼침, 여행 남은 예산 포함)
 *   한 달 평균, 만 원 단위 올림. 여유분은 붙이지 않는다
 * - 지금 적립(이벤트통장으로 들어오는 매달 배분 합)이 필요 적립보다 적으면 그만큼 올리라고 안내한다
 * - 저수지 빚(loanStatus 의 갚을 돈)은 기본 24개월(12 · 18 · 24 · 36)로 나눠 갚는다. 한 달 갚을 돈 = 빚 ÷ 개월, 천 원 단위 올림
 * - 적립을 필요보다 더 올리면 배분의 '남는 돈 → 저수지'가 그만큼 줄어 저수지 돈으로 저수지 빚을 갚는 것과 같다.
 *   그래서 갚을 돈은 쓰는 돈(평소 쓰는 돈 카테고리)을 줄여서 마련한다:
 *   ① 최근 3개월 평균이 1년(최근 12개월) 평균보다 많은 카테고리의 넘는 만큼부터 ② 남은 금액은 평소 쓰는 돈(최근 6개월 평균)에 비례.
 *   카테고리마다 천 원 단위, 합은 한 달 갚을 돈과 같게(큰 나머지 순). 그 카테고리 평소 쓰는 돈보다 많이 줄이지는 않는다
 * - 확인: 다음 달부터 필요 적립 · 줄인 쓰는 돈(그달 평소 쓰는 돈까지) · 갚을 돈을 넣고 12개월 예측을 다시 본다
 */
import { addMonths, formatMonthKo, monthOf } from './dates';
import { projectEventAccount } from './events';
import { formatMan } from './money';
import { manWon, recentHistoryMonths, recentUsualAverage, usualHistory, usualSpendingInsight, type UsualHistory } from './usual';
import type { EventProjection, Id, LedgerData, Shortage, Won, YearMonth } from './types';

/** 저수지 빚을 나눠 갚는 개월 수 선택지 */
export const REPAY_MONTH_OPTIONS = [12, 18, 24, 36] as const;
export type RepayMonths = (typeof REPAY_MONTH_OPTIONS)[number];
export const DEFAULT_REPAY_MONTHS: RepayMonths = 24;
/** '평소보다 많이 쓰는지'를 볼 때 최근 달 수 · 긴 기간 달 수 */
export const CUT_RECENT_MONTHS = 3;
export const CUT_LONG_MONTHS = 12;

/** 저장된 값이 선택지가 아니면 기본 24개월 */
export function normalizeRepayMonths(v: unknown): RepayMonths {
  const n = typeof v === 'string' ? Number(v) : v;
  return (REPAY_MONTH_OPTIONS as readonly unknown[]).includes(n) ? (n as RepayMonths) : DEFAULT_REPAY_MONTHS;
}

/** 만 원 단위 올림 */
export function ceilTo10000(n: Won): Won {
  if (!Number.isFinite(n)) return 0;
  return Math.ceil(n / 10000) * 10000 + 0;
}

/** 필요 적립 = 평소 쓰는 돈 + 등록한 일정 한 달 평균, 만 원 단위 올림 */
export function requiredContribution(monthlyUsual: Won, monthlyPlanned: Won): Won {
  return ceilTo10000(Math.max(0, monthlyUsual) + Math.max(0, monthlyPlanned));
}

/** 한 달 갚을 돈 = 빚 ÷ 개월, 천 원 단위 올림 (빚이 없으면 0) */
export function monthlyRepayment(balance: Won, months: number): Won {
  if (balance <= 0 || months <= 0) return 0;
  return Math.ceil(balance / months / 1000) * 1000;
}

/** '적립이 실제 필요보다 월 5만원 적어요 → 월 55만원으로 올려야 해요' (모자라지 않으면 null) */
export function raiseMessage(current: Won, required: Won): string | null {
  if (current >= required) return null;
  return `적립이 실제 필요보다 월 ${manWon(required - current)} 적어요 → 월 ${manWon(required)}으로 올려야 해요`;
}

/** '저수지 빚을 24개월에 갚으려면 쓰는 돈을 월 16만원 줄여야 해요' */
export function cutMessage(months: number, monthlyCut: Won): string {
  return `저수지 빚을 ${months}개월에 갚으려면 쓰는 돈을 월 ${manWon(monthlyCut)} 줄여야 해요`;
}

interface Weighted<K> {
  key: K;
  weight: number;
  /** 줄 수 있는 최대 단위 수 */
  cap: number;
}

/**
 * total 단위를 weight 에 비례해 나눈다 (정수 단위, 각자 cap 까지, 남은 단위는 큰 나머지 순 → 무게 큰 순 → 앞 순).
 * cap 합이 total 보다 작으면 cap 만큼만 나눈다
 */
export function allocateUnits<K>(total: number, items: Weighted<K>[]): Map<K, number> {
  const out = new Map<K, number>(items.map((i) => [i.key, 0]));
  let remaining = Math.max(0, Math.floor(total));
  let active = items.filter((i) => i.weight > 0 && i.cap > 0);
  while (remaining > 0 && active.length > 0) {
    const w = active.reduce((s, i) => s + i.weight, 0);
    const share = (i: Weighted<K>) => (remaining * i.weight) / w;
    const full = active.filter((i) => share(i) >= i.cap - out.get(i.key)!);
    if (full.length > 0) {
      for (const i of full) {
        remaining -= i.cap - out.get(i.key)!;
        out.set(i.key, i.cap);
      }
      active = active.filter((i) => !full.includes(i));
      continue;
    }
    const parts = active.map((i, idx) => ({ i, idx, s: share(i), f: Math.floor(share(i)) }));
    let left = remaining;
    for (const p of parts) {
      out.set(p.i.key, out.get(p.i.key)! + p.f);
      left -= p.f;
    }
    parts.sort((a, b) => b.s - b.f - (a.s - a.f) || b.i.weight - a.i.weight || a.idx - b.idx);
    for (let k = 0; k < left; k++) out.set(parts[k]!.i.key, out.get(parts[k]!.i.key)! + 1);
    remaining = 0;
  }
  return out;
}

export interface CategoryCut {
  categoryId: Id | null;
  name: string;
  /** 한 달에 줄일 금액 (천 원 단위) */
  amount: Won;
  /** 최근 6개월 평균 평소 쓰는 돈 */
  usual: Won;
  /** 최근 3개월 평균이 1년 평균보다 많은 만큼 (아니면 0) */
  over: Won;
}

export interface CutPlan {
  cuts: CategoryCut[];
  /** 나눈 합 */
  total: Won;
  /** 평소 쓰는 돈을 다 줄여도 못 나눈 금액 */
  unallocated: Won;
}

function averageOver(history: UsualHistory, months: YearMonth[]): Map<Id | null, Won> {
  const sum = new Map<Id | null, Won>();
  for (const m of months) for (const [c, v] of history.byMonth.get(m) ?? []) sum.set(c, (sum.get(c) ?? 0) + v);
  const out = new Map<Id | null, Won>();
  if (months.length === 0) return out;
  for (const [c, v] of sum) out.set(c, v / months.length);
  return out;
}

/**
 * 한 달 갚을 돈을 카테고리별 줄일 금액으로 (천 원 단위).
 * ① 최근 3개월 평균이 1년 평균보다 많은 카테고리의 넘는 만큼 ② 남은 금액은 최근 6개월 평균 평소 쓰는 돈에 비례.
 * 1년 평균은 다 지난 기록 달이 최근 3개월보다 많을 때만 본다
 */
export function allocateCuts(data: LedgerData, eventAccountId: Id, thisMonth: YearMonth, monthlyCut: Won): CutPlan {
  const history = usualHistory(data, eventAccountId);
  const usual = recentUsualAverage(history, thisMonth);
  const recentMonths = recentHistoryMonths(history, thisMonth, CUT_RECENT_MONTHS);
  const longMonths = recentHistoryMonths(history, thisMonth, CUT_LONG_MONTHS);
  const recent = averageOver(history, recentMonths);
  const long = longMonths.length > recentMonths.length ? averageOver(history, longMonths) : new Map<Id | null, Won>();
  const keys = [...usual.keys()].filter((c) => (usual.get(c) ?? 0) > 0);
  const over = new Map<Id | null, Won>();
  for (const c of keys) {
    if (long.size === 0) continue;
    over.set(c, Math.max(0, Math.round((recent.get(c) ?? 0) - (long.get(c) ?? 0))));
  }
  const units = Math.max(0, Math.round(monthlyCut / 1000));
  const capOf = (c: Id | null) => Math.floor((usual.get(c) ?? 0) / 1000);
  const first = allocateUnits(
    units,
    keys.map((c) => ({ key: c, weight: over.get(c) ?? 0, cap: Math.min(capOf(c), Math.round((over.get(c) ?? 0) / 1000)) })),
  );
  const firstSum = [...first.values()].reduce((s, v) => s + v, 0);
  const second = allocateUnits(
    units - firstSum,
    keys.map((c) => ({ key: c, weight: usual.get(c) ?? 0, cap: capOf(c) - (first.get(c) ?? 0) })),
  );
  const names = new Map(data.categories.map((c) => [c.id, c.name]));
  const cuts: CategoryCut[] = keys
    .map((c) => ({
      categoryId: c,
      name: (c !== null ? names.get(c) : undefined) ?? '기타',
      amount: ((first.get(c) ?? 0) + (second.get(c) ?? 0)) * 1000,
      usual: usual.get(c) ?? 0,
      over: over.get(c) ?? 0,
    }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount || b.usual - a.usual);
  const total = cuts.reduce((s, x) => s + x.amount, 0);
  return { cuts, total, unallocated: Math.max(0, units * 1000 - total) };
}

export interface CompromisePlan {
  /** 예측 개월 수 (보통 12) */
  horizon: number;
  monthlyUsual: Won;
  monthlyPlanned: Won;
  /** 필요 적립 (만 원 단위 올림) */
  required: Won;
  /** 지금 매달 적립 */
  current: Won;
  /** 올려야 할 금액 (필요 − 지금, 모자라지 않으면 0) */
  raise: Won;
  /** 추천 적립 = max(지금, 필요) */
  recommended: Won;
  /** 저수지에 갚을 돈 */
  loanBalance: Won;
  repayMonths: number;
  /** 한 달 갚을 돈 (천 원 단위 올림) */
  monthlyRepay: Won;
  cut: CutPlan;
  /** 추천대로 했을 때 12개월 예측의 모자라는 달 */
  shortages: Shortage[];
  raiseMessage: string | null;
  /** 저수지 빚이 없으면 null */
  cutMessage: string | null;
  /** 평소 쓰는 돈을 다 줄여도 모자라면 '평소 쓰는 돈을 모두 줄여도 월 2만원이 모자라요' (아니면 null) */
  cutGapMessage: string | null;
  /** 남는 부족 안내 ('2027년 3월에 12만원 모자라요', 없으면 null) */
  shortageMessage: string | null;
  summary: string;
}

/**
 * 추천 타협안. 이벤트통장이 없거나 평소 쓰는 돈 기록이 없으면 null (평소 쓰는 돈과 적립 카드도 보이지 않는다)
 */
export function recommendCompromise(
  data: LedgerData,
  today: string,
  projection: EventProjection,
  opts: { loanBalance: Won; repayMonths?: number },
): CompromisePlan | null {
  const insight = usualSpendingInsight(data, today, projection);
  if (!insight || !projection.accountId) return null;
  const thisMonth = monthOf(today);
  const horizon = projection.months.length;
  const required = requiredContribution(insight.monthlyUsual, insight.monthlyPlanned);
  const current = projection.monthlyContribution;
  const raise = Math.max(0, required - current);
  const recommended = current + raise;
  const loanBalance = Math.max(0, opts.loanBalance);
  const repayMonths = opts.repayMonths ?? DEFAULT_REPAY_MONTHS;
  const monthlyRepay = monthlyRepayment(loanBalance, repayMonths);
  const cut = monthlyRepay > 0 ? allocateCuts(data, projection.accountId, thisMonth, monthlyRepay) : { cuts: [], total: 0, unallocated: 0 };

  // 다음 달부터: + 올린 적립 + 줄인 쓰는 돈(그달 평소 쓰는 돈까지) − 갚을 돈. extras 는 나가는 돈이라 부호를 바꿔 넣는다
  const nextMonth = addMonths(thisMonth, 1);
  const extras = projection.months
    .filter((m) => m.month >= nextMonth)
    .map((m) => ({ month: m.month, amount: monthlyRepay - raise - Math.min(cut.total, m.usual) }))
    .filter((x) => x.amount !== 0);
  const after = extras.length > 0 ? projectEventAccount(data, today, { horizonMonths: horizon, extras }) : projection;
  const shortages = after.shortages;
  const first = shortages[0] ?? null;
  const year = Number(today.slice(0, 4));
  const label = (m: YearMonth) => (m === thisMonth ? '이번 달' : formatMonthKo(m, year));
  const shortageMessage = first ? `추천대로 해도 ${label(first.month)}에 ${manWon(first.amount)} 모자라요` : null;

  const parts = [`추천: 적립 월 ${formatMan(recommended)}${raise > 0 ? `(+${formatMan(raise)})` : ' 그대로'}`];
  if (cut.total > 0) parts.push(`쓰는 돈 월 ${formatMan(cut.total)} 줄이기`);
  let summary = parts.join(' · ');
  summary += first ? ` → ${label(first.month)}에 ${formatMan(first.amount)} 부족` : ` → ${horizon}개월 부족 없음`;
  if (monthlyRepay > 0) summary += ` · 저수지 빚 ${formatMan(loanBalance)}을 ${repayMonths}개월에 갚아요`;

  return {
    horizon,
    monthlyUsual: insight.monthlyUsual,
    monthlyPlanned: insight.monthlyPlanned,
    required,
    current,
    raise,
    recommended,
    loanBalance,
    repayMonths,
    monthlyRepay,
    cut,
    shortages,
    raiseMessage: raiseMessage(current, required),
    cutMessage: monthlyRepay > 0 ? cutMessage(repayMonths, monthlyRepay) : null,
    cutGapMessage: cut.unallocated > 0 ? `평소 쓰는 돈을 모두 줄여도 월 ${manWon(cut.unallocated)}이 모자라요` : null,
    shortageMessage,
    summary,
  };
}
