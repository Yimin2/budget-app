/** domain 내부 도우미 (index 에서 내보내지 않음) */
import { isMonthActive } from './dates';
import type { Account, AccountRole, Id, LedgerData, YearMonth } from './types';

export function activeAccountsSorted(data: LedgerData): Account[] {
  return data.accounts.filter((a) => !a.deleted).sort((a, b) => a.order - b.order);
}

export function firstAccountByRole(data: LedgerData, role: AccountRole): Account | null {
  return activeAccountsSorted(data).find((a) => a.role === role) ?? null;
}

/**
 * 그달 생활비 통장들 (PLAN 4-1 · 4-14).
 * 그달 유효한 living 고정지출의 통장들 (통장 순서, 지운 통장은 뒤). 없으면 아무 living 행의 통장 하나, 그것도 없으면 role='fixed' 첫 통장
 */
export function livingAccountIdsFor(data: LedgerData, month: YearMonth): Id[] {
  const rows = data.fixedExpenses.filter((f) => !f.deleted && f.kind === 'living' && isMonthActive(month, f.startMonth, f.endMonth));
  if (rows.length > 0) {
    const ids: Id[] = [];
    for (const r of rows) if (!ids.includes(r.accountId)) ids.push(r.accountId);
    const order = new Map(activeAccountsSorted(data).map((a, i) => [a.id, i]));
    const first = new Map(ids.map((id, i) => [id, i]));
    return ids.sort(
      (a, b) => (order.get(a) ?? 1e6) - (order.get(b) ?? 1e6) || (first.get(a) ?? 0) - (first.get(b) ?? 0),
    );
  }
  const anyLiving = data.fixedExpenses.find((f) => !f.deleted && f.kind === 'living');
  if (anyLiving) return [anyLiving.accountId];
  const fixed = firstAccountByRole(data, 'fixed');
  return fixed ? [fixed.id] : [];
}

/** 생활비 지출 통장 (여럿이면 첫 통장): 그달 유효한 living 고정지출의 accountId, 없으면 role='fixed' 첫 통장 */
export function livingAccountIdFor(data: LedgerData, month: YearMonth): Id | null {
  return livingAccountIdsFor(data, month)[0] ?? null;
}

/** 보낼 곳인지 (잔액을 관리하지 않는 각자 생활비 · 용돈, 2026-11) */
export function isPayeeAccount(a: Pick<Account, 'payee'>): boolean {
  return a.payee === true;
}

/** 잔액을 관리하는 통장 (보낼 곳 빼고) */
export function managedAccounts(data: LedgerData): Account[] {
  return activeAccountsSorted(data).filter((a) => !isPayeeAccount(a));
}

/**
 * 생활비 · 용돈 통장을 보낼 곳으로 바꿀 통장들 (아직 표시 안 한 것만, 다시 해도 같음).
 * 월급 · 이벤트 · 저수지 · 그 밖의 통장은 그대로 통장이에요
 */
export function accountsToPayee(data: LedgerData): Account[] {
  return data.accounts.filter((a) => !a.deleted && !a.payee && (a.role === 'fixed' || a.role === 'allowance')).map((a) => ({ ...a, payee: true }));
}

/**
 * 월급통장은 하나만 (2026-11): 각자 월급은 자기 통장에 들어오고, 거기서 함께 쓰는 월급통장 하나로 보내요.
 * 수입통장이 둘 이상이면 월급통장 하나(이름에 '월급' → 나가는 배분이 많은 것 → 수입 계획이 많은 것 → 순서)만 남기고
 * 나머지는 보낼 곳처럼 관리 목록에서 빼요(각자 통장). 그 통장에서 나가던 배분 · 그 통장으로 받던 수입 계획,
 * 그 통장에 기록한 월급 · 그 통장에서 나간 배분 이체도 월급통장으로 옮겨요 (월급은 월급통장에 들어와서 나가요).
 * 다시 해도 같음 (옮길 게 없으면 빈 목록)
 */
export function incomeAccountsToMerge(data: LedgerData): {
  hubId: Id | null;
  accounts: Account[];
  rules: LedgerData['rules'];
  incomePlans: NonNullable<LedgerData['incomePlans']>;
  transfers: LedgerData['transfers'];
} {
  const empty = { hubId: null, accounts: [], rules: [], incomePlans: [], transfers: [] };
  const incomes = data.accounts.filter((a) => !a.deleted && a.role === 'income');
  const managed = incomes.filter((a) => !a.payee);
  if (managed.length < 2) return { ...empty, hubId: managed[0]?.id ?? null };
  const ruleCount = (id: Id) => data.rules.filter((r) => !r.deleted && r.fromAccountId === id).length;
  const planCount = (id: Id) => (data.incomePlans ?? []).filter((p) => !p.deleted && p.accountId === id).length;
  const hub = [...managed].sort(
    (a, b) =>
      Number(b.name.includes('월급')) - Number(a.name.includes('월급')) ||
      ruleCount(b.id) - ruleCount(a.id) ||
      planCount(b.id) - planCount(a.id) ||
      a.order - b.order,
  )[0]!;
  const others = new Set(managed.filter((a) => a.id !== hub.id).map((a) => a.id));
  return {
    hubId: hub.id,
    accounts: managed.filter((a) => others.has(a.id)).map((a) => ({ ...a, payee: true })),
    rules: data.rules.filter((r) => !r.deleted && others.has(r.fromAccountId)).map((r) => ({ ...r, fromAccountId: hub.id })),
    incomePlans: (data.incomePlans ?? []).filter((p) => !p.deleted && others.has(p.accountId)).map((p) => ({ ...p, accountId: hub.id })),
    transfers: data.transfers.flatMap((t) => {
      if (t.deleted) return [];
      const to = t.kind === 'income' && t.toAccountId && others.has(t.toAccountId);
      const from = t.ruleId !== null && t.fromAccountId && others.has(t.fromAccountId);
      if (!to && !from) return [];
      return [{ ...t, ...(to ? { toAccountId: hub.id } : {}), ...(from ? { fromAccountId: hub.id } : {}) }];
    }),
  };
}
