/* 지출 화면의 순수 함수. 화면과 떼어 테스트해요. */
import { compareMonth, isMonthActive, monthOf } from '@/domain';
import type { Account, AccountRole, Category, Expense, Id, ISODate, LedgerData, PlannedEvent, Won, YearMonth } from '@/domain/types';

/* ───────── 이번 달 지출 ───────── */

function compareDesc(a: Expense, b: Expense): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** 그달 지출 (지운 것 빼고), 날짜 → 기록 시각 최신순 */
export function monthExpenses(data: LedgerData, month: YearMonth): Expense[] {
  return data.expenses.filter((e) => !e.deleted && monthOf(e.date) === month).sort(compareDesc);
}

/** 고를 수 있는 달 범위: 가장 이른 지출 달(또는 이번 달) ~ 가장 늦은 지출 달(또는 이번 달) */
export function monthBounds(data: LedgerData, today: ISODate): { min: YearMonth; max: YearMonth } {
  let min = monthOf(today);
  let max = min;
  for (const e of data.expenses) {
    if (e.deleted) continue;
    const m = monthOf(e.date);
    if (compareMonth(m, min) < 0) min = m;
    if (compareMonth(m, max) > 0) max = m;
  }
  return { min, max };
}

/** 'YYYY-MM' → '2026년 11월' */
export function monthLabel(month: YearMonth): string {
  return `${Number(month.slice(0, 4))}년 ${Number(month.slice(5, 7))}월`;
}

/** ?month= 값이 'YYYY-MM' 이면 그대로, 아니면 null */
export function parseMonthParam(value: string | null | undefined): YearMonth | null {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  return value;
}

/* ───────── 필터 ───────── */

/** 카테고리 'none' = 카테고리 없는 지출 */
export interface ExpenseFilter {
  accountId: Id | null;
  categoryId: Id | 'none' | null;
  author: string | null;
}

export const EMPTY_FILTER: ExpenseFilter = { accountId: null, categoryId: null, author: null };

export function activeFilterCount(f: ExpenseFilter): number {
  return (f.accountId ? 1 : 0) + (f.categoryId ? 1 : 0) + (f.author ? 1 : 0);
}

export function applyFilter(list: Expense[], f: ExpenseFilter): Expense[] {
  return list.filter((e) => {
    if (f.accountId && e.accountId !== f.accountId) return false;
    if (f.categoryId === 'none' && e.categoryId !== null) return false;
    if (f.categoryId && f.categoryId !== 'none' && e.categoryId !== f.categoryId) return false;
    if (f.author && e.author.toLowerCase() !== f.author.toLowerCase()) return false;
    return true;
  });
}

/** 작성자 고르기 목록: 멤버(멤버 탭 순서) 다음에 멤버가 아닌 작성자 */
export function authorOptions(data: LedgerData, list: Expense[]): { email: string; name: string }[] {
  const out: { email: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const m of data.members) {
    const key = m.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ email: m.email, name: m.displayName || m.email.split('@')[0] || m.email });
  }
  for (const e of list) {
    const key = e.author.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ email: e.author, name: e.author.split('@')[0] || e.author });
  }
  return out;
}

/* ───────── 생활비 / 이벤트 / 고정비 나누기 ───────── */

export type SplitKey = 'living' | 'event' | 'fixed' | 'other';

export const SPLIT_LABEL: Record<SplitKey, string> = {
  living: '생활비',
  event: '이벤트',
  fixed: '고정비',
  other: '기타',
};

export const SPLIT_KEYS: SplitKey[] = ['living', 'event', 'fixed', 'other'];

/** 그달 생활비 통장 (domain 과 같은 규칙: 그달 생활비 고정지출의 통장 → 아무 생활비 고정지출 → 고정지출 역할 첫 통장) */
export function livingAccountIdFor(data: LedgerData, month: YearMonth): Id | null {
  const living =
    data.fixedExpenses.find((f) => !f.deleted && f.kind === 'living' && isMonthActive(month, f.startMonth, f.endMonth)) ??
    data.fixedExpenses.find((f) => !f.deleted && f.kind === 'living');
  if (living) return living.accountId;
  return (
    data.accounts.filter((a) => !a.deleted && a.role === 'fixed').sort((a, b) => a.order - b.order)[0]?.id ?? null
  );
}

