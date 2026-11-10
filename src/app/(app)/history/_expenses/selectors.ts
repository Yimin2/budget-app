/* 지출 화면의 순수 함수. 화면과 떼어 테스트해요. */
import {
  compareMonth, expenseSpender, isAutoFixedRecord, claimLoanTransferId, claimTransferId, isClaimExpense, isMonthActive,
  ledgerPeople, monthOf, recorderKey, type ExpenseSpender,
} from '@/domain';
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

/** 카테고리 'none' = 카테고리 없는 지출. spender = 실제로 쓴 사람 키 (expenseSpender) */
export interface ExpenseFilter {
  accountId: Id | null;
  categoryId: Id | 'none' | null;
  spender: string | null;
}

export const EMPTY_FILTER: ExpenseFilter = { accountId: null, categoryId: null, spender: null };

export function activeFilterCount(f: ExpenseFilter): number {
  return (f.accountId ? 1 : 0) + (f.categoryId ? 1 : 0) + (f.spender ? 1 : 0);
}

/** spenderKeyOf 가 없으면 기록한 사람으로 걸러요 */
export function applyFilter(
  list: Expense[],
  f: ExpenseFilter,
  spenderKeyOf: (e: Expense) => string = recorderKey,
): Expense[] {
  return list.filter((e) => {
    if (f.accountId && e.accountId !== f.accountId) return false;
    if (f.categoryId === 'none' && e.categoryId !== null) return false;
    if (f.categoryId && f.categoryId !== 'none' && e.categoryId !== f.categoryId) return false;
    if (f.spender && spenderKeyOf(e) !== f.spender) return false;
    return true;
  });
}

/** 지출마다 실제로 쓴 사람 (id → 결과). 한 번 구해 목록 · 필터에 함께 써요 */
export function spendersById(data: LedgerData, list: Expense[]): Map<Id, ExpenseSpender> {
  const people = ledgerPeople(data);
  return new Map(list.map((e) => [e.id, expenseSpender(data, e, people)] as const));
}

/** 쓴 사람 고르기 목록: 가계부의 사람 다음에 이 목록에서 쓴 다른 사람 (청구에 적힌 예전 이름, 공유가 풀린 멤버 등) */
export function spenderFilterOptions(data: LedgerData, spenders: Iterable<ExpenseSpender>): { key: string; name: string }[] {
  const out: { key: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const p of ledgerPeople(data)) {
    const key = p.email.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name: p.name });
  }
  for (const s of spenders) {
    if (!s.key || seen.has(s.key)) continue;
    seen.add(s.key);
    out.push({ key: s.key, name: s.name });
  }
  return out;
}

/* ───────── 줄 배지 ───────── */

export type ExpenseBadgeKind = 'claim-pending' | 'claim-settled' | 'claim-reservoir' | 'excluded' | 'auto' | 'event';

export interface ExpenseBadge {
  kind: ExpenseBadgeKind;
  label: string;
  /** 글자와 함께 쓰는 색 (색만으로 뜻을 전하지 않아요) */
  tone: 'warning' | 'success' | 'info' | 'neutral';
}

/**
 * 지출 줄의 배지: 청구 상태(돌려줄 돈 · 돌려줌 · 저수지에서 빌려 줌) → 예외 → 자동(고정 지출 자동 기록) → 일정.
 * 색은 청구 상태에만 쓰고 나머지는 중립이에요
 */
export function expenseBadges(data: LedgerData, expense: Expense): ExpenseBadge[] {
  return expenseBadgeReader(data)(expense);
}

/** 여러 줄에 쓸 때: 이체를 한 번만 훑고 줄마다 배지를 돌려줘요 (isClaimSettled · isClaimPaidFromReservoir 와 같은 규칙) */
export function expenseBadgeReader(data: LedgerData): (expense: Expense) => ExpenseBadge[] {
  const live = new Map(data.transfers.filter((t) => !t.deleted && t.status === 'done').map((t) => [t.id, t] as const));
  const reservoirIds = new Set(data.accounts.filter((a) => a.role === 'reservoir').map((a) => a.id));
  return (expense) => {
    const out: ExpenseBadge[] = [];
    if (isClaimExpense(expense)) {
      const settle = live.get(claimTransferId(expense.id));
      const viaReservoir =
        live.has(claimLoanTransferId(expense.id)) || (!!settle?.fromAccountId && reservoirIds.has(settle.fromAccountId));
      if (!settle) out.push({ kind: 'claim-pending', label: '돌려줄 돈', tone: 'warning' });
      else if (viaReservoir) out.push({ kind: 'claim-reservoir', label: '저수지에서 빌려 줌', tone: 'info' });
      else out.push({ kind: 'claim-settled', label: '돌려줌', tone: 'success' });
    }
    if (expense.excluded) out.push({ kind: 'excluded', label: '예외', tone: 'neutral' });
    if (isAutoFixedRecord(expense)) out.push({ kind: 'auto', label: '자동', tone: 'neutral' });
    if (expense.eventId) out.push({ kind: 'event', label: '일정', tone: 'neutral' });
    return out;
  };
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
