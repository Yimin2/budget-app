/**
 * 수입 계획과 '나머지 전부 보내기' 배분 — PLAN 4-13.
 *
 * 수입 계획: 누가 · 얼마를 · 매달 며칠에 · 어느 통장(보통 함께 쓰는 월급통장)으로 받는지.
 * - 그날이 되면 수입 기록 income:<계획id>:<월> 이 자동으로 생긴다 (받는 통장 시작일 전 회차는 만들지 않는다)
 * - 기대 수입(배분과 비교할 수입)은 그달 유효한 계획 금액 합이다
 *
 * 나머지 전부 보내기(kind='remainder'):
 * - 같은 날 같은 통장에서 나가는 정한 금액 배분 · 그날까지의 수입이 모두 들어간 뒤, 보내는 통장에 남은 돈을 모두 보낸다
 * - 금액 = min(그날 잔액, 그날부터 오늘까지 매일의 잔액) 이고 0 아래면 0. 그래서 보내는 통장이 그 뒤로 0 아래로 내려가지 않는다
 * - 0 이면 기록을 만들지 않고 다음에 앱을 열 때 다시 계산한다. 한 번 기록되면(auto:<규칙id>:<월>) 금액은 그대로다
 *   (나중에 들어온 돈은 보내는 통장에 남아 다음 '나머지 전부 보내기' 때 함께 나간다)
 * - 같은 통장 · 같은 날에 나머지 규칙이 여럿이면 id 순서로 처음 규칙이 모두 가져간다 (설정 화면은 하나만 두게 한다)
 */
import { autoRuleAmount, isAutoRule, windowNeed, type WindowNeed } from './allocation';
import { accountBalance, expenseBalanceAccountId, isCountedTransfer } from './balances';
import { addMonths, compareMonth, dateInMonth, isMonthActive, isValidMonth, monthOf, monthRange } from './dates';
import { autoTransferId } from './ids';
import type { AllocationRule, Id, IncomePlan, ISODate, LedgerData, Transfer, Won, YearMonth } from './types';

/** 수입 계획 자동 기록의 결정적 id */
export function incomeRecordId(planId: Id, month: YearMonth): Id {
  return `income:${planId}:${month}`;
}

/** 나머지 전부 보내기 규칙인지 */
export function isRemainderRule(rule: Pick<AllocationRule, 'kind'>): boolean {
  return rule.kind === 'remainder';
}

/** 그달 유효한 수입 계획 (지우지 않은 것, accountId 를 주면 그 통장으로 받는 것만) */
export function activeIncomePlans(data: LedgerData, month: YearMonth, accountId?: Id): IncomePlan[] {
  return (data.incomePlans ?? []).filter(
    (p) =>
      !p.deleted &&
      p.amount > 0 &&
      isValidMonth(p.startMonth) &&
      isMonthActive(month, p.startMonth, p.endMonth) &&
      (accountId === undefined || p.accountId === accountId),
  );
}

/** 그달 기대 수입 = 유효한 계획 금액 합 (accountId 를 주면 그 통장으로 받는 것만) */
export function plannedIncome(data: LedgerData, month: YearMonth, accountId?: Id): Won {
  return activeIncomePlans(data, month, accountId).reduce((s, p) => s + p.amount, 0);
}

/** 수입 계획의 month 회차 날짜. 그달 유효하지 않거나 받는 통장 시작일 전이면 null */
export function incomePlanOccurrenceDate(data: LedgerData, plan: IncomePlan, month: YearMonth): ISODate | null {
  if (plan.deleted || plan.amount <= 0 || !isValidMonth(plan.startMonth) || !isMonthActive(month, plan.startMonth, plan.endMonth)) return null;
  const date = dateInMonth(month, plan.dayOfMonth);
  const opening = data.accounts.find((a) => a.id === plan.accountId)?.openingDate;
  if (opening && date < opening) return null;
  return date;
}

/** 수입 기록 메모: 계획 메모, 없으면 '민지 월급' */
export function incomePlanMemo(plan: Pick<IncomePlan, 'personName' | 'memo'>): string {
  const memo = (plan.memo ?? '').trim();
  if (memo) return memo;
  const who = plan.personName.trim();
  return who ? `${who} 월급` : '월급';
}

