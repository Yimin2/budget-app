import { addMonths, daysInMonth, daysLeftInMonth, formatDateKo, isMonthActive, monthOf } from './dates';
import { activeAccountsSorted, livingAccountIdsFor } from './internal';
import { orderedCategories } from './categories';
import { livingOwnerName } from './household';
import { floorTo100, formatWon } from './money';
import { isEveryDay, scheduleOf, useDayPlan, WEEKDAY_LONG, weekdayOf, weeklyPlan } from './schedule';
import type {
  Category, FixedExpense, Id, ISODate, LedgerData, LivingItem, LivingSchedule, LivingSpread, LivingStatus, MonthEndItem, YearMonth, Won,
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

/** '이 달만 다른 금액' 행인지 (PLAN 4-1). 빈 칸 = 평소 행 */
export function isLivingOverride(f: Pick<FixedExpense, 'kind' | 'override'>): boolean {
  return f.kind === 'living' && f.override === true;
}

/** 생활비 항목 행 id 의 항목 id ('food@2026-12' · 'food@once-2026-12' → 'food') */
export function livingSeriesId(rowId: Id): Id {
  const i = rowId.indexOf('@');
  return i < 0 ? rowId : rowId.slice(0, i);
}

/** 이번 달부터 바꾼 생활비 행의 결정적 id */
export function livingSegmentId(seriesId: Id, month: YearMonth): Id {
  return `${seriesId}@${month}`;
}

/** '이 달만 다른 금액' 행의 결정적 id */
export function livingOverrideId(seriesId: Id, month: YearMonth): Id {
  return `${seriesId}@once-${month}`;
}

/** 이달만 행이 어느 항목을 바꾸는지: 같은 통장 · 같은 카테고리 */
function livingGroupKey(f: Pick<FixedExpense, 'accountId' | 'categoryId'>): string {
  return `${f.accountId}|${f.categoryId ?? ''}`;
}

/**
 * 그달 유효한 생활비 항목 예산 행 (그달 금액 = 실제로 쓰는 금액).
 * '이 달만 다른 금액' 행이 있으면 같은 통장 · 같은 항목의 평소 행 대신 그 금액을 쓴다 (쓰는 방식 · 쓰는 날은 평소 행 그대로).
 * 평소 행이 없는 달의 이달만 행은 그 행 하나가 항목이 된다
 */
export function activeLivingRows(data: LedgerData, month: YearMonth): FixedExpense[] {
  const active = data.fixedExpenses.filter(
    (f) => !f.deleted && f.kind === 'living' && isMonthActive(month, f.startMonth, f.endMonth),
  );
  const overrides = new Map<string, FixedExpense>();
  for (const o of active) {
    if (!isLivingOverride(o)) continue;
    const k = livingGroupKey(o);
    const prev = overrides.get(k);
    overrides.set(k, prev ? { ...prev, amount: prev.amount + o.amount } : o);
  }
  const normal = active.filter((f) => !isLivingOverride(f));
  if (overrides.size === 0) return normal;
  const out: FixedExpense[] = [];
  const used = new Set<string>();
  for (const r of normal) {
    const k = livingGroupKey(r);
    const o = overrides.get(k);
    if (!o) out.push(r);
    else if (!used.has(k)) {
      used.add(k);
      out.push({ ...r, amount: o.amount });
    }
  }
  for (const [k, o] of overrides) if (!used.has(k)) out.push({ ...o, override: undefined });
  return out;
}

/** 이 생활비 항목(같은 통장 · 같은 카테고리)의 '이 달만 다른 금액' 행, from 달 이후(포함), 달 순 */
export function livingOverridesOf(fixedExpenses: FixedExpense[], row: Pick<FixedExpense, 'accountId' | 'categoryId'>, from: YearMonth): FixedExpense[] {
  const k = livingGroupKey(row);
  return fixedExpenses
    .filter((f) => !f.deleted && isLivingOverride(f) && livingGroupKey(f) === k && f.startMonth >= from)
    .sort((a, b) => a.startMonth.localeCompare(b.startMonth));
}

/**
 * '이 달만 다른 금액' 행 (만들거나 고칠 때). 그 달에 이미 이 항목의 이달만 행이 있으면 그 행을 고친다 (다시 해도 같은 행)
 */
export function livingOverrideRow(fixedExpenses: FixedExpense[], row: FixedExpense, month: YearMonth, amount: Won): FixedExpense {
  const existing = fixedExpenses.find(
    (f) => isLivingOverride(f) && livingGroupKey(f) === livingGroupKey(row) && f.startMonth === month,
  );
  return {
    id: existing?.id ?? livingOverrideId(livingSeriesId(row.id), month),
    name: row.name,
    amount: Math.round(amount),
    accountId: row.accountId,
    categoryId: row.categoryId,
    dayOfMonth: null,
    kind: 'living',
    targetEmail: null,
    spread: row.spread,
    startMonth: month,
    endMonth: month,
    override: true,
    deleted: false,
  };
}

const scheduleKey = (f: FixedExpense) =>
  JSON.stringify([f.spread, f.spread === 'daily' ? (f.useDays ?? null) : null, f.spread === 'daily' ? f.skipHolidays === true : false, f.spread === 'daily' ? (f.perWeek ?? null) : null]);

/**
 * 생활비 항목 고치기 (PLAN 4-1). 쓰는 순서대로 행을 돌려준다: [새 행, 앞 행 끝내기] 또는 [그 자리에서 고친 행].
 * - 금액 · 쓰는 방식 · 쓰는 날이 바뀌면 이번 달(month)부터만: 앞 행은 지난달로 끝내고, id '<항목id>@<month>' 새 행이 이번 달부터
 *   (끝 달은 이어받는다). 지난달까지의 계산은 그대로
 * - 이번 달 이후에 시작한 행 · 이미 끝난 행 · 그 밖의 칸만 바뀐 경우는 그 자리에서 고친다
 */
export function splitLivingRow(prev: FixedExpense, next: FixedExpense, month: YearMonth): FixedExpense[] {
  const changed = prev.amount !== next.amount || scheduleKey(prev) !== scheduleKey(next);
  const startedBefore = prev.startMonth < month;
  const stillActive = prev.endMonth === null || prev.endMonth === '' || prev.endMonth >= month;
  if (!changed || !startedBefore || !stillActive || isLivingOverride(prev)) return [{ ...next, id: prev.id }];
  const created: FixedExpense = { ...next, id: livingSegmentId(livingSeriesId(prev.id), month), startMonth: month, endMonth: prev.endMonth, deleted: false };
  const ended: FixedExpense = { ...prev, endMonth: addMonths(month, -1) };
  return [created, ended];
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
  schedule: LivingSchedule | null;
  /** 이번 달에 지출이 있는 날 (주 N회 셈) */
  dates: Set<ISODate>;
}

/**
 * 지난달 이월을 항목별로 (항목 구분 없는 예전 기록은 전체를 null 묶음으로).
 * accountId 의 항목만: 통장이 적힌 항목은 그 통장, 통장이 없는 예전 항목은 첫 생활비 통장(primary)
 */
function carryItems(data: LedgerData, month: YearMonth, accountId: Id | null, primary: Id | null): MonthEndItem[] {
  const prev = data.monthEnds.find((m) => m.month === addMonths(month, -1) && m.choice === 'carryover');
  if (!prev) return [];
  const all: MonthEndItem[] =
    prev.items && prev.items.length > 0 ? prev.items : prev.leftover !== 0 ? [{ categoryId: null, leftover: prev.leftover }] : [];
  return all.filter((i) => (i.accountId ? i.accountId === accountId : accountId === primary));
}

/**
 * 생활비 항목 저장 (고치기 · 이번 달까지만 · 지우기)에 쓸 행들, 쓰는 순서대로.
 * splitLivingRow 행 + 이 항목의 이달만 행 맞추기: 항목이 끝나면 끝 달 뒤 이달만 행은 지우고(지우면 모두),
 * 통장 · 카테고리가 바뀌면 이번 달 이후 이달만 행도 따라 옮긴다
 */
export function livingItemChanges(fixedExpenses: FixedExpense[], prev: FixedExpense, next: FixedExpense, month: YearMonth): FixedExpense[] {
  const out = splitLivingRow(prev, next, month);
  const ownOverrides = livingOverridesOf(fixedExpenses, prev, '');
  const moved = livingGroupKey(prev) !== livingGroupKey(next);
  for (const o of ownOverrides) {
    if (next.deleted || (next.endMonth && o.startMonth > next.endMonth)) out.push({ ...o, deleted: true });
    else if (moved && o.startMonth >= month) out.push({ ...o, accountId: next.accountId, categoryId: next.categoryId, name: next.name });
  }
  return out;
}

/** 그달 생활비 통장들 (사람별 생활비 통장이면 여럿, PLAN 4-14). 그달 생활비 예산 행의 통장 → 없으면 예전처럼 하나 */
export function livingAccountIds(data: LedgerData, month: YearMonth): Id[] {
  return livingAccountIdsFor(data, month);
}

/** 통장 이름 대신 부를 주인 이름: 이어진 사람(멤버) → 주인 → 통장 이름 (livingOwnerName) */
function ownerOf(data: LedgerData, accountId: Id | null): string | null {
  if (!accountId) return null;
  if (!data.accounts.some((x) => x.id === accountId)) return null;
  return livingOwnerName(data, accountId);
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
 *   쓰는 날(요일 · 공휴일 빼기)이 있으면 남은 일수 대신 오늘 포함 남은 쓰는 날, 쉬는 날은 오늘 몫 0 (schedule.useDayPlan).
 *   주 N회면 한 번에 쓸 돈 (schedule.weeklyPlan). 이번 달에 쓰는 날 · 횟수가 더 없으면 monthly 처럼 (noDaysLeft)
 * - 전체 dailyBudget · todayAvailable = daily 항목의 합. monthly 항목은 남은 돈만 본다
 */
export function computeLiving(data: LedgerData, today: ISODate, accountId?: Id | null): LivingStatus {
  const month = monthOf(today);
  const ids = livingAccountIds(data, month);
  const primary = ids[0] ?? null;
  if (accountId !== undefined) return computeLivingFor(data, today, accountId, primary, ids.length <= 1 && accountId === primary);
  if (ids.length <= 1) return computeLivingFor(data, today, primary, primary, true);
  // 사람별 생활비 통장이 여럿: 통장마다 계산해 합친다 (항목에 통장 · 주인 이름)
  const parts = ids.map((id) => computeLivingFor(data, today, id, primary, false));
  const items = parts.flatMap((p) => p.items.map((i) => ({ ...i, owner: ownerOf(data, p.livingAccountId) })));
  return summarize(month, Math.max(1, daysLeftInMonth(today)), primary, items);
}

function summarize(month: YearMonth, daysLeft: number, livingAccountId: Id | null, items: LivingItem[]): LivingStatus {
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

/**
 * 생활비 통장 하나의 생활비. allRows=true 면(통장이 하나뿐) 그달 생활비 행을 통장과 상관없이 모두 센다 (예전 계산과 같게)
 */
function computeLivingFor(data: LedgerData, today: ISODate, livingAccountId: Id | null, primary: Id | null, allRows: boolean): LivingStatus {
  const month = monthOf(today);
  const daysLeft = Math.max(1, daysLeftInMonth(today));
  const catById = new Map<Id, Category>(data.categories.map((c) => [c.id, c]));
  // 항목은 설정에서 정한 카테고리 순서대로 (지운 카테고리 · 예전 한 줄 · 기타 묶음은 뒤)
  const catPos = new Map<Id, number>(orderedCategories(data.categories).map((c, i) => [c.id, i]));
  const buckets = new Map<string, Bucket>();

  const nullBucket = (): Bucket => {
    let b = buckets.get('');
    if (!b) {
      b = {
        categoryId: null, name: LIVING_ETC_NAME, icon: 'dots', spread: 'monthly', order: Number.MAX_SAFE_INTEGER,
        base: 0, carryIn: 0, spent: 0, spentToday: 0, hasRow: false, schedule: null, dates: new Set(),
      };
      buckets.set('', b);
    }
    return b;
  };

  for (const row of activeLivingRows(data, month)) {
    if (!allRows && row.accountId !== livingAccountId) continue;
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
      schedule: row.spread === 'monthly' ? null : scheduleOf(row),
      dates: new Set(),
      order: row.categoryId ? (catPos.get(row.categoryId) ?? Number.MAX_SAFE_INTEGER - 1) : Number.MAX_SAFE_INTEGER,
      base: row.amount,
      carryIn: 0,
      spent: 0,
      spentToday: 0,
      hasRow: true,
    });
  }

  for (const c of carryItems(data, month, livingAccountId, primary)) {
    const b = (c.categoryId !== null && buckets.get(c.categoryId)) || nullBucket();
    b.carryIn += c.leftover;
  }

  for (const e of livingExpenses(data, month, livingAccountId)) {
    const b = (e.categoryId !== null && buckets.get(e.categoryId)) || nullBucket();
    b.spent += e.amount;
    b.dates.add(e.date);
    if (e.date === today) b.spentToday += e.amount;
  }
  const daysOff = new Set(data.settings.daysOff ?? []);

  const items: LivingItem[] = [...buckets.values()]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ko'))
    .map((b) => {
      const monthBudget = b.base + b.carryIn;
      const remaining = monthBudget - b.spent;
      let spread = b.spread;
      let dailyBudget: Won | null = null;
      let todayAvailable: Won | null = null;
      const extra: Pick<LivingItem, 'schedule' | 'useDay' | 'weekly' | 'noDaysLeft'> = {};
      if (spread === 'daily') {
        const schedule = b.schedule;
        if (!schedule || isEveryDay(schedule)) {
          const startOfDay = remaining + b.spentToday;
          dailyBudget = startOfDay > 0 ? floorTo100(startOfDay / daysLeft) : 0;
          todayAvailable = dailyBudget - b.spentToday;
        } else {
          extra.schedule = schedule;
          if (schedule.perWeek !== null) {
            const w = weeklyPlan(remaining, b.spentToday, today, schedule.perWeek, b.dates);
            if (w) {
              const { dailyBudget: db, todayAvailable: ta, ...weekly } = w;
              dailyBudget = db;
              todayAvailable = ta;
              extra.weekly = weekly;
            }
          } else {
            const p = useDayPlan(remaining, b.spentToday, today, schedule, daysOff);
            if (p) {
              dailyBudget = p.dailyBudget;
              todayAvailable = p.todayAvailable;
              extra.useDay = { today: p.today, daysLeft: p.daysLeft, daysAfterToday: p.daysAfterToday, next: p.next };
            }
          }
          // 이번 달에 쓰는 날 · 횟수가 더 없으면 남은 돈은 한 달 한도만처럼 봐요
          if (dailyBudget === null) {
            spread = 'monthly';
            extra.noDaysLeft = true;
          }
        }
      }
      return {
        categoryId: b.categoryId,
        accountId: livingAccountId,
        name: b.name,
        icon: b.icon,
        spread,
        base: b.base,
        monthBudget,
        carryIn: b.carryIn,
        spent: b.spent,
        spentToday: b.spentToday,
        remaining,
        dailyBudget,
        todayAvailable,
        unbudgeted: !b.hasRow,
        ...extra,
      };
    });
  return summarize(month, daysLeft, livingAccountId, items);
}

export interface LivingView {
  /** 생활비 통장 */
  accountId: Id;
  /** 부를 이름 (이어진 사람 → 통장 주인 → 통장 이름, livingOwnerName) */
  name: string;
  status: LivingStatus;
}

/** 생활비 통장마다의 생활비 (통장 순서). 통장이 하나면 한 줄 */
export function livingByAccount(data: LedgerData, today: ISODate): LivingView[] {
  const ids = livingAccountIds(data, monthOf(today));
  const order = new Map(activeAccountsSorted(data).map((a, i) => [a.id, i]));
  return ids
    .map((id) => ({ accountId: id, name: ownerOf(data, id) ?? '생활비', status: computeLiving(data, today, id) }))
    .sort((a, b) => (order.get(a.accountId) ?? 999) - (order.get(b.accountId) ?? 999));
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

/**
 * 특정 달의 항목별 남은 돈 (0 인 항목은 뺀다). 그달 말일 기준.
 * 생활비 통장이 여럿이면 항목에 통장(accountId)을 적고 이름 앞에 주인 이름을 붙인다 ('민지 식비')
 */
export function livingLeftoverItems(data: LedgerData, month: YearMonth): (MonthEndItem & { name: string; icon: string })[] {
  const multi = livingAccountIds(data, month).length > 1;
  return computeLiving(data, lastDayOf(month))
    .items.filter((i) => i.remaining !== 0)
    .map((i) => ({
      categoryId: i.categoryId,
      leftover: i.remaining,
      name: multi && i.owner ? `${i.owner} ${i.name}` : i.name,
      icon: i.icon,
      ...(multi && i.accountId ? { accountId: i.accountId } : {}),
    }));
}

/**
 * 설정에서 고치는 중인 생활비 행으로 다시 계산한 그 항목 (쓰는 날 미리 보기). 같은 id 행은 바꿔 넣고, 없으면 더한다
 */
export function previewLivingItem(data: LedgerData, today: ISODate, row: FixedExpense): LivingItem | null {
  const next: LedgerData = { ...data, fixedExpenses: [...data.fixedExpenses.filter((f) => f.id !== row.id), row] };
  const items = computeLiving(next, today).items.filter((i) => i.categoryId === row.categoryId && !i.unbudgeted);
  return items.find((i) => i.accountId === row.accountId) ?? items[0] ?? null;
}

/**
 * 쓰는 날 미리 보기 한 줄 (설정 · 시작 마법사).
 * '11월 남은 쓰는 날 15일 → 하루 14,600원' · '이번 주 남은 2회 · 한 번에 25,000원' · '11월 남은 21일 → 하루 21,400원'
 */
export function schedulePreviewText(item: LivingItem, today: ISODate): string {
  const m = `${Number(today.slice(5, 7))}월`;
  const won = (n: number) => formatWon(Math.max(0, n));
  if (item.noDaysLeft) return `${m}에는 남은 쓰는 날이 없어요. 남은 돈은 한 달 한도처럼 봐요`;
  if (item.weekly) return `이번 주 남은 ${item.weekly.leftThisWeek}회 · 한 번에 ${won(item.weekly.perUse)}`;
  if (item.useDay) {
    const daily = item.useDay.today ? (item.dailyBudget ?? 0) : (item.useDay.next?.amount ?? 0);
    return `${m} 남은 쓰는 날 ${item.useDay.daysLeft}일 → 하루 ${won(daily)}`;
  }
  if (item.spread === 'daily') return `${m} 남은 ${daysLeftInMonth(today)}일 → 하루 ${won(item.dailyBudget ?? 0)}`;
  return '';
}

/**
 * 홈 · 사도 돼? 의 항목 한 줄 (쓰는 날 · 주 N회 항목이 오늘 하루 예산 대신 보여 줄 글). 그 밖에는 null.
 * - 쉬는 날: '오늘은 쓰는 날이 아니에요 · 다음: 월요일 14,600원'
 * - 주 N회: '이번 주 남은 1회 · 한 번에 25,000원' / '이번 주는 다 썼어요'
 * - 쓰는 날이 더 없음: '이번 달은 쓰는 날이 끝났어요'
 */
export function livingDayNote(item: LivingItem, today: ISODate): string | null {
  if (item.noDaysLeft) return '이번 달은 쓰는 날이 끝났어요';
  if (item.weekly) {
    const w = item.weekly;
    if (!w.usedToday && w.leftThisWeek === 0) return '이번 주는 다 썼어요';
    return `이번 주 남은 ${w.leftThisWeek}회 · 한 번에 ${formatWon(w.perUse)}`;
  }
  if (item.useDay && !item.useDay.today && item.useDay.next) {
    const { date, amount } = item.useDay.next;
    const gap = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
    const when = gap <= 6 ? WEEKDAY_LONG[weekdayOf(date)] : formatDateKo(date);
    return `오늘은 쓰는 날이 아니에요 · 다음: ${when} ${formatWon(amount)}`;
  }
  return null;
}
