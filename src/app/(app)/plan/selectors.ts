/* 이벤트 화면에서 쓰는 순수 함수. 화면과 떼어 테스트해요. */
import { dateInMonth, formatDateKo, formatMonthKo, formatWon, manWon, monthOf, nextOccurrenceDate } from '@/domain';
import type {
  LedgerData,
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

export interface DetailRow {
  label: string;
  amount: Won;
  /** 더하기(+) · 빼기(-) · 그대로 */
  sign: '+' | '-' | '';
  /** 흐리게 보여 줄 줄 (추정치인 평소 쓰는 돈) */
  muted?: boolean;
}

/** 그달 계산 줄: 시작 잔액 + 적립 + 옮겨 올 돈 − 옮겨 갈 돈 − 예정 일정 − 평소 쓰는 돈 − 가정 지출 = 달 말 */
export function monthDetailRows(m: ProjectionMonth, isThisMonth: boolean): DetailRow[] {
  const rows: DetailRow[] = [{ label: isThisMonth ? '지금 잔액' : '달 시작 잔액', amount: m.startBalance, sign: '' }];
  if (m.contributions !== 0) {
    rows.push({
      label: isThisMonth ? '아직 안 들어온 적립' : '적립',
      amount: Math.abs(m.contributions),
      sign: m.contributions > 0 ? '+' : '-',
    });
  }
  if (m.transfersIn > 0) rows.push({ label: '옮겨 올 돈', amount: m.transfersIn, sign: '+' });
  if (m.transfersOut > 0) rows.push({ label: '옮겨 갈 돈', amount: m.transfersOut, sign: '-' });
  rows.push({ label: `예정 일정 ${m.events.length}건`, amount: m.planned, sign: m.planned > 0 ? '-' : '' });
  if (m.usual > 0) {
    rows.push({ label: m.usualBasis === 'lastYear' ? '평소 쓰는 돈 (작년 같은 달)' : '평소 쓰는 돈 (최근 평균)', amount: m.usual, sign: '-', muted: true });
  }
  if (m.scheduledSpending && m.scheduledSpending > 0) {
    rows.push({ label: '미리 기록한 지출', amount: m.scheduledSpending, sign: '-' });
  }
  if (m.claims && m.claims > 0) rows.push({ label: '돌려줄 돈 (개인 돈으로 낸 것)', amount: m.claims, sign: '-' });
  if (m.installments && m.installments > 0) rows.push({ label: '할부', amount: m.installments, sign: '-' });
  if (m.trips && m.trips > 0) rows.push({ label: '여행 남은 예산', amount: m.trips, sign: '-' });
  if (m.extra > 0) rows.push({ label: '살까 하는 지출', amount: m.extra, sign: '-' });
  return rows;
}

/** 12개월 동안 펼친 예정 일정 수와 합 */
export function projectionTotals(projection: EventProjection): { count: number; amount: Won } {
  return projection.months.reduce((s, m) => ({ count: s.count + m.events.length, amount: s.amount + m.planned }), {
    count: 0,
    amount: 0,
  });
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

