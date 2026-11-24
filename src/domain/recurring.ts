import { compareMonth, dateInMonth, isMonthActive, isValidMonth, monthOf, monthRange } from './dates';
import { AUTO_RULE_MEMO, autoRuleAmount, isAutoRule } from './allocation';
import { billAmountOn, billChargeDate, billMemo, isDatedBill } from './bills';
import { autoFixedExpenseId, autoTransferId } from './ids';
import {
  installmentDay, installmentGroups, installmentMemo, installmentPayments, installmentPlanId, installmentRowEnd, isInstallment,
} from './installments';
import { isRemainderRule, paydayIncomeDates, remainderAmount, ruleDueDate } from './income';
import type { AllocationRule, AutoRecords, Expense, FixedExpense, Id, ISODate, LedgerData, Transfer, YearMonth } from './types';

/** 이 통장들 중 가장 늦은 시작일 (모르는 통장은 건너뜀). 그날 전의 기록은 잔액에 들어가지 않는다 */
function latestOpeningDate(data: LedgerData, accountIds: (Id | null)[]): ISODate | null {
  let latest: ISODate | null = null;
  for (const id of accountIds) {
    if (!id) continue;
    const a = data.accounts.find((x) => x.id === id);
    if (a && a.openingDate && (latest === null || a.openingDate > latest)) latest = a.openingDate;
  }
  return latest;
}

/** 반복 기록을 펼칠 첫 달: 시작월과 (통장 시작일의 달) 중 늦은 달 */
function firstMonth(startMonth: YearMonth, opening: ISODate | null): YearMonth {
  if (!opening) return startMonth;
  const om = monthOf(opening);
  return isValidMonth(om) && compareMonth(om, startMonth) > 0 ? om : startMonth;
}

/**
 * 월배분 규칙의 month 회차 날짜. 그달에 규칙이 유효하지 않거나, 날짜가 보내는·받는 통장의 시작일보다 앞이면 null
 * (시작일 전 기록은 한쪽 통장에만 잡혀 돈이 사라진 것처럼 보이고, 시작 잔액에 이미 들어 있는 돈이다)
 */
export function ruleOccurrenceDate(data: LedgerData, rule: AllocationRule, month: YearMonth): ISODate | null {
  if (rule.deleted || !isValidMonth(rule.startMonth) || !isMonthActive(month, rule.startMonth, rule.endMonth)) return null;
  const date = dateInMonth(month, rule.dayOfMonth);
  const opening = latestOpeningDate(data, [rule.fromAccountId, rule.toAccountId]);
  if (opening && date < opening) return null;
  return date;
}

/**
 * 고정 지출의 month 회차 날짜 (규칙과 같은 기준). 할부는 마지막 회차(종료월 · 전체 회차)까지.
 * 할부의 결제일 빈 칸은 1일 (회차 계산 installmentPayments 와 같게 — 낸 것으로 세면서 기록은 안 하는 일이 없게)
 */
export function fixedOccurrenceDate(data: LedgerData, f: FixedExpense, month: YearMonth): ISODate | null {
  if (isDatedBill(f)) {
    // 고정비 · 용돈: 시작일 · 해지일 · 결제일 (PLAN 4-15)
    const date = billChargeDate(f, month);
    if (date === null) return null;
    const opening = latestOpeningDate(data, [f.accountId]);
    return opening && date < opening ? null : date;
  }
  const end = isInstallment(f) ? installmentRowEnd(f) : f.endMonth;
  if (isInstallment(f) && end === null) return null;
  const day = isInstallment(f) ? installmentDay(f) : f.dayOfMonth;
  if (f.deleted || day === null || !isValidMonth(f.startMonth) || !isMonthActive(month, f.startMonth, end)) return null;
  const date = dateInMonth(month, day);
  const opening = latestOpeningDate(data, [f.accountId]);
  if (opening && date < opening) return null;
  return date;
}

/** 나머지 전부 보내기의 두 번째 건부터 쓰는 id: 'auto:<규칙id>:<월>@<날짜>' (월급이 여러 번 들어올 때, 2026-11) */
export function remainderPartId(baseId: Id, date: ISODate): Id {
  return `${baseId}@${date}`;
}

