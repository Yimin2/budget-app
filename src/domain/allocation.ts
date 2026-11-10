/**
 * 배분 시점과 '알아서 맞추기' 금액 — PLAN 4-15.
 *
 * 배분 기간: D일 배분(M월)은 [M월 D일, M+1월 D일) 에 날짜가 든 결제를 채운다 (말일보다 크면 말일).
 * 그래서 21일 배분이면 11/21 배분은 11/21 ~ 12/20 결제를 채운다. 11/10 에 시작한 고정비의 첫 결제는
 * 이미 지난 10/21 배분 몫이라 지금 생활비에서 나가고, 11/21 배분부터 들어간다.
 *
 * 필요한 금액(통장 A, 배분일 a) = [a, 다음 배분일) 의 A 통장 고정 결제(고정비 · 세부 항목 · 할부)
 *                              + A 통장 생활비 항목 예산 (그 기간이 거의 다 드는 달 = 다음 배분일 전날의 달)
 * '알아서 맞추기' 배분(kind='auto')은 기록될 때 이 금액을 보낸다
 */
import {
  activeSubItems, billAmountOn, billChargeDate, billCharges, billHasEnd, billSeriesId, currentBillRow, firstChargeDate, hasSubItems,
  isDatedBill, lastChargeDate, nextChargeOnOrAfter, rowStart,
} from './bills';
import { addDays, addMonths, dateInMonth, formatShortDate, isMonthActive, isValidDate, isValidMonth, monthOf } from './dates';
import { autoTransferId } from './ids';
import { installmentGroups, installmentPayments, installmentPlanId } from './installments';
import { activeLivingRows } from './living';
import { formatMan, formatWon } from './money';
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
  /** 그 결제일에 살아 있는 세부 항목 (세부 항목이 있는 고정비만) */
  items?: { name: string; amount: Won }[];
}

