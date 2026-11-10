/**
 * 예산 화면 시각화 (작업정리 8-3): 월급날 돈 흐름과 통장별 들어오는 돈 · 나가는 돈.
 * 금액은 모두 월급날 미리보기(paydayPlans)와 배분 기간 필요한 금액(windowNeed)을 그대로 써요 — 새 계산식 없음
 */
import {
  allocationDayOf, dateInMonth, formatMan, isMonthActive, isValidMonth, memberName, paydayPlans, windowNeed,
} from '@/domain';
import type { Account, AllocationRule, Id, ISODate, LedgerData, Won, YearMonth } from '@/domain/types';

/** 흐름 그림의 받는 통장 이름: '생활비(민구)' → '민구 생활비', '이벤트통장' → '이벤트', '저수지통장' → '저수지' */
export function flowName(data: LedgerData, account: Pick<Account, 'name' | 'ownerName' | 'ownerEmail'> | undefined | null): string {
  if (!account) return '지운 통장';
  const owner = account.ownerName?.trim() || (account.ownerEmail?.trim() ? memberName(data, account.ownerEmail.trim()) : '');
  let base = account.name.trim();
  if (owner) {
    base = base
      .replace(`(${owner})`, '')
      .replace(new RegExp(`(^|\\s)${owner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`), ' ')
      .trim();
  }
  base = base.replace(/통장$/, '').trim() || '통장';
  return owner ? `${owner} ${base}` : base;
}

export type FlowKind = 'fixed' | 'auto' | 'remainder' | 'left';

export interface FlowBar {
  /** 받는 통장 (남는 돈이 보내는 통장에 남으면 null) */
  toAccountId: Id | null;
  name: string;
  amount: Won;
  kind: FlowKind;
  /** '민구 생활비 127만 (자동)' · '이벤트 50만' · '저수지 남는 돈 37만' */
  label: string;
  rule: AllocationRule | null;
}

export interface PaydayFlow {
  /** 보내는 통장 (월급통장) */
  sourceId: Id;
  sourceName: string;
  day: number;
  /** 그날 들어오는 계획 수입 */
  income: Won;
  earners: string[];
  /** 앞 월급날에서 남아 넘어온 돈 */
  carried: Won;
  bars: FlowBar[];
  /** 보내는 돈 합 (남는 돈 전부 포함) */
  sent: Won;
  /** 정한 금액 + 자동이 그날 돈보다 많은 금액 */
  short: Won;
  /** 막대 길이의 기준 (그날 돈과 보내는 돈 중 큰 것) */
  scale: Won;
}

/** 흐름 막대 한 줄 이름 */
export function flowLabel(name: string, amount: Won, kind: FlowKind): string {
  if (kind === 'remainder') return `${name} 남는 돈 ${formatMan(amount)}`;
  if (kind === 'left') return `남는 돈 ${formatMan(amount)} (월급통장에 남아요)`;
  return `${name} ${formatMan(amount)}${kind === 'auto' ? ' (자동)' : ''}`;
}

/** 수입통장마다 그달 월급날별 돈 흐름 (월급날 미리보기와 같은 금액) */
export function paydayFlows(data: LedgerData, month: YearMonth): PaydayFlow[] {
  const sources = data.accounts.filter((a) => !a.deleted && a.role === 'income').sort((a, b) => a.order - b.order);
  const byId = new Map(data.accounts.map((a) => [a.id, a]));
  const out: PaydayFlow[] = [];
  for (const src of sources) {
    for (const p of paydayPlans(data, month, src.id)) {
      const bar = (rule: AllocationRule, amount: Won, kind: FlowKind): FlowBar => {
        const name = flowName(data, byId.get(rule.toAccountId));
        return { toAccountId: rule.toAccountId, name, amount, kind, label: flowLabel(name, amount, kind), rule };
      };
      const bars: FlowBar[] = [
        ...p.fixed.map((l) => bar(l.rule, l.amount, 'fixed')),
        ...p.auto.map((l) => bar(l.rule, l.amount, 'auto')),
      ];
      if (p.remainder) bars.push(bar(p.remainder.rule, p.remainder.amount, 'remainder'));
      else if (p.left > 0 && p.income > 0) {
        bars.push({ toAccountId: null, name: src.name, amount: p.left, kind: 'left', label: flowLabel(src.name, p.left, 'left'), rule: null });
      }
      if (bars.length === 0 && p.income <= 0) continue;
      const sent = bars.filter((b) => b.kind !== 'left').reduce((s, b) => s + b.amount, 0);
      out.push({
        sourceId: src.id,
        sourceName: src.name,
        day: p.day,
        income: p.income,
        earners: p.earners,
        carried: p.carried,
        bars,
        sent,
        short: p.short,
        scale: Math.max(p.income + Math.max(0, p.carried), bars.reduce((s, b) => s + b.amount, 0), 1),
      });
    }
  }
  return out;
}

