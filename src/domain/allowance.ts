import { addMonths, compareMonth, dateInMonth, isMonthActive, isValidMonth, localDateOf, monthOf, monthRange } from './dates';
import { billSeriesId } from './bills';
import { ALLOWANCE_RULE_PREFIX, allowanceIncomeId, allowanceRuleId, isAllowanceRuleId } from './ids';
import { activeAccountsSorted, firstAccountByRole } from './internal';
import { formatMan } from './money';
import { ledgerPeople, memberName, nameMatchesOwner } from './people';
import type { Account, AllocationRule, FixedExpense, ISODate, LedgerData, Transfer, YearMonth, Won } from './types';

function allowancesFor(shared: LedgerData, email: string): FixedExpense[] {
  const target = email.trim().toLowerCase();
  return shared.fixedExpenses.filter(
    (f) => !f.deleted && f.kind === 'allowance' && (f.targetEmail ?? '').trim().toLowerCase() === target,
  );
}

/** 공용 가계부에서 email 에게 month 에 배분된 용돈 합 (kind='allowance', targetEmail 대소문자 무시) */
export function allowanceFor(shared: LedgerData, email: string, month: YearMonth): Won {
  return allowancesFor(shared, email)
    .filter((f) => isMonthActive(month, f.startMonth, f.endMonth))
    .reduce((s, f) => s + f.amount, 0);
}

/**
 * 개인 가계부에 아직 없는 용돈 수입 기록. 공용 고정지출의 dayOfMonth 가 지난 회차만, startMonth 와 개인 가계부 생성 월(이 기기 시간대) 중 늦은 달부터.
 * 받는 통장의 시작일보다 앞선 회차는 만들지 않는다 (시작 잔액에 이미 들어 있음).
 * 받는 통장 = 개인 가계부 role='allowance' 첫 통장 (없으면 []). id = allowanceIncomeId(sharedLedgerId, fixedId, month)
 */
export function pendingAllowanceIncome(
  personal: LedgerData,
  shared: LedgerData,
  sharedLedgerId: string,
  email: string,
  today: ISODate,
  now: string,
): Transfer[] {
  const account = firstAccountByRole(personal, 'allowance');
  if (!account) return [];
  const thisMonth = monthOf(today);
  const created = localDateOf(personal.settings.createdAt);
  let createdMonth = created ? monthOf(created) : thisMonth;
  if (account.openingDate && isValidMonth(monthOf(account.openingDate)) && compareMonth(monthOf(account.openingDate), createdMonth) > 0) {
    createdMonth = monthOf(account.openingDate);
  }
  const existing = new Set(personal.transfers.map((t) => t.id));
  const out: Transfer[] = [];
  for (const f of allowancesFor(shared, email)) {
    if (f.amount <= 0 || !isValidMonth(f.startMonth)) continue;
    const start = compareMonth(f.startMonth, createdMonth) >= 0 ? f.startMonth : createdMonth;
    for (const m of monthRange(start, thisMonth)) {
      if (!isMonthActive(m, f.startMonth, f.endMonth)) continue;
      const date = dateInMonth(m, f.dayOfMonth ?? 1);
      if (date > today || (account.openingDate && date < account.openingDate)) continue;
      const id = allowanceIncomeId(sharedLedgerId, f.id, m);
      if (existing.has(id)) continue;
      existing.add(id);
      out.push({
        id,
        date,
        kind: 'income',
        fromAccountId: null,
        toAccountId: account.id,
        amount: f.amount,
        status: 'done',
        ruleId: null,
        memo: `${shared.settings.name} 용돈`,
        author: email,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      });
    }
  }
  return out;
}

/* ---------- 기존 시트 자동 고치기 (8-2): 용돈 항목 → 배분 · 고정비 ---------- */

/** 옮긴 뒤 한 번 보여 주는 알림 (앞부분) */
export const ALLOWANCE_MOVE_NOTICE = '용돈 항목을 배분/고정비로 옮겼어요';

export interface AllowanceMigration {
  /** 새로 쓸 배분 규칙 (매달 같은 금액, 받는 통장 = 그 사람 용돈 통장) */
  rules: AllocationRule[];
  /** 바꿀 고정지출 행 (용돈 → 지움 표시, 또는 → 일반 고정비 '용돈(이름)') */
  fixedExpenses: FixedExpense[];
  /** 알림 (옮긴 게 없으면 null) */
  notice: string | null;
}

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** 받는 사람(이메일)의 용돈 통장: 주인 이메일이 같은 통장 → (없으면) 주인 이름이 그 사람과 맞는 통장이 하나뿐일 때 */
export function allowanceAccountOf(data: LedgerData, email: string): Account | null {
  const key = lower(email);
  if (!key) return null;
  const wallets = activeAccountsSorted(data).filter((a) => a.role === 'allowance');
  const byEmail = wallets.find((a) => lower(a.ownerEmail) === key);
  if (byEmail) return byEmail;
  const person = ledgerPeople(data).find((p) => lower(p.email) === key);
  if (!person) return null;
  const byName = wallets.filter(
    (a) =>
      !lower(a.ownerEmail) &&
      !!(a.ownerName ?? '').trim() &&
      ((a.ownerName ?? '').trim() === person.name || nameMatchesOwner(person.displayName, a.ownerName ?? '', person.email)),
  );
  return byName.length === 1 ? byName[0]! : null;
}

