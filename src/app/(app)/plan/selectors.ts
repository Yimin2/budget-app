/* 이벤트 화면에서 쓰는 순수 함수. 화면과 떼어 테스트해요. */
import { formatDateKo, formatManShort, formatMonthKo, formatShortDate, monthOf } from '@/domain';
import type {
  EventMonthUsage,
  MonthSpentClaims,
  SettlementSummary,
  Category,
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

/* ───────── 평소 쓰는 돈 카드 ───────── */

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

/* ───────── 12개월 막대 ───────── */


/* ───────── 범위 (아끼면 / 많이 쓰면) ───────── */
