/* 통장 화면의 순수 함수. 화면과 떼어 테스트해요. */
import { isCountedTransfer, isMonthActive, monthOf } from '@/domain';
import type { Account, AccountRole, Expense, Id, ISODate, LedgerData, Transfer, Won, YearMonth } from '@/domain/types';
import { ACCOUNT_ROLE_ICON } from '@/ui';
import { incomeSummaries, referenceIncome, type IncomeSummary } from '../settings/helpers';

/* ───────── 통장 역할 ───────── */

/** 카드에 붙이는 짧은 역할 이름 */
export const ROLE_LABEL: Record<AccountRole, string> = {
  income: '수입',
  fixed: '고정지출',
  event: '이벤트',
  reservoir: '저수지',
  savings: '저축투자',
  allowance: '용돈',
  other: '기타',
};

/** 역할별 아이콘 (홈·설정과 같은 모양) */
export const ROLE_ICON = ACCOUNT_ROLE_ICON;

/** 받침에 맞춰 '으로' / '로' (ㄹ 받침은 '로'). 한글이 아니면 '(으)로' */
export function ro(word: string): string {
  const ch = word.trim().slice(-1);
  const code = ch ? ch.charCodeAt(0) - 0xac00 : -1;
  if (code < 0 || code > 11171) return '(으)로';
  const jong = code % 28;
  return jong === 0 || jong === 8 ? '로' : '으로';
}

function accountName(data: LedgerData, id: Id | null): string {
  if (!id) return '';
  return data.accounts.find((a) => a.id === id)?.name ?? '지운 통장';
}

function categoryName(data: LedgerData, id: Id | null): string | null {
  if (!id) return null;
  return data.categories.find((c) => c.id === id)?.name ?? null;
}

/* ───────── 이번 달 들어온 돈 · 나간 돈 ───────── */

export interface MonthFlow {
  in: Won;
  out: Won;
}

/**
 * 통장별 이번 달(1일 ~ 오늘) 들어온 돈 · 나간 돈.
 * 잔액 계산과 같은 규칙: 완료 기록만, 시작일 이후, 오늘까지, 지운 기록 제외. 지출은 나간 돈이에요.
 */
export function monthFlows(data: LedgerData, today: ISODate): Record<Id, MonthFlow> {
  const month = monthOf(today);
  const out: Record<Id, MonthFlow> = {};
  const opening = new Map<Id, ISODate>();
  for (const a of data.accounts) {
    if (a.deleted) continue;
    out[a.id] = { in: 0, out: 0 };
    opening.set(a.id, a.openingDate);
  }
  const counts = (accountId: Id | null, date: ISODate): accountId is Id => {
    if (!accountId) return false;
    const from = opening.get(accountId);
    return from !== undefined && date >= from && date <= today && monthOf(date) === month;
  };
  for (const t of data.transfers) {
    if (!isCountedTransfer(data, t)) continue;
    if (counts(t.toAccountId, t.date)) out[t.toAccountId]!.in += t.amount;
    if (counts(t.fromAccountId, t.date)) out[t.fromAccountId]!.out += t.amount;
  }
  for (const e of data.expenses) {
    if (e.deleted) continue;
    if (counts(e.accountId, e.date)) out[e.accountId]!.out += e.amount;
  }
  return out;
}

/** 이번 달(1일 ~ 오늘) 밖에서 들어온 수입 합 · 지출 합 (지운 통장 포함, 완료 기록만) */
export function monthTotals(data: LedgerData, today: ISODate): { income: Won; spent: Won } {
  const month = monthOf(today);
  const inMonth = (date: ISODate) => date <= today && monthOf(date) === month;
  const income = data.transfers
    .filter((t) => !t.deleted && t.kind === 'income' && t.status === 'done' && inMonth(t.date))
    .reduce((s, t) => s + t.amount, 0);
  const spent = data.expenses.filter((e) => !e.deleted && inMonth(e.date)).reduce((s, e) => s + e.amount, 0);
  return { income, spent };
}

/* ───────── 매달 배분 흐름 ───────── */

export interface FlowItem {
  accountId: Id;
  name: string;
  role: AccountRole;
  amount: Won;
  /** 막대에서 차지하는 비율 (0..1) */
  share: number;
}

export interface FlowSummary {
  month: YearMonth;
  /** 배분을 보내는 수입 역할 통장 (첫 통장) */
  incomeAccount: Account | null;
  /** 수입 역할 통장 모두 (사람별 수입통장) */
  incomeAccounts: Account[];
  /** 수입통장마다 배분 합 · 수입 · 넘침 (배분이나 수입 기록이 있는 통장만) */
  sources: IncomeSummary[];
  /** 받는 통장별 합 (통장 순서) */
  items: FlowItem[];
  total: Won;
  /** 비교할 수입: 이번 달 수입 기록, 없으면 지난달. 둘 다 없으면 null */
  income: { month: YearMonth; amount: Won } | null;
  /** 배분 합이 수입보다 많은 금액 (아니면 0) */
  over: Won;
  /** 수입에서 배분하고 남는 금액 (아니면 0) */
  left: Won;
  /** 남는 돈의 막대 비율 */
  leftShare: number;
  /** 넘칠 때 막대 위 수입 위치 (0..1). 아니면 null */
  incomeMark: number | null;
}