/** 이 용돈 행에서 이미 자동 기록한 마지막 달 (없으면 null) */
function lastRecordedMonth(data: LedgerData, fixedId: string): YearMonth | null {
  let last: YearMonth | null = null;
  for (const e of data.expenses) {
    if (e.fixedExpenseId !== fixedId) continue;
    const m = monthOf(e.date);
    if (isValidMonth(m) && (last === null || compareMonth(m, last) > 0)) last = m;
  }
  return last;
}

/**
 * 예전 '용돈' 고정지출 행(kind='allowance')을 배분 · 고정비로 옮긴 행 (8-2). 다시 해도 같아요 (옮길 게 없으면 빈 결과).
 * - 받는 사람의 용돈 통장이 있고 그 통장으로 들어오는 배분이 없으면: 수입통장 → 용돈 통장 '매달 같은 금액' 배분
 *   (같은 금액 · 날 · 끝, 시작은 이미 자동 기록한 달의 다음 달부터라 지난 기록과 겹치지 않음) + 용돈 행은 지움 표시
 * - 그 통장으로 들어오는 배분이 이미 있으면: 용돈 행만 지움 표시 (알림에 금액을 적어요)
 * - 아니면: 같은 통장에서 나가는 일반 고정비 '용돈(이름)'으로 (id 가 같아 지난 자동 기록과 겹치지 않음)
 * 이미 자동 기록된 지출은 그대로 둬요. 행은 지우지 않아요 (지움 표시만)
 */
export function migrateAllowanceRows(data: LedgerData): AllowanceMigration {
  const rows = data.fixedExpenses.filter((f) => !f.deleted && f.kind === 'allowance');
  if (rows.length === 0) return { rules: [], fixedExpenses: [], notice: null };
  const accounts = activeAccountsSorted(data);
  const incomes = accounts.filter((a) => a.role === 'income');
  const rules: AllocationRule[] = [];
  const fixedExpenses: FixedExpense[] = [];
  const dropped: string[] = [];

  for (const f of rows) {
    const email = (f.targetEmail ?? '').trim();
    const who = email ? memberName(data, email) : '';
    const asBill = (): FixedExpense => ({ ...f, kind: 'bill', targetEmail: null, name: who ? `용돈(${who})` : f.name });
    const wallet = email ? allowanceAccountOf(data, email) : null;
    const paying = accounts.find((a) => a.id === f.accountId);
    const from = paying?.role === 'income' ? paying : (incomes[0] ?? null);
    if (!wallet || !from || from.id === wallet.id || !isValidMonth(f.startMonth)) {
      fixedExpenses.push(asBill());
      continue;
    }
    const last = lastRecordedMonth(data, f.id);
    const next = last ? addMonths(last, 1) : f.startMonth;
    const start = compareMonth(next, f.startMonth) > 0 ? next : f.startMonth;
    const end = f.endMonth;
    // 앞으로 보낼 회차가 없는 지난 행 (이미 다 기록됨)
    if (end !== null && compareMonth(start, end) > 0) {
      fixedExpenses.push({ ...f, deleted: true });
      continue;
    }
    const id = allowanceRuleId(f.id);
    // 같은 용돈(금액 변경으로 나뉜 행)에서 옮긴 배분은 '이미 있는 배분'으로 치지 않아요
    const series = billSeriesId(f.id);
    const ours = (ruleId: string) => isAllowanceRuleId(ruleId) && billSeriesId(ruleId.slice(ALLOWANCE_RULE_PREFIX.length)) === series;
    const others = data.rules.filter(
      (r) =>
        !r.deleted &&
        !ours(r.id) &&
        r.toAccountId === wallet.id &&
        isValidMonth(r.startMonth) &&
        (r.endMonth === null || compareMonth(r.endMonth, start) >= 0),
    );
    if (others.length > 0) {
      fixedExpenses.push({ ...f, deleted: true });
      dropped.push(`${f.name} ${formatMan(f.amount)}`);
      continue;
    }
    rules.push({
      id,
      fromAccountId: from.id,
      toAccountId: wallet.id,
      amount: f.amount,
      dayOfMonth: f.dayOfMonth ?? 1,
      startMonth: start,
      endMonth: end,
      kind: 'fixed',
      deleted: false,
    });
    fixedExpenses.push({ ...f, deleted: true });
  }
  const notice =
    dropped.length > 0 ? `${ALLOWANCE_MOVE_NOTICE} · 배분이 이미 있어 뺀 용돈: ${dropped.join(', ')}` : ALLOWANCE_MOVE_NOTICE;
  return { rules, fixedExpenses, notice };
}
