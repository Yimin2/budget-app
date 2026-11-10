/* 홈 '이번 달 쓴 돈' 카드의 순수 함수 (기타 · 용돈 · 이벤트통장). 화면과 떼어 테스트해요. */
import { accountBelongsTo, ledgerPeople, monthOf } from '@/domain';
import type { Account, EventProjection, Id, ISODate, LedgerData, LivingStatus, Won } from '@/domain';

export interface MonthSpentEtc {
  /** 이번 달 '기타(예산 없음)' 묶음에 쓴 돈 */
  amount: Won;
  /** 건수 */
  count: number;
  /** 내역(지출 · 이번 달, 한 사람이면 그 생활비 통장) */
  href: string;
}

export interface MonthSpentAllowance {
  /** 이번 달 용돈 통장에서 나간 돈 */
  spent: Won;
  /** 용돈 통장 잔액 (여럿이면 합) */
  balance: Won;
  accountIds: Id[];
  href: string;
}

export interface MonthSpentEvent {
  /** 이번 달 이벤트통장에서 나간 지출 (청구는 지출 금액으로) */
  spent: Won;
  /** 이번 달 적립 (배분 규칙) */
  contribution: Won;
  balance: Won;
  href: string;
}

export interface MonthSpent {
  etc: MonthSpentEtc | null;
  allowance: MonthSpentAllowance | null;
  event: MonthSpentEvent | null;
}

/**
 * 홈에 보이는 사람의 용돈 통장 (역할 '용돈'). livingAccountId = 그 사람의 생활비 통장, null = 모두 합쳐(모든 용돈 통장).
 * 생활비 통장과 이어진 사람(ledgerPeople) → 그 사람 주인인 용돈 통장. 사람이 없으면 생활비 통장 주인(이메일 · 이름)과 같은 통장
 */
export function allowanceAccountsFor(data: LedgerData, livingAccountId: Id | null): Account[] {
  const allowances = data.accounts.filter((a) => !a.deleted && a.role === 'allowance').sort((a, b) => a.order - b.order);
  if (livingAccountId === null) return allowances;
  const living = data.accounts.find((a) => a.id === livingAccountId);
  if (!living) return [];
  const person = ledgerPeople(data).find((p) => accountBelongsTo(living, p));
  if (person) return allowances.filter((a) => accountBelongsTo(a, person));
  const email = (living.ownerEmail ?? '').trim();
  const name = (living.ownerName ?? '').trim();
  if (!email && !name) return [];
  return allowances.filter((a) => accountBelongsTo(a, { email, name, displayName: '' }));
}

/**
 * 이번 달 '기타(예산 없음)'에 쓴 돈과 건수 (PLAN 4-1 과 같은 지출: 생활비 통장 · 고정 자동 기록 · 이벤트 지출이 아닌 것,
 * 그 통장 예산 항목이 없는 카테고리 · 카테고리 없음). 예전 방식의 '생활비' 한 줄이 있는 통장은 그 줄이 묶음이라 세지 않아요
 */
function etcSpent(data: LedgerData, month: string, statuses: LivingStatus[]): { amount: Won; count: number } {
  let amount = 0;
  let count = 0;
  for (const s of statuses) {
    if (!s.livingAccountId) continue;
    if (s.items.some((i) => i.categoryId === null && !i.unbudgeted)) continue;
    const budgeted = new Set(s.items.filter((i) => !i.unbudgeted && i.categoryId !== null).map((i) => i.categoryId));
    for (const e of data.expenses) {
      if (e.deleted || e.fixedExpenseId !== null || e.eventId !== null || e.accountId !== s.livingAccountId) continue;
      if (monthOf(e.date) !== month) continue;
      if (e.categoryId !== null && budgeted.has(e.categoryId)) continue;
      amount += e.amount;
      count += 1;
    }
  }
  return { amount, count };
}

/** 이번 달 이 통장들에서 나간 지출 합 */
function spentFrom(data: LedgerData, month: string, ids: ReadonlySet<Id>): Won {
  return data.expenses.reduce((sum, e) => (!e.deleted && ids.has(e.accountId) && monthOf(e.date) === month ? sum + e.amount : sum), 0);
}

/**
 * 홈 '이번 달 쓴 돈'. 보이는 사람(livingAccountId, null = 모두 합쳐)의 기타 · 용돈과 이벤트통장.
 * 줄마다 보일 게 없으면 null: 기타는 0건, 용돈은 통장이 없거나 쓴 돈 · 잔액이 모두 0, 이벤트통장은 통장이 없거나 셋 다 0
 */
export function monthSpent(
  data: LedgerData,
  today: ISODate,
  input: {
    /** 보이는 사람의 생활비 (모두 합쳐면 통장마다 하나씩) */
    statuses: LivingStatus[];
    /** 보이는 사람의 생활비 통장. null = 모두 합쳐 */
    livingAccountId: Id | null;
    balances: Record<Id, Won>;
    eventProjection: EventProjection | null;
  },
): MonthSpent {
  const month = monthOf(today);

  const etcSum = etcSpent(data, month, input.statuses);
  const etc: MonthSpentEtc | null =
    etcSum.count > 0
      ? {
          ...etcSum,
          href: `/history?month=${month}${input.livingAccountId ? `&account=${encodeURIComponent(input.livingAccountId)}` : ''}`,
        }
      : null;

  const allowanceAccounts = allowanceAccountsFor(data, input.livingAccountId);
  const allowanceIds = allowanceAccounts.map((a) => a.id);
  const allowanceSpent = spentFrom(data, month, new Set(allowanceIds));
  const allowanceBalance = allowanceIds.reduce((s, id) => s + (input.balances[id] ?? 0), 0);
  const allowance: MonthSpentAllowance | null =
    allowanceIds.length > 0 && (allowanceSpent !== 0 || allowanceBalance !== 0)
      ? {
          spent: allowanceSpent,
          balance: allowanceBalance,
          accountIds: allowanceIds,
          href:
            allowanceIds.length === 1
              ? `/history?tab=accounts&id=${encodeURIComponent(allowanceIds[0]!)}`
              : '/history?tab=accounts',
        }
      : null;

  const eventId = input.eventProjection?.accountId ?? null;
  let event: MonthSpentEvent | null = null;
  if (eventId) {
    const spent = spentFrom(data, month, new Set([eventId]));
    const contribution = input.eventProjection!.monthlyContribution;
    const balance = input.balances[eventId] ?? input.eventProjection!.currentBalance;
    if (spent !== 0 || contribution !== 0 || balance !== 0) event = { spent, contribution, balance, href: '/plan' };
  }

  return { etc, allowance, event };
}

/** 카드를 보일지: 줄이 하나라도 있으면 */
export function hasMonthSpent(s: MonthSpent): boolean {
  return s.etc !== null || s.allowance !== null || s.event !== null;
}
