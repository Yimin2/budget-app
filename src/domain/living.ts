import { addMonths, daysInMonth, daysLeftInMonth, isMonthActive, monthOf } from './dates';
import { livingAccountIdFor } from './internal';
import { floorTo100 } from './money';
import type {
  Category, FixedExpense, Id, ISODate, LedgerData, LivingItem, LivingSpread, LivingStatus, MonthEndItem, YearMonth, Won,
} from './types';

/** 예산 행 없이 지출만 있는 생활비 묶음 이름 */
export const LIVING_ETC_NAME = '기타(예산 없음)';

/** 기본으로 '하루에 나눠 쓰기' 하는 항목 (나머지는 '한 달 한도만') */
export const DAILY_ITEM_NAMES = ['식비', '카페', '교통'];

/** 새 생활비 항목의 기본 쓰는 방식: 식비·카페·교통은 daily, 나머지는 monthly */
export function defaultSpreadFor(name: string): LivingSpread {
  return DAILY_ITEM_NAMES.includes(name.trim()) ? 'daily' : 'monthly';
}

/** 항목 키: categoryId, null 묶음은 '' */
export function livingItemKey(categoryId: Id | null): string {
  return categoryId ?? '';
}

/** 그달 유효한 생활비 항목 예산 행 */
export function activeLivingRows(data: LedgerData, month: YearMonth): FixedExpense[] {
  return data.fixedExpenses.filter(
    (f) => !f.deleted && f.kind === 'living' && isMonthActive(month, f.startMonth, f.endMonth),
  );
}

function livingExpenses(data: LedgerData, month: YearMonth, accountId: string | null) {
  if (accountId === null) return [];
  return data.expenses.filter(
    (e) =>
      !e.deleted &&
      e.fixedExpenseId === null &&
      e.eventId === null &&
      e.accountId === accountId &&
      monthOf(e.date) === month,
  );
}

interface Bucket {
  categoryId: Id | null;
  name: string;
  icon: string;
  spread: LivingSpread;
  order: number;
  base: Won;
  carryIn: Won;
  spent: Won;
  spentToday: Won;
  hasRow: boolean;
}

/** 지난달 이월을 항목별로 (항목 구분 없는 예전 기록은 전체를 null 묶음으로) */
function carryItems(data: LedgerData, month: YearMonth): MonthEndItem[] {
  const prev = data.monthEnds.find((m) => m.month === addMonths(month, -1) && m.choice === 'carryover');
  if (!prev) return [];
  if (prev.items && prev.items.length > 0) return prev.items;
  return prev.leftover !== 0 ? [{ categoryId: null, leftover: prev.leftover }] : [];
}

/**
 * PLAN 4-1. 생활비 계산 (항목별).
 * - 항목 = 그달 유효한 kind='living' 고정지출 행을 categoryId 로 묶은 것. 같은 카테고리 행이 여럿이면 금액을 더한다
 *   (쓰는 방식은 앞 행). categoryId=null 행은 예전 방식의 '생활비' 한 줄 → null 묶음
 * - 생활비 지출 = 삭제 안 된 지출 중 fixedExpenseId=null, eventId=null 이고 accountId 가 생활비 통장인 것
 *   지출 카테고리에 예산 항목이 있으면 그 항목, 없거나 카테고리가 없으면 null 묶음
 *   (null 행이 없으면 예산 0 의 '기타(예산 없음)' 묶음). 그래서 전체 = 항목 합
 * - 이월: 지난달 MonthEnd(choice='carryover').items 를 같은 항목에 더한다. 이번 달에 없는 항목의 이월과
 *   항목 구분 없는 예전 이월은 null 묶음으로
 * - daily 항목: 하루 예산 = (남은 돈 + 오늘 쓴 돈) ÷ 남은 일수(오늘 포함), 100원 내림
 * - 전체 dailyBudget · todayAvailable = daily 항목의 합. monthly 항목은 남은 돈만 본다
 */
