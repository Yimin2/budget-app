/**
 * 예산 달별 보기 (작업정리 13, PLAN 6 [예산]).
 *
 * 예산 설정(매달 배분 · 수입 계획 · 고정비 · 생활비 항목)은 이미 행마다 시작월 · 종료월(고정비는 시작일 · 해지일)이 있어
 * 그달 유효한 행이 곧 '그달 예산'이에요. 그래서 새 탭 없이:
 * - 지난 달 = 그달 유효한 행을 보기만 (그때 적용된 예산 그대로)
 * - 다음 달 = 준비하지 않으면 이번 달 행이 그대로 이어져요 (예전과 같음, 0 이 되는 일 없음)
 * - [전달 복사] = 이번 달 행 중 다음 달에도 이어지는 행을 이번 달로 끝내고, 같은 내용의 '<id>@<다음 달>' 행을 다음 달부터 만들어요.
 *   그 뒤로 두 달은 서로 다른 행이라 따로 고쳐요. 설정 '준비한달' = 다음 달
 * - [초기화] = 다음 달 표시가 붙은 행('<id>@<다음 달>' · 고정비 '<id>@<다음 달>-DD' · '이 달만 다른 금액')을 지우고
 *   앞 행의 끝을 되돌려 다시 이번 달 예산이 이어지게 해요. '준비한달'은 비워요
 * 할부는 회차가 정해진 결제라 나누지 않아요 (그달 회차 금액이 그대로 보여요).
 */
import { addDays, addMonths, compareMonth, dateInMonth, daysInMonth, isMonthActive, isValidDate, isValidMonth, monthOf } from './dates';
import { billDay, billSegmentId, billSeriesId, isDatedBill, normalizeBill, rowStart } from './bills';
import { isLivingOverride, livingSegmentId, livingSeriesId } from './living';
import type { AllocationRule, FixedExpense, Id, IncomePlan, ISODate, LedgerData, YearMonth } from './types';

export type BudgetMonthKind = 'past' | 'current' | 'next';

export interface BudgetMonthView {
  month: YearMonth;
  kind: BudgetMonthKind;
  /** 다음 달을 [전달 복사]로 준비했는지 (다음 달일 때만 뜻이 있어요) */
  prepared: boolean;
  /** 고칠 수 있는지: 이번 달 · 준비한 다음 달 */
  editable: boolean;
  /** 준비하지 않은 다음 달: 화면은 비어서 시작하고, 계산은 이번 달 예산이 이어져요 */
  empty: boolean;
  /** 그달 화면의 기준 날짜 (이번 달 = 오늘, 다른 달 = 그달 1일) */
  asOf: ISODate;
}

/** 예산 설정 표 */
export type BudgetTable = 'rules' | 'incomePlans' | 'fixedExpenses';

/** 쓸 행 (쓰는 순서: created → ended) */
export interface BudgetRowWrites {
  rules: AllocationRule[];
  incomePlans: IncomePlan[];
  fixedExpenses: FixedExpense[];
}

export interface NextMonthWrites {
  /** 먼저 쓸 행 (다음 달 새 행 / 초기화에서 지울 행) */
  first: BudgetRowWrites;
  /** 나중에 쓸 행 (앞 행 끝내기 / 앞 행 끝 되돌리기) */
  then: BudgetRowWrites;
}

const emptyWrites = (): BudgetRowWrites => ({ rules: [], incomePlans: [], fixedExpenses: [] });

/** 다음 달 */
export function nextBudgetMonth(today: ISODate): YearMonth {
  return addMonths(monthOf(today), 1);
}

/** 다음 달을 [전달 복사]로 준비했는지 */
export function isNextMonthPrepared(data: LedgerData, today: ISODate): boolean {
  return data.settings.preparedMonth === nextBudgetMonth(today);
}