/**
 * 아직 만들지 않은 자동 기록 (앱을 열 때 호출).
 * - 월배분 규칙: rule.startMonth ~ 이번 달, 그달 dayOfMonth 가 오늘 이전(포함)인 회차 → transfer(kind='transfer', status='done', ruleId, id=autoTransferId)
 * - 고정지출 bill/allowance/installment: startMonth ~ 이번 달, dayOfMonth 가 지난 회차 → expense(fixedExpenseId, id=autoFixedExpenseId)
 *   할부는 마지막 회차까지만, 같은 달을 두 행이 덮으면 그달을 맡은 행만. 메모에 회차('TV 할부 16/24회차')
 * - 이미 같은 id 가 있으면(삭제 포함) 만들지 않는다. 종료월·삭제된 규칙 제외
 * - 미래 planned 이체가 같은 규칙 회차를 대신하지 않는다
 * - 통장 시작일보다 앞선 회차는 만들지 않는다 (시작 잔액에 이미 들어 있음). 시작월이 'YYYY-MM' 이 아니면 건너뛴다
 * - 수입(월급)은 만들지 않아요. 직접 기록한 수입에 맞춰 배분해요 (PLAN 4-13)
 * - 월급이 들어온 날 배분: 그 월급날 몫의 수입이 기록돼 있으면 배분은 정해 둔 날 대신 수입이 들어온 날에 나가요 (ruleDueDate)
 * - 나머지 전부 보내기 규칙: 위 기록(수입 · 정한 금액 배분 · 고정 지출)을 모두 더한 뒤 날짜 순으로 하나씩 금액을 정한다
 *   (remainderAmount). 0 이면 만들지 않는다 (다음에 열 때 다시 계산). id 는 정한 금액 배분과 같은 auto:<규칙id>:<월>
 *   월급이 여러 번 들어오면 들어올 때마다 따로 한 건씩 (첫 건 auto:<규칙id>:<월>, 다음부터 auto:<규칙id>:<월>@<날짜>).
 *   이미 기록한(보낸) 건은 그대로 두고, 그 뒤에 남은 돈만 보내요 (2026-11)
 */

