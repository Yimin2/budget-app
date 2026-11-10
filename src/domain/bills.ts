/**
 * 고정비의 시작 · 끝 · 결제일 · 금액 변경 · 세부 항목 — PLAN 4-15.
 *
 * - 결제일 = dayOfMonth (말일보다 크면 말일). 새로 넣을 때 기본은 시작일의 날
 * - 결제는 시작일 이후(포함) 첫 결제일부터, 해지 · 만기일 이전(포함) 마지막 결제일까지 매달 한 번.
 *   예: 11/10 시작 · 결제일 10일 → 12/05 해지면 마지막 결제 11/10, 12/15 해지면 12/10
 * - startMonth · endMonth 는 첫 · 마지막 결제가 있는 달로 맞춘다 (달 단위로만 보는 코드도 같은 답을 내게)
 * - 금액 변경(언제부터 E)은 배분 규칙처럼 행을 나눈다: 앞 행은 E 전날로 끝내고, id '<고정비id>@<E>' 새 행이 E 부터.
 *   앞 행의 지난 자동 기록(fixed:<행id>:<월>)은 그대로이고, 한 달에 두 행이 결제하는 일은 없다
 * - 세부 항목이 있으면 결제 금액 = 그 결제일에 살아 있는 항목 합
 *
 * 할부(installment)는 4-10 의 회차 모델을 그대로 쓰고, 생활비(living)는 결제가 없다
 */
import { addDays, addMonths, compareMonth, dateInMonth, formatShortDate, isMonthActive, isValidDate, isValidMonth, monthOf, monthRange } from './dates';
import { autoFixedExpenseId } from './ids';
import { formatWon } from './money';
import type { FixedExpense, FixedSubItem, Id, ISODate, Won, YearMonth } from './types';

/** 끝이 없는 고정비를 셀 때의 한도 (달) */
const MAX_SCAN_MONTHS = 240;

/** 날짜로 결제하는 고정 지출인지 (고정비 · 용돈). 할부 · 생활비는 아니다 */
export function isDatedBill(f: Pick<FixedExpense, 'kind'>): boolean {
  return f.kind === 'bill' || f.kind === 'allowance';
}

/** 행 id 의 고정비 id ('netflix@2027-01-15' → 'netflix') */
export function billSeriesId(rowId: Id): Id {
  const i = rowId.indexOf('@');
  return i < 0 ? rowId : rowId.slice(0, i);
}

/** 금액을 바꾼 날부터 이어지는 행의 결정적 id (다시 시도해도 같은 행) */
export function billSegmentId(seriesId: Id, from: ISODate): Id {
  return `${seriesId}@${from}`;
}

/** 결제일: dayOfMonth, 없으면 시작일의 날, 그것도 없으면 null (결제 없음) */
export function billDay(f: Pick<FixedExpense, 'dayOfMonth' | 'startDate'>): number | null {
  const d = f.dayOfMonth;
  if (typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= 31) return d;
  if (f.startDate && isValidDate(f.startDate)) return Number(f.startDate.slice(8, 10));
  return null;
}

const validDate = (d: ISODate | null | undefined): ISODate | null => (d && isValidDate(d) ? d : null);

/**
 * month 의 결제일 (그달 결제가 없으면 null). 통장 시작일은 보지 않는다 (자동 기록은 recurring 에서 따로 막음).
 * 시작월 ~ 종료월 안이고, 시작일 ≤ 결제일 ≤ 해지일 일 때만
 */
export function billChargeDate(f: FixedExpense, month: YearMonth): ISODate | null {
  if (f.deleted || !isDatedBill(f) || !isValidMonth(f.startMonth)) return null;
  const day = billDay(f);
  if (day === null || !isMonthActive(month, f.startMonth, f.endMonth)) return null;
  const date = dateInMonth(month, day);
  const start = validDate(f.startDate);
  const end = validDate(f.endDate);
  if (start && date < start) return null;
  if (end && date > end) return null;
  return date;
}