/** 아직 만들지 않은 수입 계획 기록 (시작월 ~ 이번 달, 날짜가 오늘 이전(포함)인 회차) */
export function pendingIncomeRecords(data: LedgerData, today: ISODate, author: string, now: string): Transfer[] {
  const thisMonth = monthOf(today);
  const ids = new Set(data.transfers.map((t) => t.id));
  const out: Transfer[] = [];
  for (const plan of data.incomePlans ?? []) {
    if (plan.deleted || plan.amount <= 0 || !isValidMonth(plan.startMonth)) continue;
    const opening = data.accounts.find((a) => a.id === plan.accountId)?.openingDate;
    let from = plan.startMonth;
    if (opening && isValidMonth(monthOf(opening)) && compareMonth(monthOf(opening), from) > 0) from = monthOf(opening);
    for (const m of monthRange(from, thisMonth)) {
      const date = incomePlanOccurrenceDate(data, plan, m);
      if (date === null || date > today) continue;
      const id = incomeRecordId(plan.id, m);
      if (ids.has(id)) continue;
      ids.add(id);
      out.push({
        id,
        date,
        kind: 'income',
        fromAccountId: null,
        toAccountId: plan.accountId,
        amount: plan.amount,
        status: 'done',
        ruleId: null,
        memo: incomePlanMemo(plan),
        author,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      });
    }
  }
  return out;
}

/** 통장의 날짜별 잔액 변화 (잔액에 들어가는 기록만, 시작일 이후) */
function balanceDeltas(data: LedgerData, accountId: Id): { date: ISODate; delta: Won }[] {
  const account = data.accounts.find((a) => a.id === accountId);
  const opening = account?.openingDate ?? '';
  const out: { date: ISODate; delta: Won }[] = [];
  for (const t of data.transfers) {
    if (t.toAccountId !== accountId && t.fromAccountId !== accountId) continue;
    if (t.date < opening || !isCountedTransfer(data, t)) continue;
    let d = 0;
    if (t.toAccountId === accountId) d += t.amount;
    if (t.fromAccountId === accountId) d -= t.amount;
    if (d !== 0) out.push({ date: t.date, delta: d });
  }
  for (const e of data.expenses) {
    if (e.deleted || expenseBalanceAccountId(e) !== accountId || e.date < opening) continue;
    out.push({ date: e.date, delta: -e.amount });
  }
  return out;
}

/**
 * '나머지 전부 보내기'가 date 에 보낼 금액: min(그날 잔액, 그 뒤 오늘까지 기록마다의 잔액), 0 아래면 0.
 * (그날 뒤에 이미 나간 돈이 있으면 그만큼 덜 보내서 보내는 통장이 0 아래로 내려가지 않게)
 */
export function remainderAmount(data: LedgerData, rule: AllocationRule, date: ISODate, today: ISODate): Won {
  let min = accountBalance(data, rule.fromAccountId, date);
  if (date < today) {
    const later = balanceDeltas(data, rule.fromAccountId)
      .filter((x) => x.date > date && x.date <= today)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let running = min;
    for (let i = 0; i < later.length; i++) {
      running += later[i]!.delta;
      // 같은 날 기록은 모두 더한 뒤의 잔액으로 본다
      const next = later[i + 1];
      if (!next || next.date !== later[i]!.date) min = Math.min(min, running);
    }
  }
  return Math.max(0, Math.round(min));
}

/** 한 통장 · 한 달의 배분 흐름에서 쓰는 사건 (같은 날은 수입 → 정한 금액 → 자동 → 나머지 순) */
interface FlowEvent {
  date: ISODate;
  order: number;
  delta: Won;
  remainder: AllocationRule | null;
  key: string;
}

function eventOrder(a: FlowEvent, b: FlowEvent): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.order !== b.order) return a.order - b.order;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** 규칙의 month 회차 날짜 (시작일 확인 포함, recurring.ruleOccurrenceDate 와 같은 규칙) */
function ruleDate(data: LedgerData, rule: AllocationRule, month: YearMonth): ISODate | null {
  if (rule.deleted || !isValidMonth(rule.startMonth) || !isMonthActive(month, rule.startMonth, rule.endMonth)) return null;
  const date = dateInMonth(month, rule.dayOfMonth);
  for (const id of [rule.fromAccountId, rule.toAccountId]) {
    const opening = data.accounts.find((a) => a.id === id)?.openingDate;
    if (opening && date < opening) return null;
  }
  return date;
}

/**
 * 앞으로 '나머지 전부 보내기'가 보낼 금액 예상 (예측용). key = '<규칙id>:<월>'.
 * 보내는 통장마다 오늘 잔액에서 시작해, 아직 기록되지 않은 수입 계획 · 정한 금액 배분 · 나머지 배분을 날짜 순으로 흘려 본다.
 * 수입 계획이 없으면(수입을 손으로 기록하는 가계부) 앞으로 들어올 수입을 몰라서 예상은 보통 0 이다
 */
