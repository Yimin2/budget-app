/* 설정 화면의 순수 도우미 */
import {
  addMonths, compareMonth, dateInMonth, formatMan, formatMonthKo, isMonthActive, isRemainderRule, monthOf, paydayPlans, plannedIncome, ruleAmountIn,
} from '@/domain';
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
    .reduce((s, r) => s + ruleAmountIn(data, r, month), 0);
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
  /** 이번 달 이 통장에서 나가는 정한 금액 · 필요한 만큼(자동) 배분 합 */
  total: Won;
  /**
   * 비교할 수입: 이번 달 수입 계획 합(planned=true), 계획이 없으면 이번 달(없으면 지난달) 수입 기록
   */
  income: { month: YearMonth; amount: Won; planned?: boolean } | null;
  /** 배분이 수입보다 많은 금액 (아니면 0) */
  over: Won;
  /** 이 통장에서 나가는 '나머지 전부 보내기' 규칙 (있으면 남는 돈을 경고하지 않아요) */
  remainder: AllocationRule | null;
  /** 정한 금액을 보내고 남는 돈 (수입을 알 때만, 나머지 규칙이 있으면 그 규칙이 보낼 돈) */
  left: Won | null;
}

/** 수입통장마다 배분 합 · 수입 · 넘침 · 나머지 규칙 (통장 순서) */
export function incomeSummaries(data: LedgerData, month: YearMonth): IncomeSummary[] {
  return data.accounts
    .filter((a) => !a.deleted && a.role === 'income')
    .sort((a, b) => a.order - b.order)
    .map((account) => {
      const total = allocationTotal(data, month, account.id);
      const planned = plannedIncome(data, month, account.id);
      const income = planned > 0 ? { month, amount: planned, planned: true } : referenceIncome(data, month, account.id);
      const remainder =
        data.rules.find(
          (r) => !r.deleted && isRemainderRule(r) && r.fromAccountId === account.id && isMonthActive(month, r.startMonth, r.endMonth),
        ) ?? null;
      return {
        account,
        total,
        income,
        over: income && total > income.amount ? total - income.amount : 0,
        remainder,
        left: income ? Math.max(0, income.amount - total) : null,
      };
    });
}

/**
 * 월급날 배분 미리보기 한 줄: '21일: 297만 → 생활비(가람) 82.8만 · 이벤트 50만 · 나머지 36.94만 → 저수지'.
 * 받는 통장 이름은 짧게 (통장 이름 끝의 '통장'을 뺀다)
 */
export function paydayPreviewLines(data: LedgerData, month: YearMonth, sourceAccountId: string): { day: number; text: string; short: Won }[] {
  const short = (id: string) => {
    const acc = data.accounts.find((a) => a.id === id);
    const base = accountName(data.accounts, id).replace(/통장$/, '') || '통장';
    const owner = acc ? ownerLabel(acc) : null;
    return owner ? `${base}(${owner})` : base;
  };
  return paydayPlans(data, month, sourceAccountId).map((p) => {
    const parts = p.fixed.map((l) => `${short(l.rule.toAccountId)} ${formatMan(l.amount)}`);
    for (const l of p.auto) parts.push(`${short(l.rule.toAccountId)} ${formatMan(l.amount)}(자동)`);
    if (p.remainder) parts.push(`나머지 ${formatMan(p.remainder.amount)} → ${short(p.remainder.rule.toAccountId)}`);
    else if (p.left > 0 && p.income > 0) parts.push(`남는 돈 ${formatMan(p.left)}`);
    const head = p.income > 0 ? `${p.day}일: ${formatMan(p.income)}` : `${p.day}일`;
    return { day: p.day, text: parts.length > 0 ? `${head} → ${parts.join(' · ')}` : head, short: p.short };
  });
}

/** 통장 이름 옆에 붙일 주인 표시 ('민지'). 주인이 없거나 이름에 이미 들어 있으면 null */
export function ownerLabel(account: Pick<Account, 'name' | 'ownerName' | 'ownerEmail'>): string | null {
  const owner = account.ownerName?.trim() || account.ownerEmail?.split('@')[0] || '';
  if (!owner) return null;
  return account.name.includes(owner) ? null : owner;
}

/** 이메일을 짧게: 'minji@demo.com' → 'minji@…' (모바일 고르기 목록에서 두 사람 통장을 가려 볼 만큼만) */
export function shortEmail(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? `${email.slice(0, at)}@…` : email;
}

/**
 * 통장 주인 표시: '민지 · minji@demo' (short=true 면 '민지 (minji@…)'). 이름이 통장 이름에 이미 있으면 이메일만.
 * 주인이 없으면 null
 */
export function ownerText(account: Pick<Account, 'name' | 'ownerName' | 'ownerEmail'>, short = false): string | null {
  const email = account.ownerEmail?.trim() || '';
  const name = account.ownerName?.trim() || '';
  if (!name && !email) return null;
  const mail = email ? (short ? shortEmail(email) : email) : '';
  const who = name && !account.name.includes(name) ? name : '';
  if (who && mail) return short ? `${who} (${mail})` : `${who} · ${mail}`;
  return who || mail || null;
}

/** 고르기 목록의 통장 이름: '월급통장 · 준호 (jun@…)' · '생활비(민지) · minji@…'. 주인이 없으면 이름만 */
export function accountOptionLabel(account: Pick<Account, 'name' | 'ownerName' | 'ownerEmail' | 'deleted'>): string {
  const owner = ownerText(account, true);
  const base = owner ? `${account.name} · ${owner}` : account.name;
  return account.deleted ? `${base} (지운 통장)` : base;
}

/** 통장 목록을 고르기 선택지로 (사람별 통장은 주인을 붙여요) */
export function accountOptions(accounts: Pick<Account, 'id' | 'name' | 'ownerName' | 'ownerEmail' | 'deleted'>[]): { value: string; label: string }[] {
  return accounts.map((a) => ({ value: a.id, label: accountOptionLabel(a) }));
}

/** 지금 보여 줄 고정 지출 (지우지 않았고 이번 달 이후에도 살아 있는 것). 생활비 → 일반 → 용돈 → 할부 순 */
export function visibleFixed(list: FixedExpense[], month: YearMonth): FixedExpense[] {
  const order = { living: 0, bill: 1, allowance: 2, installment: 3 } as const;
  return list
    .filter((f) => !f.deleted && (f.endMonth === null || f.endMonth === '' || compareMonth(f.endMonth, month) >= 0))
    .sort((a, b) => order[a.kind] - order[b.kind] || (a.dayOfMonth ?? 0) - (b.dayOfMonth ?? 0));
}

export function accountName(accounts: Account[], id: string | null): string {
  if (!id) return '';
  return accounts.find((a) => a.id === id)?.name ?? '지운 통장';
}

/** 통장 이름 + 주인 (사람별 통장): '월급통장 · 준호 (jun@…)'. 지운 통장은 '지운 통장' */
export function accountNameWithOwner(accounts: Account[], id: string | null): string {
  if (!id) return '';
  const acc = accounts.find((a) => a.id === id);
  if (!acc) return '지운 통장';
  const owner = ownerText(acc, true);
  return owner ? `${acc.name} · ${owner}` : acc.name;
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
