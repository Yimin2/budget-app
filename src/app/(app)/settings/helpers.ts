/* 설정 화면의 순수 도우미 */
import { addMonths, compareMonth, dateInMonth, formatMonthKo, isMonthActive, monthOf } from '@/domain';
import type { Account, AccountRole, AllocationRule, FixedExpense, ISODate, LedgerData, Won, YearMonth } from '@/domain/types';

export const ROLE_TEXT: Record<AccountRole, string> = {
  income: '수입',
  fixed: '고정지출 (생활비)',
  event: '이벤트',
  reservoir: '저수지',
  savings: '저축투자',
  allowance: '용돈',
  other: '기타',
};

export const ROLE_ORDER: AccountRole[] = ['income', 'fixed', 'event', 'reservoir', 'savings', 'allowance', 'other'];

export const ROLE_OPTIONS = ROLE_ORDER.map((r) => ({ value: r, label: ROLE_TEXT[r] }));

/** 구글 시트 주소 */
export function spreadsheetUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;
}

/** 지금 보여 줄 배분 규칙: 지우지 않았고 이번 달 이후에도 살아 있는 것 (시작월 순) */
export function visibleRules(rules: AllocationRule[], month: YearMonth): AllocationRule[] {
  return rules
    .filter((r) => !r.deleted && (r.endMonth === null || r.endMonth === '' || compareMonth(r.endMonth, month) >= 0))
    .sort((a, b) => compareMonth(a.startMonth, b.startMonth));
}

/** 규칙 상태 문구: '12월부터' · '이번 달까지' · '3월까지' (없으면 null) */
export function periodLabel(start: YearMonth, end: YearMonth | null, month: YearMonth): string | null {
  const year = Number(month.slice(0, 4));
  const fmt = (m: YearMonth) => (Number(m.slice(0, 4)) === year ? `${Number(m.slice(5, 7))}월` : `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`);
  if (compareMonth(start, month) > 0) return `${fmt(start)}부터`;
  if (end && compareMonth(end, month) === 0) return '이번 달까지';
  if (end) return `${fmt(end)}까지`;
  return null;
}

function incomeIdsOf(data: LedgerData, incomeAccountId?: string): Set<string> {
  return new Set(
    data.accounts
      .filter((a) => !a.deleted && a.role === 'income' && (incomeAccountId === undefined || a.id === incomeAccountId))
      .map((a) => a.id),
  );
}

/** 이번 달에 적용되는 배분 규칙 중 수입 역할 통장(incomeAccountId 를 주면 그 통장 하나)에서 나가는 금액 합 */
export function allocationTotal(data: LedgerData, month: YearMonth, incomeAccountId?: string): Won {
  const incomeIds = incomeIdsOf(data, incomeAccountId);
  return data.rules
    .filter((r) => !r.deleted && incomeIds.has(r.fromAccountId) && isMonthActive(month, r.startMonth, r.endMonth))
    .reduce((s, r) => s + r.amount, 0);
}

/**
 * 비교할 한 달 수입: 이번 달 수입 기록 합, 없으면 지난달. 둘 다 없으면 null.
 * (수입 = 밖에서 수입 역할 통장(incomeAccountId 를 주면 그 통장 하나)으로 들어온 완료 기록)
 */
export function referenceIncome(
  data: LedgerData,
  month: YearMonth,
  incomeAccountId?: string,
): { month: YearMonth; amount: Won } | null {
  const incomeIds = incomeIdsOf(data, incomeAccountId);
  const sumFor = (m: YearMonth) =>
    data.transfers
      .filter(
        (t) =>
          !t.deleted &&
          t.kind === 'income' &&
          t.status === 'done' &&
          t.toAccountId !== null &&
          incomeIds.has(t.toAccountId) &&
          monthOf(t.date) === m,
      )
      .reduce((s, t) => s + t.amount, 0);
  const now = sumFor(month);
  if (now > 0) return { month, amount: now };
  const prevMonth = addMonths(month, -1);
  const prev = sumFor(prevMonth);
  if (prev > 0) return { month: prevMonth, amount: prev };
  return null;
}

export interface IncomeSummary {
  account: Account;
  /** 이번 달 이 통장에서 나가는 배분 합 */
  total: Won;
  /** 이 통장의 이번 달(없으면 지난달) 수입 */
  income: { month: YearMonth; amount: Won } | null;
  /** 배분이 수입보다 많은 금액 (아니면 0) */
  over: Won;
}