export function projectRemainders(data: LedgerData, today: ISODate, horizonMonths: number): Map<string, Won> {
  const out = new Map<string, Won>();
  const computed = data.rules.filter((r) => !r.deleted && (isRemainderRule(r) || isAutoRule(r)));
  if (computed.length === 0) return out;
  const thisMonth = monthOf(today);
  const last = addMonths(thisMonth, Math.max(1, horizonMonths) - 1);
  const recorded = new Set(data.transfers.filter((t) => !t.deleted).map((t) => t.id));
  // 자동 규칙은 잔액과 상관없이 그 배분 기간의 필요한 금액 (PLAN 4-15)
  const autoAmounts = new Map<string, Won>();
  for (const r of computed) {
    if (!isAutoRule(r)) continue;
    for (const month of monthRange(thisMonth, last)) {
      const date = ruleDate(data, r, month);
      if (date === null) continue;
      const amount = autoRuleAmount(data, r, date);
      autoAmounts.set(`${r.id}:${month}`, amount);
      out.set(`${r.id}:${month}`, amount);
    }
  }
  const sources = [...new Set(computed.filter(isRemainderRule).map((r) => r.fromAccountId))];
  for (const source of sources) {
    const events: FlowEvent[] = [];
    for (const month of monthRange(thisMonth, last)) {
      for (const p of activeIncomePlans(data, month, source)) {
        const date = incomePlanOccurrenceDate(data, p, month);
        if (date === null || recorded.has(incomeRecordId(p.id, month))) continue;
        events.push({ date, order: 0, delta: p.amount, remainder: null, key: p.id });
      }
      for (const r of data.rules) {
        if (r.deleted || (r.fromAccountId !== source && r.toAccountId !== source)) continue;
        const date = ruleDate(data, r, month);
        if (date === null || recorded.has(autoTransferId(r.id, month))) continue;
        if (isRemainderRule(r)) {
          if (r.fromAccountId === source) events.push({ date, order: 3, delta: 0, remainder: r, key: `${r.id}:${month}` });
          continue;
        }
        const amount = isAutoRule(r) ? (autoAmounts.get(`${r.id}:${month}`) ?? 0) : r.amount;
        const delta = (r.toAccountId === source ? amount : 0) - (r.fromAccountId === source ? amount : 0);
        events.push({ date, order: delta >= 0 ? 0 : isAutoRule(r) ? 2 : 1, delta, remainder: null, key: r.id });
      }
    }
    events.sort(eventOrder);
    let balance = accountBalance(data, source, today);
    for (const ev of events) {
      if (ev.remainder) {
        const amount = Math.max(0, balance);
        out.set(ev.key, amount);
        balance -= amount;
      } else balance += ev.delta;
    }
  }
  return out;
}

/** 나머지 · 자동 규칙이 있는지 (예측에서 projectRemainders 가 필요한지) */
export function isComputedRule(rule: Pick<AllocationRule, 'kind'>): boolean {
  return isRemainderRule(rule) || isAutoRule(rule);
}

/**
 * 예측에서 규칙이 그달 보낼 금액 (정한 금액은 그대로, 나머지 · 자동은 projectRemainders 예상).
 * 자동이 지도에 없으면(예측 기간 밖) data 로 바로 계산한다
 */
export function ruleAmountFor(rule: AllocationRule, month: YearMonth, remainders: Map<string, Won>, data?: LedgerData): Won {
  if (isAutoRule(rule)) {
    const v = remainders.get(`${rule.id}:${month}`);
    if (v !== undefined) return v;
    return data ? autoRuleAmount(data, rule, dateInMonth(month, rule.dayOfMonth)) : 0;
  }
  return isRemainderRule(rule) ? (remainders.get(`${rule.id}:${month}`) ?? 0) : rule.amount;
}

/** 나머지 규칙 하나의 예상 (규칙 줄 · 미리보기 · 배분 흐름) */
export interface RemainderEstimate {
  rule: AllocationRule;
  /** 다음 회차 날짜 (기록 전인 가장 이른 회차) */
  nextDate: ISODate | null;
  /** 다음 회차 예상 (수입 계획이 없으면 null = 알 수 없음) */
  nextAmount: Won | null;
  /** 한 달 월급날 흐름으로 본 매달 예상 (수입 계획이 없으면 null) */
  monthly: Won | null;
}