/**
 * 월급 → 수입통장(사람마다 하나일 수 있음) → 각 통장 흐름. 이번 달에 적용되는 규칙 중 수입 역할 통장에서 나가는 것만 받는 통장별로 더해요.
 * 막대 기준 = max(배분 합, 수입). 배분이 수입보다 많으면 over > 0 이고 incomeMark 에 수입 위치를 줘요.
 */
export function flowSummary(data: LedgerData, month: YearMonth): FlowSummary {
  const incomeAccounts = data.accounts.filter((a) => !a.deleted && a.role === 'income').sort((a, b) => a.order - b.order);
  const incomeIds = new Set(incomeAccounts.map((a) => a.id));
  const byTo = new Map<Id, Won>();
  for (const r of data.rules) {
    if (r.deleted || r.amount <= 0 || !incomeIds.has(r.fromAccountId)) continue;
    if (!isMonthActive(month, r.startMonth, r.endMonth)) continue;
    byTo.set(r.toAccountId, (byTo.get(r.toAccountId) ?? 0) + r.amount);
  }
  const order = (id: Id) => data.accounts.find((a) => a.id === id)?.order ?? Number.MAX_SAFE_INTEGER;
  const total = [...byTo.values()].reduce((s, v) => s + v, 0);
  const income = referenceIncome(data, month);
  const incomeAmount = income?.amount ?? 0;
  const base = Math.max(total, incomeAmount) || 1;
  const items: FlowItem[] = [...byTo.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([accountId, amount]) => {
      const acc = data.accounts.find((a) => a.id === accountId);
      return {
        accountId,
        name: acc?.name ?? '지운 통장',
        role: acc?.role ?? 'other',
        amount,
        share: amount / base,
      };
    });
  const over = income && total > incomeAmount ? total - incomeAmount : 0;
  const left = income && incomeAmount > total ? incomeAmount - total : 0;
  return {
    month,
    incomeAccount: incomeAccounts[0] ?? null,
    incomeAccounts,
    sources: incomeSummaries(data, month).filter((x) => x.total > 0 || x.income !== null),
    items,
    total,
    income,
    over,
    left,
    leftShare: left / base,
    incomeMark: over > 0 && total > 0 ? incomeAmount / total : null,
  };
}

/* ───────── 통장 기록 (잔액 흐름) ───────── */

export type HistoryKind = 'opening' | 'income' | 'transferIn' | 'transferOut' | 'adjustIn' | 'adjustOut' | 'expense';

export interface HistoryEntry {
  key: string;
  kind: HistoryKind;
  date: ISODate;
  title: string;
  detail: string;
  /** 이 통장 기준 증감 (들어오면 +, 나가면 −) */
  amount: Won;
  /** 이 기록 뒤 잔액. 잔액에 안 들어간 기록은 null */
  balance: Won | null;
  /**
   * counted: 잔액에 들어감 · pending: 예정이거나 미래 날짜라 아직 안 들어감 ·
   * beforeOpening: 시작일 전 기록이라 잔액에 넣지 않음
   */
  status: 'counted' | 'pending' | 'beforeOpening';
  /** 매달 배분 · 고정 지출로 자동 기록됨 */
  auto: boolean;
  transfer: Transfer | null;
  expense: Expense | null;
}

const IN_KINDS = new Set<HistoryKind>(['opening', 'income', 'transferIn', 'adjustIn']);

function transferEntries(data: LedgerData, account: Account, t: Transfer): Omit<HistoryEntry, 'balance' | 'status'>[] {
  const base = { date: t.date, auto: t.ruleId !== null, transfer: t, expense: null };
  const memo = t.memo.trim();
  const out: Omit<HistoryEntry, 'balance' | 'status'>[] = [];
  if (t.kind === 'income') {
    if (t.toAccountId === account.id) {
      out.push({ ...base, key: `t:${t.id}`, kind: 'income', title: memo || '수입', detail: '수입', amount: t.amount });
    }
    return out;
  }
  if (t.kind === 'adjustment') {
    if (t.toAccountId === account.id)
      out.push({ ...base, key: `t:${t.id}:in`, kind: 'adjustIn', title: memo || '잔액 맞추기', detail: '잔액 조정', amount: t.amount });
    if (t.fromAccountId === account.id)
      out.push({ ...base, key: `t:${t.id}:out`, kind: 'adjustOut', title: memo || '잔액 맞추기', detail: '잔액 조정', amount: -t.amount });
    return out;
  }
  if (t.fromAccountId === t.toAccountId) return out;
  if (t.toAccountId === account.id) {
    const from = accountName(data, t.fromAccountId) || '다른 통장';
    out.push({ ...base, key: `t:${t.id}:in`, kind: 'transferIn', title: memo || '이체', detail: `${from}에서`, amount: t.amount });
  }
  if (t.fromAccountId === account.id) {
    const to = accountName(data, t.toAccountId) || '다른 통장';
    out.push({ ...base, key: `t:${t.id}:out`, kind: 'transferOut', title: memo || '이체', detail: `${to}${ro(to)}`, amount: -t.amount });
  }
  return out;
}

