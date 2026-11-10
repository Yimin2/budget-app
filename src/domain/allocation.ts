/**
 * 배분 시점과 '다음 배분에 필요한 금액' — PLAN 4-15.
 *
 * 배분 기간: D일 배분(M월)은 [M월 D일, M+1월 D일) 에 날짜가 든 결제를 채운다 (말일보다 크면 말일).
 * 그래서 21일 배분이면 11/21 배분은 11/21 ~ 12/20 결제를 채운다. 11/10 에 시작한 고정비의 첫 결제는
 * 이미 지난 10/21 배분 몫이라 지금 생활비에서 나가고, 11/21 배분부터 들어간다.
 *
 * 필요한 금액(통장 A, 배분일 a) = [a, 다음 배분일) 의 A 통장 고정 결제(고정비 · 세부 항목 · 할부)
 *                              + A 통장 생활비 항목 예산 (그 기간이 거의 다 드는 달 = 다음 배분일 전날의 달)
 * '필요한 만큼 (자동)' 배분(kind='auto')은 기록될 때 이 금액을 보낸다
 */
import {
  billAmountOn, billChargeDate, billCharges, billHasEnd, billSeries, billSeriesId, currentBillRow, firstChargeDate, hasSubItems,
  isDatedBill, lastChargeDate, nextChargeOnOrAfter, rowStart,
} from './bills';
import { addDays, addMonths, dateInMonth, formatShortDate, isMonthActive, isValidDate, isValidMonth, monthOf } from './dates';
import { autoTransferId } from './ids';
import { installmentGroups, installmentPayments, installmentPlanId } from './installments';
import { activeLivingRows } from './living';
import { formatWon } from './money';
import type { Account, AllocationRule, FixedExpense, Id, ISODate, LedgerData, Won, YearMonth } from './types';

/* ---------- 배분 기간 ---------- */

/** date 이전(포함)의 가장 늦은 D일 배분일 */
export function allocationOnOrBefore(date: ISODate, day: number): ISODate {
  const here = dateInMonth(monthOf(date), day);
  return here <= date ? here : dateInMonth(addMonths(monthOf(date), -1), day);
}

/** date 보다 뒤의 첫 D일 배분일 */
export function allocationAfter(date: ISODate, day: number): ISODate {
  const here = dateInMonth(monthOf(date), day);
  return here > date ? here : dateInMonth(addMonths(monthOf(date), 1), day);
}

/** a 배분이 채우는 기간의 끝 (그 날은 빠짐) = 다음 배분일 */
export function allocationWindowEnd(a: ISODate, day: number): ISODate {
  return dateInMonth(addMonths(monthOf(a), 1), day);
}

/** 규칙 종류 */
export function isAutoRule(rule: Pick<AllocationRule, 'kind'>): boolean {
  return rule.kind === 'auto';
}

/** 정한 금액 규칙 (빈 칸 = 정한 금액) */
export function isFixedRule(rule: Pick<AllocationRule, 'kind'>): boolean {
  return rule.kind !== 'remainder' && rule.kind !== 'auto';
}

/** '필요한 만큼 (자동)'으로 받을 수 있는 통장 (생활비 · 용돈) */
export function canAutoFill(account: Pick<Account, 'role'> | undefined | null): boolean {
  return !!account && (account.role === 'fixed' || account.role === 'allowance');
}

/** 그달 이 통장으로 들어오는 배분 중 기간을 정하는 규칙 (정한 금액 · 자동, 금액이 큰 것 → id 순) */
export function allocationRuleInto(data: LedgerData, accountId: Id, month: YearMonth): AllocationRule | null {
  const rules = data.rules
    .filter(
      (r) =>
        !r.deleted &&
        r.toAccountId === accountId &&
        !(r.kind === 'remainder') &&
        isValidMonth(r.startMonth) &&
        isMonthActive(month, r.startMonth, r.endMonth) &&
        (isAutoRule(r) || r.amount > 0),
    )
    .sort((a, b) => (isAutoRule(b) ? 1 : 0) - (isAutoRule(a) ? 1 : 0) || b.amount - a.amount || (a.id < b.id ? -1 : 1));
  return rules[0] ?? null;
}

/** 이 통장의 배분일 (이번 달 규칙 → 다음 달 규칙 → 어느 규칙이든). 없으면 null */
export function allocationDayOf(data: LedgerData, accountId: Id, today: ISODate): number | null {
  const m = monthOf(today);
  const r =
    allocationRuleInto(data, accountId, m) ??
    allocationRuleInto(data, accountId, addMonths(m, 1)) ??
    data.rules.find((x) => !x.deleted && x.toAccountId === accountId && x.kind !== 'remainder');
  return r ? r.dayOfMonth : null;
}

