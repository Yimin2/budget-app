/* 새 가계부 만들기 마법사의 순수 도우미 (화면과 분리해서 테스트해요) */
import { DEFAULT_CATEGORIES, defaultSpreadFor } from '@/domain';
import type { Account, AccountRole, AllocationRule, Category, FixedExpense, IncomePlan, LivingSpread, Won, YearMonth } from '@/domain/types';

export type AllocRole = Extract<AccountRole, 'fixed' | 'event' | 'savings' | 'reservoir'>;

/** 매달 배분 순서와 설명 (PLAN 2장: 수입 → 고정지출 / 이벤트 / 저축투자 / 저수지) */
export const ALLOC_TARGETS: { role: AllocRole; label: string; hint: string }[] = [
  { role: 'fixed', label: '고정지출통장', hint: '월세·통신비 같은 고정비와 생활비' },
  { role: 'event', label: '이벤트통장', hint: '경조사·여행·명절·큰 구매' },
  { role: 'savings', label: '저축투자통장', hint: '적금·투자' },
  { role: 'reservoir', label: '저수지통장', hint: '목돈·비상금. 이벤트가 모자랄 때 끌어 써요' },
];

export const BILL_SUGGESTIONS = ['월세', '관리비', '통신비', '보험', '구독'];

export const DEFAULT_NAMES = { shared: '우리 집 가계부', personal: '내 용돈 가계부' } as const;

export interface BillDraft {
  key: string;
  name: string;
  amount: Won | null;
  day: number;
}

export interface AllowanceDraft {
  key: string;
  email: string;
  name: string;
  amount: Won | null;
  day: number;
}

/**
 * 공용 가계부의 버는 사람 한 명 (PLAN 4-13): 월급 · 월급날은 수입 계획이 되고, 월급은 함께 쓰는 월급통장 하나로 들어와요.
 * 월급날에 월급통장에서 각 통장으로 보낼 금액(alloc)을 정하고, 남은 돈은 저수지로 모두 보낼 수 있어요(rest)
 */
export interface EarnerDraft {
  key: string;
  name: string;
  email: string;
  salary: Won | null;
  /** 월급날 = 배분하는 날 */
  day: number;
  alloc: Record<AllocRole, Won | null>;
  /** 남은 돈은 모두 저수지통장으로 (나머지 전부 보내기). true 면 alloc.reservoir 는 쓰지 않아요 */
  rest: boolean;
}

/** 함께 쓰는 월급통장 이름 */
export const SALARY_ACCOUNT_NAME = '월급통장';

/** 생활비 항목 예산 한 줄 */
export interface LivingDraft {
  key: string;
  categoryId: string;
  name: string;
  icon: string;
  amount: Won | null;
  spread: LivingSpread;
}

export type DraftErrors = Record<string, { name?: string; email?: string; amount?: string }>;

