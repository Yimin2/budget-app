/* 이벤트 화면에서 쓰는 순수 함수. 화면과 떼어 테스트해요. */
import { dateInMonth, formatDateKo, formatMan, formatManShort, formatMonthKo, formatShortDate, formatWon, manWon, monthOf, nextOccurrenceDate } from '@/domain';
import type {
  EventMonthUsage,
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
  ShortageFix,
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

/* ───────── 이번 달 카드 ───────── */

/**
 * '이번 달' 카드의 정산 한 줄 (PLAN 4-9): '11/21 정산 30만 · 저수지에서 빌려 2.4만' /
 * '이번 달 정산할 돈은 없어요 · 다음 정산 12/1 2.4만'. 이벤트통장에서 줄 수 있는 돈에 안 들어 넘어가는 청구는 따로
 * carry: '못 준 돈 55만 → 다음 달 (민구)' (사람이 하나면 이름, 둘이면 이름과 금액)
 */
export function settleLineText(u: EventMonthUsage, sum: SettlementSummary): { text: string; carry: string | null } {
  const parts: string[] = [];
  if (sum.total <= 0) parts.push('이번 달 정산할 돈은 없어요');
  if (u.plannedClaims > 0) parts.push(`${formatShortDate(sum.date)} 정산 ${formatMan(u.plannedClaims)}`);
  if (sum.fromFixed > 0) parts.push(`생활비 통장에서 ${formatMan(sum.fromFixed)}`);
  if (sum.fromReservoir > 0) parts.push(`저수지에서 ${formatMan(sum.fromReservoir)}`);
  if (sum.borrow > 0) parts.push(`저수지에서 빌려 ${formatMan(sum.borrow)}`);
  if (sum.total <= 0 && sum.next) parts.push(`다음 정산 ${formatShortDate(sum.next.date)} ${formatMan(sum.next.amount)}`);
  let carry: string | null = null;
  if (u.unpaid > 0) {
    const who =
      u.unpaidPeople.length === 1
        ? ` (${u.unpaidPeople[0]!.name})`
        : u.unpaidPeople.length === 2
          ? ` (${u.unpaidPeople.map((p) => `${p.name} ${formatMan(p.amount)}`).join(' · ')})`
          : '';
    carry = `못 준 돈 ${formatMan(u.unpaid)} → 다음 달${who}`;
  }
  return { text: parts.join(' · '), carry };
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

/** 돌려주기 묶음 한 줄: '지난 지출 돌려주기 67.2만 (9~10월에 쓴 것 3건)'. 돌려줄 게 없으면 null */
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
  return `${head} (${span}에 쓴 것 ${list.length}건)`;
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

/**
 * 다가오는 달 한 줄을 두 토막으로: head = '12월 · 37.2만'(그달 나갈 돈 합, 굵게), tail = '결혼식 2건 · 돌려주기 30만'
 * (일정이 없으면 큰 항목 이름. 지난 지출 돌려주기는 나갈 돈에 섞지 않고 '돌려주기 ○'로 뒤에)
 */
export function aheadMonthSummary(m: ProjectionMonth, today: ISODate): { head: string; tail: string } {
  const items = aheadMonthItems(m);
  const { total, repay } = aheadTotals(m);
  const head = `${monthLabel(m.month, today)} · ${formatManShort(total)}`;
  const names =
    m.events.length > 0
      ? summarizeEventNames(m.events.map((e) => e.name))
      : items
          .filter((i) => i.kind !== 'usual' && isNewSpend(i))
          .slice(0, 2)
          .map((i) => i.label)
          .join(' · ');
  const tail = [names, repay > 0 ? `돌려주기 ${formatManShort(repay)}` : ''].filter(Boolean).join(' · ');
  return { head, tail };
}

/** 다가오는 달 한 줄: '12월 · 37.2만 · 결혼식 2건 · 돌려주기 30만' */
export function aheadMonthLine(m: ProjectionMonth, today: ISODate): string {
  const { head, tail } = aheadMonthSummary(m, today);
  return tail ? `${head} · ${tail}` : head;
}

/**
 * 고른 달 맨 위 합계 줄 (PLAN 4-2): '11월 나갈 돈 합계 87.8만' + 아래 작은 줄 '새로 나갈 돈 20.6만 · 지난 지출 돌려주기 67.2만'.
 * 이번 달은 '이번 달 나갈 돈 87.8만' + '이미 나간 돈 10만 + 앞으로 77.8만' (spentSoFar = 1일부터 오늘까지 통장에서 나간 돈)
 */
export function aheadTotalLines(
  m: ProjectionMonth,
  today: ISODate,
  spentSoFar: Won | null,
): { title: string; split: string | null; parts: string | null } {
  const { spend, repay, total } = aheadTotals(m);
  const parts = repay > 0 ? `새로 나갈 돈 ${formatManShort(spend)} · 지난 지출 돌려주기 ${formatManShort(repay)}` : null;
  if (m.month === monthOf(today) && spentSoFar !== null) {
    const all = spentSoFar + total;
    return {
      title: `이번 달 나갈 돈 ${formatManShort(all)}`,
      split: `이미 나간 돈 ${formatManShort(spentSoFar)} + 앞으로 ${formatManShort(total)}`,
      parts,
    };
  }
  return { title: `${monthLabel(m.month, today)} 나갈 돈 합계 ${formatManShort(total)}`, split: null, parts };
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

export interface ShortageSummary {
  month: YearMonth;
  amount: Won;
  /** '4월에 300,000원 모자라요' */
  title: string;
  /** '결혼식 4건 · 어버이날' (그달 일정이 없으면 '') */
  names: string;
  /** 첫 부족 달 말고 더 모자라는 달 수 */
  others: number;
  isThisMonth: boolean;
}

/** 첫 번째로 모자라는 달 요약. 부족이 없으면 null */
export function shortageSummary(projection: EventProjection | null, today: ISODate): ShortageSummary | null {
  if (!projection || projection.shortages.length === 0) return null;
  const first = projection.shortages[0]!;
  const m = projection.months.find((x) => x.month === first.month);
  const isThisMonth = first.month === monthOf(today);
  const label = monthLabel(first.month, today, '이번 달');
  return {
    month: first.month,
    amount: first.amount,
    title: `${label}에 ${formatWon(first.amount)} 모자라요`,
    names: m ? summarizeEventNames(m.events.map((e) => e.name)) : '',
    others: projection.shortages.length - 1,
    isThisMonth,
  };
}

export interface FixChoiceText {
  title: string;
  description: string;
  /** 보조 줄 (예: '매달 300,000원 → 360,000원') */
  note: string | null;
  /** 고르면 안 되는 이유 (있으면 고를 수 없어요) */
  blocked: string | null;
}

/** ① 지금부터 매달 적립액 늘리기 */
export function increaseChoiceText(
  fix: NonNullable<ShortageFix['increaseMonthly']>,
  today: ISODate,
  currentContribution: Won,
): FixChoiceText {
  const from = monthLabel(fix.fromMonth, today);
  const to = monthLabel(fix.toMonth, today);
  return {
    title: `지금부터 매달 적립액 +${formatWon(fix.amount)}`,
    description:
      fix.fromMonth === fix.toMonth || fix.times <= 1
        ? `${to} 적립 한 번으로 채워요`
        : `${from}부터 ${to}까지 ${fix.times}번에 나눠 채워요`,
    note:
      currentContribution > 0
        ? `매달 ${formatWon(currentContribution)} → ${formatWon(currentContribution + fix.amount)}`
        : null,
    blocked: null,
  };
}

/** ② 그달에 저수지에서 옮기기 */
export function reservoirChoiceText(fix: NonNullable<ShortageFix['fromReservoir']>, today: ISODate): FixChoiceText {
  const label = monthLabel(fix.month, today, '이번 달');
  const after = fix.reservoirProjected - fix.amount;
  return {
    title: `${label}에 저수지에서 ${formatWon(fix.amount)} 옮기기`,
    description: `저수지 예상 잔액 ${formatWon(fix.reservoirProjected)}`,
    note: after >= 0 ? `옮긴 뒤 저수지 ${formatWon(after)}` : null,
    blocked: after < 0 ? `저수지 예상 잔액이 ${formatWon(-after)} 모자라서 고를 수 없어요` : null,
  };
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

/** 처음 고를 달: 첫 부족 달 → 이번 달 */
export function initialMonth(projection: EventProjection, today: ISODate): YearMonth | null {
  if (projection.months.length === 0) return null;
  const first = projection.shortages[0]?.month;
  if (first) return first;
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