/** 사람별 수입통장마다 배분 합 · 수입 · 넘침 (통장 순서) */
export function incomeSummaries(data: LedgerData, month: YearMonth): IncomeSummary[] {
  return data.accounts
    .filter((a) => !a.deleted && a.role === 'income')
    .sort((a, b) => a.order - b.order)
    .map((account) => {
      const total = allocationTotal(data, month, account.id);
      const income = referenceIncome(data, month, account.id);
      return { account, total, income, over: income && total > income.amount ? total - income.amount : 0 };
    });
}

/** 통장 이름 옆에 붙일 주인 표시 ('민지'). 주인이 없거나 이름에 이미 들어 있으면 null */
export function ownerLabel(account: Pick<Account, 'name' | 'ownerName' | 'ownerEmail'>): string | null {
  const owner = account.ownerName?.trim() || account.ownerEmail?.split('@')[0] || '';
  if (!owner) return null;
  return account.name.includes(owner) ? null : owner;
}

/** 지금 보여 줄 고정 지출 (지우지 않았고 이번 달 이후에도 살아 있는 것). 생활비 → 일반 → 용돈 순 */
export function visibleFixed(list: FixedExpense[], month: YearMonth): FixedExpense[] {
  const order = { living: 0, bill: 1, allowance: 2 } as const;
  return list
    .filter((f) => !f.deleted && (f.endMonth === null || f.endMonth === '' || compareMonth(f.endMonth, month) >= 0))
    .sort((a, b) => order[a.kind] - order[b.kind] || (a.dayOfMonth ?? 0) - (b.dayOfMonth ?? 0));
}

export function accountName(accounts: Account[], id: string | null): string {
  if (!id) return '';
  return accounts.find((a) => a.id === id)?.name ?? '지운 통장';
}

/** 카테고리에서 고를 기본 통장 역할: 가계부에 있는 통장 역할 (+ 지금 값) */
export function categoryRoleOptions(accounts: Account[], current?: AccountRole): { value: AccountRole; label: string }[] {
  const roles = new Set<AccountRole>(accounts.filter((a) => !a.deleted).map((a) => a.role));
  if (current) roles.add(current);
  return ROLE_ORDER.filter((r) => roles.has(r)).map((r) => {
    const acc = accounts.find((a) => !a.deleted && a.role === r);
    return { value: r, label: acc ? `${acc.name}` : ROLE_TEXT[r] };
  });
}

/** 카테고리 아이콘 고르기 목록 (UI 키트 Icon 이름 + 화면 읽기용 이름) */
export const CATEGORY_ICON_CHOICES: { name: string; label: string }[] = [
  { name: 'utensils', label: '식사' },
  { name: 'coffee', label: '커피' },
  { name: 'bus', label: '교통' },
  { name: 'home', label: '집' },
  { name: 'bag', label: '가방' },
  { name: 'shopping-bag', label: '쇼핑백' },
  { name: 'cart', label: '장보기' },
  { name: 'heart-pulse', label: '의료' },
  { name: 'pill', label: '약' },
  { name: 'ticket', label: '티켓' },
  { name: 'film', label: '영화' },
  { name: 'envelope', label: '봉투' },
  { name: 'plane', label: '여행' },
  { name: 'calendar', label: '달력' },
  { name: 'gift', label: '선물' },
  { name: 'heart', label: '하트' },
  { name: 'home-heart', label: '가족' },
  { name: 'box', label: '상자' },
  { name: 'tag', label: '태그' },
  { name: 'receipt', label: '영수증' },
  { name: 'wallet', label: '지갑' },
  { name: 'piggy-bank', label: '저금통' },
  { name: 'coins', label: '동전' },
  { name: 'sparkles', label: '반짝임' },
  { name: 'dots', label: '기타' },
];

/**
 * 새 배분·고정 지출의 시작월. 이번 달 그 날짜가 이미 지났으면 다음 달부터
 * (만들기 전 날짜로 이번 달 기록이 소급해 생기지 않게)
 */
export function startMonthForNew(today: ISODate, day: number | null): YearMonth {
  const month = monthOf(today);
  if (day === null) return month;
  return dateInMonth(month, day) < today ? addMonths(month, 1) : month;
}

/** 위 규칙으로 다음 달부터 시작하면 그 안내 문구, 아니면 undefined */
export function startMonthHint(today: ISODate, day: number | null): string | undefined {
  if (day === null) return undefined;
  const month = monthOf(today);
  if (dateInMonth(month, day) >= today) return undefined;
  return `이번 달 ${Number(dateInMonth(month, day).slice(8, 10))}일은 지나서 ${formatMonthKo(addMonths(month, 1))}부터 기록해요`;
}