/** 결제일에 살아 있는 세부 항목 */
export function activeSubItems(f: Pick<FixedExpense, 'subItems'>, date: ISODate): FixedSubItem[] {
  return (f.subItems ?? []).filter((s) => {
    const start = validDate(s.startDate);
    const end = validDate(s.endDate);
    return (!start || date >= start) && (!end || date <= end);
  });
}

export function hasSubItems(f: Pick<FixedExpense, 'subItems'>): boolean {
  return (f.subItems ?? []).length > 0;
}

/** 그 결제일의 금액: 세부 항목이 있으면 살아 있는 항목 합, 없으면 amount */
export function billAmountOn(f: Pick<FixedExpense, 'amount' | 'subItems'>, date: ISODate): Won {
  if (!hasSubItems(f)) return Math.max(0, f.amount);
  return activeSubItems(f, date).reduce((s, x) => s + Math.max(0, Math.round(x.amount)), 0);
}

/** 자동 기록 메모: '회비 (목장 40,000원 · 초원 30,000원)' — 세부 항목이 없으면 이름만 */
export function billMemo(f: Pick<FixedExpense, 'name' | 'subItems'>, date: ISODate): string {
  const items = activeSubItems(f, date);
  if (items.length === 0) return f.name;
  return `${f.name} (${items.map((x) => `${x.name} ${formatWon(Math.round(x.amount))}`).join(' · ')})`;
}

export interface BillCharge {
  rowId: Id;
  seriesId: Id;
  name: string;
  accountId: Id;
  date: ISODate;
  amount: Won;
}

/** 이 행의 [from, to) 결제 (날짜 순) */
export function billCharges(f: FixedExpense, from: ISODate, to: ISODate): BillCharge[] {
  if (to <= from) return [];
  const out: BillCharge[] = [];
  for (const m of monthRange(monthOf(from), monthOf(to))) {
    const date = billChargeDate(f, m);
    if (date === null || date < from || date >= to) continue;
    out.push({ rowId: f.id, seriesId: billSeriesId(f.id), name: f.name, accountId: f.accountId, date, amount: billAmountOn(f, date) });
  }
  return out;
}

/** 첫 결제일 (없으면 null) */
export function firstChargeDate(f: FixedExpense): ISODate | null {
  if (!isValidMonth(f.startMonth)) return null;
  const last = f.endMonth && isValidMonth(f.endMonth) ? f.endMonth : addMonths(f.startMonth, MAX_SCAN_MONTHS);
  if (compareMonth(last, f.startMonth) < 0) return null;
  // 시작월 · 그 다음 달 안에 보통 나온다. 해지일이 앞이면 없다
  for (const m of monthRange(f.startMonth, compareMonth(last, addMonths(f.startMonth, 2)) < 0 ? last : addMonths(f.startMonth, 2))) {
    const d = billChargeDate(f, m);
    if (d) return d;
  }
  return null;
}

/** 마지막 결제일. 끝이 없으면(해지일 · 종료월 없음) null */
export function lastChargeDate(f: FixedExpense): ISODate | null {
  if (!isValidMonth(f.startMonth)) return null;
  if (!(f.endMonth && isValidMonth(f.endMonth)) && !validDate(f.endDate)) return null;
  const end = f.endMonth && isValidMonth(f.endMonth) ? f.endMonth : monthOf(f.endDate!);
  for (let i = 0; i < 3; i++) {
    const m = addMonths(end, -i);
    if (compareMonth(m, f.startMonth) < 0) break;
    const d = billChargeDate(f, m);
    if (d) return d;
  }
  return null;
}

/** 끝이 있는 행인지 (해지일 또는 종료월) */
export function billHasEnd(f: Pick<FixedExpense, 'endMonth' | 'endDate'>): boolean {
  return !!(validDate(f.endDate) || (f.endMonth && isValidMonth(f.endMonth)));
}

/**
 * 시작일 · 해지일이 있으면 startMonth · endMonth 를 첫 · 마지막 결제가 있는 달로 맞춘다 (결제가 없으면 종료월 = 시작월 앞 달).
 * 세부 항목이 있으면 amount 를 asOf 이후 첫 결제(없으면 첫 결제)의 항목 합으로. 시작일 · 해지일 · 세부 항목이 없는 행은 그대로
 */