/** 이 통장에서 [from, to) 에 나갈 고정 결제 (고정비 · 용돈 · 할부, 날짜 순) */
export function accountCharges(data: LedgerData, accountId: Id, from: ISODate, to: ISODate): WindowCharge[] {
  const out: WindowCharge[] = [];
  for (const f of data.fixedExpenses) {
    if (f.deleted || !isDatedBill(f) || f.accountId !== accountId) continue;
    for (const c of billCharges(f, from, to)) {
      if (c.amount <= 0) continue;
      const withItems = hasSubItems(f);
      out.push({
        key: `bill:${billSeriesId(f.id)}`,
        name: f.name,
        date: c.date,
        amount: c.amount,
        kind: 'bill',
        withItems,
        ...(withItems ? { items: activeSubItems(f, c.date).map((x) => ({ name: x.name, amount: Math.max(0, Math.round(x.amount)) })) } : {}),
      });
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

/* ---------- 규칙마다 다음 배분 금액과 지난달과 달라진 까닭 ---------- */

/** 방식 이름 (화면): 매달 같은 금액 / 알아서 맞추기 / 남는 돈 전부 */
export const RULE_KIND_LABEL = { fixed: '매달 같은 금액', auto: '알아서 맞추기', remainder: '남는 돈 전부' } as const;

/** 규칙의 방식 이름 */
export function ruleKindLabel(rule: Pick<AllocationRule, 'kind'>): string {
  return rule.kind === 'remainder' ? RULE_KIND_LABEL.remainder : isAutoRule(rule) ? RULE_KIND_LABEL.auto : RULE_KIND_LABEL.fixed;
}

/** 이 규칙의 다음 배분일: 이번 달 회차가 아직 기록 전이고 오늘 이후(포함)면 이번 달, 아니면 다음 달 */
export function nextAllocationDate(data: LedgerData, rule: AllocationRule, today: ISODate): ISODate {
  const m = monthOf(today);
  const here = dateInMonth(m, rule.dayOfMonth);
  const recorded = data.transfers.some((t) => !t.deleted && t.id === autoTransferId(rule.id, m));
  return here < today || (here === today && recorded) ? dateInMonth(addMonths(m, 1), rule.dayOfMonth) : here;
}

interface NeedItem {
  name: string;
  amount: Won;
  /** 세부 항목 (고정비에 있을 때, 이름 → 금액) */
  items: Map<string, Won> | null;
}

function needItems(n: WindowNeed): Map<string, NeedItem> {
  const map = new Map<string, NeedItem>();
  for (const c of n.charges) {
    const cur = map.get(c.key) ?? { name: c.name, amount: 0, items: c.items ? new Map<string, Won>() : null };
    cur.amount += c.amount;
    if (c.items && cur.items) for (const it of c.items) cur.items.set(it.name, (cur.items.get(it.name) ?? 0) + it.amount);
    map.set(c.key, cur);
  }
  return map;
}

export interface NeedChange {
  /** 다음 − 앞 */
  delta: Won;
  /** '넷플릭스 시작' · '보험 금액 변경' · '운동 끝' · '생활비 항목 변경' */
  text: string;
}

/**
 * 두 기간을 비교해 바뀐 것들 (고정비 · 세부 항목 · 할부 · 생활비 항목), 바뀐 금액이 큰 순.
 * 두 기간 모두 있는 세부 항목 고정비는 세부 항목마다 비교해요 ('넷플릭스 시작')
 */
export function needChanges(prev: WindowNeed, next: WindowNeed): NeedChange[] {
  const a = needItems(prev);
  const b = needItems(next);
  const out: NeedChange[] = [];
  const diffItem = (name: string, before: Won | undefined, after: Won | undefined) => {
    if (before === undefined && after !== undefined) out.push({ delta: after, text: `${name} 시작` });
    else if (before !== undefined && after === undefined) out.push({ delta: -before, text: `${name} 끝` });
    else if (before !== undefined && after !== undefined && before !== after) out.push({ delta: after - before, text: `${name} 금액 변경` });
  };
  for (const [k, v] of b) {
    const before = a.get(k);
    if (before && before.items && v.items) {
      for (const [name, amt] of v.items) diffItem(name, before.items.get(name), amt);
      for (const [name, amt] of before.items) if (!v.items.has(name)) diffItem(name, amt, undefined);
    } else diffItem(v.name, before?.amount, v.amount);
  }
  for (const [k, v] of a) if (!b.has(k)) diffItem(v.name, v.amount, undefined);
  if (prev.living !== next.living) out.push({ delta: next.living - prev.living, text: '생활비 항목 변경' });
  return out.filter((c) => c.delta !== 0).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

export interface RuleNext {
  rule: AllocationRule;
  /** 다음 배분일 */
  date: ISODate;
  /** 다음 배분 금액 (매달 같은 금액은 그대로, 알아서 맞추기는 그 기간의 필요한 금액) */
  amount: Won;
  auto: boolean;
  /** 알아서 맞추기의 내역 */
  need: WindowNeed | null;
  /** 지난달 회차 금액과의 차이 (알아서 맞추기만, 아니면 0) */
  diff: Won;
  /** 가장 크게 바뀐 까닭 ('넷플릭스 시작'), 없으면 null */
  reason: string | null;
}

/** 규칙의 다음 배분 금액 (남는 돈 전부는 null — remainderViews 로) */
export function ruleNext(data: LedgerData, rule: AllocationRule, today: ISODate): RuleNext | null {
  if (rule.kind === 'remainder') return null;
  const date = nextAllocationDate(data, rule, today);
  if (!isAutoRule(rule)) return { rule, date, amount: rule.amount, auto: false, need: null, diff: 0, reason: null };
  const need = windowNeed(data, rule.toAccountId, date, rule.dayOfMonth);
  const prev = windowNeed(data, rule.toAccountId, dateInMonth(addMonths(monthOf(date), -1), rule.dayOfMonth), rule.dayOfMonth);
  const diff = need.total - prev.total;
  const reason = diff !== 0 ? (needChanges(prev, need)[0]?.text ?? null) : null;
  return { rule, date, amount: need.total, auto: true, need, diff, reason };
}

/** '지난달보다 +1.5만 · 넷플릭스 시작' (바뀌지 않았으면 null) */
export function ruleChangeText(n: Pick<RuleNext, 'diff' | 'reason'>): string | null {
  if (n.diff === 0) return null;
  const sign = n.diff > 0 ? '+' : '−';
  const head = `지난달보다 ${sign}${formatMan(Math.abs(n.diff))}`;
  return n.reason ? `${head} · ${n.reason}` : head;
}

/* ---------- 기존 시트 자동 고치기: 생활비 · 용돈 배분을 알아서 맞추기로 ---------- */

/** 바꾼 뒤 한 번 보여 주는 알림 */
export const AUTO_KIND_NOTICE = "생활비 · 용돈 배분을 '알아서 맞추기'로 바꿨어요";

const overlaps = (a: Pick<AllocationRule, 'startMonth' | 'endMonth'>, b: Pick<AllocationRule, 'startMonth' | 'endMonth'>) =>
  (a.endMonth === null || b.startMonth <= a.endMonth) && (b.endMonth === null || a.startMonth <= b.endMonth);

/**
 * 생활비 · 용돈 통장으로 보내는 '매달 같은 금액' 규칙 중 이번 달 이후에도 살아 있는 것을 '알아서 맞추기'(금액 0)로 바꾼 행.
 * 이벤트 · 저축 · 저수지 등으로 가는 규칙, 남는 돈 전부, 이미 끝난 규칙은 그대로. 같은 통장으로 같은 달에 겹쳐 들어오는
 * 규칙이 여럿이거나 이미 알아서 맞추기가 있으면 두 번 보내게 되므로 그 통장은 건드리지 않아요. 다시 해도 같아요 (바꿀 게 없으면 빈 배열)
 */
export function rulesToAutoKind(data: LedgerData, today: ISODate): AllocationRule[] {
  const month = monthOf(today);
  const live = (r: AllocationRule) => !r.deleted && isValidMonth(r.startMonth) && (r.endMonth === null || r.endMonth >= month);
  const byTarget = new Map<Id, AllocationRule[]>();
  for (const r of data.rules) {
    if (!live(r) || !isFixedRule(r)) continue;
    const to = data.accounts.find((a) => a.id === r.toAccountId && !a.deleted);
    if (!canAutoFill(to)) continue;
    byTarget.set(r.toAccountId, [...(byTarget.get(r.toAccountId) ?? []), r]);
  }
  const out: AllocationRule[] = [];
  for (const [target, list] of byTarget) {
    const autos = data.rules.filter((r) => live(r) && isAutoRule(r) && r.toAccountId === target);
    const clash =
      list.some((r) => autos.some((x) => overlaps(r, x))) || list.some((r, i) => list.some((x, j) => j > i && overlaps(r, x)));
    if (clash) continue;
    for (const r of list) out.push({ ...r, kind: 'auto', amount: 0 });
  }
  return out;
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