let seq = 0;
/** 화면 안에서만 쓰는 행 키 */
export function draftKey(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;
export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/* ---------- 버는 사람 ---------- */

export function emptyAlloc(): Record<AllocRole, Won | null> {
  return { fixed: null, event: null, savings: null, reservoir: null };
}

export function newEarner(name = '', email = ''): EarnerDraft {
  return { key: draftKey('earner'), name, email, salary: null, day: 25, alloc: emptyAlloc(), rest: true };
}

/** 정한 금액으로 보내는 통장 (남은 돈을 저수지로 모두 보내면 저수지는 빼요) */
export function fixedTargets(e: Pick<EarnerDraft, 'rest'>): typeof ALLOC_TARGETS {
  return e.rest ? ALLOC_TARGETS.filter((t) => t.role !== 'reservoir') : ALLOC_TARGETS;
}

/** 사람별 수입통장 이름: '민지 수입통장' (이름이 없으면 '수입통장') */
export function incomeAccountName(name: string): string {
  const n = name.trim();
  return n ? `${n} 수입통장` : '수입통장';
}

function hasAnyAmount(e: Pick<EarnerDraft, 'salary' | 'alloc'>): boolean {
  return (e.salary !== null && e.salary > 0) || ALLOC_TARGETS.some((t) => (e.alloc[t.role] ?? 0) > 0);
}

/** 저장할 사람: 첫 사람(만든 사람)은 늘, 나머지는 이름이나 금액이 있을 때만 */
export function activeEarners(earners: EarnerDraft[]): EarnerDraft[] {
  return earners.filter((e, i) => i === 0 || e.name.trim() !== '' || hasAnyAmount(e));
}

/** 둘째 사람부터는 이름이 꼭 있어야 해요. 이메일은 쓰면 형식을 확인해요 */
export function validateEarners(earners: EarnerDraft[]): DraftErrors {
  const errors: DraftErrors = {};
  earners.forEach((e, i) => {
    const err: DraftErrors[string] = {};
    if (i > 0 && !e.name.trim() && hasAnyAmount(e)) err.name = '이름을 입력해 주세요';
    if (e.email.trim() && !isEmail(e.email)) err.email = '이메일 주소를 확인해 주세요';
    if (err.name || err.email) errors[e.key] = err;
  });
  return errors;
}

/** 사람의 수입통장 행 값 (이름 · 주인) */
export function earnerAccountFields(e: EarnerDraft): Pick<Account, 'name' | 'ownerName' | 'ownerEmail'> {
  return { name: incomeAccountName(e.name), ownerName: e.name.trim() || null, ownerEmail: e.email.trim() || null };
}

/* ---------- 생활비 항목 ---------- */

/** 마법사 생활비 단계에 미리 넣어 둘 항목: 생활비 기본 카테고리(식비·카페·교통·생활·쇼핑·의료·문화), 금액은 비워요 */
export function defaultLivingDrafts(categories: Category[]): LivingDraft[] {
  const names = DEFAULT_CATEGORIES.filter((c) => c.role === 'fixed' && c.key !== 'etc').map((c) => c.name);
  return names
    .map((n) => categories.find((c) => !c.deleted && c.name === n))
    .filter((c): c is Category => !!c)
    .map((c) => livingDraftFor(c));
}

export function livingDraftFor(c: Category): LivingDraft {
  return { key: draftKey('living'), categoryId: c.id, name: c.name, icon: c.icon, amount: null, spread: defaultSpreadFor(c.name) };
}

export function livingTotal(rows: LivingDraft[]): Won {
  return rows.reduce((s, r) => s + (r.amount && r.amount > 0 ? r.amount : 0), 0);
}

/* ---------- 매달 배분 합계 ---------- */

export interface AllocationSummary {
  total: Won;
  salary: Won | null;
  /** salary - total (salary 가 없으면 null) */
  left: Won | null;
  state: 'none' | 'over' | 'under' | 'even';
}

export function allocationSummary(salary: Won | null, amounts: (Won | null | undefined)[]): AllocationSummary {
  const total = amounts.reduce<number>((s, a) => s + (a && a > 0 ? a : 0), 0);
  if (salary === null || salary <= 0) return { total, salary: null, left: null, state: 'none' };
  const left = salary - total;
  return { total, salary, left, state: left < 0 ? 'over' : left > 0 ? 'under' : 'even' };
}

/* ---------- 입력 확인 ---------- */

/** 금액만 있고 이름이 없으면 오류. 이름도 금액도 없는 행은 무시해요 */
export function validateBills(bills: BillDraft[]): DraftErrors {
  const errors: DraftErrors = {};
  for (const b of bills) {
    const hasAmount = b.amount !== null && b.amount > 0;
    const hasName = b.name.trim() !== '';
    if (hasAmount && !hasName) errors[b.key] = { name: '이름을 입력해 주세요' };
    else if (hasName && !hasAmount) errors[b.key] = { amount: '금액을 입력해 주세요' };
  }
  return errors;
}

/** 금액이 있으면 받는 사람 이메일이 꼭 있어야 해요. 금액이 없는 행은 무시해요 (내 이메일이 미리 채워져 있어서) */
export function validateAllowances(rows: AllowanceDraft[]): DraftErrors {
  const errors: DraftErrors = {};
  for (const r of rows) {
    const hasAmount = r.amount !== null && r.amount > 0;
    const email = r.email.trim();
    if (!hasAmount) continue;
    if (!email) errors[r.key] = { email: '받는 사람 이메일을 입력해 주세요' };
    else if (!isEmail(email)) errors[r.key] = { email: '이메일 주소를 확인해 주세요' };
  }
  return errors;
}

/* ---------- 저장할 행 만들기 ---------- */

export type FixedInput = Omit<FixedExpense, 'id' | 'deleted'>;

export interface FixedContext {
  /** 고정 지출이 나가는 통장 (보통 고정지출통장) */
  accountId: string;
  month: YearMonth;
}

/** 마법사 입력 → 고정 지출 행 (키는 저장 상태를 맞출 때 써요) */
export function wantedFixed(
  ctx: FixedContext,
  bills: BillDraft[],
  allowances: AllowanceDraft[],
): { key: string; input: FixedInput }[] {
  const base = { accountId: ctx.accountId, startMonth: ctx.month, endMonth: null, spread: 'daily' as const };
  const out: { key: string; input: FixedInput }[] = [];
  for (const b of bills) {
    if (!b.name.trim() || b.amount === null || b.amount <= 0) continue;
    out.push({
      key: b.key,
      input: { ...base, name: b.name.trim(), amount: b.amount, categoryId: null, dayOfMonth: b.day, kind: 'bill', targetEmail: null },
    });
  }
  for (const r of allowances) {
    const email = r.email.trim();
    if (!isEmail(email) || r.amount === null || r.amount <= 0) continue;
    const who = r.name.trim() || email.split('@')[0] || email;
    out.push({
      key: r.key,
      input: { ...base, name: `용돈(${who})`, amount: r.amount, categoryId: null, dayOfMonth: r.day, kind: 'allowance', targetEmail: email },
    });
  }
  return out;
}

/** 마법사 생활비 항목 → 생활비 예산 행 (키 = living:카테고리id). 금액이 없는 항목은 빼요 */
export function wantedLiving(ctx: FixedContext, rows: LivingDraft[]): { key: string; input: FixedInput }[] {
  const out: { key: string; input: FixedInput }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.amount === null || r.amount <= 0 || seen.has(r.categoryId)) continue;
    seen.add(r.categoryId);
    out.push({
      key: `living:${r.categoryId}`,
      input: {
        accountId: ctx.accountId,
        startMonth: ctx.month,
        endMonth: null,
        name: r.name,
        amount: r.amount,
        categoryId: r.categoryId,
        dayOfMonth: null,
        kind: 'living',
        targetEmail: null,
        spread: r.spread,
      },
    });
  }
  return out;
}

