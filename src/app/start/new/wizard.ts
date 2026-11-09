/* 새 가계부 만들기 마법사의 순수 도우미 (화면과 분리해서 테스트해요) */
import type { AccountRole, AllocationRule, FixedExpense, Won, YearMonth } from '@/domain/types';

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
  living: Won | null,
  bills: BillDraft[],
  allowances: AllowanceDraft[],
): { key: string; input: FixedInput }[] {
  const base = { accountId: ctx.accountId, startMonth: ctx.month, endMonth: null };
  const out: { key: string; input: FixedInput }[] = [];
  if (living !== null && living > 0) {
    out.push({
      key: 'living',
      input: { ...base, name: '생활비', amount: living, categoryId: null, dayOfMonth: null, kind: 'living', targetEmail: null },
    });
  }
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

export type RuleInput = Omit<AllocationRule, 'id' | 'deleted'>;

/** 매달 배분 입력 → 규칙 행 (키 = 받는 통장 역할) */
export function wantedRules(
  ctx: { incomeAccountId: string | null; month: YearMonth; day: number },
  targets: { role: AllocRole; accountId: string | null; amount: Won | null }[],
): { key: string; input: RuleInput }[] {
  if (!ctx.incomeAccountId) return [];
  const out: { key: string; input: RuleInput }[] = [];
  for (const t of targets) {
    if (!t.accountId || t.amount === null || t.amount <= 0) continue;
    out.push({
      key: t.role,
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
