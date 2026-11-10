/**
 * 할부 (PLAN 4-10). 고정지출 kind='installment' 행으로 둔다.
 *
 * - 한 할부 = 같은 할부 id 를 가진 행 여럿. 첫 행 id 가 할부 id 이고, 도중에 바꾸면 그달부터 '<할부id>@<월>' 행이 이어진다
 *   (적립액 변경으로 규칙을 나누는 것과 같은 방식). 지난 행의 금액은 고치지 않으므로 이미 자동 기록된 회차는 그대로다
 * - 행마다 시작월 · 종료월 · 금액이 정해져 있고, 회차 번호는 첫 행의 installmentNo(빈 칸이면 1)부터 차례로 센다
 * - 마지막 회차 뒤에는 종료월이 지나 자동 기록이 저절로 멈춘다
 * - 늦게 시작한 행이 자기 시작월부터 앞 행을 끊는다: 앞 행의 종료월이 더 길어도 그 뒤 달은 늦은 행 몫이다
 *   (늦은 행이 그전에 끝나면 그 뒤 달은 회차가 아니다). 그래서 도중에 바꾼 새 행만 저장되고 앞 행을 끝내는 쓰기가
 *   끊겨도, 줄인 회차가 앞 행으로 다시 기록되지 않는다. 앞 행을 끝내는 쓰기는 정리일 뿐이다
 * - 종료월이 시작월보다 앞인 행(0회 행)은 회차를 맡지 않고 그 달부터 끊는 표시다 (그만 내기 · 다 미리 갚기)
 */
import { addMonths, compareMonth, dateInMonth, isValidMonth, monthOf, monthRange } from './dates';
import { autoFixedExpenseId } from './ids';
import type { FixedExpense, Id, InstallmentPayment, InstallmentPlan, ISODate, LedgerData, Won, YearMonth } from './types';

/** 회차 수 한도 (시트에 엉뚱한 값이 있어도 수천 개를 펼치지 않게) */
export const MAX_INSTALLMENT_MONTHS = 120;

export function isInstallment(f: Pick<FixedExpense, 'kind'>): boolean {
  return f.kind === 'installment';
}

/** 행 id 의 할부 id ('tv@2027-03' → 'tv') */
export function installmentPlanId(rowId: Id): Id {
  const i = rowId.indexOf('@');
  return i < 0 ? rowId : rowId.slice(0, i);
}

/** 도중에 바꾼 할부가 month 부터 이어지는 행의 결정적 id. 다시 시도해도 같은 행 */
export function installmentRowId(planId: Id, month: YearMonth): Id {
  return `${planId}@${month}`;
}

/**
 * 미리 갚기 지출의 결정적 id. 남은 금액 · 갚은 금액이 들어가므로 같은 미리 갚기를 다시 시도하면 같은 id(한 번만 기록),
 * 저장이 끝난 뒤의 새 미리 갚기는 남은 금액이 달라 새 id, 금액을 고쳐 다시 하면 그 금액의 새 id 다
 */
export function installmentPrepayId(planId: Id, fromMonth: YearMonth, remainingBefore: Won, amount: Won): Id {
  return `prepay:${planId}:${fromMonth}:${remainingBefore}:${Math.round(amount)}`;
}

/** 할부 미리 갚기 지출인지 (자동 기록이 아님) */
export function isInstallmentPrepay(expense: { id: Id }): boolean {
  return expense.id.startsWith('prepay:');
}

/**
 * 고정 지출 자동 기록인지 (고정비 · 용돈 · 할부 회차). 미리 갚기 지출은 고정지출id 가 있어도(생활비 계산에서 빼려고)
 * 사람이 기록한 것이라 아니다
 */
export function isAutoFixedRecord(expense: { id: Id; fixedExpenseId: Id | null }): boolean {
  return expense.fixedExpenseId !== null && !isInstallmentPrepay(expense);
}

