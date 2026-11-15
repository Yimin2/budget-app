/* 이벤트 화면에서 쓰는 순수 함수. 화면과 떼어 테스트해요. */
import { dateInMonth, formatDateKo, formatMan, formatManShort, formatMonthKo, formatShortDate, manWon, monthOf, nextOccurrenceDate } from '@/domain';
import type {
  EventMonthUsage,
  MonthSpentClaims,
  ThisMonthSpending,
  LedgerData,
  SettlementSummary,
  Category,
  EventProjection,
  Expense,
  Id,
  ISODate,
  PlannedEvent,
  ProjectionMonth,
  Repeat,
  Won,
  YearMonth,
} from '@/domain';

/* ───────── 공통 ───────── */

export function errorText(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message.trim()) return e.message;
  if (typeof e === 'string' && e.trim()) return e;
  return fallback;
}

export function baseYearOf(today: ISODate): number {
  return Number(today.slice(0, 4));
}

/** '2027-04' → 오늘과 같은 해면 '4월', 다르면 '2027년 4월', 이번 달이면 '이번 달' (thisMonthWord 를 줄 때) */
export function monthLabel(month: YearMonth, today: ISODate, thisMonthWord?: string): string {
  if (thisMonthWord && month === monthOf(today)) return thisMonthWord;
  return formatMonthKo(month, baseYearOf(today));
}

/** '2027-01-14' → 같은 해면 '1월 14일 목요일', 다른 해면 '2027년 1월 14일 목요일' */
export function dateLabel(date: ISODate, today: ISODate, withWeekday = true): string {
  const base = formatDateKo(date, withWeekday);
  return date.slice(0, 4) === today.slice(0, 4) ? base : `${Number(date.slice(0, 4))}년 ${base}`;
}

const WEEKDAY_SHORT = ['일', '월', '화', '수', '목', '금', '토'];

/** '2026-11-14' → '토' */
export function weekdayShort(date: ISODate): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return WEEKDAY_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
}

export const REPEAT_LABEL: Record<Repeat, string> = { none: '반복 안 함', monthly: '매월', yearly: '매년' };

export const REPEAT_OPTIONS: { value: Repeat; label: string }[] = [
  { value: 'none', label: '안 함' },
  { value: 'monthly', label: '매월' },
  { value: 'yearly', label: '매년' },
];

/* ───────── 맨 위 숫자 띠 ───────── */

export interface SettleTileText {
  /** '11/21 정산' */
  label: string;
  /** 이번에 이벤트통장 등에서 실제로 줄 돈 (넘어가는 돈 뺀 것, 만 단위). 돌려줄 날이 된 청구가 없으면 null → '정산할 돈 없어요' */
  value: string | null;
  /** '생활비 통장에서 2.4만 · 저수지에서 빌려 2.4만' / '다음 정산 12/1 2.4만' (없으면 null) */
  note: string | null;
  /** '못 준 돈 55만 → 다음 달 (민구)' (사람이 하나면 이름, 둘이면 이름과 금액) */
  carry: string | null;
}

/**
 * 숫자 띠 세 번째 칸 '11/21 정산 32.4만' (PLAN 4-9). 줄 돈 = 정산 기준일까지 돌려줄 날이 된 청구 합 (settlementSummary.total).
 * 그중 이벤트통장 밖에서 나가는 돈은 아래 작은 줄로. 줄 돈이 없으면 '정산할 돈 없어요' + 다음 정산.
 * 이벤트통장에서 줄 수 있는 돈에 안 들어 넘어가는 청구는 따로 carry
 */