/** 나머지 규칙마다 다음 회차 예상과 매달 예상 (수입 계획이 있는 보내는 통장만 금액을 안다) */
export function remainderEstimates(data: LedgerData, today: ISODate): RemainderEstimate[] {
  const month = monthOf(today);
  const rules = data.rules.filter((r) => !r.deleted && isRemainderRule(r) && isValidMonth(r.startMonth) && (r.endMonth === null || compareMonth(r.endMonth, month) >= 0));
  if (rules.length === 0) return [];
  const projected = projectRemainders(data, today, 3);
  const recorded = new Set(data.transfers.filter((t) => !t.deleted).map((t) => t.id));
  return rules.map((rule) => {
    const planned = (data.incomePlans ?? []).some((p) => !p.deleted && p.accountId === rule.fromAccountId);
    let nextDate: ISODate | null = null;
    let nextAmount: Won | null = null;
    for (const m of monthRange(month, addMonths(month, 2))) {
      const date = ruleDate(data, rule, m);
      if (date === null || recorded.has(autoTransferId(rule.id, m))) continue;
      nextDate = date;
      nextAmount = planned ? (projected.get(`${rule.id}:${m}`) ?? 0) : null;
      break;
    }
    // 매달 예상: 다음 달(한 달을 온전히 흘려 본 달) 월급날 흐름
    const flowMonth = nextDate ? monthOf(nextDate) : month;
    const monthly = planned
      ? paydayPlans(data, flowMonth, rule.fromAccountId).reduce((s, p) => s + (p.remainder?.rule.id === rule.id ? p.remainder.amount : 0), 0)
      : null;
    return { rule, nextDate, nextAmount, monthly };
  });
}

/* ---------- 월급날 배분 미리보기 ---------- */

export interface PaydayLine {
  rule: AllocationRule;
  /** 정한 금액, 자동은 그 배분 기간의 필요한 금액, 나머지는 그날 남는 돈 예상 */
  amount: Won;
  /** 자동 규칙의 내역 (고정비 · 할부 · 생활비 항목) */
  need?: WindowNeed;
}

export interface PaydayPlan {
  day: number;
  /** 그날 들어오는 계획 수입 */
  income: Won;
  /** 그날 들어오는 사람 (계획 이름) */
  earners: string[];
  /** 앞 월급날에서 남아 넘어온 돈 (나머지 규칙이 없을 때) */
  carried: Won;
  fixed: PaydayLine[];
  /** 필요한 만큼 (자동) 배분 (정한 금액 뒤, 나머지 앞) */
  auto: PaydayLine[];
  remainder: PaydayLine | null;
  /** 나머지 규칙이 없을 때 그날 뒤 보내는 통장에 남는 돈 (음수 = 모자람) */
  left: Won;
  /** 정한 금액 + 자동이 그날까지 들어온 돈보다 많은 금액 (아니면 0) */
  short: Won;
}

/**
 * 보내는 통장 하나의 그달 월급날별 배분 (설정 미리보기 · 경고용).
 * 날짜 순으로 계획 수입을 더하고 정한 금액을 뺀 뒤, 나머지 규칙이 그날 남은 돈을 모두 가져간다.
 * 수입 계획이 없는 날의 배분도 한 줄로 보여 준다 (수입 0)
 */
export function paydayPlans(data: LedgerData, month: YearMonth, sourceAccountId: Id): PaydayPlan[] {
  const days = new Map<number, PaydayPlan>();
  const dayOf = (n: number) => Math.min(Math.max(1, n), 31);
  const get = (day: number) => {
    let p = days.get(day);
    if (!p) {
      p = { day, income: 0, earners: [], carried: 0, fixed: [], auto: [], remainder: null, left: 0, short: 0 };
      days.set(day, p);
    }
    return p;
  };
  for (const plan of activeIncomePlans(data, month, sourceAccountId)) {
    const p = get(dayOf(plan.dayOfMonth));
    p.income += plan.amount;
    if (plan.personName.trim()) p.earners.push(plan.personName.trim());
  }
  const rules = data.rules
    .filter((r) => !r.deleted && r.fromAccountId === sourceAccountId && isValidMonth(r.startMonth) && isMonthActive(month, r.startMonth, r.endMonth))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const r of rules) {
    const p = get(dayOf(r.dayOfMonth));
    if (isRemainderRule(r)) {
      if (!p.remainder) p.remainder = { rule: r, amount: 0 };
    } else if (isAutoRule(r)) {
      const need = windowNeed(data, r.toAccountId, dateInMonth(month, r.dayOfMonth), r.dayOfMonth);
      p.auto.push({ rule: r, amount: need.total, need });
    } else p.fixed.push({ rule: r, amount: r.amount });
  }
  // 정한 금액은 받는 통장 순서로 보여 준다
  const order = new Map(data.accounts.filter((a) => !a.deleted).sort((a, b) => a.order - b.order).map((a, i) => [a.id, i]));
  for (const p of days.values()) {
    p.fixed.sort((a, b) => (order.get(a.rule.toAccountId) ?? 999) - (order.get(b.rule.toAccountId) ?? 999));
    p.auto.sort((a, b) => (order.get(a.rule.toAccountId) ?? 999) - (order.get(b.rule.toAccountId) ?? 999));
  }
  const list = [...days.values()].sort((a, b) => a.day - b.day);
  let balance = 0;
  for (const p of list) {
    p.carried = balance;
    balance += p.income;
    const fixed = p.fixed.reduce((s, l) => s + l.amount, 0) + p.auto.reduce((s, l) => s + l.amount, 0);
    const available = balance;
    balance -= fixed;
    p.short = fixed > available ? fixed - Math.max(0, available) : 0;
    if (p.remainder) {
      p.remainder.amount = Math.max(0, balance);
      balance = Math.min(0, balance);
      p.left = 0;
    } else p.left = balance;
  }
  return list;
}