/** 거슬러 볼 수 있는 가장 앞 달: 가계부를 만든 달과 예산 행이 시작한 달 중 가장 앞 (이번 달보다 뒤면 이번 달, 최대 10년 전) */
export function earliestBudgetMonth(data: LedgerData, today: ISODate): YearMonth {
  const cur = monthOf(today);
  const floor = addMonths(cur, -120);
  let min = cur;
  const consider = (m: unknown) => {
    if (isValidMonth(m) && compareMonth(m, min) < 0) min = m;
  };
  const created = data.settings.createdAt?.slice(0, 7);
  consider(created);
  for (const r of data.rules) if (!r.deleted) consider(r.startMonth);
  for (const p of data.incomePlans) if (!p.deleted) consider(p.startMonth);
  for (const f of data.fixedExpenses) if (!f.deleted) consider(f.startMonth);
  return compareMonth(min, floor) < 0 ? floor : min;
}

/** 고를 수 있는 달로 맞추기: 가장 앞 달 ~ 다음 달 */
export function clampBudgetMonth(data: LedgerData, today: ISODate, month: YearMonth): YearMonth {
  const min = earliestBudgetMonth(data, today);
  const max = nextBudgetMonth(today);
  if (!isValidMonth(month) || compareMonth(month, min) < 0) return min;
  return compareMonth(month, max) > 0 ? max : month;
}

/** 그달 예산 화면이 어떤 모습인지 (지난 달 · 이번 달 · 다음 달 준비함 / 안 함) */
export function budgetMonthView(data: LedgerData, today: ISODate, month: YearMonth): BudgetMonthView {
  const cur = monthOf(today);
  const m = clampBudgetMonth(data, today, month);
  const c = compareMonth(m, cur);
  if (c === 0) return { month: m, kind: 'current', prepared: false, editable: true, empty: false, asOf: today };
  if (c < 0) return { month: m, kind: 'past', prepared: false, editable: false, empty: false, asOf: `${m}-01` };
  const prepared = isNextMonthPrepared(data, today);
  return { month: m, kind: 'next', prepared, editable: prepared, empty: !prepared, asOf: `${m}-01` };
}

/* ---------- 다음 달 행 나누기 ---------- */

const seriesOf = (id: Id): Id => {
  const i = id.indexOf('@');
  return i < 0 ? id : id.slice(0, i);
};

/** 다음 달 행의 id ('<id>@<다음 달>', 고정비 '<id>@<다음 달>-01') */
export function nextMonthRowId(table: BudgetTable, row: { id: Id; kind?: string }, next: YearMonth): Id {
  if (table === 'fixedExpenses') {
    const f = row as Pick<FixedExpense, 'id' | 'kind'>;
    return isDatedBill(f) ? billSegmentId(billSeriesId(f.id), `${next}-01`) : livingSegmentId(livingSeriesId(f.id), next);
  }
  return `${seriesOf(row.id)}@${next}`;
}

/** 다음 달 화면에서 새로 만드는 행의 id (초기화하면 지워지게 다음 달 표시를 붙여요) */
export function nextMonthNewId(baseId: Id, table: BudgetTable, kind: FixedExpense['kind'] | null, next: YearMonth): Id {
  return nextMonthRowId(table, { id: baseId, kind: kind ?? undefined }, next);
}

/** 이번 달과 다음 달에 모두 걸친 행인지 (시작이 다음 달 앞이고 다음 달에도 살아 있음) */
function spansInto(row: { deleted: boolean; startMonth: YearMonth; endMonth: YearMonth | null }, next: YearMonth): boolean {
  return !row.deleted && isValidMonth(row.startMonth) && compareMonth(row.startMonth, next) < 0 && isMonthActive(next, row.startMonth, row.endMonth);
}

/** 나눌 수 있는 고정 지출: 고정비 · 생활비 평소 행 (할부 · 이 달만 다른 금액은 아니에요) */
function splittableFixed(f: FixedExpense): boolean {
  return (isDatedBill(f) || f.kind === 'living') && !isLivingOverride(f);
}

export interface RowSplit<T> {
  /** 다음 달부터의 새 행 */
  created: T;
  /** 이번 달로 끝낸 앞 행 */
  ended: T;
}

/** 매달 배분 · 수입 계획 한 행을 다음 달 앞에서 나누기 (걸치지 않으면 null) */
export function splitMonthRow<T extends AllocationRule | IncomePlan>(table: 'rules' | 'incomePlans', row: T, next: YearMonth): RowSplit<T> | null {
  if (!spansInto(row, next)) return null;
  return {
    created: { ...row, id: nextMonthRowId(table, row, next), startMonth: next, endMonth: row.endMonth },
    ended: { ...row, endMonth: addMonths(next, -1) },
  };
}