export function pendingAutoRecords(data: LedgerData, today: ISODate, author: string, now: string): AutoRecords {
  const thisMonth = monthOf(today);
  const transferIds = new Set(data.transfers.map((t) => t.id));
  const expenseIds = new Set(data.expenses.map((e) => e.id));
  const transfers: Transfer[] = [];
  const expenses: Expense[] = [];

  // 기록한 수입을 월급날에 붙여 둬요 (통장 · 달마다 한 번). 월급은 직접 기록해요 — 수입은 자동으로 만들지 않아요
  const withIncome: LedgerData = data;
  const incomeCache = new Map<string, Map<ISODate, ISODate[]>>();
  const dueOf = (rule: AllocationRule, m: YearMonth, planned: ISODate) => {
    const key = `${rule.fromAccountId}|${m}`;
    let map = incomeCache.get(key);
    if (!map) incomeCache.set(key, (map = paydayIncomeDates(withIncome, rule.fromAccountId, m)));
    return ruleDueDate(withIncome, rule, m, planned, map);
  };

  const remainders: { rule: AllocationRule; month: YearMonth; date: ISODate; id: Id }[] = [];
  const byTransferId = new Map(data.transfers.map((t) => [t.id, t]));
  for (const rule of data.rules) {
    if (rule.deleted || !isValidMonth(rule.startMonth)) continue;
    if (isRemainderRule(rule)) {
      const from = firstMonth(rule.startMonth, latestOpeningDate(data, [rule.fromAccountId, rule.toAccountId]));
      for (const m of monthRange(from, thisMonth)) {
        const planned = ruleOccurrenceDate(data, rule, m);
        if (planned === null) continue;
        // 월급이 들어올 때마다 따로 보내요 (2026-11): 그 월급날 몫의 수입 날짜마다 한 건. 수입이 없으면 정해 둔 날 한 건
        const key = `${rule.fromAccountId}|${m}`;
        let map = incomeCache.get(key);
        if (!map) incomeCache.set(key, (map = paydayIncomeDates(withIncome, rule.fromAccountId, m)));
        const dates = [...new Set(map.get(planned) ?? [dueOf(rule, m, planned)])].sort();
        const baseId = autoTransferId(rule.id, m);
        const base = byTransferId.get(baseId);
        let baseFree = !base;
        for (const date of dates) {
          if (date > today) continue;
          // 예전 한 건(합쳐진 기록)이 있으면 그날까지는 그대로 둬요. 지운 기록이면 날짜마다 새로 만들어요
          if (base && !base.deleted && date <= base.date) continue;
          const id = baseFree ? baseId : remainderPartId(baseId, date);
          baseFree = false;
          if (transferIds.has(id)) continue;
          remainders.push({ rule, month: m, date, id });
        }
      }
      continue;
    }
    const auto = isAutoRule(rule);
    if (!auto && rule.amount <= 0) continue;
    const from = firstMonth(rule.startMonth, latestOpeningDate(data, [rule.fromAccountId, rule.toAccountId]));
    for (const m of monthRange(from, thisMonth)) {
      const planned = ruleOccurrenceDate(data, rule, m);
      if (planned === null) continue;
      const date = dueOf(rule, m, planned);
      if (date > today) continue;
      const id = autoTransferId(rule.id, m);
      if (transferIds.has(id)) continue;
      // 필요한 만큼 (자동): 그 배분 기간의 고정 결제 + 생활비 항목 예산을 지금 정해 그대로 둔다. 0 이면 다음에 다시 (PLAN 4-15)
      const amount = auto ? autoRuleAmount(data, rule, date) : rule.amount;
      if (amount <= 0) continue;
      transferIds.add(id);
      transfers.push({
        id,
        date,
        kind: 'transfer',
        fromAccountId: rule.fromAccountId,
        toAccountId: rule.toAccountId,
        amount,
        status: 'done',
        ruleId: rule.id,
        memo: auto ? AUTO_RULE_MEMO : '매달 배분',
        author,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      });
    }
  }

  const plans = installmentGroups(data.fixedExpenses);
  const payments = new Map([...plans].map(([id, rows]) => [id, installmentPayments(rows)]));
  for (const f of data.fixedExpenses) {
    if (f.deleted || f.kind === 'living' || !isValidMonth(f.startMonth)) continue;
    if (!isDatedBill(f) && f.amount <= 0) continue;
    if (f.dayOfMonth === null && !isInstallment(f) && !f.startDate) continue;
    const from = firstMonth(f.startMonth, latestOpeningDate(data, [f.accountId]));
    const planPayments = isInstallment(f) ? (payments.get(installmentPlanId(f.id)) ?? []) : null;
    for (const m of monthRange(from, thisMonth)) {
      const date = fixedOccurrenceDate(data, f, m);
      if (date === null || date > today) continue;
      let memo = f.name;
      let amount = f.amount;
      if (isDatedBill(f)) {
        amount = billAmountOn(f, date);
        memo = billMemo(f, date);
        if (amount <= 0) continue;
      }
      if (planPayments) {
        const p = planPayments.find((x) => x.month === m);
        if (!p || p.rowId !== f.id) continue; // 같은 달을 맡은 다른 행이 있다
        const last = planPayments[planPayments.length - 1];
        memo = installmentMemo(f.name, p.number, last ? last.number : p.number);
      }
      const id = autoFixedExpenseId(f.id, m);
      if (expenseIds.has(id)) continue;
      expenseIds.add(id);
      expenses.push({
        id,
        date,
        amount,
        accountId: f.accountId,
        categoryId: f.categoryId,
        memo,
        eventId: null,
        fixedExpenseId: f.id,
        author,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      });
    }
  }

  if (remainders.length > 0) {
    // 날짜 순 (같은 날은 규칙 id 순). 앞서 정한 나머지 이체까지 넣은 잔액으로 다음 금액을 정한다
    remainders.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.rule.id < b.rule.id ? -1 : a.rule.id > b.rule.id ? 1 : 0));
    const work: LedgerData = { ...data, transfers: [...data.transfers, ...transfers], expenses: [...data.expenses, ...expenses] };
    for (const { rule, date, id } of remainders) {
      const amount = remainderAmount(work, rule, date, today);
      if (amount <= 0) continue;
      transferIds.add(id);
      const row: Transfer = {
        id,
        date,
        kind: 'transfer',
        fromAccountId: rule.fromAccountId,
        toAccountId: rule.toAccountId,
        amount,
        status: 'done',
        ruleId: rule.id,
        memo: '남은 돈 보내기',
        author,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      };
      transfers.push(row);
      work.transfers.push(row);
    }
  }
  return { transfers, expenses };
}
