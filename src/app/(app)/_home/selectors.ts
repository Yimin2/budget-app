/* 홈 · 사도 돼? 화면에서 쓰는 순수 함수. 화면과 떼어 테스트해요. */
import { formatMonthKo, formatWon, monthOf, parseWon } from '@/domain';
import type {
  Account, AccountRole, Category, EventProjection, Expense, Id, ISODate, LedgerData, ProjectionMonth, Won,
} from '@/domain';

/* ───────── 이벤트 일정 ───────── */

export interface UpcomingEvent {
  id: Id;
  name: string;
  date: ISODate;
  amount: Won;
  /** 날짜가 지났는데 아직 예정 상태 */
  overdue: boolean;
}

/** 예측에 들어간 예정 일정(반복 펼침 포함)을 날짜순으로 앞에서 n 개. 날짜가 지난 예정 일정이 맨 앞에 와요 */
export function upcomingEvents(projection: EventProjection | null, today: ISODate, n = 3): UpcomingEvent[] {
  if (!projection) return [];
  const seen = new Set<string>();
  const all: UpcomingEvent[] = [];
  for (const m of projection.months) {
    for (const e of m.events) {
      const key = `${e.id}@${e.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push({ ...e, overdue: e.date < today });
    }
  }
  all.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name, 'ko') : a.date < b.date ? -1 : 1));
  return all.slice(0, n);
}

/**
 * 일정 이름 요약. 끝 낱말이 같은 일정은 묶어요.
 * ['지수 결혼식', '민수 결혼식', '어버이날'] → '결혼식 2건 · 어버이날'. 묶음이 셋 이상이면 '… 외 N건'
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

/** 홈 부족 알림 문구. 부족이 없으면 null */
export function shortageBannerText(
  projection: EventProjection | null,
  today: ISODate,
): { title: string; description: string } | null {
  if (!projection || projection.shortages.length === 0) return null;
  const baseYear = Number(monthOf(today).slice(0, 4));
  const first = projection.shortages[0]!;
  const title = `${formatMonthKo(first.month, baseYear)}에 이벤트통장이 ${formatWon(first.amount)} 모자라요`;
  const month = projection.months.find((m) => m.month === first.month);
  const names = month ? summarizeEventNames(month.events.map((e) => e.name)) : '';
  const others = projection.shortages.length - 1;
  const parts = [names, others > 0 ? `다른 ${others}개월도 모자라요` : ''].filter(Boolean);
  return { title, description: parts.length > 0 ? parts.join(' · ') : '미리 채워 두면 걱정 없어요' };
}

/* ───────── 지출 ───────── */

/** 최근 지출 n 개 (날짜 → 기록 시각 내림차순, 지운 것 빼고) */
export function recentExpenses(data: LedgerData | null, n = 5): Expense[] {
  if (!data) return [];
  return data.expenses
    .filter((e) => !e.deleted)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    })
    .slice(0, n);
}

/** 지출 한 줄 제목: 내용 → 카테고리 이름 → '지출' */
export function expenseTitle(expense: Expense, categories: Category[]): string {
  const memo = expense.memo.trim();
  if (memo) return memo;
  const cat = expense.categoryId ? categories.find((c) => c.id === expense.categoryId) : undefined;
  return cat?.name ?? '지출';
}

/* ───────── 통장 고르기 ───────── */

export type Source = 'living' | 'event';

/**
 * 어느 돈으로 살지에 따라 기록할 통장.
 * living: 생활비 통장 → 고정지출 통장 → (개인 가계부) 용돈 통장 / event: 이벤트 통장
 */
export function accountIdForSource(
  source: Source,
  livingAccountId: Id | null,
  accountByRole: (role: AccountRole) => Account | null,
): Id | null {
  if (source === 'event') return accountByRole('event')?.id ?? null;
  return livingAccountId ?? accountByRole('fixed')?.id ?? accountByRole('allowance')?.id ?? null;
}

/** 카테고리의 기본 통장 역할로 고른 통장 (fixed 는 생활비 통장 우선) */
export function accountIdForCategory(
  category: Category,
  livingAccountId: Id | null,
  accountByRole: (role: AccountRole) => Account | null,
): Id | null {
  if (category.defaultAccountRole === 'event') return accountByRole('event')?.id ?? null;
  if (category.defaultAccountRole === 'fixed') return livingAccountId ?? accountByRole('fixed')?.id ?? null;
  return accountByRole(category.defaultAccountRole)?.id ?? null;
}

/** 카테고리를 고르면 바뀌는 돈의 종류 */
export function sourceForCategory(category: Category): Source {
  return category.defaultAccountRole === 'event' ? 'event' : 'living';
}

/* ───────── 사도 돼? 금액 ───────── */

export const QUICK_AMOUNTS: { value: Won; label: string }[] = [
  { value: 5_000, label: '5,000원' },
  { value: 10_000, label: '1만원' },
  { value: 30_000, label: '3만원' },
  { value: 50_000, label: '5만원' },
  { value: 100_000, label: '10만원' },
];

export const STEP_AMOUNTS: { value: Won; label: string }[] = [
  { value: 10_000, label: '+1만원' },
  { value: 100_000, label: '+10만원' },
];

/** 금액 상한 (MoneyInput 과 같은 999조) */
export const MAX_AMOUNT = 999_999_999_999_999;

/** ?amount= 값 ('12000', '12,000원', '2만') → 양의 정수 원. 아니면 null */
export function parseAmountParam(value: string | null | undefined): Won | null {
  if (!value) return null;
  const n = parseWon(value);
  if (n === null || !(n > 0)) return null;
  return Math.min(n, MAX_AMOUNT);
}

/* ───────── 12개월 막대 ───────── */

export interface BarGeometry {
  month: string;
  value: Won;
  /** 기준선 위 막대 높이(px) */
  pos: number;
  /** 기준선 아래 막대 높이(px) */
  neg: number;
}

export interface ChartGeometry {
  /** 기준선 위 칸 높이(px) */
  posArea: number;
  /** 기준선 아래 칸 높이(px). 음수 달이 없으면 0 */
  negArea: number;
  bars: BarGeometry[];
}

/**
 * 막대 높이 계산. 위·아래 칸을 값 비율로 나누고(위 칸 최소 minPos), 같은 배율로 그려요.
 * 0 이 아닌 값은 최소 2px 이 보여요.
 */
export function chartGeometry(
  months: Pick<ProjectionMonth, 'month' | 'endBalance'>[],
  opts: { height?: number; minPos?: number; minNeg?: number } = {},
): ChartGeometry {
  const height = opts.height ?? 88;
  const minPos = opts.minPos ?? 24;
  const minNeg = opts.minNeg ?? 20;
  const values = months.map((m) => (Number.isFinite(m.endBalance) ? m.endBalance : 0));
  const posMax = Math.max(0, ...values);
  const negMax = Math.max(0, ...values.map((v) => -v));

  let posArea = height;
  let negArea = 0;
  if (negMax > 0) {
    const ratio = posMax / (posMax + negMax);
    posArea = Math.round(height * ratio);
    posArea = Math.min(height - minNeg, Math.max(minPos, posArea));
    negArea = height - posArea;
  }
  const scales = [posMax > 0 ? posArea / posMax : Infinity, negMax > 0 ? negArea / negMax : Infinity];
  const scale = Math.min(...scales);
  const px = (v: number) => (v === 0 || !Number.isFinite(scale) ? 0 : Math.max(2, Math.round(Math.abs(v) * scale)));

  return {
    posArea,
    negArea,
    bars: months.map((m, i) => {
      const v = values[i]!;
      return { month: m.month, value: v, pos: v > 0 ? Math.min(posArea, px(v)) : 0, neg: v < 0 ? Math.min(negArea, px(v)) : 0 };
    }),
  };
}

/* ───────── 오류 문구 ───────── */

/** 상태 계층이 던진 오류의 한국어 문구. 없으면 fallback */
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message.trim()) return e.message;
  if (typeof e === 'string' && e.trim()) return e;
  return fallback;
}