export function settleTileText(u: Pick<EventMonthUsage, 'unpaid' | 'unpaidPeople'> | null, sum: SettlementSummary | null, date: ISODate): SettleTileText {
  const label = `${formatShortDate(sum?.date ?? date)} 정산`;
  if (!sum || sum.total <= 0) {
    return {
      label,
      value: null,
      note: sum?.next ? `다음 정산 ${formatShortDate(sum.next.date)} ${formatManShort(sum.next.amount)}` : null,
      carry: null,
    };
  }
  const parts: string[] = [];
  if (sum.fromFixed > 0) parts.push(`생활비 통장에서 ${formatManShort(sum.fromFixed)}`);
  if (sum.fromReservoir > 0) parts.push(`저수지에서 ${formatManShort(sum.fromReservoir)}`);
  if (sum.borrow > 0) parts.push(`저수지에서 빌려 ${formatManShort(sum.borrow)}`);
  let carry: string | null = null;
  if (u && u.unpaid > 0) {
    const who =
      u.unpaidPeople.length === 1
        ? ` (${u.unpaidPeople[0]!.name})`
        : u.unpaidPeople.length === 2
          ? ` (${u.unpaidPeople.map((p) => `${p.name} ${formatManShort(p.amount)}`).join(' · ')})`
          : '';
    carry = `못 준 돈 ${formatManShort(u.unpaid)} → 다음 달${who}`;
  }
  // 이번에 실제로 줄 돈 = 정산일까지 돌려줄 날이 된 청구 − 다음 달로 넘어가는 돈 (넘어가는 돈은 carry 로 따로)
  const payNow = Math.max(0, sum.total - (u?.unpaid ?? 0));
  return { label, value: formatManShort(payNow), note: parts.length > 0 ? parts.join(' · ') : null, carry };
}

/** 숫자 띠 네 번째 칸: 12개월 중 처음으로 모자라는 달 (없으면 null) */
export function firstShortMonth(projection: EventProjection): ProjectionMonth | null {
  return projection.months.find((m) => m.endBalance < 0) ?? null;
}

/** 12개월 중 가장 많이 모자라는 달 (없으면 null) */
export function worstShortMonth(projection: EventProjection): ProjectionMonth | null {
  let worst: ProjectionMonth | null = null;
  for (const m of projection.months) if (m.endBalance < 0 && (!worst || m.endBalance < worst.endBalance)) worst = m;
  return worst;
}

/* ───────── 평소 쓰는 돈 카드 ───────── */

/**
 * ② 추천 타협안 칩의 짧은 머리말: '적립 70만 + 선물 −5만' (줄일 카테고리가 여럿이면 가장 큰 것 + '외 2개'),
 * 줄일 것이 없으면 '적립 70만'
 */
export function compromiseHeadline(plan: { recommended: Won; cut: { cuts: { name: string; amount: Won }[] } }): string {
  const head = `적립 ${formatMan(plan.recommended)}`;
  const cuts = plan.cut.cuts.filter((c) => c.amount > 0);
  if (cuts.length === 0) return head;
  const top = cuts.reduce((a, b) => (b.amount > a.amount ? b : a), cuts[0]!);
  return `${head} + ${top.name} −${formatMan(top.amount)}${cuts.length > 1 ? ` 외 ${cuts.length - 1}개` : ''}`;
}

/* ───────── 앞으로 12개월 카드: 고른 달 항목 ───────── */

/** 평소 쓰는 돈 근거 (예측 usualBasis) */
export const USUAL_BASIS_NOTE: Record<'lastYear' | 'recent', string> = {
  lastYear: '작년 30% + 평균 70%, 일정 뺀 뒤',
  recent: '최근 평균, 일정 뺀 뒤',
};

export type AheadItemKind = 'event' | 'trip' | 'installment' | 'scheduled' | 'claims' | 'extra' | 'transferOut' | 'usual';

export interface AheadItem {
  key: string;
  kind: AheadItemKind;
  label: string;
  amount: Won;
  /** 일정 날짜 */
  date?: ISODate;
  /** 여행 id (여행 화면 링크) */
  tripId?: Id;
  /** 평소 쓰는 돈 근거 같은 작은 설명 */
  note?: string;
  /** 지난 지출 돌려주기: 낸 사람 */
  payer?: string;
}

/**
 * 예측 한 달에서 나갈 돈 항목 (PLAN 4-2). 두 묶음:
 * - 새로 나갈 돈: 일정(날짜순) → 여행 남은 예산 → 할부(이름별, 없으면 한 줄) → 미리 기록한 지출 → 살까 하는 지출 → 옮겨 갈 돈 → 평소 쓰는 돈(근거 설명)
 * - 지난 지출 돌려주기(kind 'claims', 늘 맨 뒤): 개인 돈으로 이미 쓴 돈을 통장에서 돌려주는 것. 한 건씩 '10월에 쓴 것 · 민지'
 * 금액이 0 인 줄은 빼요. installments 는 eventMonthlyCosts 의 그달 할부 줄 (합이 예측과 다르면 '할부' 한 줄로)
 */