/* ---------- 기간 안의 결제 ---------- */

export interface WindowCharge {
  /** 묶음 키 (고정비 id · 할부 id) — 앞 기간과 비교할 때 */
  key: string;
  name: string;
  date: ISODate;
  amount: Won;
  kind: 'bill' | 'installment';
  /** 세부 항목이 있는 고정비면 true */
  withItems: boolean;
}

/** 이 통장에서 [from, to) 에 나갈 고정 결제 (고정비 · 용돈 · 할부, 날짜 순) */
export function accountCharges(data: LedgerData, accountId: Id, from: ISODate, to: ISODate): WindowCharge[] {
  const out: WindowCharge[] = [];
  for (const f of data.fixedExpenses) {
    if (f.deleted || !isDatedBill(f) || f.accountId !== accountId) continue;
    for (const c of billCharges(f, from, to)) {
      if (c.amount <= 0) continue;
      out.push({ key: `bill:${billSeriesId(f.id)}`, name: f.name, date: c.date, amount: c.amount, kind: 'bill', withItems: hasSubItems(f) });
    }
  }
  for (const [planId, rows] of installmentGroups(data.fixedExpenses)) {
    for (const p of installmentPayments(rows)) {
      if (p.accountId !== accountId || p.date < from || p.date >= to || p.amount <= 0) continue;
      const row = rows.find((r) => r.id === p.rowId);
      out.push({ key: `inst:${planId}`, name: row?.name ?? '할부', date: p.date, amount: p.amount, kind: 'installment', withItems: false });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
}

/** 이 통장의 그달 생활비 항목 예산 합 ('이 달만 다른 금액'이 있으면 그 금액, PLAN 4-1) */
export function livingBudgetOf(data: LedgerData, accountId: Id, month: YearMonth): Won {
  return activeLivingRows(data, month)
    .filter((f) => f.accountId === accountId)
    .reduce((s, f) => s + Math.max(0, f.amount), 0);
}

export interface WindowNeed {
  accountId: Id;
  /** 배분일 */
  date: ISODate;
  /** 기간 끝 (다음 배분일, 빠짐) */
  end: ISODate;
  charges: WindowCharge[];
  /** 고정비 · 용돈 합 */
  bills: Won;
  /** 할부 합 */
  installments: Won;
  /** 생활비 항목 예산 합 */
  living: Won;
  livingMonth: YearMonth;
  total: Won;
}

/** a 배분(D일)이 이 통장에 채워야 할 돈 */
export function windowNeed(data: LedgerData, accountId: Id, a: ISODate, day: number): WindowNeed {
  const end = allocationWindowEnd(a, day);
  const charges = accountCharges(data, accountId, a, end);
  const livingMonth = monthOf(addDays(end, -1));
  const living = livingBudgetOf(data, accountId, livingMonth);
  const bills = charges.filter((c) => c.kind === 'bill').reduce((s, c) => s + c.amount, 0);
  const installments = charges.filter((c) => c.kind === 'installment').reduce((s, c) => s + c.amount, 0);
  return { accountId, date: a, end, charges, bills, installments, living, livingMonth, total: bills + installments + living };
}

/** '필요한 만큼 (자동)' 규칙이 date 에 보낼 금액 */
export function autoRuleAmount(data: LedgerData, rule: AllocationRule, date: ISODate): Won {
  return windowNeed(data, rule.toAccountId, date, rule.dayOfMonth).total;
}

/** 규칙이 month 에 보낼 금액 (정한 금액 그대로, 자동은 계산, 나머지는 0 — 나머지는 projectRemainders 로) */
export function ruleAmountIn(data: LedgerData, rule: AllocationRule, month: YearMonth): Won {
  if (rule.kind === 'remainder') return 0;
  if (isAutoRule(rule)) return autoRuleAmount(data, rule, dateInMonth(month, rule.dayOfMonth));
  return rule.amount;
}

/** 자동 금액 내역 한 줄: '고정비 26만 · 할부 6.36만 · 생활비 항목 82만' */
export function needBreakdownText(n: Pick<WindowNeed, 'bills' | 'installments' | 'living'>): string {
  const parts: string[] = [];
  if (n.bills > 0) parts.push(`고정비 ${formatWon(n.bills)}`);
  if (n.installments > 0) parts.push(`할부 ${formatWon(n.installments)}`);
  if (n.living > 0) parts.push(`생활비 항목 ${formatWon(n.living)}`);
  return parts.length > 0 ? parts.join(' · ') : '나갈 돈 없음';
}

/* ---------- 다음 배분에 필요한 금액 ---------- */

export interface AllocationNeed {
  account: Account;
  /** 정한 금액 규칙 중 맞출 규칙 (자동 규칙만 있으면 null) */
  rule: AllocationRule | null;
  /** 자동 규칙이 있으면 true (맞추지 않아도 저절로 따라가요) */
  auto: boolean;
  /** 다음 배분일 */
  next: ISODate;
  need: WindowNeed;
  /** 다음 배분 달에 이 통장으로 들어오는 정한 금액 배분 합 (자동은 need.total) */
  current: Won;
  /** need.total − current */
  diff: Won;
  /** 바뀐 까닭 ('넷플릭스 시작' · '보험 금액 변경' · '생활비 항목 변경') */
  reasons: string[];
  /** 맞추기를 누르면 그 규칙에 넣을 금액 (맞출 수 없으면 null) */
  adjustTo: Won | null;
  /** 지금 기간(앞 배분 ~ 다음 배분)에 새로 시작해 배분에 없는 결제 합 */
  uncovered: Won;
  uncoveredNames: string[];
}

/** 이 규칙의 다음 배분일: 이번 달 회차가 아직 기록 전이고 오늘 이후(포함)면 이번 달, 아니면 다음 달 */
function nextAllocationDate(data: LedgerData, rule: AllocationRule, today: ISODate): ISODate {
  const m = monthOf(today);
  const here = dateInMonth(m, rule.dayOfMonth);
  const recorded = data.transfers.some((t) => !t.deleted && t.id === autoTransferId(rule.id, m));
  return here < today || (here === today && recorded) ? dateInMonth(addMonths(m, 1), rule.dayOfMonth) : here;
}

function chargeMap(list: WindowCharge[]): Map<string, { name: string; amount: Won }> {
  const map = new Map<string, { name: string; amount: Won }>();
  for (const c of list) {
    const cur = map.get(c.key);
    map.set(c.key, { name: c.name, amount: (cur?.amount ?? 0) + c.amount });
  }
  return map;
}

/** 두 기간을 비교한 까닭 */
export function needReasons(prev: WindowNeed, next: WindowNeed): string[] {
  const a = chargeMap(prev.charges);
  const b = chargeMap(next.charges);
  const out: string[] = [];
  for (const [k, v] of b) {
    const before = a.get(k);
    if (!before) out.push(`${v.name} 시작`);
    else if (before.amount !== v.amount) out.push(`${v.name} 금액 변경`);
  }
  for (const [k, v] of a) if (!b.has(k)) out.push(`${v.name} 끝`);
  if (prev.living !== next.living) out.push('생활비 항목 변경');
  return out;
}

/**
 * 생활비 · 용돈 통장마다 다음 배분에 필요한 금액 (그 통장으로 정한 금액 · 자동 배분이 있을 때, 통장 순서).
 * 정한 금액 규칙이면 지금 금액과 차이 · 까닭, [배분 금액 맞추기] 에 넣을 금액. 자동 규칙이면 diff 0
 */
export function allocationNeeds(data: LedgerData, today: ISODate): AllocationNeed[] {
  const out: AllocationNeed[] = [];
  const accounts = data.accounts.filter((a) => !a.deleted && canAutoFill(a)).sort((a, b) => a.order - b.order);
  for (const account of accounts) {
    const anyRule = allocationRuleInto(data, account.id, monthOf(today)) ?? allocationRuleInto(data, account.id, addMonths(monthOf(today), 1));
    if (!anyRule) continue;
    const next = nextAllocationDate(data, anyRule, today);
    const day = anyRule.dayOfMonth;
    const month = monthOf(next);
    const into = data.rules.filter(
      (r) => !r.deleted && r.toAccountId === account.id && r.kind !== 'remainder' && isValidMonth(r.startMonth) && isMonthActive(month, r.startMonth, r.endMonth),
    );
    if (into.length === 0) continue;
    const auto = into.some(isAutoRule);
    const need = windowNeed(data, account.id, next, day);
    const prevDate = dateInMonth(addMonths(month, -1), day);
    const prev = windowNeed(data, account.id, prevDate, day);
    const fixedRules = into.filter(isFixedRule);
    const fixedSum = fixedRules.reduce((s, r) => s + r.amount, 0);
    const current = auto ? need.total : fixedSum;
    const diff = auto ? 0 : need.total - fixedSum;
    const rule = fixedRules.sort((a, b) => b.amount - a.amount || (a.id < b.id ? -1 : 1))[0] ?? null;
    const adjustTo = !auto && rule && diff !== 0 && rule.amount + diff > 0 ? rule.amount + diff : null;
    // 지금 기간에 새로 시작한 결제 (첫 결제가 앞 배분일 뒤) — 앞 배분은 몰랐던 돈
    const uncoveredList = prev.charges.filter((c) => c.date < next && firstOfKey(data, c.key) !== null && firstOfKey(data, c.key)! > prevDate);
    out.push({
      account,
      rule,
      auto,
      next,
      need,
      current,
      diff,
      reasons: needReasons(prev, need),
      adjustTo,
      uncovered: uncoveredList.reduce((s, c) => s + c.amount, 0),
      uncoveredNames: uncoveredList.map((c) => c.name),
    });
  }
  return out;
}

/** 묶음 키의 첫 결제일 (고정비: 첫 행의 첫 결제, 할부: 첫 회차) */
function firstOfKey(data: LedgerData, key: string): ISODate | null {
  if (key.startsWith('bill:')) {
    const id = key.slice(5);
    const rows = billSeries(data.fixedExpenses).get(id) ?? [];
    return rows[0] ? firstChargeDate(rows[0]) : null;
  }
  const id = key.slice(5);
  const rows = installmentGroups(data.fixedExpenses).get(id) ?? [];
  return installmentPayments(rows)[0]?.date ?? null;
}

/** 다음 배분 한 줄: '생활비(민구): 1,272,600원 → 1,287,600원 (+15,000원 · 넷플릭스 시작)' */
export function needLineText(n: AllocationNeed): string {
  if (n.auto) return `${n.account.name}: ${formatWon(n.need.total)} (자동)`;
  if (n.diff === 0) return `${n.account.name}: ${formatWon(n.current)} 그대로예요`;
  const sign = n.diff > 0 ? '+' : '−';
  const why = [`${sign}${formatWon(Math.abs(n.diff))}`, ...n.reasons.slice(0, 3)].join(' · ');
  return `${n.account.name}: ${formatWon(n.current)} → ${formatWon(n.need.total)} (${why})`;
}

/** 지금 기간 한 줄: '이번 달은 15,000원이 배분에 없어요 · 생활비에서 나가요' (없으면 null) */
export function uncoveredText(n: AllocationNeed): string | null {
  if (n.uncovered <= 0) return null;
  const where = n.account.role === 'allowance' ? '용돈' : '생활비';
  return `이번 달은 ${formatWon(n.uncovered)}이 배분에 없어요 · ${where}에서 나가요`;
}

/* ---------- 고정비 하나의 배분 시점 ---------- */

export interface TimelineLine {
  kind: 'first' | 'change' | 'last' | 'item-start' | 'item-end' | 'none';
  text: string;
  /** 이미 다 지난 일 (목록 줄에는 안 보여요) */
  past: boolean;
}

/**
 * 결제 c 를 어느 배분이 채우는지. aInc = c 이전(포함) 마지막 배분.
 * aInc 가 오늘 뒤면 그 배분부터 들어가고, 오늘 이전이면 지금 기간이면 다음 배분부터(그 사이는 지금 돈에서), 더 앞이면 지난 일
 */
function coverOf(c: ISODate, today: ISODate, day: number): { from: ISODate; state: 'future' | 'current' | 'past' } {
  const aInc = allocationOnOrBefore(c, day);
  if (aInc > today) return { from: aInc, state: 'future' };
  const w0 = allocationOnOrBefore(today, day);
  const a1 = allocationAfter(aInc, day);
  return { from: a1, state: aInc >= w0 ? 'current' : 'past' };
}

function startCopy(head: string, c: ISODate, today: ISODate, day: number | null, where: string, newWord: string): Omit<TimelineLine, 'kind'> {
  if (day === null) return { text: head, past: c < today };
  const cov = coverOf(c, today, day);
  const from = formatShortDate(cov.from);
  if (cov.state === 'future') return { text: `${head} · ${from} 배분부터 ${newWord}`, past: false };
  if (cov.state === 'current') return { text: `${head} · ${from} 배분 전이라 지금 ${where}에서 나가요 · ${from} 배분부터 ${newWord}`, past: false };
  return { text: `${head} · ${from} 배분부터 ${newWord}`, past: true };
}

function endCopy(head: string, last: ISODate, today: ISODate, day: number | null): Omit<TimelineLine, 'kind'> {
  if (day === null) return { text: head, past: last < today };
  const exit = allocationAfter(last, day);
  return { text: `${head} · ${formatShortDate(exit)} 배분부터 빠져요`, past: exit <= allocationOnOrBefore(today, day) };
}

/**
 * 고정비 하나(행 여럿)의 배분 시점 설명 — 첫 결제 · 금액 변경 · 세부 항목 시작/끝 · 마지막 결제.
 * 예: '첫 결제 11/10 · 11/21 배분 전이라 지금 생활비에서 나가요 · 11/21 배분부터 포함해요',
 *     '1/15부터 금액 변경 · 1/21 배분부터 새 금액 17,000원', '마지막 결제 12/10 · 12/21 배분부터 빠져요'
 */
export function billTimeline(data: LedgerData, rows: FixedExpense[], today: ISODate): TimelineLine[] {
  const live = rows.filter((r) => !r.deleted && isDatedBill(r)).sort((a, b) => rowStart(a).localeCompare(rowStart(b)));
  const head = live[0];
  if (!head) return [];
  const cur = currentBillRow(live, today) ?? head;
  const account = data.accounts.find((a) => a.id === cur.accountId);
  const where = account?.role === 'allowance' ? '용돈' : '생활비';
  const day = allocationDayOf(data, cur.accountId, today);
  const out: TimelineLine[] = [];

  const first = firstChargeDate(head);
  if (first) out.push({ kind: 'first', ...startCopy(`첫 결제 ${formatShortDate(first)}`, first, today, day, where, '포함해요') });

  for (let i = 1; i < live.length; i++) {
    const r = live[i]!;
    const prev = live[i - 1]!;
    const c = firstChargeDate(r);
    if (!c) continue;
    const before = lastChargeDate(prev);
    const prevAmount = before ? billAmountOn(prev, before) : prev.amount;
    const amount = billAmountOn(r, c);
    if (amount === prevAmount) continue;
    const from = formatShortDate(rowStart(r));
    out.push({ kind: 'change', ...startCopy(`${from}부터 금액 변경`, c, today, day, where, `새 금액 ${formatWon(amount)}`) });
  }

  // 세부 항목의 시작 · 끝 (행의 결제 기간 안에서)
  for (const r of live) {
    for (const s of r.subItems ?? []) {
      if (s.startDate && isValidDate(s.startDate)) {
        const c = nextChargeOnOrAfter(r, s.startDate);
        const firstRow = firstChargeDate(r);
        if (c && firstRow && c > firstRow) {
          out.push({ kind: 'item-start', ...startCopy(`'${s.name}' ${formatShortDate(c)} 결제부터`, c, today, day, where, '포함해요') });
        }
      }
      if (s.endDate && isValidDate(s.endDate)) {
        const lastOfItem = lastChargeOnOrBefore(r, s.endDate);
        const lastRow = billHasEnd(r) ? lastChargeDate(r) : null;
        if (lastOfItem && (!lastRow || lastOfItem < lastRow)) {
          out.push({ kind: 'item-end', ...endCopy(`'${s.name}' 마지막 결제 ${formatShortDate(lastOfItem)}`, lastOfItem, today, day) });
        }
      }
    }
  }

  const tail = live[live.length - 1]!;
  if (billHasEnd(tail)) {
    const last = lastChargeDate(tail);
    if (last) out.push({ kind: 'last', ...endCopy(`마지막 결제 ${formatShortDate(last)}`, last, today, day) });
    else if (!first) out.push({ kind: 'none', text: '결제 없이 끝나요', past: false });
  }
  return out;
}

/** date 이전(포함) 마지막 결제일 */
function lastChargeOnOrBefore(f: FixedExpense, date: ISODate): ISODate | null {
  for (let i = 0; i < 3; i++) {
    const d = billChargeDate(f, addMonths(monthOf(date), -i));
    if (d && d <= date) return d;
  }
  return null;
}

/** 목록 줄에 보일 설명 (지난 일은 빼고 첫 줄) */
export function billTimelineHint(data: LedgerData, rows: FixedExpense[], today: ISODate): string | null {
  return billTimeline(data, rows, today).find((l) => !l.past)?.text ?? null;
}

/** 할부 행인지 묶음 키로 (테스트 · 화면용) */
export function chargeKeyOf(f: Pick<FixedExpense, 'id' | 'kind'>): string {
  return f.kind === 'installment' ? `inst:${installmentPlanId(f.id)}` : `bill:${billSeriesId(f.id)}`;
}