export type RuleInput = Omit<AllocationRule, 'id' | 'deleted'>;
export type IncomePlanInput = Omit<IncomePlan, 'id' | 'deleted'>;

/** 버는 사람 → 수입 계획 (키 = 사람 키). 월급이 없는 사람은 빼요. 이름이 없으면 이메일 앞부분 → '나' */
export function wantedIncomePlans(
  ctx: { accountId: string | null; month: YearMonth },
  earners: EarnerDraft[],
): { key: string; input: IncomePlanInput }[] {
  if (!ctx.accountId) return [];
  const out: { key: string; input: IncomePlanInput }[] = [];
  for (const e of earners) {
    if (e.salary === null || e.salary <= 0) continue;
    const email = e.email.trim();
    out.push({
      key: e.key,
      input: {
        personName: e.name.trim() || email.split('@')[0] || '나',
        personEmail: email || null,
        amount: e.salary,
        dayOfMonth: e.day,
        accountId: ctx.accountId,
        startMonth: ctx.month,
        endMonth: null,
        memo: '',
      },
    });
  }
  return out;
}

/**
 * 버는 사람마다 월급날의 '남은 돈은 모두 저수지로' 규칙 (키 = <사람 키>:rest).
 * 같은 날 월급이 둘이면 나머지 규칙은 하나만 (먼저 적은 사람). 월급도 배분도 없는 사람은 빼요
 */
export function wantedRestRules(
  ctx: { incomeAccountId: string | null; reservoirAccountId: string | null; month: YearMonth },
  earners: EarnerDraft[],
): { key: string; input: RuleInput }[] {
  if (!ctx.incomeAccountId || !ctx.reservoirAccountId) return [];
  const days = new Set<number>();
  const out: { key: string; input: RuleInput }[] = [];
  for (const e of earners) {
    if (!e.rest || !hasAnyAmount(e) || days.has(e.day)) continue;
    days.add(e.day);
    out.push({
      key: `${e.key}:rest`,
      input: {
        fromAccountId: ctx.incomeAccountId,
        toAccountId: ctx.reservoirAccountId,
        amount: 0,
        kind: 'remainder',
        dayOfMonth: e.day,
        startMonth: ctx.month,
        endMonth: null,
      },
    });
  }
  return out;
}

/** 매달 배분 입력 → 규칙 행 (키 = [keyPrefix:]받는 통장 역할. 사람마다 keyPrefix 를 달리 줘요) */
export function wantedRules(
  ctx: { incomeAccountId: string | null; month: YearMonth; day: number; keyPrefix?: string },
  targets: { role: AllocRole; accountId: string | null; amount: Won | null }[],
): { key: string; input: RuleInput }[] {
  if (!ctx.incomeAccountId) return [];
  const out: { key: string; input: RuleInput }[] = [];
  for (const t of targets) {
    if (!t.accountId || t.amount === null || t.amount <= 0) continue;
    out.push({
      key: ctx.keyPrefix ? `${ctx.keyPrefix}:${t.role}` : t.role,
      input: {
        fromAccountId: ctx.incomeAccountId,
        toAccountId: t.accountId,
        amount: t.amount,
        dayOfMonth: ctx.day,
        startMonth: ctx.month,
        endMonth: null,
      },
    });
  }
  return out;
}

/**
 * 이미 저장한 행과 원하는 행을 키로 맞춰 할 일을 정해요.
 * 마법사에서 이전 단계로 돌아가 다시 저장해도 중복으로 만들지 않기 위해서예요.
 */
export function diffByKey<S extends { deleted: boolean }, I extends object>(
  saved: Record<string, S>,
  wanted: { key: string; input: I }[],
): { add: { key: string; input: I }[]; update: { key: string; row: S }[]; remove: { key: string; row: S }[] } {
  const add: { key: string; input: I }[] = [];
  const update: { key: string; row: S }[] = [];
  const remove: { key: string; row: S }[] = [];
  const seen = new Set<string>();
  for (const w of wanted) {
    seen.add(w.key);
    const prev = saved[w.key];
    if (!prev) {
      add.push(w);
      continue;
    }
    const merged = { ...prev, ...w.input } as S;
    if (!sameFields(prev, merged)) update.push({ key: w.key, row: merged });
  }
  for (const [key, row] of Object.entries(saved)) {
    if (!seen.has(key)) remove.push({ key, row: { ...row, deleted: true } });
  }
  return { add, update, remove };
}

function sameFields(a: object, b: object): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
}

/** 1 ~ 31 일 고르기 */
export const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `매달 ${i + 1}일` }));