function compareAsc(a: HistoryEntry, b: HistoryEntry): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  // 같은 날은 시작 잔액 → 들어온 돈 → 나간 돈 순 (잔액 흐름이 자연스럽게)
  const rank = (e: HistoryEntry) => (e.kind === 'opening' ? 0 : IN_KINDS.has(e.kind) ? 1 : 2);
  const r = rank(a) - rank(b);
  if (r !== 0) return r;
  const ca = a.transfer?.createdAt ?? a.expense?.createdAt ?? '';
  const cb = b.transfer?.createdAt ?? b.expense?.createdAt ?? '';
  if (ca !== cb) return ca < cb ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * 통장 하나의 기록 (이체 · 수입 · 조정 · 지출 + 시작 잔액), 최신순, 기록마다 그 뒤 잔액.
 * 잔액 규칙은 domain accountBalance 와 같아요: 완료 · 시작일 이후 · 오늘까지만 더해요.
 * 예정 이체와 미래 날짜 기록은 pending (잔액 null), 시작일 전 기록은 beforeOpening.
 */
export function accountHistory(data: LedgerData, accountId: Id, today: ISODate): HistoryEntry[] {
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account) return [];
  const opening = account.openingDate;

  const raw: Omit<HistoryEntry, 'balance' | 'status'>[] = [];
  for (const t of data.transfers) {
    if (t.deleted) continue;
    // 월말 행이 '저수지'가 아닌 달의 월말 이체는 잔액에 들어가지 않으므로 목록에서도 뺀다
    if (t.status === 'done' && !isCountedTransfer(data, t)) continue;
    if (t.toAccountId !== accountId && t.fromAccountId !== accountId) continue;
    raw.push(...transferEntries(data, account, t));
  }
  for (const e of data.expenses) {
    if (e.deleted || e.accountId !== accountId) continue;
    const memo = e.memo.trim();
    const cat = categoryName(data, e.categoryId);
    raw.push({
      key: `e:${e.id}`,
      kind: 'expense',
      date: e.date,
      title: memo || cat || '지출',
      detail: memo && cat ? cat : '지출',
      amount: -e.amount,
      auto: e.fixedExpenseId !== null,
      transfer: null,
      expense: e,
    });
  }

  const entries: HistoryEntry[] = raw.map((r) => {
    const planned = r.transfer?.status === 'planned';
    const status: HistoryEntry['status'] =
      r.date < opening ? 'beforeOpening' : planned || r.date > today ? 'pending' : 'counted';
    return { ...r, status, balance: null };
  });
  entries.push({
    key: 'opening',
    kind: 'opening',
    date: opening,
    title: '시작 잔액',
    detail: '이날부터 잔액을 계산해요',
    amount: account.openingBalance,
    balance: account.openingBalance,
    status: 'counted',
    auto: false,
    transfer: null,
    expense: null,
  });

  entries.sort(compareAsc);
  let balance = account.openingBalance;
  for (const e of entries) {
    if (e.kind === 'opening') continue;
    if (e.status !== 'counted') continue;
    balance += e.amount;
    e.balance = balance;
  }
  return entries.reverse();
}

/** 기록을 달별로 묶어요 (입력 순서 유지) */
export function groupByMonth<T extends { date: ISODate }>(list: T[]): { month: YearMonth; items: T[] }[] {
  const groups: { month: YearMonth; items: T[] }[] = [];
  for (const item of list) {
    const m = monthOf(item.date);
    const last = groups[groups.length - 1];
    if (last && last.month === m) last.items.push(item);
    else groups.push({ month: m, items: [item] });
  }
  return groups;
}

/** 'YYYY-MM' → '2026년 11월' (올해면 '11월') */
export function monthTitle(month: YearMonth, thisYear: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return y === thisYear ? `${m}월` : `${y}년 ${m}월`;
}

/** 오류에서 보여 줄 문구 */
export function errorText(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message.trim()) return e.message;
  if (typeof e === 'string' && e.trim()) return e;
  return fallback;
}