function rowNo(f: FixedExpense): number {
  const n = f.installmentNo;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * 할부 행의 실제 마지막 달: 종료월, 비어 있으면 전체 회차로 센 달 (시작월 + 전체 − 이 행 회차).
 * 둘 다 없으면 시작월부터 한도까지. 시작월이 올바르지 않으면 null
 */
export function installmentRowEnd(f: FixedExpense): YearMonth | null {
  if (!isValidMonth(f.startMonth)) return null;
  const cap = addMonths(f.startMonth, MAX_INSTALLMENT_MONTHS - 1);
  let end: YearMonth = cap;
  if (f.endMonth && isValidMonth(f.endMonth) && compareMonth(f.endMonth, end) < 0) end = f.endMonth;
  const count = f.installmentCount;
  if (typeof count === 'number' && Number.isInteger(count) && count >= 1) {
    const byCount = addMonths(f.startMonth, count - rowNo(f));
    if (compareMonth(byCount, end) < 0) end = byCount;
  }
  return compareMonth(end, f.startMonth) < 0 ? null : end;
}

/** 지우지 않은 할부 행을 할부 id 로 묶는다 (행은 시작월 순) */
export function installmentGroups(fixedExpenses: FixedExpense[]): Map<Id, FixedExpense[]> {
  const groups = new Map<Id, FixedExpense[]>();
  for (const f of fixedExpenses) {
    if (f.deleted || !isInstallment(f) || !isValidMonth(f.startMonth)) continue;
    const id = installmentPlanId(f.id);
    const list = groups.get(id) ?? [];
    list.push(f);
    groups.set(id, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => compareMonth(a.startMonth, b.startMonth) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return groups;
}

/** 결제일. 빈 칸(시트에서 지운 경우)은 1일 — 회차 계산과 자동 기록이 같은 날을 쓴다 */
export function installmentDay(f: Pick<FixedExpense, 'dayOfMonth'>): number {
  const d = f.dayOfMonth;
  return typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= 31 ? d : 1;
}

/**
 * 한 할부의 회차 목록. 달마다 그달 이전(포함)에 시작한 행 중 가장 늦게 시작한 행이 맡는다 (그 행이 그달 전에 끝났으면 회차 없음).
 * 번호는 첫 행의 installmentNo(빈 칸 1)부터 달 순서대로. today 를 주면 결제일이 오늘 이전(포함)인 회차가 paid
 */
export function installmentPayments(rows: FixedExpense[], today?: ISODate): InstallmentPayment[] {
  const sorted = rows
    .filter((f) => !f.deleted && isValidMonth(f.startMonth))
    .sort((a, b) => compareMonth(a.startMonth, b.startMonth) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const first = sorted[0];
  if (!first) return [];
  const owner = new Map<YearMonth, FixedExpense>();
  sorted.forEach((f, i) => {
    let end = installmentRowEnd(f);
    if (!end) return; // 0회 행: 회차 없이 앞 행만 끊는다
    const later = sorted[i + 1];
    if (later) {
      // 다음 행의 시작월부터는 다음 행 몫 (같은 달에 시작하면 이 행은 맡을 달이 없다)
      const cut = addMonths(later.startMonth, -1);
      if (compareMonth(cut, end) < 0) end = cut;
      if (compareMonth(end, f.startMonth) < 0) return;
    }
    for (const m of monthRange(f.startMonth, end)) owner.set(m, f);
  });
  const months = [...owner.keys()].sort(compareMonth);
  let no = rowNo(first);
  return months.map((month) => {
    const f = owner.get(month)!;
    const date = dateInMonth(month, installmentDay(f));
    return {
      month,
      date,
      number: no++,
      amount: Math.max(0, f.amount),
      rowId: f.id,
      accountId: f.accountId,
      paid: today !== undefined && date <= today,
    };
  });
}

/** 이 행이 month 회차를 맡는지 (같은 할부의 다른 행이 덮지 않는지) */
export function installmentOwnsMonth(rows: FixedExpense[], row: FixedExpense, month: YearMonth): InstallmentPayment | null {
  const p = installmentPayments(rows).find((x) => x.month === month);
  return p && p.rowId === row.id ? p : null;
}

function expenseIdSet(data: LedgerData): Set<Id> {
  return new Set(data.expenses.map((e) => e.id));
}

/** 결제일이 지났거나 이미 자동 기록된 회차를 낸 것으로 본다 */
function planOf(recorded: Set<Id>, id: Id, rows: FixedExpense[], today: ISODate): InstallmentPlan | null {
  const payments = installmentPayments(rows, today).map((p) => ({
    ...p,
    paid: p.paid || recorded.has(autoFixedExpenseId(p.rowId, p.month)),
  }));
  const first = rows[0];
  if (!first) return null;
  const before = rowNo(first) - 1; // 앞서 낸 회차 (기록 전)
  if (payments.length === 0) {
    // 첫 회차 전에 그만 냈거나 다 미리 갚은 할부: 끝난 할부로 남긴다 (목록에서 사라지지 않게)
    return {
      id,
      name: first.name,
      accountId: first.accountId,
      categoryId: first.categoryId,
      dayOfMonth: installmentDay(first),
      rows,
      payments: [],
      firstMonth: addMonths(first.startMonth, -before),
      count: before,
      paidCount: before,
      remainingCount: 0,
      remainingAmount: 0,
      next: null,
      last: null,
      endMonth: addMonths(first.startMonth, -1),
      monthly: Math.max(0, first.amount),
      ended: true,
    };
  }
  const next = payments.find((p) => !p.paid) ?? null;
  const last = payments[payments.length - 1] ?? null;
  const unpaid = payments.filter((p) => !p.paid);
  const current = rows.find((r) => r.id === (next ?? last)?.rowId) ?? rows[rows.length - 1]!;
  return {
    id,
    name: current.name,
    accountId: current.accountId,
    categoryId: current.categoryId,
    dayOfMonth: installmentDay(current),
    rows,
    payments,
    firstMonth: addMonths(payments[0]!.month, -before),
    count: before + payments.length,
    paidCount: before + payments.length - unpaid.length,
    remainingCount: unpaid.length,
    remainingAmount: unpaid.reduce((s, p) => s + p.amount, 0),
    next,
    last,
    endMonth: last ? last.month : addMonths(first.startMonth, -1),
    monthly: (next ?? last)?.amount ?? 0,
    ended: next === null,
  };
}

/** 할부 하나 (없거나 모두 지웠으면 null) */
export function installmentPlan(data: LedgerData, planId: Id, today: ISODate): InstallmentPlan | null {
  const rows = installmentGroups(data.fixedExpenses).get(planId);
  return rows ? planOf(expenseIdSet(data), planId, rows, today) : null;
}

/** 모든 할부. 진행 중인 것 먼저(다음 결제일 순), 끝난 것은 뒤(마지막 회차가 늦은 순) */
export function installmentPlans(data: LedgerData, today: ISODate): InstallmentPlan[] {
  const out: InstallmentPlan[] = [];
  const recorded = expenseIdSet(data);
  for (const [id, rows] of installmentGroups(data.fixedExpenses)) {
    const p = planOf(recorded, id, rows, today);
    if (p) out.push(p);
  }
  return out.sort((a, b) => {
    if (a.ended !== b.ended) return a.ended ? 1 : -1;
    if (!a.ended) return a.next!.date < b.next!.date ? -1 : a.next!.date > b.next!.date ? 1 : 0;
    return compareMonth(b.endMonth, a.endMonth) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

/** 'TV 할부 · 16/24회차' 처럼 자동 기록 메모에 붙일 회차 */
export function installmentMemo(name: string, number: number, count: number): string {
  return `${name} ${number}/${count}회차`;
}

/* ---------- 금액 나누기 ---------- */

/**
 * 총액을 n 회로 나눈 회차 금액. 원 단위로 나누어떨어지지 않는 나머지는 1회차에 더한다 (카드 할부와 같게).
 * 예: 1,000,000원 3회 → [333,334, 333,333, 333,333]
 */
export function splitTotal(total: Won, months: number): Won[] {
  const n = Math.max(0, Math.floor(months));
  if (n === 0) return [];
  const t = Math.max(0, Math.round(total));
  const base = Math.floor(t / n);
  const out = Array.from({ length: n }, () => base);
  out[0] = base + (t - base * n);
  return out;
}

/** 같은 금액이 이어지는 회차를 묶는다: [{start, amounts}]. breaks 의 달에서는 금액이 같아도 새로 묶는다 */
function segmentsOf(
  fromMonth: YearMonth,
  amounts: Won[],
  breaks: ReadonlySet<YearMonth> = new Set(),
): { start: YearMonth; amount: Won; length: number }[] {
  const out: { start: YearMonth; amount: Won; length: number }[] = [];
  amounts.forEach((amount, i) => {
    const last = out[out.length - 1];
    const month = addMonths(fromMonth, i);
    if (last && last.amount === amount && !breaks.has(month)) last.length += 1;
    else out.push({ start: month, amount, length: 1 });
  });
  return out;
}

/* ---------- 새 할부 ---------- */

export interface InstallmentInput {
  name: string;
  /** 총액 또는 매달 금액 */
  amount: Won;
  amountKind: 'total' | 'monthly';
  /** 전체 회차 (개월) */
  months: number;
  /** 1회차의 달 (지난 달이어도 된다: 이미 낸 회차는 기록하지 않고 회차만 센다) */
  firstMonth: YearMonth;
  dayOfMonth: number;
  accountId: Id;
  categoryId: Id | null;
}

/** 입력의 회차 금액 목록 (1회차부터) */
export function installmentAmounts(input: Pick<InstallmentInput, 'amount' | 'amountKind' | 'months'>): Won[] {
  const n = Math.floor(input.months);
  if (input.amountKind === 'total') return splitTotal(input.amount, n);
  return Array.from({ length: Math.max(0, n) }, () => Math.max(0, Math.round(input.amount)));
}

/** 입력 확인. 문제가 없으면 null, 있으면 한국어 문구 */
export function validateInstallment(input: InstallmentInput, today: ISODate): string | null {
  if (!input.name.trim()) return '이름을 입력해 주세요';
  if (!(input.amount > 0)) return '금액을 입력해 주세요';
  if (!Number.isInteger(input.months) || input.months < 2 || input.months > MAX_INSTALLMENT_MONTHS)
    return `할부 개월은 2~${MAX_INSTALLMENT_MONTHS}개월로 입력해 주세요`;
  if (input.amountKind === 'total' && input.amount < input.months) return '총액이 회차보다 적어요';
  if (!isValidMonth(input.firstMonth)) return '첫 달을 골라 주세요';
  if (!input.accountId) return '통장을 골라 주세요';
  const lastDate = dateInMonth(addMonths(input.firstMonth, input.months - 1), input.dayOfMonth);
  if (lastDate < today) return '이미 다 낸 할부예요';
  return null;
}

/**
 * 새 할부의 행. 결제일이 오늘보다 앞선 회차는 이미 낸 것으로 보고 기록하지 않는다
 * (만들기 전 날짜로 지출이 소급해 생기지 않게. 첫 행 installmentNo 로 회차만 이어 센다).
 * 회차 금액이 바뀌는 곳(나머지를 더한 1회차)에서 행을 나눈다
 */
export function buildInstallmentRows(input: InstallmentInput, planId: Id, today: ISODate): FixedExpense[] {
  const error = validateInstallment(input, today);
  if (error) throw new Error(error);
  const day = Math.min(31, Math.max(1, Math.floor(input.dayOfMonth)));
  const amounts = installmentAmounts(input);
  let skip = 0;
  while (skip < amounts.length && dateInMonth(addMonths(input.firstMonth, skip), day) < today) skip++;
  const from = addMonths(input.firstMonth, skip);
  const count = amounts.length;
  return segmentsOf(from, amounts.slice(skip)).map((s, i) => ({
    id: i === 0 ? planId : installmentRowId(planId, s.start),
    name: input.name.trim(),
    amount: s.amount,
    accountId: input.accountId,
    categoryId: input.categoryId,
    dayOfMonth: day,
    kind: 'installment',
    targetEmail: null,
    spread: 'daily',
    startMonth: s.start,
    endMonth: addMonths(s.start, s.length - 1),
    installmentNo: skip + 1 + compareMonth(s.start, from),
    installmentCount: count,
    deleted: false,
  }));
}

/* ---------- 도중에 바꾸기 ---------- */

/** 바꿀 수 있는 가장 이른 달 = 아직 내지 않은 다음 회차의 달 (없으면 null = 끝난 할부) */
export function earliestChangeMonth(plan: InstallmentPlan): YearMonth | null {
  return plan.next?.month ?? null;
}

/** fromMonth 부터 남은 회차 금액 목록 */
export function remainingAmountsFrom(plan: InstallmentPlan, fromMonth: YearMonth): Won[] {
  return plan.payments.filter((p) => compareMonth(p.month, fromMonth) >= 0).map((p) => p.amount);
}

export interface InstallmentPatch {
  name?: string;
  accountId?: Id;
  categoryId?: Id | null;
  dayOfMonth?: number;
}

/**
 * PLAN 4-10 도중에 바꾸기. fromMonth 회차부터 amounts(남은 회차 금액, 빈 목록 = 그만 내기)로 다시 짠다.
 * 지난 회차는 그대로: fromMonth 를 덮는 행은 그 전 달로 끝내고, fromMonth 부터 시작하는 행은 같은 id 로 다시 쓰거나 지운다.
 * 빈 목록이면 fromMonth 에 0회 행(끊는 표시)을 쓴다 — 첫 회차 전이어도 행이 남아 끝난 할부로 보인다.
 *
 * 반환 순서가 곧 쓰는 순서다 (중간에 끊겨도 줄인 회차가 다시 기록되지 않게):
 * 1) 새 일정보다 뒤에서 시작하는 옛 행 지우기 (뒤에서부터)
 * 2) 새로 짠 행 (앞에서부터. 옛 행이 시작하는 달에서 나눠 그 행을 같은 id 로 덮어쓴다)
 * 3) fromMonth 를 덮는 옛 행 끝내기 · 이름 바꾸기 (늦게 시작한 행이 이미 끊으므로 정리일 뿐)
 * - fromMonth 는 아직 내지 않은 다음 회차의 달 이후여야 한다
 * - patch.name 은 모든 행에(지난 기록 메모는 그대로), 통장 · 카테고리 · 결제일은 fromMonth 부터
 */
export function replanInstallment(
  plan: InstallmentPlan,
  fromMonth: YearMonth,
  amounts: Won[],
  patch: InstallmentPatch = {},
): FixedExpense[] {
  const earliest = earliestChangeMonth(plan);
  if (!earliest) throw new Error('이미 다 낸 할부예요');
  if (!isValidMonth(fromMonth) || compareMonth(fromMonth, earliest) < 0) throw new Error('이미 낸 회차는 바꿀 수 없어요');
  const at = plan.payments.find((p) => p.month === fromMonth);
  if (!at) throw new Error('바꿀 회차를 찾을 수 없어요');
  if (amounts.length > MAX_INSTALLMENT_MONTHS) throw new Error(`남은 회차는 ${MAX_INSTALLMENT_MONTHS}회까지예요`);
  if (amounts.some((a) => !(a > 0))) throw new Error('회차 금액을 확인해 주세요');

  const template = plan.rows.find((r) => r.id === at.rowId)!;
  const startNo = at.number;
  const count = startNo - 1 + amounts.length;
  const name = patch.name?.trim() || undefined;
  const idFor = (m: YearMonth) => {
    const same = plan.rows.find((r) => r.startMonth === m);
    if (same && (same.id === plan.id || same.id === installmentRowId(plan.id, m))) return same.id;
    return installmentRowId(plan.id, m);
  };
  const fields = {
    ...template,
    ...(name ? { name } : {}),
    ...(patch.accountId !== undefined ? { accountId: patch.accountId } : {}),
    ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
    ...(patch.dayOfMonth !== undefined ? { dayOfMonth: Math.min(31, Math.max(1, Math.floor(patch.dayOfMonth))) } : {}),
    kind: 'installment' as const,
    installmentCount: count,
    deleted: false,
  };

  // 옛 행이 시작하는 달에서 나눠, 그 행을 같은 id 로 덮어쓴다 (따로 지울 필요가 없게)
  const breaks = new Set(plan.rows.map((r) => r.startMonth).filter((m) => compareMonth(m, fromMonth) > 0));
  const created: FixedExpense[] =
    amounts.length > 0
      ? segmentsOf(fromMonth, amounts.map((a) => Math.round(a)), breaks).map((s) => ({
          ...fields,
          id: idFor(s.start),
          amount: s.amount,
          startMonth: s.start,
          endMonth: addMonths(s.start, s.length - 1),
          installmentNo: startNo + compareMonth(s.start, fromMonth),
        }))
      : [
          // 그만 내기 · 다 미리 갚기: fromMonth 부터 끊는 0회 행
          { ...fields, id: idFor(fromMonth), startMonth: fromMonth, endMonth: addMonths(fromMonth, -1), installmentNo: startNo },
        ];
  const createdIds = new Set(created.map((r) => r.id));

  const removed: FixedExpense[] = [];
  const tidied: FixedExpense[] = [];
  for (const r of plan.rows) {
    if (createdIds.has(r.id)) continue;
    const end = installmentRowEnd(r);
    if (compareMonth(r.startMonth, fromMonth) >= 0) {
      removed.push({ ...r, deleted: true });
    } else if (end && compareMonth(end, fromMonth) >= 0) {
      tidied.push({ ...r, ...(name ? { name } : {}), endMonth: addMonths(fromMonth, -1), installmentCount: count });
    } else if (name && r.name !== name) {
      tidied.push({ ...r, name });
    }
  }
  removed.sort((a, b) => compareMonth(b.startMonth, a.startMonth));
  return [...removed, ...created, ...tidied];
}

/** 매달 금액 · 남은 회차를 fromMonth 부터 바꾼 회차 금액 목록 (안 준 값은 지금 그대로) */
export function revisedAmounts(
  plan: InstallmentPlan,
  fromMonth: YearMonth,
  change: { monthly?: Won; remaining?: number },
): Won[] {
  const current = remainingAmountsFrom(plan, fromMonth);
  const remaining = change.remaining ?? current.length;
  if (!Number.isInteger(remaining) || remaining < 0) throw new Error('남은 회차를 확인해 주세요');
  if (change.monthly === undefined && change.remaining === undefined) return current;
  if (change.monthly === undefined) {
    // 회차만 바뀌면 지금 회차 금액을 그대로 이어 쓴다 (예: 미리 갚아서 8회 → 4회)
    const monthly = current[0] ?? plan.monthly;
    return Array.from({ length: remaining }, (_, i) => current[i] ?? monthly);
  }
  if (!(change.monthly > 0)) throw new Error('매달 금액을 입력해 주세요');
  return Array.from({ length: remaining }, () => Math.round(change.monthly!));
}

/**
 * 미리 갚기 뒤 남은 회차 금액. 남은 금액 R(fromMonth 부터) 에서 amount 를 뺀다.
 * keep='monthly': 매달 금액은 그대로 두고 회차를 줄인다 (나누어떨어지지 않으면 마지막 회차가 적다)
 * keep='months': 회차는 그대로 두고 매달 금액을 줄인다 (나머지는 첫 회차에)
 * 남은 금액을 다 갚으면 빈 목록
 */
export function prepaidAmounts(plan: InstallmentPlan, fromMonth: YearMonth, amount: Won, keep: 'monthly' | 'months'): Won[] {
  const current = remainingAmountsFrom(plan, fromMonth);
  const total = current.reduce((s, a) => s + a, 0);
  const p = Math.round(amount);
  if (!(p > 0)) throw new Error('미리 갚을 금액을 입력해 주세요');
  if (p > total) throw new Error(`남은 금액 ${total.toLocaleString('ko-KR')}원보다 많아요`);
  const left = total - p;
  if (left === 0) return [];
  if (keep === 'months') return splitTotal(left, current.length);
  const monthly = current[0] ?? plan.monthly;
  const n = Math.floor(left / monthly);
  const rest = left - n * monthly;
  return [...Array.from({ length: n }, () => monthly), ...(rest > 0 ? [rest] : [])];
}

/** 할부를 지운다: 모든 행 deleted (이미 자동 기록된 지출은 남는다) */
export function deleteInstallmentRows(plan: InstallmentPlan): FixedExpense[] {
  return plan.rows.map((r) => ({ ...r, deleted: true }));
}

/** 그 회차 달에 이 통장에서 나갈 할부 중 아직 자동 기록되지 않은 것 (예측용) */
export function unrecordedInstallmentPayments(data: LedgerData, accountId: Id): InstallmentPayment[] {
  const ids = expenseIdSet(data);
  const opening = data.accounts.find((a) => a.id === accountId)?.openingDate ?? '';
  const out: InstallmentPayment[] = [];
  for (const rows of installmentGroups(data.fixedExpenses).values()) {
    for (const p of installmentPayments(rows)) {
      if (p.accountId !== accountId || p.amount <= 0) continue;
      if (p.date < opening) continue; // 통장 시작 전 회차는 시작 잔액에 이미 들어 있다
      if (ids.has(autoFixedExpenseId(p.rowId, p.month))) continue;
      out.push(p);
    }
  }
  return out;
}

/** 오늘 기준 이번 달 (예측에서 지난 미기록 회차를 이번 달로 모을 때) */
export function projectionMonthOf(p: InstallmentPayment, today: ISODate): YearMonth {
  const m = monthOf(today);
  return compareMonth(p.month, m) < 0 ? m : p.month;
}