/** 고정비 · 생활비 항목 한 행을 다음 달 앞에서 나누기 (걸치지 않거나 할부 · 이 달만 행이면 null) */
export function splitFixedRow(row: FixedExpense, next: YearMonth, today: ISODate): RowSplit<FixedExpense> | null {
  if (!splittableFixed(row) || !spansInto(row, next)) return null;
  const id = nextMonthRowId('fixedExpenses', row, next);
  const cur = addMonths(next, -1);
  if (isDatedBill(row) && billDay(row) !== null) {
    const first = `${next}-01`;
    const start = row.startDate && isValidDate(row.startDate) && row.startDate > first ? row.startDate : first;
    return {
      created: normalizeBill({ ...row, id, startDate: start }, first),
      ended: normalizeBill({ ...row, endDate: dateInMonth(cur, daysInMonth(cur)) }, today),
    };
  }
  return { created: { ...row, id, startMonth: next }, ended: { ...row, endMonth: cur } };
}

/**
 * [전달 복사]: 이번 달 예산 중 다음 달에도 이어지는 행을 모두 나눠요 (다시 해도 같은 행).
 * first = 다음 달 새 행, then = 이번 달로 끝낸 앞 행
 */
export function nextMonthCopy(data: LedgerData, today: ISODate): NextMonthWrites {
  const next = nextBudgetMonth(today);
  const first = emptyWrites();
  const then = emptyWrites();
  for (const r of data.rules) {
    const s = splitMonthRow('rules', r, next);
    if (s) {
      first.rules.push(s.created);
      then.rules.push(s.ended);
    }
  }
  for (const p of data.incomePlans) {
    const s = splitMonthRow('incomePlans', p, next);
    if (s) {
      first.incomePlans.push(s.created);
      then.incomePlans.push(s.ended);
    }
  }
  for (const f of data.fixedExpenses) {
    const s = splitFixedRow(f, next, today);
    if (s) {
      first.fixedExpenses.push(s.created);
      then.fixedExpenses.push(s.ended);
    }
  }
  return { first, then };
}

/* ---------- 초기화 ---------- */

/** 다음 달 표시가 붙은 행인지: '<id>@<다음 달>' · 고정비 '<id>@<다음 달>-DD' · '<id>@once-<다음 달>' */
export function isNextMonthRow(table: BudgetTable, row: { id: Id; kind?: string }, next: YearMonth): boolean {
  const at = row.id.indexOf('@');
  if (at < 0) return false;
  const tail = row.id.slice(at + 1);
  if (table !== 'fixedExpenses') return tail === next;
  const f = row as Pick<FixedExpense, 'id' | 'kind'>;
  if (f.kind === 'installment') return false;
  if (isDatedBill(f)) return /^\d{4}-\d{2}-\d{2}$/.test(tail) && tail.slice(0, 7) === next;
  return tail === next || tail === `once-${next}`;
}

interface Span {
  start: ISODate;
  /** null = 계속 */
  end: ISODate | null;
}

const monthEndDate = (m: YearMonth): ISODate => dateInMonth(m, daysInMonth(m));

function spanOf(table: BudgetTable, row: AllocationRule | IncomePlan | FixedExpense): Span {
  if (table === 'fixedExpenses' && isDatedBill(row as FixedExpense)) {
    const f = row as FixedExpense;
    const end = f.endDate && isValidDate(f.endDate) ? f.endDate : f.endMonth && isValidMonth(f.endMonth) ? monthEndDate(f.endMonth) : null;
    return { start: rowStart(f), end };
  }
  return { start: `${row.startMonth}-01`, end: row.endMonth && isValidMonth(row.endMonth) ? monthEndDate(row.endMonth) : null };
}