export function aheadMonthItems(m: ProjectionMonth, installments: { key: string; label: string; amount: Won }[] = []): AheadItem[] {
  const items: AheadItem[] = m.events.map((e, i) => ({ key: `ev:${e.id}@${e.date}@${i}`, kind: 'event', label: e.name, amount: e.amount, date: e.date }));
  for (const t of m.tripList ?? []) items.push({ key: `trip:${t.id}`, kind: 'trip', label: t.name, amount: t.amount, tripId: t.id, note: '여행 남은 예산' });
  const inst = m.installments ?? 0;
  if (inst > 0) {
    const sum = installments.reduce((s, x) => s + x.amount, 0);
    if (installments.length > 0 && sum === inst) {
      for (const x of installments) items.push({ key: `inst:${x.key}`, kind: 'installment', label: x.label, amount: x.amount, note: '할부' });
    } else items.push({ key: 'inst', kind: 'installment', label: '할부', amount: inst });
  }
  if ((m.scheduledSpending ?? 0) > 0) items.push({ key: 'scheduled', kind: 'scheduled', label: '미리 기록한 지출', amount: m.scheduledSpending! });
  if (m.extra > 0) items.push({ key: 'extra', kind: 'extra', label: '살까 하는 지출', amount: m.extra });
  if (m.transfersOut > 0) items.push({ key: 'out', kind: 'transferOut', label: '옮겨 갈 돈', amount: m.transfersOut });
  if (m.usual > 0) {
    items.push({ key: 'usual', kind: 'usual', label: '평소 쓰는 돈', amount: m.usual, note: USUAL_BASIS_NOTE[m.usualBasis ?? 'recent'] });
  }
  const claims = m.claims ?? 0;
  if (claims > 0) {
    const list = m.claimList ?? [];
    const base = baseYearOf(`${m.month}-01`);
    if (list.length > 0 && list.reduce((s, c) => s + c.amount, 0) === claims) {
      for (const c of list) {
        items.push({
          key: `claim:${c.expenseId}`,
          kind: 'claims',
          label: `${formatMonthKo(monthOf(c.spentDate), base)}에 쓴 것 · ${c.payer}`,
          amount: c.amount,
          date: c.spentDate,
          payer: c.payer,
        });
      }
    } else items.push({ key: 'claims', kind: 'claims', label: '지난 지출 돌려주기', amount: claims });
  }
  return items;
}

/** 새로 나갈 돈 묶음인지 (지난 지출 돌려주기가 아니면) */
export function isNewSpend(item: Pick<AheadItem, 'kind'>): boolean {
  return item.kind !== 'claims';
}

export interface AheadTotals {
  /** 새로 나갈 돈 */
  spend: Won;
  /** 지난 지출 돌려주기 */
  repay: Won;
  /** 합 (spend + repay) */
  total: Won;
}

/** 그달 나갈 돈 합: 새로 나갈 돈 · 지난 지출 돌려주기 · 합 (예측 계산과 같은 금액) */
export function aheadTotals(m: ProjectionMonth): AheadTotals {
  const items = aheadMonthItems(m);
  const spend = items.filter(isNewSpend).reduce((s, i) => s + i.amount, 0);
  const repay = m.claims ?? 0;
  return { spend, repay, total: spend + repay };
}

/** 그달 나갈 돈 합 (aheadMonthItems 합) */
export function aheadOutflow(m: ProjectionMonth): Won {
  return aheadTotals(m).total;
}

/** 돌려주기 묶음 한 줄: '지난 지출 돌려주기 67.2만 · 3건 (9~10월에 쓴 것)'. 돌려줄 게 없으면 null */
export function repaySummary(m: ProjectionMonth): string | null {
  const total = m.claims ?? 0;
  if (total <= 0) return null;
  const list = m.claimList ?? [];
  const head = `지난 지출 돌려주기 ${formatManShort(total)}`;
  if (list.length === 0) return head;
  const months = list.map((c) => monthOf(c.spentDate)).sort();
  const base = baseYearOf(`${m.month}-01`);
  const lo = months[0]!;
  const hi = months[months.length - 1]!;
  const span =
    lo === hi
      ? formatMonthKo(lo, base)
      : lo.slice(0, 4) === hi.slice(0, 4) && Number(lo.slice(0, 4)) === base
        ? `${Number(lo.slice(5, 7))}~${formatMonthKo(hi, base)}`
        : `${formatMonthKo(lo, base)}~${formatMonthKo(hi, base)}`;
  return `${head} · ${list.length}건 (${span}에 쓴 것)`;
}