/**
 * 지출 하나가 어디에 드는지.
 * 고정비: 고정 지출 자동 기록 · 이벤트: 일정에 연결됐거나 이벤트 역할 통장 ·
 * 생활비: 생활비 통장이거나 고정지출 · 용돈 역할 통장 · 기타: 그 밖 (저수지 · 저축투자 등)
 */
export function splitOf(expense: Expense, roleOf: (accountId: Id) => AccountRole | null, livingAccountId: Id | null): SplitKey {
  if (expense.fixedExpenseId !== null) return 'fixed';
  const role = roleOf(expense.accountId);
  if (expense.eventId !== null || role === 'event') return 'event';
  if (expense.accountId === livingAccountId || role === 'fixed' || role === 'allowance') return 'living';
  return 'other';
}

export type SplitTotals = Record<SplitKey, Won> & { total: Won; count: number };

export function splitTotals(data: LedgerData, list: Expense[], month: YearMonth): SplitTotals {
  const roles = new Map(data.accounts.map((a) => [a.id, a.role] as const));
  const roleOf = (id: Id) => roles.get(id) ?? null;
  const livingId = livingAccountIdFor(data, month);
  const out: SplitTotals = { living: 0, event: 0, fixed: 0, other: 0, total: 0, count: list.length };
  for (const e of list) {
    out[splitOf(e, roleOf, livingId)] += e.amount;
    out.total += e.amount;
  }
  return out;
}

/* ───────── 날짜별 묶음 ───────── */

export interface DayGroup {
  date: ISODate;
  total: Won;
  items: Expense[];
}

/** 이미 정렬된 목록을 날짜별로 묶어요 */
export function groupByDate(list: Expense[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const e of list) {
    const last = groups[groups.length - 1];
    if (last && last.date === e.date) {
      last.items.push(e);
      last.total += e.amount;
    } else groups.push({ date: e.date, total: e.amount, items: [e] });
  }
  return groups;
}

/* ───────── 기록 창 도우미 ───────── */

/** 지출 한 줄 제목: 내용 → 카테고리 이름 → '지출' */
export function expenseTitle(expense: Expense, category: Category | null | undefined): string {
  return expense.memo.trim() || category?.name || '지출';
}

/**
 * 카테고리로 고르는 통장.
 * 이벤트 → 이벤트 통장 · 고정지출 → 생활비 통장(없으면 고정지출 통장) · 그 밖 역할 → 그 역할 첫 통장.
 * 카테고리가 없거나 맞는 통장이 없으면 생활비 통장 → 고정지출 → 용돈 → 첫 통장
 */
export function accountForCategory(
  category: Category | null | undefined,
  accounts: Account[],
  livingAccountId: Id | null,
): Id | null {
  const active = accounts.filter((a) => !a.deleted).sort((a, b) => a.order - b.order);
  const byRole = (role: AccountRole) => active.find((a) => a.role === role)?.id ?? null;
  const living = livingAccountId && active.some((a) => a.id === livingAccountId) ? livingAccountId : null;
  let pick: Id | null = null;
  if (category) {
    const role = category.defaultAccountRole;
    pick = role === 'fixed' ? (living ?? byRole('fixed')) : byRole(role);
  }
  return pick ?? living ?? byRole('fixed') ?? byRole('allowance') ?? active[0]?.id ?? null;
}

/** 지출에 연결할 수 있는 일정: 예정 상태(지운 것 제외) + 지금 연결된 일정, 날짜순 */
export function linkableEvents(data: LedgerData, currentEventId: Id | null): PlannedEvent[] {
  return data.events
    .filter((e) => !e.deleted && (e.status === 'planned' || e.id === currentEventId))
    .sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name, 'ko') : a.date < b.date ? -1 : 1));
}

export function isISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function errorText(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message.trim()) return e.message;
  if (typeof e === 'string' && e.trim()) return e;
  return fallback;
}