export function normalizeBill(f: FixedExpense, asOf?: ISODate): FixedExpense {
  if (!isDatedBill(f)) return f;
  const start = validDate(f.startDate);
  const end = validDate(f.endDate);
  let out: FixedExpense = { ...f };
  const day = billDay(out);
  if (start && out.dayOfMonth === null && day !== null) out.dayOfMonth = day;
  if (start && day !== null) {
    const sm = monthOf(start);
    out.startMonth = dateInMonth(sm, day) >= start ? sm : addMonths(sm, 1);
  }
  if (end && day !== null && isValidMonth(out.startMonth)) {
    const em = monthOf(end);
    const lastMonth = dateInMonth(em, day) <= end ? em : addMonths(em, -1);
    out.endMonth = compareMonth(lastMonth, out.startMonth) < 0 ? addMonths(out.startMonth, -1) : lastMonth;
  }
  if (hasSubItems(out)) {
    out = {
      ...out,
      subItems: (out.subItems ?? []).map((s) => ({
        name: s.name.trim(),
        amount: Math.max(0, Math.round(s.amount)),
        ...(validDate(s.startDate) ? { startDate: s.startDate } : {}),
        ...(validDate(s.endDate) ? { endDate: s.endDate } : {}),
      })),
    };
    const next = asOf ? nextChargeOnOrAfter(out, asOf) : null;
    const ref = next ?? firstChargeDate(out) ?? asOf ?? null;
    out.amount = ref ? billAmountOn(out, ref) : out.amount;
  }
  return out;
}

/** date 이후(포함) 첫 결제일 (없으면 null) */
export function nextChargeOnOrAfter(f: FixedExpense, date: ISODate): ISODate | null {
  if (!isValidMonth(f.startMonth)) return null;
  const from = compareMonth(monthOf(date), f.startMonth) < 0 ? f.startMonth : monthOf(date);
  for (let i = 0; i < 3; i++) {
    const m = addMonths(from, i);
    if (f.endMonth && isValidMonth(f.endMonth) && compareMonth(m, f.endMonth) > 0) return null;
    const d = billChargeDate(f, m);
    if (d && d >= date) return d;
  }
  return null;
}