/** 돌려주기 묶음 낸 사람별 합 (많은 순, 3명 넘으면 '외 N명'): '민구 420만 · 기쁜 20만'. 한 건씩 목록이 없으면 null */
export function repayPayersLine(m: ProjectionMonth, max = 3): string | null {
  const list = m.claimList ?? [];
  if (list.length === 0) return null;
  const by = new Map<string, Won>();
  for (const c of list) by.set(c.payer, (by.get(c.payer) ?? 0) + c.amount);
  const sorted = [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  const shown = sorted.slice(0, max).map(([p, a]) => `${p} ${formatManShort(a)}`);
  if (sorted.length > max) shown.push(`외 ${sorted.length - max}명`);
  return shown.join(' · ');
}

export interface RepayMonthGroup {
  /** 쓴 달 */
  month: YearMonth;
  /** '10월' (다른 해면 '2025년 10월') */
  label: string;
  count: number;
  amount: Won;
  /** 쓴 날 순 */
  items: AheadItem[];
}

/** 돌려주기 항목을 쓴 달로 묶어요 (오래된 달 먼저, 달 안은 쓴 날 순). 합은 항목 합 그대로. 날짜 없는 한 줄(합만)은 빈 목록 */
export function repayByMonth(items: AheadItem[], m: Pick<ProjectionMonth, 'month'>): RepayMonthGroup[] {
  const base = baseYearOf(`${m.month}-01`);
  const map = new Map<YearMonth, AheadItem[]>();
  for (const i of items) {
    if (i.kind !== 'claims' || !i.date) continue;
    const k = monthOf(i.date);
    map.set(k, [...(map.get(k) ?? []), i]);
  }
  return [...map]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([month, list]) => ({
      month,
      label: formatMonthKo(month, base),
      count: list.length,
      amount: list.reduce((s, i) => s + i.amount, 0),
      items: [...list].sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0)),
    }));
}

/** 긴 목록 줄이기: limit 줄을 넘으면 앞 keep 줄만 보이고 나머지 수 (새로 나갈 돈 6 → 5, 돌려주기 달마다 5) */
export function capList<T>(list: T[], limit: number, keep = limit): { shown: T[]; more: number } {
  if (list.length <= limit) return { shown: list, more: 0 };
  return { shown: list.slice(0, keep), more: list.length - keep };
}

/** 그달 들어오는 쪽 한 줄: '달 시작 잔액 50만 · 적립 +30만 · 옮겨 올 돈 +30만' (이번 달은 '지금 잔액' · '아직 안 들어온 적립') */
export function aheadInflowText(m: ProjectionMonth, isThisMonth: boolean): string {
  const parts = [`${isThisMonth ? '지금 잔액' : '달 시작 잔액'} ${formatManShort(m.startBalance)}`];
  if (m.contributions !== 0) {
    parts.push(`${isThisMonth ? '아직 안 들어온 적립' : '적립'} ${m.contributions > 0 ? '+' : '−'}${formatManShort(Math.abs(m.contributions))}`);
  }
  if (m.transfersIn > 0) parts.push(`옮겨 올 돈 +${formatManShort(m.transfersIn)}`);
  return parts.join(' · ');
}

/** 쓸 돈(예정)으로 세는 항목인지: 일정 · 할부 · 미리 기록 · 살까 하는 지출 · 평소 쓰는 돈. 여행은 따로, 돌려주기 · 옮겨 갈 돈은 통장에서 나갈 돈 */
export function isPlannedSpend(item: Pick<AheadItem, 'kind'>): boolean {
  return item.kind !== 'trip' && item.kind !== 'claims' && item.kind !== 'transferOut';
}