/** 이 통장에서 나가는 나머지 규칙이 그달 있는지 */
export function hasRemainderRule(data: LedgerData, month: YearMonth, sourceAccountId: Id): boolean {
  return data.rules.some(
    (r) => !r.deleted && isRemainderRule(r) && r.fromAccountId === sourceAccountId && isValidMonth(r.startMonth) && isMonthActive(month, r.startMonth, r.endMonth),
  );
}

/** 같은 통장 · 같은 날에 이미 있는 다른 나머지 규칙 (설정에서 하나만 두게) */
export function conflictingRemainderRule(
  data: LedgerData,
  rule: Pick<AllocationRule, 'fromAccountId' | 'dayOfMonth' | 'startMonth' | 'endMonth'> & { id?: Id | null },
): AllocationRule | null {
  return (
    data.rules.find(
      (r) =>
        !r.deleted &&
        isRemainderRule(r) &&
        r.id !== rule.id &&
        r.fromAccountId === rule.fromAccountId &&
        r.dayOfMonth === rule.dayOfMonth &&
        (r.endMonth === null || rule.startMonth <= r.endMonth) &&
        (rule.endMonth === null || r.startMonth <= rule.endMonth),
    ) ?? null
  );
}

/** '약 245만원' (만 원 아래면 원 단위 그대로) */
export function aboutMan(n: Won): string {
  const r = Math.round(n);
  if (Math.abs(r) < 10000) return `${r.toLocaleString('en-US')}원`;
  return `약 ${Math.round(r / 10000).toLocaleString('en-US')}만원`;
}

export interface RemainderView {
  rule: AllocationRule;
  /** 받는 통장 짧은 이름 ('저수지') */
  toName: string;
  /** '남는 돈 전부 → 저수지 · 다음 21일 예상 369,400원' */
  text: string;
  /** '다음 21일 예상 369,400원' 또는 '남는 돈이 없어요' (예상할 수 없으면 null) */
  nextText: string | null;
  /** 예상이 0 이하 (경고 색) */
  empty: boolean;
  /** '저수지로 매달 약 245만원' (수입 계획이 없으면 null) */
  monthlyText: string | null;
  monthly: Won | null;
}

/** 나머지 규칙마다 보여 줄 예상 문구 (규칙 줄 · 월급날 미리보기 · 배분 흐름 카드) */
export function remainderViews(data: LedgerData, today: ISODate): RemainderView[] {
  return remainderEstimates(data, today).map((e) => {
    const acc = data.accounts.find((a) => a.id === e.rule.toAccountId);
    const toName = (acc?.name ?? '지운 통장').replace(/통장$/, '') || '통장';
    const empty = e.nextAmount !== null && e.nextAmount <= 0;
    const nextText =
      e.nextAmount === null || e.nextDate === null
        ? null
        : empty
          ? '남는 돈이 없어요'
          : `다음 ${Number(e.nextDate.slice(8, 10))}일 예상 ${e.nextAmount.toLocaleString('en-US')}원`;
    const monthlyText = e.monthly !== null && e.monthly > 0 ? `${toName}로 매달 ${aboutMan(e.monthly)}` : null;
    return {
      rule: e.rule,
      toName,
      text: nextText ? `남는 돈 전부 → ${toName} · ${nextText}` : `남는 돈 전부 → ${toName}`,
      nextText,
      empty,
      monthlyText,
      monthly: e.monthly,
    };
  });
}