/** 한 고정비의 행 (지우지 않은 것, 시작 순). 행 id 가 '<id>' · '<id>@<날짜>' 인 것 */
export function billSeriesRows(fixedExpenses: FixedExpense[], seriesId: Id): FixedExpense[] {
  return fixedExpenses
    .filter((f) => !f.deleted && isDatedBill(f) && billSeriesId(f.id) === seriesId)
    .sort((a, b) => rowStart(a).localeCompare(rowStart(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 행이 시작하는 날 (시작일, 없으면 시작월 1일) */
export function rowStart(f: Pick<FixedExpense, 'startDate' | 'startMonth'>): ISODate {
  return validDate(f.startDate) ?? (isValidMonth(f.startMonth) ? `${f.startMonth}-01` : '');
}

/** 고정비를 묶어 하나씩 (고정비 id → 행들) */
export function billSeries(fixedExpenses: FixedExpense[]): Map<Id, FixedExpense[]> {
  const ids = new Set(fixedExpenses.filter((f) => !f.deleted && isDatedBill(f)).map((f) => billSeriesId(f.id)));
  return new Map([...ids].map((id) => [id, billSeriesRows(fixedExpenses, id)]));
}

/** 지금 보여 줄 행: 오늘이 든 행 → 앞으로 시작할 행 → 마지막 행 */
export function currentBillRow(rows: FixedExpense[], today: ISODate): FixedExpense | null {
  if (rows.length === 0) return null;
  const live = [...rows].reverse().find((r) => rowStart(r) <= today && !rowEnded(r, today));
  if (live) return live;
  return rows.find((r) => rowStart(r) > today) ?? rows[rows.length - 1]!;
}

function rowEnded(f: FixedExpense, today: ISODate): boolean {
  const end = validDate(f.endDate);
  if (end) return end < today;
  return !!(f.endMonth && isValidMonth(f.endMonth) && compareMonth(f.endMonth, monthOf(today)) < 0);
}

export type SplitResult = { ok: true; rows: FixedExpense[] } | { ok: false; error: string };

/**
 * 금액 변경 (언제부터 from). 쓰는 순서대로 행을 돌려준다: [새 행, 앞 행 끝내기] 또는 [그 자리에서 고친 행].
 * - from 이 그 행의 첫 결제일 이전(포함)이면 그 자리에서 금액만 바꾼다
 * - 아니면 앞 행을 from 전날로 끝내고, id '<고정비id>@<from>' 새 행이 from 부터 (해지일은 새 행이 이어받는다)
 * - from 이후 결제가 이미 자동 기록됐으면(recordedIds) 바꾸지 않는다: 지난 기록은 그대로 둔다
 * - 세부 항목이 있는 고정비는 항목의 날짜로 바꾼다
 */
export function splitBillAmount(
  fixedExpenses: FixedExpense[],
  rowId: Id,
  amount: Won,
  from: ISODate,
  recordedIds: ReadonlySet<Id>,
  asOf?: ISODate,
): SplitResult {
  if (!(amount > 0)) return { ok: false, error: '금액을 입력해 주세요' };
  if (!isValidDate(from)) return { ok: false, error: '언제부터를 골라 주세요' };
  const seriesId = billSeriesId(rowId);
  const rows = billSeriesRows(fixedExpenses, seriesId);
  // from 을 덮는 행: from 이전(포함)에 시작한 마지막 행, 없으면 첫 행
  const target = [...rows].reverse().find((r) => rowStart(r) <= from) ?? rows[0];
  if (!target) return { ok: false, error: '고정 지출을 찾을 수 없어요' };
  if (hasSubItems(target)) return { ok: false, error: '세부 항목이 있으면 항목마다 시작일 · 종료일로 바꿔 주세요' };
  // from 이후 결제 중 이미 기록된 것이 있으면 안 된다
  const lastAllowed = rows
    .flatMap((r) => billCharges(r, from, addDays(from, 31 * MAX_SCAN_MONTHS)).filter((c) => recordedIds.has(autoFixedExpenseId(r.id, monthOf(c.date)))))
    .map((c) => c.date)
    .sort()
    .pop();
  if (lastAllowed) return { ok: false, error: `${formatShortDate(lastAllowed)} 결제가 이미 기록됐어요. 그 뒤 날짜부터 바꿀 수 있어요` };
  const rounded = Math.round(amount);
  const first = firstChargeDate(target);
  if (first === null || from <= first || rowStart(target) >= from) {
    return { ok: true, rows: [normalizeBill({ ...target, amount: rounded }, asOf)] };
  }
  const next = rows[rows.indexOf(target) + 1];
  const created = normalizeBill(
    {
      ...target,
      id: billSegmentId(seriesId, from),
      amount: rounded,
      startDate: from,
      // 뒤에 이미 다른 행이 있으면 그 앞날까지, 없으면 앞 행의 끝을 이어받는다
      endDate: next ? addDays(rowStart(next), -1) : (validDate(target.endDate) ?? null),
      endMonth: next ? null : target.endMonth,
    },
    asOf,
  );
  if (next && !validDate(created.endDate)) created.endMonth = target.endMonth;
  const ended = normalizeBill({ ...target, endDate: addDays(from, -1) }, asOf);
  return { ok: true, rows: [created, ended] };
}

/** 이 고정비의 행을 모두 끝내기 (해지일 end). 해지일 뒤에 시작하는 행은 지운다 */
export function endBillSeries(fixedExpenses: FixedExpense[], seriesId: Id, end: ISODate, asOf?: ISODate): FixedExpense[] {
  const out: FixedExpense[] = [];
  for (const r of billSeriesRows(fixedExpenses, seriesId)) {
    if (rowStart(r) > end) out.push({ ...r, deleted: true });
    else {
      const cur = validDate(r.endDate);
      if (cur && cur <= end) continue;
      if (!cur && r.endMonth && isValidMonth(r.endMonth) && compareMonth(r.endMonth, monthOf(end)) < 0) continue;
      out.push(normalizeBill({ ...r, endDate: end }, asOf));
    }
  }
  return out;
}