export interface AheadSpendSplit {
  /** 쓸 돈 (예정) 항목 */
  spend: AheadItem[];
  spendTotal: Won;
  /** 여행 남은 예산 (따로 세요) */
  trips: AheadItem[];
  tripTotal: Won;
  /** 통장에서 나갈 돈: 지난 지출 돌려주기 · 옮겨 갈 돈 (쓴 돈이 아니에요) */
  outflow: AheadItem[];
  repay: Won;
  transferOut: Won;
}

/**
 * 앞으로 달 항목을 셋으로 (PLAN 4-2): 그달 쓸 돈(예정) · 여행 · 통장에서 나갈 돈(지난 지출 돌려주기 · 옮겨 갈 돈).
 * 세 합을 더하면 예측이 그달 빼는 돈(aheadTotals.total)과 같아요
 */
export function aheadSpendSplit(m: ProjectionMonth, installments: { key: string; label: string; amount: Won }[] = []): AheadSpendSplit {
  const items = aheadMonthItems(m, installments);
  const spend = items.filter(isPlannedSpend);
  const trips = items.filter((i) => i.kind === 'trip');
  const outflow = items.filter((i) => i.kind === 'claims' || i.kind === 'transferOut');
  const sum = (list: AheadItem[]) => list.reduce((s, i) => s + i.amount, 0);
  return {
    spend,
    spendTotal: sum(spend),
    trips,
    tripTotal: sum(trips),
    outflow,
    repay: m.claims ?? 0,
    transferOut: m.transfersOut,
  };
}

/**
 * 다가오는 달 한 줄을 두 토막으로: head = '12월 · 37.2만'(그달 쓸 돈, 굵게), tail = '결혼식 2건 · 여행 40만 · 돌려주기 30만'
 * (일정이 없으면 큰 항목 이름). 여행 · 지난 지출 돌려주기는 쓸 돈에 섞지 않고 뒤에 '여행 ○' · '돌려주기 ○'.
 * 이번 달은 spentTotal(이번 달 쓴 돈 = 지금까지 + 예정, 숫자 띠와 같은 합)을 넘겨요
 */
