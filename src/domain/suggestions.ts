/**
 * 자주 쓰는 지출 자동 추천 — PLAN 6 (홈).
 * 따로 등록하지 않아요. 로그인한 사람이 최근 3개월 동안 쓴 지출에서 자주 쓴 것을 골라 홈에 칩으로 보여 줘요.
 * - 묶기: 카테고리 + 내용(메모). 내용은 앞뒤 공백 · 겹친 공백 · 대소문자를 무시해요 ('아아 ' = '아아', 'Coffee' = 'coffee')
 * - 순서: 쓴 횟수 많은 순 → 같으면 가장 최근에 쓴 것 먼저. 최대 6개
 * - 빼는 것: 지운 지출, 청구(개인 돈으로 낸 지출), 예외 지출, 자동으로 만든 행(id 에 ':' — auto: · fixed: · event: ·
 *   imp: · income: · prepay: · claim: …), 고정비 · 할부 기록, 일정 · 여행에 묶인 지출, 0원 이하, 미래 날짜,
 *   지운 · 숨긴 카테고리
 * - 내 지출: 실제로 쓴 사람(spender.ts)이 나인 것. 주인이 사람 아닌 이메일인 내 생활비 통장 지출도 내 것
 * - 추천마다 가장 최근 지출의 금액 · 카테고리 · 내용 · 통장을 써요. 통장이 생활비 통장이면 내 생활비 통장으로
 *   ('누가 썼나요?'에서 나를 고른 것과 같게), 지운 통장이면 내 생활비 통장, 그것도 없으면 추천하지 않아요
 * 예전에 설정에서 등록한 자주 쓰는 지출(즐겨찾기 탭)은 읽지 않아요. 시트의 행은 그대로 둬요
 */
import { addMonths, daysInMonth, monthOf } from './dates';
import { livingAccountIdsFor } from './internal';
import { ledgerPeople } from './people';
import { expenseSpender } from './spender';
import type { Expense, Id, ISODate, LedgerData, Won } from './types';

export const SUGGESTION_MONTHS = 3;
export const SUGGESTION_LIMIT = 6;

export interface ExpenseSuggestion {
  /** 묶음 키 (카테고리 id | 정리한 내용) */
  key: string;
  /** 칩에 보일 이름: 내용, 없으면 카테고리 이름 */
  label: string;
  amount: Won;
  categoryId: Id | null;
  memo: string;
  accountId: Id;
  /** 최근 3개월 동안 쓴 횟수 */
  count: number;
  /** 가장 최근에 쓴 날 */
  lastDate: ISODate;
}

/** 묶을 때 쓰는 내용: 앞뒤 · 겹친 공백과 대소문자 무시 */
export function normalizeMemo(memo: string | null | undefined): string {
  return (memo ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 추천에 쓰지 않는 지출 (자동 기록 · 청구 · 예외 · 일정 · 여행 · 지운 것) */
export function isSuggestableExpense(e: Expense): boolean {
  if (e.deleted || e.excluded === true) return false;
  if ((e.paidBy ?? '').trim()) return false; // 청구
  if (e.id.includes(':')) return false; // 앱이 만든 행 (auto: · fixed: · event: · imp: · income: · prepay: · claim: …)
  if (e.fixedExpenseId || e.eventId || e.tripId) return false;
  return Number.isFinite(e.amount) && e.amount > 0;
}

/** today 에서 months 개월 전 같은 날 (그 달에 그날이 없으면 말일) */
function monthsBefore(today: ISODate, months: number): ISODate {
  const m = addMonths(monthOf(today), -months);
  const day = Math.min(Number(today.slice(8, 10)) || 1, daysInMonth(m));
  return `${m}-${String(day).padStart(2, '0')}`;
}

const newer = (a: Expense, b: Expense) => a.date > b.date || (a.date === b.date && (a.createdAt ?? '') > (b.createdAt ?? ''));

export function suggestExpenses(
  data: LedgerData,
  opts: {
    today: ISODate;
    /** 나를 가르는 키 (멤버 이메일 — '누가 썼나요?'의 내 키) */
    meKey: string | null;
    /** 내 생활비 통장 */
    myLivingId: Id | null;
    months?: number;
    limit?: number;
  },
): ExpenseSuggestion[] {
  const me = (opts.meKey ?? '').trim().toLowerCase();
  if (!me && !opts.myLivingId) return [];
  const from = monthsBefore(opts.today, opts.months ?? SUGGESTION_MONTHS);
  const people = ledgerPeople(data);
  const categories = new Map(data.categories.map((c) => [c.id, c]));
  const liveAccounts = new Set(data.accounts.filter((a) => !a.deleted).map((a) => a.id));
  const livingIds = new Set(livingAccountIdsFor(data, monthOf(opts.today)));

  const groups = new Map<string, { count: number; last: Expense }>();
  for (const e of data.expenses) {
    if (e.date < from || e.date > opts.today || !isSuggestableExpense(e)) continue;
    if (e.categoryId) {
      const c = categories.get(e.categoryId);
      if (!c || c.deleted || c.hidden === true) continue;
    }
    const who = expenseSpender(data, e, people);
    const mine = (!!me && who.key === me) || (!!opts.myLivingId && e.accountId === opts.myLivingId && who.source === 'account');
    if (!mine) continue;
    const key = `${e.categoryId ?? ''}|${normalizeMemo(e.memo)}`;
    const g = groups.get(key);
    if (!g) groups.set(key, { count: 1, last: e });
    else {
      g.count += 1;
      if (newer(e, g.last)) g.last = e;
    }
  }

  const out: ExpenseSuggestion[] = [];
  for (const [key, { count, last }] of groups) {
    let accountId: Id | null = last.accountId;
    if (livingIds.has(accountId) || !liveAccounts.has(accountId)) accountId = opts.myLivingId ?? (liveAccounts.has(accountId) ? accountId : null);
    if (!accountId) continue;
    const memo = last.memo.trim();
    const label = memo || (last.categoryId ? (categories.get(last.categoryId)?.name ?? '') : '') || '지출';
    out.push({ key, label, amount: last.amount, categoryId: last.categoryId, memo, accountId, count, lastDate: last.date });
  }
  const lastOf = new Map([...groups].map(([k, g]) => [k, g.last]));
  out.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const la = lastOf.get(a.key)!;
    const lb = lastOf.get(b.key)!;
    if (newer(la, lb)) return -1;
    if (newer(lb, la)) return 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return out.slice(0, opts.limit ?? SUGGESTION_LIMIT);
}
