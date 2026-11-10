/* 홈 '이번 달 쓴 돈' 카드의 순수 함수 (고정비 · 기타 · 용돈 · 이벤트통장). 화면과 떼어 테스트해요. */
import { accountBelongsTo, accountCharges, addMonths, isAutoFixedRecord, ledgerPeople, monthOf } from '@/domain';
import type { Account, EventProjection, Id, ISODate, LedgerData, LivingStatus, Won } from '@/domain';

export interface MonthSpentFixed {
  /** 이번 달 자동 기록된 고정비 · 할부 지출 합 (지금까지 낸 돈) */
  paid: Won;
  /** 이번 달 결제일이 있는 고정비(세부 항목 포함) · 할부 결제 합 */
  total: Won;
  /** 오늘 뒤에 남은 결제 수 */
  remainingCount: number;
  /** 예산의 고정 지출 칸 */
  href: string;
}

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
  fixed: MonthSpentFixed | null;
  etc: MonthSpentEtc | null;
  allowance: MonthSpentAllowance | null;
  event: MonthSpentEvent | null;
}

/**
 * 홈에 보이는 사람의 통장 (지우지 않은 것, 순서대로). livingAccountId = 그 사람의 생활비 통장, null = 모두 합쳐(모든 통장).
 * 생활비 통장과 이어진 사람(ledgerPeople) → 그 사람이 주인인 통장. 사람이 없으면 생활비 통장 주인(이메일 · 이름)과 같은 통장.
 * 생활비 통장 자신은 늘 들어가요 (주인 칸이 비어 있어도)
 */
export function personAccountsFor(data: LedgerData, livingAccountId: Id | null): Account[] {
  const accounts = data.accounts.filter((a) => !a.deleted).sort((a, b) => a.order - b.order);
  if (livingAccountId === null) return accounts;
  const living = data.accounts.find((a) => a.id === livingAccountId);
  if (!living) return [];
  const person = ledgerPeople(data).find((p) => accountBelongsTo(living, p));
  if (person) return accounts.filter((a) => a.id === living.id || accountBelongsTo(a, person));
  const email = (living.ownerEmail ?? '').trim();
  const name = (living.ownerName ?? '').trim();
  if (!email && !name) return accounts.filter((a) => a.id === living.id);
  return accounts.filter((a) => a.id === living.id || accountBelongsTo(a, { email, name, displayName: '' }));
}

/**
 * 홈에 보이는 사람의 용돈 통장 (역할 '용돈'). livingAccountId = 그 사람의 생활비 통장, null = 모두 합쳐(모든 용돈 통장).
 * 생활비 통장과 이어진 사람(ledgerPeople) → 그 사람 주인인 용돈 통장. 사람이 없으면 생활비 통장 주인(이메일 · 이름)과 같은 통장
 */
export function allowanceAccountsFor(data: LedgerData, livingAccountId: Id | null): Account[] {
  return personAccountsFor(data, livingAccountId).filter((a) => a.role === 'allowance');
}

/**
 * 이번 달 고정비 한 줄 (PLAN 6 홈). 보이는 사람의 통장에서 나가는 고정비 · 용돈(세부 항목이면 그 결제일의 항목 합) · 할부 결제.
 * - 낸 돈 = 이번 달 자동 기록(고정비 · 할부 회차, 미리 갚기 제외) 합
 * - 전체 = 이번 달에 결제일이 있는 결제 합, 남은 결제 = 결제일이 오늘 뒤인 결제 수
 * 이번 달 결제가 하나도 없으면 null (줄을 숨겨요)
 */
export function fixedThisMonth(data: LedgerData, today: ISODate, livingAccountId: Id | null): MonthSpentFixed | null {
  const month = monthOf(today);
  const from = `${month}-01`;
  const to = `${addMonths(month, 1)}-01`;
  const ids = personAccountsFor(data, livingAccountId).map((a) => a.id);
  const charges = ids.flatMap((id) => accountCharges(data, id, from, to));
  if (charges.length === 0) return null;
  const idSet = new Set(ids);
  const paid = data.expenses.reduce(
    (sum, e) => (!e.deleted && isAutoFixedRecord(e) && idSet.has(e.accountId) && monthOf(e.date) === month ? sum + e.amount : sum),
    0,
  );
  return {
    paid,
    total: charges.reduce((s, c) => s + c.amount, 0),
    remainingCount: charges.filter((c) => c.date > today).length,
    href: '/budget#st-fixed',
  };
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
 * 홈 '이번 달 쓴 돈'. 보이는 사람(livingAccountId, null = 모두 합쳐)의 고정비 · 기타 · 용돈과 이벤트통장.
 * 줄이 없으면 null: 고정비는 이번 달 결제가 없을 때, 기타는 0건, 용돈은 그 사람 용돈 통장이 없을 때, 이벤트통장은 통장이 없을 때
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
  const fixed = fixedThisMonth(data, today, input.livingAccountId);

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
    allowanceIds.length > 0
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
    event = { spent, contribution, balance, href: '/plan' };
  }

  return { fixed, etc, allowance, event };
}

/** 카드를 보일지: 0 이 아닌 금액이 있는 줄이 하나라도 있으면 (줄이 모두 없거나 모두 0원이면 숨겨요) */
export function hasMonthSpent(s: MonthSpent): boolean {
  return (
    s.fixed !== null ||
    (s.etc !== null && s.etc.count > 0) ||
    (s.allowance !== null && (s.allowance.spent !== 0 || s.allowance.balance !== 0)) ||
    (s.event !== null && (s.event.spent !== 0 || s.event.contribution !== 0 || s.event.balance !== 0))
  );
}