export function aheadMonthSummary(m: ProjectionMonth, today: ISODate, spentTotal: Won | null = null): { head: string; tail: string } {
  const split = aheadSpendSplit(m);
  const head = `${monthLabel(m.month, today)} · ${formatManShort(spentTotal ?? split.spendTotal)}`;
  const names =
    m.events.length > 0
      ? summarizeEventNames(m.events.map((e) => e.name))
      : split.spend
          .filter((i) => i.kind !== 'usual')
          .slice(0, 2)
          .map((i) => i.label)
          .join(' · ');
  const tail = [
    names,
    split.tripTotal > 0 ? `여행 ${formatManShort(split.tripTotal)}` : '',
    split.repay > 0 ? `돌려주기 ${formatManShort(split.repay)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return { head, tail };
}

/** 다가오는 달 한 줄: '12월 · 37.2만 · 결혼식 2건 · 돌려주기 30만' */
export function aheadMonthLine(m: ProjectionMonth, today: ISODate, spentTotal: Won | null = null): string {
  const { head, tail } = aheadMonthSummary(m, today, spentTotal);
  return tail ? `${head} · ${tail}` : head;
}

/** 고른 달 맨 위 합계 줄 (PLAN 4-2). title 은 굵게, split · trip 은 아래 작은 줄 */
export interface SpendLines {
  title: string;
  split: string | null;
  trip: string | null;
}

/** 이번 달: '이번 달 쓴 돈 87.8만' + '= 지금까지 10만 + 예정 77.8만' + '여행 40만' (숫자 띠 '이번 달 쓴 돈'과 같은 합) */
export function thisMonthSpendLines(t: Pick<ThisMonthSpending, 'spent' | 'planned' | 'total' | 'trip'>): SpendLines {
  return {
    title: `이번 달 쓴 돈 ${formatManShort(t.total)}`,
    split: `지금까지 ${formatManShort(t.spent)} + 예정 ${formatManShort(t.planned)}`,
    trip: t.trip > 0 ? `여행 ${formatManShort(t.trip)}` : null,
  };
}

/** 앞으로 달: '12월 쓸 돈 (예정) 37.2만' + '여행 40만' */
export function futureSpendLines(m: ProjectionMonth, today: ISODate): SpendLines {
  const split = aheadSpendSplit(m);
  return {
    title: `${monthLabel(m.month, today)} 쓸 돈 (예정) ${formatManShort(split.spendTotal)}`,
    split: null,
    trip: split.tripTotal > 0 ? `여행 ${formatManShort(split.tripTotal)}` : null,
  };
}

/** 지난 달: '9월 쓴 돈 37.2만' */
export function pastSpendTitle(month: YearMonth, today: ISODate, total: Won): string {
  return `${monthLabel(month, today)} 쓴 돈 ${formatManShort(total)}`;
}

export interface ClaimBadge {
  text: string;
  tone: 'warning' | 'success' | 'info';
}

/**
 * 쓴 돈 줄의 청구 정산 상태 배지 (정산 화면과 같은 색): 줄 돈(주황) · '11/10 지급'(초록) · 저수지에서 빌려 줌(파랑).
 * 줄 전체가 한 상태면 글자만, 여러 상태가 섞이면 상태마다 금액을 붙여요. 청구가 없으면 빈 목록
 */
export function claimBadges(c: MonthSpentClaims | null, amount: Won): ClaimBadge[] {
  if (!c) return [];
  const kinds = [c.pending, c.paid, c.borrowed].filter((x) => x > 0).length;
  const whole = kinds === 1 && c.pending + c.paid + c.borrowed === amount;
  const tail = (x: Won) => (whole ? '' : ` ${formatManShort(x)}`);
  const out: ClaimBadge[] = [];
  if (c.pending > 0) out.push({ text: `줄 돈${tail(c.pending)}`, tone: 'warning' });
  if (c.paid > 0) out.push({ text: `${c.paidOn ? `${formatShortDate(c.paidOn)} 지급` : '지급함'}${tail(c.paid)}`, tone: 'success' });
  if (c.borrowed > 0) out.push({ text: `저수지에서 빌려 줌${tail(c.borrowed)}`, tone: 'info' });
  return out;
}

/* ───────── 일정 목록 ───────── */

function byDateAsc(a: PlannedEvent, b: PlannedEvent): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.name.localeCompare(b.name, 'ko');
}

export interface MonthGroup {
  month: YearMonth;
  events: PlannedEvent[];
  total: Won;
}

export interface EventSections {
  /** 날짜가 지났는데 아직 예정인 일정 (오래된 것부터) */
  overdue: PlannedEvent[];
  /** 오늘 이후(오늘 포함) 예정 일정, 달별 */
  upcoming: MonthGroup[];
  /** 완료 · 취소된 일정 (최근 것부터) */
  past: PlannedEvent[];
  /** 지우지 않은 일정 수 */
  total: number;
}

/** 지운 일정은 빼고 예정(지난 것 / 다가오는 것) · 지난 일정으로 나눠요 */
export function sectionEvents(events: PlannedEvent[], today: ISODate): EventSections {
  const live = events.filter((e) => !e.deleted);
  const planned = live.filter((e) => e.status === 'planned').sort(byDateAsc);
  const overdue = planned.filter((e) => e.date < today);
  const upcoming: MonthGroup[] = [];
  for (const e of planned) {
    if (e.date < today) continue;
    const month = monthOf(e.date);
    let g = upcoming[upcoming.length - 1];
    if (!g || g.month !== month) {
      g = { month, events: [], total: 0 };
      upcoming.push(g);
    }
    g.events.push(e);
    g.total += e.amount;
  }
  const past = live
    .filter((e) => e.status !== 'planned')
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.name.localeCompare(b.name, 'ko')));
  return { overdue, upcoming, past, total: live.length };
}

/** 일정 id → 그 일정으로 기록한 지출 합 (지운 지출 빼고) */
export function spentByEvent(expenses: Expense[]): Map<Id, Won> {
  const map = new Map<Id, Won>();
  for (const x of expenses) {
    if (x.deleted || !x.eventId) continue;
    map.set(x.eventId, (map.get(x.eventId) ?? 0) + x.amount);
  }
  return map;
}

/** 일정에 고를 카테고리: 이벤트통장에서 나가는 카테고리. 하나도 없으면(개인 가계부 등) 전부 */
export function eventCategories(categories: Category[]): Category[] {
  const live = categories.filter((c) => !c.deleted).sort((a, b) => a.order - b.order);
  const ev = live.filter((c) => c.defaultAccountRole === 'event');
  return ev.length > 0 ? ev : live;
}

/** 완료할 때 기본 날짜: 일정 날짜가 지났으면 그날, 아니면 오늘 */
export function defaultCompleteDate(event: PlannedEvent, today: ISODate): ISODate {
  return event.date <= today ? event.date : today;
}

/** 반복 일정의 다음 회차 날짜 (상태 계층과 같은 규칙: 말일보다 크면 말일, anchorDay 가 있으면 그 일 기준). 반복이 아니면 null */
export function nextOccurrence(date: ISODate, repeat: Repeat, anchorDay?: number): ISODate | null {
  return nextOccurrenceDate(date, repeat, anchorDay);
}

/* ───────── 부족 알림 ───────── */

/**
 * 일정 이름 요약. 끝 낱말이 같은 일정은 묶어요.
 * ['지수 결혼식', '민수 결혼식', '어버이날'] → '결혼식 2건 · 어버이날'. 묶음이 maxGroups 보다 많으면 '… 외 N건'
 */
export function summarizeEventNames(names: string[], maxGroups = 2): string {
  const groups: { key: string; names: string[] }[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const parts = name.split(/\s+/);
    const key = parts.length > 1 ? parts[parts.length - 1]! : name;
    const g = groups.find((x) => x.key === key);
    if (g) g.names.push(name);
    else groups.push({ key, names: [name] });
  }
  const labels = groups.map((g) => (g.names.length > 1 ? `${g.key} ${g.names.length}건` : g.names[0]!));
  if (labels.length <= maxGroups) return labels.join(' · ');
  const restCount = groups.slice(maxGroups).reduce((s, g) => s + g.names.length, 0);
  return `${labels.slice(0, maxGroups).join(' · ')} 외 ${restCount}건`;
}

/**
 * 고른 달이 모자랄 때 상세 맨 위 한 줄: '2027년 4월에 30만 모자라요 · 결혼식 4건 · 어버이날' (그달 일정이 없으면 이름 없이).
 * 모자라지 않으면 null
 */
export function monthShortLine(m: Pick<ProjectionMonth, 'month' | 'endBalance' | 'events'>, today: ISODate): string | null {
  if (m.endBalance >= 0) return null;
  const names = summarizeEventNames(m.events.map((e) => e.name));
  return `${monthLabel(m.month, today, '이번 달')}에 ${formatManShort(-m.endBalance)} 모자라요${names ? ` · ${names}` : ''}`;
}

/* ───────── 12개월 막대 ───────── */

/** 막대 아래 짧은 금액: -300000 → { sign: '-', num: '30', unit: '만' } */
export function compactWon(n: Won): { sign: string; num: string; unit: string } {
  const r = Math.round(Number.isFinite(n) ? n : 0);
  const sign = r < 0 ? '-' : '';
  const abs = Math.abs(r);
  const trim = (v: number) => String(Math.round(v * 10) / 10);
  if (abs >= 100_000_000) return { sign, num: trim(abs / 100_000_000), unit: '억' };
  if (abs >= 100_000) return { sign, num: String(Math.round(abs / 10_000)), unit: '만' };
  if (abs >= 10_000) return { sign, num: trim(abs / 10_000), unit: '만' };
  if (abs >= 1_000) return { sign, num: trim(abs / 1_000), unit: '천' };
  return { sign, num: String(abs), unit: '원' };
}

export interface Bar {
  month: YearMonth;
  value: Won;
  /** 기준선 위 막대 높이(px) */
  pos: number;
  /** 기준선 아래 막대 높이(px) */
  neg: number;
}

export interface BarsGeometry {
  /** 기준선 위 칸 높이(px) */
  posArea: number;
  /** 기준선 아래 칸 높이(px, 금액 글자 자리 포함). 음수 달이 없으면 0 */
  negArea: number;
  bars: Bar[];
  /** 1원당 px (값 → 높이). 그릴 값이 없으면 0 */
  scale: number;
}

/**
 * 막대 높이. 위·아래 칸을 값 비율로 나누고 같은 배율로 그려요.
 * 기준선 아래에는 모자라는 금액 글자 자리(labelRoom)를 남겨요. 0 이 아닌 값은 최소 2px.
 */
export function barsGeometry(
  months: Pick<ProjectionMonth, 'month' | 'endBalance'>[],
  opts: { height?: number; labelRoom?: number; minPos?: number; extent?: number[] } = {},
): BarsGeometry {
  const height = opts.height ?? 144;
  const labelRoom = opts.labelRoom ?? 22;
  const minPos = opts.minPos ?? 20;
  const values = months.map((m) => (Number.isFinite(m.endBalance) ? m.endBalance : 0));
  // extent: 막대 말고도 칸 안에 그려야 할 값 (아끼면 · 많이 쓰면 범위)
  const all = [...values, ...(opts.extent ?? []).filter((v) => Number.isFinite(v))];
  const posMax = Math.max(0, ...all);
  const negMax = Math.max(0, ...all.map((v) => -v));

  let posArea = height;
  let negArea = 0;
  let scale: number;
  if (negMax > 0) {
    const avail = Math.max(0, height - labelRoom);
    posArea = posMax > 0 ? Math.round((avail * posMax) / (posMax + negMax)) : 0;
    posArea = Math.min(avail - 8, Math.max(minPos, posArea));
    const negBars = avail - posArea;
    negArea = height - posArea;
    scale = Math.min(posMax > 0 ? posArea / posMax : Infinity, negBars / negMax);
  } else {
    scale = posMax > 0 ? posArea / posMax : 0;
  }
  const px = (v: number) =>
    v === 0 || !Number.isFinite(scale) || scale <= 0 ? 0 : Math.max(2, Math.round(Math.abs(v) * scale));
  return {
    posArea,
    negArea,
    scale: Number.isFinite(scale) && scale > 0 ? scale : 0,
    bars: months.map((m, i) => {
      const v = values[i]!;
      return { month: m.month, value: v, pos: v > 0 ? px(v) : 0, neg: v < 0 ? px(v) : 0 };
    }),
  };
}

/** 처음 고를 달: 이번 달 (예측에 없으면 첫 달) */
export function initialMonth(projection: EventProjection, today: ISODate): YearMonth | null {
  if (projection.months.length === 0) return null;
  const now = monthOf(today);
  return projection.months.find((m) => m.month === now)?.month ?? projection.months[0]!.month;
}

/** 다음 달 적립이 이번 달과 다르면 그 금액 (적립액을 바꾼 직후 안내용). 같으면 null */
export function nextContribution(projection: EventProjection): Won | null {
  const next = projection.months[1];
  if (!next) return null;
  return next.contributions !== projection.monthlyContribution ? next.contributions : null;
}

/** 예측에 평소 쓰는 돈이 들어간 달이 있는지 (설명 문구를 보일지) */
export function hasUsual(projection: EventProjection): boolean {
  return projection.months.some((m) => m.usual > 0);
}

/** 평소 쓰는 돈 카테고리 줄: '경조사 35만 · 선물 15만 · 여행 12만' */
export function usualCategoriesText(top: { name: string; amount: Won }[]): string {
  return top.map((c) => `${c.name} ${manWon(c.amount).replace(/원$/, '')}`).join(' · ');
}

/* ───────── 범위 (아끼면 / 많이 쓰면) ───────── */

/** 예측에 범위 폭이 있는지 (기록이 없으면 띠 없이 보통 선만) */
export function hasRange(projection: EventProjection): boolean {
  const r = projection.range;
  return Boolean(r && r.months.length === projection.months.length && (r.spreadLow > 0 || r.spreadHigh > 0));
}

/** 범위를 어떻게 정했는지 한 줄 */
export function rangeNote(projection: EventProjection): string | null {
  const r = projection.range;
  if (!r || !hasRange(projection)) return null;
  const how =
    r.method === 'percentile'
      ? `지난 ${r.points}개월 기록 중 가운데 절반(25~75%)`
      : `지난 ${r.points}개월 기록의 표준편차`;
  return `띠는 평소 쓰는 돈을 아끼면 · 많이 쓰면이에요. ${how}만큼 넓혔어요`;
}

/** 값(원) → 차트 칸 위에서부터 px (0 ~ 칸 높이로 자름) */
export function yOf(geo: Pick<BarsGeometry, 'posArea' | 'negArea' | 'scale'>, value: Won): number {
  const y = geo.posArea - value * geo.scale;
  return Math.min(geo.posArea + geo.negArea, Math.max(0, y));
}