/** 앞 행의 끝을 end 로 되돌린 행 */
function withEnd<T extends AllocationRule | IncomePlan | FixedExpense>(table: BudgetTable, row: T, end: ISODate | null, today: ISODate): T {
  if (table === 'fixedExpenses' && isDatedBill(row as FixedExpense)) {
    const f = row as FixedExpense;
    const restored: FixedExpense = end === null ? { ...f, endDate: null, endMonth: null } : { ...f, endDate: end, endMonth: monthOf(end) };
    return normalizeBill(restored, today) as T;
  }
  return { ...row, endMonth: end === null ? null : monthOf(end) };
}

function resetTable<T extends AllocationRule | IncomePlan | FixedExpense>(
  table: BudgetTable,
  rows: T[],
  next: YearMonth,
  today: ISODate,
): { removed: T[]; restored: T[] } {
  const cur = addMonths(next, -1);
  const isLiving = (r: T) => table === 'fixedExpenses' && (r as FixedExpense).kind === 'living';
  const tagged = rows.filter((r) => isNextMonthRow(table, r, next));
  const removed = tagged.filter((r) => !r.deleted).map((r) => ({ ...r, deleted: true }));
  const restored: T[] = [];
  const bySeries = new Map<Id, T[]>();
  for (const r of tagged) {
    if (table === 'fixedExpenses' && isLivingOverride(r as FixedExpense)) continue;
    const k = seriesOf(r.id);
    bySeries.set(k, [...(bySeries.get(k) ?? []), r]);
  }
  for (const [series, list] of bySeries) {
    const own = rows.filter(
      (r) =>
        !r.deleted &&
        seriesOf(r.id) === series &&
        !list.includes(r) &&
        (table !== 'fixedExpenses' || isLiving(r) === isLiving(list[0]!)) &&
        !(table === 'fixedExpenses' && (isLivingOverride(r as FixedExpense) || (r as FixedExpense).kind === 'installment')),
    );
    // 앞 행: 다음 달 앞에 시작해서 이번 달 안에서 끝나는 마지막 행
    const prev = own
      .filter((r) => {
        const s = spanOf(table, r);
        return s.start < `${next}-01` && s.end !== null && monthOf(s.end) === cur;
      })
      .sort((a, b) => spanOf(table, b).start.localeCompare(spanOf(table, a).start))[0];
    if (!prev) continue;
    // 되돌릴 끝 = 지운 다음 달 행들의 끝 (하나라도 계속이면 계속), 뒤에 남은 행이 있으면 그 앞날까지
    const spans = list.map((r) => spanOf(table, r));
    let end: ISODate | null = spans.some((s) => s.end === null) ? null : spans.map((s) => s.end!).sort().pop()!;
    const later = own
      .map((r) => spanOf(table, r).start)
      .filter((s) => s >= `${next}-01`)
      .sort()[0];
    if (later) {
      const cap = addDays(later, -1);
      if (end === null || end > cap) end = cap;
    }
    if (table !== 'fixedExpenses' || !isDatedBill(prev as FixedExpense)) {
      // 달로 세는 행은 달 끝으로
      end = end === null ? null : monthEndDate(monthOf(end));
    }
    restored.push(withEnd(table, prev, end, today));
  }
  return { removed, restored };
}

/**
 * [초기화]: 다음 달 표시가 붙은 행을 지우고(지움 표시) 앞 행의 끝을 되돌려요 — 다시 이번 달 예산이 이어져요 (다시 해도 같음).
 * first = 지울 행, then = 끝을 되돌린 앞 행. 할부는 건드리지 않아요
 */
export function nextMonthReset(data: LedgerData, today: ISODate): NextMonthWrites {
  const next = nextBudgetMonth(today);
  const rules = resetTable('rules', data.rules, next, today);
  const plans = resetTable('incomePlans', data.incomePlans, next, today);
  const fixed = resetTable('fixedExpenses', data.fixedExpenses, next, today);
  return {
    first: { rules: rules.removed, incomePlans: plans.removed, fixedExpenses: fixed.removed },
    then: { rules: rules.restored, incomePlans: plans.restored, fixedExpenses: fixed.restored },
  };
}

/** 쓸 행이 하나라도 있는지 */
export function hasBudgetWrites(w: NextMonthWrites): boolean {
  return [w.first, w.then].some((x) => x.rules.length + x.incomePlans.length + x.fixedExpenses.length > 0);
}

