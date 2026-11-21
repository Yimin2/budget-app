/**
 * 오늘 보낼 돈 (PLAN 4-13): 월급통장에서 배분이 기록되면 실제 은행에서 보낼 일이 남아요.
 * 이번 달 월급통장에서 나간 배분 이체(자동 기록, 오늘까지)를 받는 통장 · 은행 · 계좌번호 · 금액과 함께 보여 주고,
 * [보냈어요]를 누르면 그 이체에 보낸 시각(sentAt)을 적어요. 두 사람 폰에서 같이 보여요.
 *
 * - 자동이체 배분(rule.autoDebit)은 은행이 알아서 보내서 따로 보낼 게 없어요. 다만 지난달과 금액이 다르면
 *   '자동이체를 ○ → ○로 바꿔 주세요'를 보여 주고, [바꿨어요]로 닫아요 (같은 sentAt)
 * - 덜 보낸 돈: 이번 달 배분이 다 기록된 뒤에도 월급통장에 돈이 남아 있으면 알려요.
 *   [저수지로 보내기]를 누르면 월급통장 → 저수지 이체(id leftover:<통장id>:<날짜>)를 적고, 그 줄도 보낼 돈에 함께 보여요
 */
import { accountBalance } from './balances';
import { addMonths, monthOf } from './dates';
import { autoTransferId } from './ids';
import type { Account, AllocationRule, Id, ISODate, LedgerData, Transfer, Won } from './types';

/** 월급통장에 남은 돈을 저수지로 보내는 이체 id (하루에 한 번, 두 폰에서 눌러도 한 건) */
export function leftoverTransferId(accountId: Id, date: ISODate): Id {
  return `${LEFTOVER_PREFIX}${accountId}:${date}`;
}
const LEFTOVER_PREFIX = 'leftover:';

export interface SendItem {
  transfer: Transfer;
  /** 배분 규칙 (남은 돈을 저수지로 보내는 줄이면 null) */
  rule: AllocationRule | null;
  to: Account | null;
  /** 보냈어요 · 바꿨어요를 눌렀는지 */
  sent: boolean;
  /** 은행 자동이체로 보내는 배분 */
  autoDebit: boolean;
  /** 자동이체인데 지난달과 금액이 다르면 지난달 금액 (아니면 null) */
  changedFrom: Won | null;
  /** 아직 할 일이 남았는지: 직접 보낼 배분을 아직 안 보냈거나, 금액이 바뀐 자동이체를 아직 안 바꿨어요 */
  pending: boolean;
}

export interface SendList {
  /** 보내는 통장(월급통장)마다 */
  sources: { account: Account; items: SendItem[]; leftover: Won }[];
  /** 할 일이 남은 줄 수 */
  pendingCount: number;
}

/** 배분 규칙이 나가는 수입 통장 (월급통장) */
export function salaryAccounts(data: LedgerData): Account[] {
  const ids = new Set(data.rules.filter((r) => !r.deleted).map((r) => r.fromAccountId));
  return data.accounts.filter((a) => !a.deleted && a.role === 'income' && ids.has(a.id)).sort((a, b) => a.order - b.order);
}

/**
 * 이번 달 오늘 보낼 돈. 배분 이체가 하나도 없으면 sources 가 비어요.
 * leftover = 오늘 그 월급통장 잔액(0보다 클 때만). 이번 달 배분 이체가 있을 때만 셈해요
 */
export function sendList(data: LedgerData, today: ISODate): SendList {
  const month = monthOf(today);
  const prev = addMonths(month, -1);
  const rules = new Map(data.rules.map((r) => [r.id, r]));
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const byId = new Map(data.transfers.map((t) => [t.id, t]));
  const sources: SendList['sources'] = [];
  let pendingCount = 0;
  for (const account of salaryAccounts(data)) {
    const items: SendItem[] = [];
    for (const t of data.transfers) {
      if (t.deleted || t.status !== 'done' || t.kind !== 'transfer' || t.fromAccountId !== account.id) continue;
      if (monthOf(t.date) !== month || t.date > today || t.amount <= 0) continue;
      const rule = t.ruleId ? (rules.get(t.ruleId) ?? null) : null;
      if (!rule && !t.id.startsWith(LEFTOVER_PREFIX)) continue;
      const autoDebit = rule?.autoDebit === true;
      const last = rule ? byId.get(autoTransferId(rule.id, prev)) : undefined;
      const changedFrom = autoDebit && last && !last.deleted && last.amount !== t.amount ? last.amount : null;
      const sent = !!t.sentAt;
      const pending = !sent && (!autoDebit || changedFrom !== null);
      if (pending) pendingCount += 1;
      items.push({ transfer: t, rule, to: t.toAccountId ? (accounts.get(t.toAccountId) ?? null) : null, sent, autoDebit, changedFrom, pending });
    }
    if (items.length === 0) continue;
    // 날짜 → 받는 통장 순서
    const order = (id: Id | null) => (id ? (accounts.get(id)?.order ?? 999) : 999);
    items.sort((a, b) => (a.transfer.date !== b.transfer.date ? (a.transfer.date < b.transfer.date ? -1 : 1) : order(a.transfer.toAccountId) - order(b.transfer.toAccountId)));
    const balance = accountBalance(data, account.id, today);
    sources.push({ account, items, leftover: Math.max(0, balance) });
  }
  return { sources, pendingCount };
}

/** 보낼 일이 남았거나 월급통장에 덜 보낸 돈이 있으면 true (홈 카드를 보일지) */
export function hasSendWork(list: SendList): boolean {
  return list.pendingCount > 0 || list.sources.some((s) => s.leftover > 0);
}