/* ---------- 통장별 들어오는 돈 · 나가는 돈 ---------- */

export interface IncomingLine {
  rule: AllocationRule;
  day: number;
  fromAccountId: Id;
  amount: Won;
  kind: FlowKind;
}

export interface AccountMoney {
  accountId: Id;
  /** 이 통장으로 들어오는 배분 (월급날 미리보기 금액, 날짜 순) */
  incoming: IncomingLine[];
  incomingTotal: Won;
  /** 나가는 돈을 세는 기간 (이 통장 배분일 기준, 배분이 없으면 그달 1일부터 한 달) */
  from: ISODate;
  to: ISODate;
  bills: Won;
  billCount: number;
  installments: Won;
  installmentCount: number;
  living: Won;
  outgoingTotal: Won;
}

const activeIn = (r: AllocationRule, month: YearMonth) => !r.deleted && isValidMonth(r.startMonth) && isMonthActive(month, r.startMonth, r.endMonth);

/** 통장 하나의 그달 들어오는 돈(배분)과 나가는 돈(고정비 · 할부 · 생활비 예산 합) */
export function accountMoney(data: LedgerData, accountId: Id, month: YearMonth, today: ISODate): AccountMoney {
  const incoming: IncomingLine[] = [];
  const sources = new Set(data.rules.filter((r) => activeIn(r, month) && r.toAccountId === accountId).map((r) => r.fromAccountId));
  for (const src of sources) {
    for (const p of paydayPlans(data, month, src)) {
      for (const l of p.fixed) if (l.rule.toAccountId === accountId) incoming.push({ rule: l.rule, day: p.day, fromAccountId: src, amount: l.amount, kind: 'fixed' });
      for (const l of p.auto) if (l.rule.toAccountId === accountId) incoming.push({ rule: l.rule, day: p.day, fromAccountId: src, amount: l.amount, kind: 'auto' });
      if (p.remainder && p.remainder.rule.toAccountId === accountId) {
        incoming.push({ rule: p.remainder.rule, day: p.day, fromAccountId: src, amount: p.remainder.amount, kind: 'remainder' });
      }
    }
  }
  incoming.sort((a, b) => a.day - b.day || (a.rule.id < b.rule.id ? -1 : 1));
  // 나가는 돈은 그 통장 배분이 채우는 기간 (자동 배분 금액과 같은 셈, PLAN 4-15)
  const day = incoming[0]?.day ?? allocationDayOf(data, accountId, today) ?? 1;
  const need = windowNeed(data, accountId, dateInMonth(month, day), day);
  const keys = (kind: 'bill' | 'installment') => new Set(need.charges.filter((c) => c.kind === kind).map((c) => c.key)).size;
  return {
    accountId,
    incoming,
    incomingTotal: incoming.reduce((s, l) => s + l.amount, 0),
    from: need.date,
    to: need.end,
    bills: need.bills,
    billCount: keys('bill'),
    installments: need.installments,
    installmentCount: keys('installment'),
    living: need.living,
    outgoingTotal: need.total,
  };
}