export function computeLiving(data: LedgerData, today: ISODate): LivingStatus {
  const month = monthOf(today);
  const daysLeft = Math.max(1, daysLeftInMonth(today));
  const livingAccountId = livingAccountIdFor(data, month);
  const catById = new Map<Id, Category>(data.categories.map((c) => [c.id, c]));
  const buckets = new Map<string, Bucket>();

  const nullBucket = (): Bucket => {
    let b = buckets.get('');
    if (!b) {
      b = {
        categoryId: null, name: LIVING_ETC_NAME, icon: 'dots', spread: 'monthly', order: Number.MAX_SAFE_INTEGER,
        base: 0, carryIn: 0, spent: 0, spentToday: 0, hasRow: false,
      };
      buckets.set('', b);
    }
    return b;
  };

  for (const row of activeLivingRows(data, month)) {
    const key = livingItemKey(row.categoryId);
    const existing = buckets.get(key);
    if (existing) {
      existing.base += row.amount;
      continue;
    }
    const cat = row.categoryId ? catById.get(row.categoryId) : undefined;
    buckets.set(key, {
      categoryId: row.categoryId,
      name: row.categoryId ? (cat?.name ?? (row.name.trim() || '항목')) : row.name.trim() || '생활비',
      icon: row.categoryId ? (cat?.icon ?? 'dots') : 'wallet',
      spread: row.spread === 'monthly' ? 'monthly' : 'daily',
      order: row.categoryId ? (cat?.order ?? Number.MAX_SAFE_INTEGER - 1) : Number.MAX_SAFE_INTEGER,
      base: row.amount,
      carryIn: 0,
      spent: 0,
      spentToday: 0,
      hasRow: true,
    });
  }

  for (const c of carryItems(data, month)) {
    const b = (c.categoryId !== null && buckets.get(c.categoryId)) || nullBucket();
    b.carryIn += c.leftover;
  }

  for (const e of livingExpenses(data, month, livingAccountId)) {
    const b = (e.categoryId !== null && buckets.get(e.categoryId)) || nullBucket();
    b.spent += e.amount;
    if (e.date === today) b.spentToday += e.amount;
  }

  const items: LivingItem[] = [...buckets.values()]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ko'))
    .map((b) => {
      const monthBudget = b.base + b.carryIn;
      const remaining = monthBudget - b.spent;
      let dailyBudget: Won | null = null;
      let todayAvailable: Won | null = null;
      if (b.spread === 'daily') {
        const startOfDay = remaining + b.spentToday;
        dailyBudget = startOfDay > 0 ? floorTo100(startOfDay / daysLeft) : 0;
        todayAvailable = dailyBudget - b.spentToday;
      }
      return {
        categoryId: b.categoryId,
        name: b.name,
        icon: b.icon,
        spread: b.spread,
        base: b.base,
        monthBudget,
        carryIn: b.carryIn,
        spent: b.spent,
        spentToday: b.spentToday,
        remaining,
        dailyBudget,
        todayAvailable,
        unbudgeted: !b.hasRow,
      };
    });

  const sum = (pick: (i: LivingItem) => number | null) => items.reduce((s, i) => s + (pick(i) ?? 0), 0);
  const monthBudget = sum((i) => i.monthBudget);
  const spent = sum((i) => i.spent);
  return {
    month,
    monthBudget,
    carryIn: sum((i) => i.carryIn),
    spent,
    spentToday: sum((i) => i.spentToday),
    remaining: monthBudget - spent,
    daysLeft,
    dailyBudget: sum((i) => i.dailyBudget),
    todayAvailable: sum((i) => i.todayAvailable),
    livingAccountId,
    items,
  };
}

/** 생활비 예산 행이 하나라도 있는지 (이월만 있는 달은 아니라고 본다) */
export function hasLivingBudget(living: LivingStatus | null): boolean {
  return !!living && living.items.some((i) => i.base > 0);
}

/** 생활비 항목 찾기: 그 카테고리 항목, 없으면 null 묶음 (지출이 들어가는 곳과 같다). 둘 다 없으면 null */
export function findLivingItem(living: LivingStatus, categoryId: Id | null): LivingItem | null {
  if (categoryId !== null) {
    const hit = living.items.find((i) => i.categoryId === categoryId);
    if (hit) return hit;
  }
  return living.items.find((i) => i.categoryId === null) ?? null;
}

/** 예전 방식의 '생활비' 한 줄(카테고리 없는 생활비 행)이 그달에 있는지 — 설정에서 항목으로 나누라고 안내 */
export function hasLegacyLivingRow(data: LedgerData, month: YearMonth): boolean {
  return activeLivingRows(data, month).some((f) => f.categoryId === null);
}

function lastDayOf(month: YearMonth): ISODate {
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
}

/** 특정 달의 생활비 남은 돈 (월말 처리용). 그달 말일 기준 */
export function livingLeftover(data: LedgerData, month: YearMonth): Won {
  return computeLiving(data, lastDayOf(month)).remaining;
}

/** 특정 달의 항목별 남은 돈 (0 인 항목은 뺀다). 그달 말일 기준 */
export function livingLeftoverItems(data: LedgerData, month: YearMonth): (MonthEndItem & { name: string; icon: string })[] {
  return computeLiving(data, lastDayOf(month))
    .items.filter((i) => i.remaining !== 0)
    .map((i) => ({ categoryId: i.categoryId, leftover: i.remaining, name: i.name, icon: i.icon }));
}
