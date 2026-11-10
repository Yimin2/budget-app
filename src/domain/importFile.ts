/**
 * 파일에서 가져오기 (PLAN 4-12) — 버전 있는 JSON 가져오기 파일(budget-import v1 · v2)을 읽고, 확인하고,
 * 지금 가계부에 무엇이 더해질지 미리 보여 줄 계획을 만든다. 쓰기는 계획(rows)을 그대로 insert 한다.
 *
 * - 행 id 는 파일의 source 와 각 행의 key 로 정한다: `imp:<source>:<표>:<key>` → 같은 파일을 다시 가져와도 행이 늘지 않는다
 * - 통장 · 카테고리는 이름이 같은 것이 이미 있으면 새로 만들지 않고 그것을 쓴다 (합치기). 합친 통장은 비어 있는 주인 칸만 채운다
 * - 할부는 InstallmentInput 그대로 받아 buildInstallmentRows 로 행을 만든다 (결제일이 지난 회차는 이미 낸 것으로 본다)
 * - 청구: pending 은 낸 사람 · 돌려받을 통장 · 정산일을 앱 규칙(4-9)으로 정하고, settled 는 돌려준 이체 claim:<지출id> 도 함께 만든다
 * - v2 (PLAN 4-13 · 4-14): 수입 계획(incomePlans), 매달 배분의 방식(rules[].kind = fixed · remainder). 사람별 생활비 · 용돈 통장은
 *   v1 처럼 통장의 ownerName · ownerEmail 로 적는다. v1 파일은 그대로 읽는다 (v2 칸을 쓰면 버전을 올리라고 알린다)
 * - v2 (PLAN 4-1): 생활비 항목의 쓰는 날 fixedExpenses[].useDays('every' · 'weekdays' · 'weekends' · ['mon', 'wed', …]),
 *   skipHolidays(true/false), perWeek(1~7). 모두 선택이고, 비우면 매일 (예전과 같다)
 */
import { isClaimExpense } from './balances';
import { canClaimOnAccount, claimAccountFor, claimTransferId, computeClaimDue } from './claims';
import { addMonths, dateInMonth, isValidDate, isValidMonth, monthOf } from './dates';
import { buildInstallmentRows, installmentPlanId, validateInstallment } from './installments';
import { conflictingRemainderRule } from './income';
import { cleanTripItems, TRIP_ITEMS, tripBudget, validateTrip } from './trips';
import type {
  Account, AccountRole, AllocationRule, Category, EventStatus, Expense, FixedExpense, Id, IncomePlan, ISODate, LedgerData,
  LivingSpread, PlannedEvent, Repeat, RuleKind, Transfer, Trip, TripItem, Won, YearMonth,
} from './types';

export const IMPORT_FORMAT = 'budget-import';
/** 지금 버전 (새로 만드는 파일). 읽기는 IMPORT_VERSIONS 모두 */
export const IMPORT_VERSION = 2;
export const IMPORT_VERSIONS = [1, 2] as const;
export type ImportVersion = (typeof IMPORT_VERSIONS)[number];

/* ---------- 파일 모양 (v1) ---------- */

/** 통장. 같은 이름의 통장이 가계부에 있으면 그것과 합친다 */
export interface ImportAccount {
  key: string;
  name: string;
  role: AccountRole;
  openingBalance: Won;
  openingDate: ISODate;
  ownerName: string | null;
  ownerEmail: string | null;
  /** 월급 (선택). 주면 시작일 뒤 첫 월급날에 수입 기록 한 건 (그 뒤 달은 앱에서 기록) */
  salary: Won | null;
  /** 월급날 (salary 가 있을 때. 없으면 1일) */
  salaryDay: number | null;
}
export interface ImportCategory {
  key: string;
  name: string;
  icon: string;
  defaultAccountRole: AccountRole;
  /** 미리보기에만 보이는 설명 (카테고리 탭에는 저장하지 않는다) */
  note: string;
}
export interface ImportRule {
  key: string;
  /** 통장 key */
  from: string;
  to: string;
  /** 방식 (v2). fixed = 정한 금액, remainder = 그날 남은 돈 전부 (amount 는 0) */
  kind: RuleKind;
  amount: Won;
  dayOfMonth: number;
  startMonth: YearMonth;
  endMonth: YearMonth | null;
}
/** 수입 계획 (v2): 누가 · 얼마를 · 매달 며칠에 · 어느 통장으로 받는지 */
export interface ImportIncomePlan {
  key: string;
  /** 버는 사람 이름 */
  person: string;
  email: string | null;
  amount: Won;
  dayOfMonth: number;
  /** 받는 통장 key */
  account: string;
  startMonth: YearMonth;
  endMonth: YearMonth | null;
  memo: string;
}
export interface ImportFixed {
  key: string;
  name: string;
  amount: Won;
  account: string;
  category: string | null;
  kind: 'bill' | 'living' | 'allowance';
  dayOfMonth: number | null;
  spread: LivingSpread;
  /** 생활비 쓰는 요일 (v2, 0=일 … 6=토). null = 매일 */
  useDays: number[] | null;
  /** 생활비 공휴일 · 쉬는 날 빼기 (v2) */
  skipHolidays: boolean;
  /** 생활비 주 N회 (v2, 1~7) */
  perWeek: number | null;
  targetEmail: string | null;
  startMonth: YearMonth;
  endMonth: YearMonth | null;
  memo: string;
}
export interface ImportInstallment {
  key: string;
  name: string;
  amount: Won;
  amountKind: 'total' | 'monthly';
  months: number;
  firstMonth: YearMonth;
  dayOfMonth: number;
  account: string;
  category: string | null;
  memo: string;
}
export interface ImportEvent {
  key: string;
  date: ISODate;
  name: string;
  amount: Won;
  account: string | null;
  category: string | null;
  status: EventStatus;
  repeat: Repeat;
  memo: string;
}
export interface ImportTrip {
  key: string;
  name: string;
  startDate: ISODate;
  endDate: ISODate;
  budget: Won;
  items: Partial<Record<TripItem, Won>>;
  memo: string;
}
export interface ImportClaim {
  /** 개인 돈으로 낸 사람 이름 */
  payer: string;
  status: 'pending' | 'settled';
  /** 돌려줄 날. 비우면 pending 은 앱 규칙(4-9), settled 는 돌려준 날 */
  due: ISODate | null;
  /** 돌려준 날 (settled). 비우면 지출 날짜 */
  settledDate: ISODate | null;
}
export interface ImportExpense {
  key: string;
  date: ISODate;
  amount: Won;
  account: string;
  category: string | null;
  memo: string;
  event: string | null;
  trip: string | null;
  tripItem: TripItem | null;
  claim: ImportClaim | null;
}
export interface ImportTransfer {
  key: string;
  date: ISODate;
  kind: 'income' | 'transfer';
  from: string | null;
  to: string | null;
  amount: Won;
  memo: string;
}

/** 읽고 확인한 가져오기 파일 (빈 표는 빈 배열) */
export interface ImportFile {
  format: typeof IMPORT_FORMAT;
  version: ImportVersion;
  /** 이 파일의 출처 이름. 행 id 의 앞부분이 된다 (같은 출처 = 같은 행) */
  source: string;
  name: string;
  accounts: ImportAccount[];
  categories: ImportCategory[];
  rules: ImportRule[];
  /** 수입 계획 (v2, v1 은 빈 배열) */
  incomePlans: ImportIncomePlan[];
  fixedExpenses: ImportFixed[];
  installments: ImportInstallment[];
  events: ImportEvent[];
  trips: ImportTrip[];
  expenses: ImportExpense[];
  transfers: ImportTransfer[];
}

export type ParseResult = { ok: true; file: ImportFile } | { ok: false; errors: string[] };

/** 파일 크기 한도 (브라우저에서 한 번에 읽는 양) */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_ERRORS = 30;
const KEY_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const SOURCE_RE = /^[A-Za-z0-9_.-]{1,40}$/;
const ICON_RE = /^[a-z0-9-]{1,40}$/;

const ROLES: AccountRole[] = ['income', 'fixed', 'event', 'reservoir', 'savings', 'allowance', 'other'];
const FIXED_KINDS = ['bill', 'living', 'allowance'] as const;
const EVENT_STATUSES: EventStatus[] = ['planned', 'done', 'canceled'];
const REPEATS: Repeat[] = ['none', 'monthly', 'yearly'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** 한 행의 칸 읽기. 틀린 칸은 fail 로 알리고 기본값을 돌려준다 */
function reader(r: Obj, fail: (msg: string) => void) {
  const bad = (f: string) => fail(`'${f}' 칸을 확인해 주세요`);
  return {
    text(f: string, optional = false): string {
      const v = r[f];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (blank(v) && optional) return '';
      bad(f);
      return '';
    },
    optText(f: string): string | null {
      const v = r[f];
      if (blank(v)) return null;
      if (typeof v === 'string') return v.trim();
      bad(f);
      return null;
    },
    int(f: string, opts: { min?: number; max?: number; optional?: boolean } = {}): number | null {
      const v = r[f];
      if (blank(v) && opts.optional) return null;
      if (typeof v !== 'number' || !Number.isInteger(v) || (opts.min !== undefined && v < opts.min) || (opts.max !== undefined && v > opts.max)) {
        bad(f);
        return null;
      }
      return v;
    },
    date(f: string, optional = false): ISODate | null {
      const v = r[f];
      if (blank(v) && optional) return null;
      if (isValidDate(v)) return v;
      bad(f);
      return null;
    },
    month(f: string, optional = false): YearMonth | null {
      const v = r[f];
      if (blank(v) && optional) return null;
      if (isValidMonth(v)) return v;
      bad(f);
      return null;
    },
    oneOf<T extends string>(f: string, values: readonly T[], fallback?: T): T {
      const v = r[f];
      if (blank(v) && fallback !== undefined) return fallback;
      if (typeof v === 'string' && (values as readonly string[]).includes(v)) return v as T;
      bad(f);
      return fallback ?? values[0]!;
    },
    ref(f: string, keys: Set<string>, optional = true): string | null {
      const v = r[f];
      if (blank(v)) {
        if (!optional) bad(f);
        return null;
      }
      if (typeof v === 'string' && keys.has(v)) return v;
      fail(`'${f}' 에 적은 '${String(v)}' 를 파일에서 찾을 수 없어요`);
      return null;
    },
  };
}

type Fields = ReturnType<typeof reader>;

/** 표 하나 읽기: 배열인지, 행마다 key 가 맞고 겹치지 않는지 확인하고 parse 로 행을 만든다 */
function readTable<T>(
  root: Obj,
  name: string,
  label: string,
  errors: string[],
  parse: (f: Fields, key: string, r: Obj, fail: (msg: string) => void) => T,
): T[] {
  const raw = root[name];
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push(`'${name}' 는 목록이어야 해요`);
    return [];
  }
  const seen = new Set<string>();
  const out: T[] = [];
  raw.forEach((item, i) => {
    const where = `${label} ${i + 1}번째`;
    if (!isObj(item)) {
      errors.push(`${where}: 항목 모양이 맞지 않아요`);
      return;
    }
    const key = typeof item.key === 'string' ? item.key : '';
    const fail = (msg: string) => errors.push(`${where}${key ? ` (${key})` : ''}: ${msg}`);
    if (!KEY_RE.test(key)) {
      fail("'key' 는 영문 · 숫자 · _ . - 로 64자까지 써 주세요");
      return;
    }
    if (seen.has(key)) {
      fail('key 가 앞 항목과 겹쳐요');
      return;
    }
    seen.add(key);
    out.push(parse(reader(item, fail), key, item, fail));
  });
  return out;
}

const keysOf = (root: Obj, name: string): Set<string> => {
  const raw = root[name];
  const out = new Set<string>();
  if (Array.isArray(raw)) for (const r of raw) if (isObj(r) && typeof r.key === 'string') out.add(r.key);
  return out;
};

const DAY_CODES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** 생활비 쓰는 요일 (v2): 'every' · 'weekdays' · 'weekends' · ['mon', 'wed', …]. 빈 칸 · 'every' · 7개 모두 = null (매일) */
function readUseDays(v: unknown, bad: () => void): number[] | null {
  if (blank(v) || v === 'every') return null;
  if (v === 'weekdays') return [1, 2, 3, 4, 5];
  if (v === 'weekends') return [0, 6];
  if (Array.isArray(v) && v.length > 0 && v.every((d) => typeof d === 'string' && DAY_CODES.includes(d.toLowerCase()))) {
    const days = [...new Set(v.map((d) => DAY_CODES.indexOf((d as string).toLowerCase())))].sort((a, b) => a - b);
    return days.length === 7 ? null : days;
  }
  bad();
  return null;
}

/** 가져오기 파일 글자 → 확인한 파일. 틀린 곳은 한국어 목록으로 (앞 30개) */
export function parseImportFile(text: string): ParseResult {
  let root: unknown;
  try {
    root = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return { ok: false, errors: ['파일을 읽을 수 없어요. 가져오기용 JSON 파일인지 확인해 주세요'] };
  }
  if (!isObj(root) || root.format !== IMPORT_FORMAT) {
    return { ok: false, errors: [`가져오기 파일이 아니에요. format 이 '${IMPORT_FORMAT}' 인 파일을 골라 주세요`] };
  }
  if (!(IMPORT_VERSIONS as readonly unknown[]).includes(root.version)) {
    return { ok: false, errors: [`이 앱은 버전 ${IMPORT_VERSIONS.join(' · ')} 파일만 읽어요 (파일 버전: ${String(root.version)})`] };
  }
  const version = root.version as ImportVersion;
  const errors: string[] = [];
  const v2Only = (what: string) => `'${what}' 는 버전 2 파일에서 써요. version 을 2 로 바꿔 주세요`;
  if (version === 1 && root.incomePlans !== undefined && root.incomePlans !== null) errors.push(v2Only('incomePlans'));
  const source = typeof root.source === 'string' ? root.source.trim() : '';
  if (!SOURCE_RE.test(source)) errors.push("'source' 는 영문 · 숫자 · _ . - 로 40자까지 써 주세요 (같은 파일을 다시 가져올 때 알아보는 이름)");

  const accountKeys = keysOf(root, 'accounts');
  const categoryKeys = keysOf(root, 'categories');
  const eventKeys = keysOf(root, 'events');
  const tripKeys = keysOf(root, 'trips');

  const accounts = readTable<ImportAccount>(root, 'accounts', '통장', errors, (f, key) => {
    const salary = f.int('salary', { min: 1, optional: true });
    return {
      key,
      name: f.text('name'),
      role: f.oneOf('role', ROLES),
      openingBalance: f.int('openingBalance', { optional: true }) ?? 0,
      openingDate: f.date('openingDate') ?? '',
      ownerName: f.optText('ownerName') || null,
      ownerEmail: f.optText('ownerEmail') || null,
      salary,
      salaryDay: f.int('salaryDay', { min: 1, max: 31, optional: true }),
    };
  });
  const categories = readTable<ImportCategory>(root, 'categories', '카테고리', errors, (f, key, r, fail) => {
    const icon = f.optText('icon') ?? 'dots';
    if (!ICON_RE.test(icon)) fail("'icon' 칸을 확인해 주세요");
    return {
      key,
      name: f.text('name'),
      icon: ICON_RE.test(icon) ? icon : 'dots',
      defaultAccountRole: f.oneOf('defaultAccountRole', ROLES, 'event'),
      note: typeof r.note === 'string' ? r.note.trim() : '',
    };
  });
  const rules = readTable<ImportRule>(root, 'rules', '매달 배분', errors, (f, key, r, fail) => {
    if (version === 1 && !blank(r.kind)) fail(v2Only('kind'));
    const kind = version === 1 ? 'fixed' : f.oneOf<RuleKind>('kind', ['fixed', 'remainder'], 'fixed');
    // 나머지 전부 보내기는 금액을 쓰지 않는다 (비우거나 0. 적었으면 모양만 확인)
    const amount = kind === 'remainder' ? (f.int('amount', { min: 0, optional: true }), 0) : (f.int('amount', { min: 1 }) ?? 0);
    return {
      key,
      from: f.ref('from', accountKeys, false) ?? '',
      to: f.ref('to', accountKeys, false) ?? '',
      kind,
      amount,
      dayOfMonth: f.int('dayOfMonth', { min: 1, max: 31 }) ?? 1,
      startMonth: f.month('startMonth') ?? '',
      endMonth: f.month('endMonth', true),
    };
  });
  const incomePlans =
    version === 1
      ? []
      : readTable<ImportIncomePlan>(root, 'incomePlans', '수입 계획', errors, (f, key) => ({
          key,
          person: f.text('person'),
          email: f.optText('email') || null,
          amount: f.int('amount', { min: 1 }) ?? 0,
          dayOfMonth: f.int('dayOfMonth', { min: 1, max: 31 }) ?? 1,
          account: f.ref('account', accountKeys, false) ?? '',
          startMonth: f.month('startMonth') ?? '',
          endMonth: f.month('endMonth', true),
          memo: f.text('memo', true),
        }));
  const fixedExpenses = readTable<ImportFixed>(root, 'fixedExpenses', '고정 지출', errors, (f, key, r, fail) => {
    const kind = f.oneOf('kind', FIXED_KINDS);
    const day = f.int('dayOfMonth', { min: 1, max: 31, optional: true });
    if (kind !== 'living' && day === null) fail("'dayOfMonth' 칸을 확인해 주세요");
    for (const k of ['useDays', 'skipHolidays', 'perWeek']) if (version === 1 && !blank(r[k])) fail(v2Only(k));
    const useDays = version === 1 ? null : readUseDays(r.useDays, () => fail("'useDays' 칸을 확인해 주세요"));
    if (!blank(r.skipHolidays) && typeof r.skipHolidays !== 'boolean') fail("'skipHolidays' 칸을 확인해 주세요");
    const perWeek = version === 1 ? null : f.int('perWeek', { min: 1, max: 7, optional: true });
    return {
      key,
      name: f.text('name'),
      amount: f.int('amount', { min: 1 }) ?? 0,
      account: f.ref('account', accountKeys, false) ?? '',
      category: f.ref('category', categoryKeys),
      kind,
      dayOfMonth: kind === 'living' ? null : day,
      spread: f.oneOf<LivingSpread>('spread', ['daily', 'monthly'], 'daily'),
      useDays,
      skipHolidays: version !== 1 && r.skipHolidays === true,
      perWeek,
      targetEmail: kind === 'allowance' ? f.optText('targetEmail') || null : null,
      startMonth: f.month('startMonth') ?? '',
      endMonth: f.month('endMonth', true),
      memo: f.text('memo', true),
    };
  });
  const installments = readTable<ImportInstallment>(root, 'installments', '할부', errors, (f, key) => ({
    key,
    name: f.text('name'),
    amount: f.int('amount', { min: 1 }) ?? 0,
    amountKind: f.oneOf('amountKind', ['total', 'monthly'] as const),
    months: f.int('months', { min: 2, max: 120 }) ?? 2,
    firstMonth: f.month('firstMonth') ?? '',
    dayOfMonth: f.int('dayOfMonth', { min: 1, max: 31 }) ?? 1,
    account: f.ref('account', accountKeys, false) ?? '',
    category: f.ref('category', categoryKeys),
    memo: f.text('memo', true),
  }));
  const events = readTable<ImportEvent>(root, 'events', '일정', errors, (f, key) => ({
    key,
    date: f.date('date') ?? '',
    name: f.text('name'),
    amount: f.int('amount', { min: 0 }) ?? 0,
    account: f.ref('account', accountKeys),
    category: f.ref('category', categoryKeys),
    status: f.oneOf('status', EVENT_STATUSES, 'planned'),
    repeat: f.oneOf('repeat', REPEATS, 'none'),
    memo: f.text('memo', true),
  }));
  const trips = readTable<ImportTrip>(root, 'trips', '여행', errors, (f, key, r, fail) => {
    const items: Partial<Record<TripItem, Won>> = {};
    if (r.items !== undefined && r.items !== null) {
      if (!isObj(r.items)) fail("'items' 칸을 확인해 주세요");
      else
        for (const [k, v] of Object.entries(r.items)) {
          if (!(TRIP_ITEMS as string[]).includes(k) || typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
            fail(`'items' 의 '${k}' 를 확인해 주세요`);
            continue;
          }
          items[k as TripItem] = v;
        }
    }
    const trip: ImportTrip = {
      key,
      name: f.text('name'),
      startDate: f.date('startDate') ?? '',
      endDate: f.date('endDate') ?? '',
      budget: f.int('budget', { min: 0, optional: true }) ?? 0,
      items: cleanTripItems(items),
      memo: f.text('memo', true),
    };
    if (trip.name && trip.startDate && trip.endDate) {
      const problem = validateTrip(trip);
      if (problem) fail(problem);
    }
    return trip;
  });
  const expenses = readTable<ImportExpense>(root, 'expenses', '지출', errors, (f, key, r, fail) => {
    let claim: ImportClaim | null = null;
    if (r.claim !== undefined && r.claim !== null) {
      if (!isObj(r.claim)) fail("'claim' 칸을 확인해 주세요");
      else {
        const c = reader(r.claim, (m) => fail(`청구 ${m}`));
        claim = {
          payer: c.text('payer'),
          status: c.oneOf('status', ['pending', 'settled'] as const),
          due: c.date('due', true),
          settledDate: c.date('settledDate', true),
        };
      }
    }
    const tripItem = r.tripItem;
    if (!blank(tripItem) && !(typeof tripItem === 'string' && (TRIP_ITEMS as string[]).includes(tripItem))) fail("'tripItem' 칸을 확인해 주세요");
    return {
      key,
      date: f.date('date') ?? '',
      amount: f.int('amount', { min: 1 }) ?? 0,
      account: f.ref('account', accountKeys, false) ?? '',
      category: f.ref('category', categoryKeys),
      memo: f.text('memo', true),
      event: f.ref('event', eventKeys),
      trip: f.ref('trip', tripKeys),
      tripItem: typeof tripItem === 'string' && (TRIP_ITEMS as string[]).includes(tripItem) ? (tripItem as TripItem) : null,
      claim,
    };
  });
  const transfers = readTable<ImportTransfer>(root, 'transfers', '이체', errors, (f, key, _r, fail) => {
    const kind = f.oneOf('kind', ['income', 'transfer'] as const);
    const from = f.ref('from', accountKeys);
    const to = f.ref('to', accountKeys, false);
    if (kind === 'transfer' && !from) fail("이체는 'from' 통장이 있어야 해요");
    return {
      key,
      date: f.date('date') ?? '',
      kind,
      from: kind === 'income' ? null : from,
      to,
      amount: f.int('amount', { min: 1 }) ?? 0,
      memo: f.text('memo', true),
    };
  });

  if (errors.length > 0) {
    const shown = errors.slice(0, MAX_ERRORS);
    if (errors.length > MAX_ERRORS) shown.push(`그 밖에 ${errors.length - MAX_ERRORS}곳이 더 있어요`);
    return { ok: false, errors: shown };
  }
  return {
    ok: true,
    file: {
      format: IMPORT_FORMAT,
      version,
      source,
      name: typeof root.name === 'string' ? root.name.trim() : '',
      accounts, categories, rules, incomePlans, fixedExpenses, installments, events, trips, expenses, transfers,
    },
  };
}

/* ---------- 계획 (미리보기) ---------- */

/** 가져오기가 쓰는 표 (쓰는 순서) */
export const IMPORT_TABLES = [
  'accounts', 'categories', 'trips', 'events', 'rules', 'incomePlans', 'fixedExpenses', 'expenses', 'transfers',
] as const;
export type ImportTable = (typeof IMPORT_TABLES)[number];

export interface ImportRows {
  accounts: Account[];
  categories: Category[];
  trips: Trip[];
  events: PlannedEvent[];
  rules: AllocationRule[];
  incomePlans: IncomePlan[];
  fixedExpenses: FixedExpense[];
  expenses: Expense[];
  transfers: Transfer[];
}

/** 미리보기 표 한 줄 */
export interface ImportSummaryLine {
  key: 'accounts' | 'categories' | 'rules' | 'incomePlans' | 'bills' | 'living' | 'installments' | 'events' | 'trips' | 'expenses' | 'transfers';
  label: string;
  /** 새로 더할 행 */
  added: number;
  /** 이미 가져온 행 (같은 id) — 건너뜀 */
  existing: number;
  /** 이름이 같아 가계부에 있던 것과 합친 행 */
  merged: number;
  /** 더할 행의 금액 합 (금액이 없는 표는 null) */
  amount: Won | null;
  /** 금액 뜻 ('매달' · '합계' · '시작 잔액' …) */
  amountLabel: string | null;
}

export interface ImportPlan {
  source: string;
  name: string;
  /** 쓸 수 없게 막는 문제 (있으면 가져오기 버튼을 끈다) */
  errors: string[];
  /** 알아 두면 좋은 점 */
  warnings: string[];
  /** 이름이 같아 합칠 통장 · 카테고리 */
  merges: { table: 'accounts' | 'categories'; name: string; note: string }[];
  summary: ImportSummaryLine[];
  /** 지출을 통장마다 (새로 더할 것) */
  expensesByAccount: { name: string; count: number; amount: Won }[];
  claims: {
    pending: { payer: string; count: number; amount: Won }[];
    pendingTotal: Won;
    /** 그중 저수지통장 청구 (정산 화면의 '저수지에서 돌려받을 돈'). 저수지에서 돌려주면 빌린 돈이 되지 않는다 */
    reservoirPending: { payer: string; count: number; amount: Won }[];
    nextDue: ISODate | null;
    settledCount: number;
    settledAmount: Won;
  };
  /** 카테고리 설명 (파일의 note, 카테고리 탭에는 저장하지 않음) */
  notes: { name: string; note: string }[];
  rows: ImportRows;
  /** 합친 통장의 빈 주인 칸 채우기 */
  accountUpdates: Account[];
  /** 쓸 행 수 (rows + accountUpdates) */
  total: number;
}

/** 가져오기 행 id: imp:<source>:<표>:<key> */
export function importRowId(source: string, table: string, key: string): Id {
  return `imp:${source}:${table}:${key}`;
}

const normName = (s: string) => s.replace(/\s/g, '').toLowerCase();

function emptyRows(): ImportRows {
  return { accounts: [], categories: [], trips: [], events: [], rules: [], incomePlans: [], fixedExpenses: [], expenses: [], transfers: [] };
}

const ROLE_KO: Record<AccountRole, string> = {
  income: '수입', fixed: '고정지출', event: '이벤트', reservoir: '저수지', savings: '저축투자', allowance: '용돈', other: '기타',
};

/** 이 가계부에 파일을 더하면 무엇이 생기는지 (쓰지 않는다) */
export function planImport(
  data: LedgerData,
  file: ImportFile,
  ctx: { today: ISODate; author: string; now: string },
): ImportPlan {
  const { today, author, now } = ctx;
  const stamp = { author, createdAt: now, updatedAt: now, deleted: false as const };
  const rid = (table: string, key: string) => importRowId(file.source, table, key);
  const rows = emptyRows();
  const errors: string[] = [];
  const warnings: string[] = [];
  const merges: ImportPlan['merges'] = [];
  const counts = new Map<ImportSummaryLine['key'], { existing: number; merged: number }>();
  const bump = (k: ImportSummaryLine['key'], what: 'existing' | 'merged') => {
    const c = counts.get(k) ?? { existing: 0, merged: 0 };
    c[what] += 1;
    counts.set(k, c);
  };
  // 계산용 작업 데이터 (새 통장 · 규칙 · 지출을 더해 가며 정산일 · 돌려받을 통장을 앱 규칙대로 정한다)
  const work: LedgerData = {
    ...data,
    accounts: [...data.accounts],
    rules: [...data.rules],
    expenses: [...data.expenses],
    transfers: [...data.transfers],
  };
  const has = <T extends { id: Id }>(list: T[], id: Id) => list.some((r) => r.id === id);

  /* 통장 */
  const accountId = new Map<string, Id>();
  const accountUpdates: Account[] = [];
  const claimed = new Set<Id>();
  let order = data.accounts.reduce((m, a) => Math.max(m, a.order), -1) + 1;
  for (const a of file.accounts) {
    const id = rid('acc', a.key);
    if (has(data.accounts, id)) {
      accountId.set(a.key, id);
      bump('accounts', 'existing');
      continue;
    }
    const same = data.accounts.find((x) => !x.deleted && !claimed.has(x.id) && normName(x.name) === normName(a.name));
    if (same) {
      claimed.add(same.id);
      accountId.set(a.key, same.id);
      bump('accounts', 'merged');
      const fill: Partial<Account> = {};
      if (!same.ownerName && a.ownerName) fill.ownerName = a.ownerName;
      if (!same.ownerEmail && a.ownerEmail) fill.ownerEmail = a.ownerEmail;
      const notes: string[] = ['있던 통장에 합쳐요 (시작 잔액 · 시작일은 그대로)'];
      if (Object.keys(fill).length > 0) {
        const updated = { ...same, ...fill };
        accountUpdates.push(updated);
        const i = work.accounts.findIndex((x) => x.id === same.id);
        if (i >= 0) work.accounts[i] = updated;
        notes.push('주인 칸을 채워요');
      }
      if (same.role !== a.role) {
        warnings.push(`'${same.name}' 는 ${ROLE_KO[same.role]} 통장이에요. 파일에는 ${ROLE_KO[a.role]} 통장으로 적혀 있어요`);
      }
      merges.push({ table: 'accounts', name: same.name, note: notes.join(' · ') });
      continue;
    }
    const row: Account = {
      id,
      name: a.name,
      role: a.role,
      openingBalance: a.openingBalance,
      openingDate: a.openingDate,
      order: order++,
      ownerName: a.ownerName,
      ownerEmail: a.ownerEmail,
      deleted: false,
    };
    rows.accounts.push(row);
    work.accounts.push(row);
    accountId.set(a.key, id);
  }
  const accountOf = (key: string | null) => (key ? (accountId.get(key) ?? null) : null);
  const accountRow = (id: Id | null) => (id ? work.accounts.find((x) => x.id === id) : undefined);

  /* 카테고리 */
  const categoryId = new Map<string, Id>();
  const takenCats = new Set<Id>();
  let catOrder = data.categories.reduce((m, c) => Math.max(m, c.order), -1) + 1;
  const notes: ImportPlan['notes'] = [];
  for (const c of file.categories) {
    if (c.note) notes.push({ name: c.name, note: c.note });
    const id = rid('cat', c.key);
    if (has(data.categories, id)) {
      categoryId.set(c.key, id);
      bump('categories', 'existing');
      continue;
    }
    const same = data.categories.find((x) => !x.deleted && !takenCats.has(x.id) && normName(x.name) === normName(c.name));
    if (same) {
      takenCats.add(same.id);
      categoryId.set(c.key, same.id);
      bump('categories', 'merged');
      merges.push({ table: 'categories', name: same.name, note: '있던 카테고리에 합쳐요' });
      continue;
    }
    rows.categories.push({ id, name: c.name, icon: c.icon, defaultAccountRole: c.defaultAccountRole, order: catOrder++, deleted: false });
    categoryId.set(c.key, id);
  }
  const categoryOf = (key: string | null) => (key ? (categoryId.get(key) ?? null) : null);

  /* 여행 */
  const tripId = new Map<string, Id>();
  for (const t of file.trips) {
    const id = rid('trip', t.key);
    tripId.set(t.key, id);
    if (has(data.trips, id)) {
      bump('trips', 'existing');
      continue;
    }
    rows.trips.push({ id, name: t.name, startDate: t.startDate, endDate: t.endDate, budget: t.budget, items: t.items, memo: t.memo, ...stamp });
  }

  /* 일정 */
  const eventId = new Map<string, Id>();
  const eventAccount = work.accounts.find((a) => !a.deleted && a.role === 'event')?.id ?? null;
  for (const e of file.events) {
    const id = rid('ev', e.key);
    eventId.set(e.key, id);
    if (has(data.events, id)) {
      bump('events', 'existing');
      continue;
    }
    const acc = accountOf(e.account) ?? eventAccount;
    if (!acc) {
      errors.push(`일정 '${e.name}' 의 통장이 없어요. 이벤트통장을 파일에 넣어 주세요`);
      continue;
    }
    rows.events.push({
      id, date: e.date, name: e.name, amount: e.amount, accountId: acc, categoryId: categoryOf(e.category),
      status: e.status, repeat: e.repeat, memo: e.memo, ...stamp,
    });
  }

  /* 매달 배분 */
  for (const r of file.rules) {
    const id = rid('rule', r.key);
    if (has(data.rules, id)) {
      bump('rules', 'existing');
      continue;
    }
    const from = accountOf(r.from);
    const to = accountOf(r.to);
    if (!from || !to || from === to) {
      errors.push(`매달 배분 '${r.key}' 의 보내는 통장과 받는 통장을 확인해 주세요`);
      continue;
    }
    const row: AllocationRule = {
      id, fromAccountId: from, toAccountId: to, amount: r.kind === 'remainder' ? 0 : r.amount, dayOfMonth: r.dayOfMonth,
      startMonth: r.startMonth, endMonth: r.endMonth, kind: r.kind, deleted: false,
    };
    if (r.kind === 'remainder' && conflictingRemainderRule(work, row)) {
      errors.push(`매달 배분 '${r.key}': 같은 통장 · 같은 날에 나머지 전부 보내기가 이미 있어요. 하나만 둘 수 있어요`);
      continue;
    }
    rows.rules.push(row);
    work.rules.push(row);
  }

  /* 수입 계획 (v2) */
  for (const p of file.incomePlans) {
    const id = rid('inc', p.key);
    if (has(data.incomePlans ?? [], id)) {
      bump('incomePlans', 'existing');
      continue;
    }
    const acc = accountOf(p.account);
    if (!acc) continue;
    rows.incomePlans.push({
      id, personName: p.person, personEmail: p.email, amount: p.amount, dayOfMonth: p.dayOfMonth, accountId: acc,
      startMonth: p.startMonth, endMonth: p.endMonth, memo: p.memo, deleted: false,
    });
  }

  /* 고정 지출 · 생활비 예산 */
  for (const f of file.fixedExpenses) {
    const line = f.kind === 'living' ? 'living' : 'bills';
    const id = rid('fx', f.key);
    if (has(data.fixedExpenses, id)) {
      bump(line, 'existing');
      continue;
    }
    const acc = accountOf(f.account);
    if (!acc) continue;
    rows.fixedExpenses.push({
      id, name: f.name, amount: f.amount, accountId: acc, categoryId: categoryOf(f.category),
      dayOfMonth: f.dayOfMonth, kind: f.kind, targetEmail: f.targetEmail, spread: f.kind === 'living' ? f.spread : 'daily',
      startMonth: f.startMonth, endMonth: f.endMonth, memo: f.memo, deleted: false,
      // 생활비 쓰는 날 (v2). 매일이면 칸을 두지 않아 예전 행과 같다
      ...(f.kind === 'living' && f.spread === 'daily'
        ? {
            ...(f.perWeek !== null ? { perWeek: f.perWeek } : {}),
            ...(f.perWeek === null && f.useDays !== null ? { useDays: f.useDays } : {}),
            ...(f.perWeek === null && f.skipHolidays ? { skipHolidays: true } : {}),
          }
        : {}),
    });
  }

  /* 할부 */
  const installmentLines: { amount: Won }[] = [];
  for (const inst of file.installments) {
    const planId = rid('inst', inst.key);
    if (data.fixedExpenses.some((x) => installmentPlanId(x.id) === planId)) {
      bump('installments', 'existing');
      continue;
    }
    const acc = accountOf(inst.account);
    if (!acc) continue;
    const input = {
      name: inst.name, amount: inst.amount, amountKind: inst.amountKind, months: inst.months, firstMonth: inst.firstMonth,
      dayOfMonth: inst.dayOfMonth, accountId: acc, categoryId: categoryOf(inst.category),
    };
    const problem = validateInstallment(input, today);
    if (problem) {
      if (problem === '이미 다 낸 할부예요') warnings.push(`할부 '${inst.name}' 는 이미 다 낸 할부라 건너뛰어요`);
      else errors.push(`할부 '${inst.name}': ${problem}`);
      continue;
    }
    const built = buildInstallmentRows(input, planId, today).map((x) => ({ ...x, memo: inst.memo }));
    rows.fixedExpenses.push(...built);
    const skipped = (built[0]?.installmentNo ?? 1) - 1;
    if (skipped > 0) warnings.push(`할부 '${inst.name}' 의 지난 ${skipped}회는 이미 낸 것으로 보고 기록하지 않아요`);
    installmentLines.push({ amount: built[0]?.amount ?? 0 });
  }

  /* 지출 (청구 포함) */
  const tripOf = (key: string | null) => (key ? (tripId.get(key) ?? null) : null);
  let beforeOpening = 0;
  let droppedEvent = 0;
  const pendingByPayer = new Map<string, { count: number; amount: Won }>();
  const reservoirByPayer = new Map<string, { count: number; amount: Won }>();
  let settledCount = 0;
  let settledAmount = 0;
  let nextDue: ISODate | null = null;
  for (const e of file.expenses) {
    const id = rid('exp', e.key);
    if (has(data.expenses, id)) {
      bump('expenses', 'existing');
      continue;
    }
    const acc = accountOf(e.account);
    if (!acc) continue;
    const trip = tripOf(e.trip);
    let event = e.event ? (eventId.get(e.event) ?? null) : null;
    if (trip && event) {
      event = null;
      droppedEvent += 1;
    }
    let row: Expense = {
      id, date: e.date, amount: e.amount, accountId: acc, categoryId: categoryOf(e.category), memo: e.memo,
      eventId: event, fixedExpenseId: null, paidBy: null, claimAccountId: null, claimDue: null,
      tripId: trip, tripItem: trip ? e.tripItem : null, ...stamp,
    };
    if (e.claim) {
      const payer = e.claim.payer;
      if (!canClaimOnAccount(work, acc)) {
        errors.push(`지출 '${e.memo || e.key}' 는 청구인데 이벤트통장 · 고정지출통장 · 저수지통장이 아니에요`);
        continue;
      }
      const claimAccountId = claimAccountFor(work, payer);
      if (e.claim.status === 'pending') {
        const due = e.claim.due ?? computeClaimDue(work, { accountId: acc, amount: e.amount }, today);
        row = { ...row, paidBy: payer, claimAccountId, claimDue: due };
        const p = pendingByPayer.get(payer) ?? { count: 0, amount: 0 };
        pendingByPayer.set(payer, { count: p.count + 1, amount: p.amount + e.amount });
        if (accountRow(acc)?.role === 'reservoir') {
          const q = reservoirByPayer.get(payer) ?? { count: 0, amount: 0 };
          reservoirByPayer.set(payer, { count: q.count + 1, amount: q.amount + e.amount });
        }
        if (nextDue === null || due < nextDue) nextDue = due;
      } else {
        const settledOn = e.claim.settledDate ?? e.date;
        row = { ...row, paidBy: payer, claimAccountId, claimDue: e.claim.due ?? settledOn };
        const what = e.memo || '지출';
        const settle: Transfer = {
          id: claimTransferId(id), date: settledOn, kind: 'transfer', fromAccountId: acc, toAccountId: claimAccountId,
          amount: e.amount, status: 'done', ruleId: null, memo: `${payer}에게 돌려줌 · ${what}`, ...stamp,
        };
        if (!has(data.transfers, settle.id)) {
          rows.transfers.push(settle);
          work.transfers.push(settle);
        }
        settledCount += 1;
        settledAmount += e.amount;
      }
    }
    const balanceAcc = isClaimExpense(row) ? row.claimAccountId : row.accountId;
    const opening = accountRow(balanceAcc ?? null)?.openingDate;
    if (opening && row.date < opening) beforeOpening += 1;
    rows.expenses.push(row);
    work.expenses.push(row);
  }

  /* 이체 · 월급 */
  for (const t of file.transfers) {
    const id = rid('tr', t.key);
    if (has(data.transfers, id)) {
      bump('transfers', 'existing');
      continue;
    }
    const to = accountOf(t.to);
    const from = accountOf(t.from);
    if (!to || (t.kind === 'transfer' && !from)) continue;
    rows.transfers.push({
      id, date: t.date, kind: t.kind, fromAccountId: t.kind === 'income' ? null : from, toAccountId: to, amount: t.amount,
      status: 'done', ruleId: null, memo: t.memo, ...stamp,
    });
  }
  for (const a of file.accounts) {
    if (!a.salary) continue;
    const to = accountOf(a.key);
    const acc = accountRow(to);
    if (!to || !acc) continue;
    const day = a.salaryDay ?? 1;
    let month = monthOf(acc.openingDate);
    if (dateInMonth(month, day) < acc.openingDate) month = addMonths(month, 1);
    const id = rid('tr', `salary.${a.key}.${month}`);
    if (has(data.transfers, id)) {
      bump('transfers', 'existing');
      continue;
    }
    rows.transfers.push({
      id, date: dateInMonth(month, day), kind: 'income', fromAccountId: null, toAccountId: to, amount: a.salary,
      status: 'done', ruleId: null, memo: '월급', ...stamp,
    });
  }

  /* 알림 */
  if (beforeOpening > 0) warnings.push(`통장 시작일 전 지출 ${beforeOpening}건은 기록으로만 남고 잔액에는 들어가지 않아요`);
  if (droppedEvent > 0) warnings.push(`일정과 여행에 함께 묶인 지출 ${droppedEvent}건은 여행에만 묶어요`);
  const activeRules = data.rules.filter((r) => !r.deleted).length;
  if (rows.rules.length > 0 && activeRules > 0) warnings.push(`가계부에 매달 배분이 이미 ${activeRules}개 있어요. 가져오면 함께 더해져요`);
  const remainderCount = rows.rules.filter((r) => r.kind === 'remainder').length;
  if (remainderCount > 0) warnings.push(`나머지 전부 보내기 ${remainderCount}개는 그날 남은 돈을 모두 보내요. 금액은 그날 기록될 때 정해져요`);
  const activePlans = (data.incomePlans ?? []).filter((p) => !p.deleted).length;
  if (rows.incomePlans.length > 0 && activePlans > 0) warnings.push(`가계부에 수입 계획이 이미 ${activePlans}개 있어요. 가져오면 함께 더해져요`);
  if (rows.incomePlans.length > 0) warnings.push('수입 계획은 받는 날마다 수입을 자동으로 기록해요. 같은 월급을 손으로 또 기록하지 마세요');
  const activeFixed = data.fixedExpenses.filter((f) => !f.deleted).length;
  if (rows.fixedExpenses.length > 0 && activeFixed > 0) warnings.push(`가계부에 고정 지출 · 생활비 예산이 이미 ${activeFixed}개 있어요. 가져오면 함께 더해져요`);

  /* 요약 */
  const sum = (xs: { amount: Won }[]) => xs.reduce((s, x) => s + x.amount, 0);
  const line = (key: ImportSummaryLine['key'], label: string, added: number, amount: Won | null, amountLabel: string | null): ImportSummaryLine => ({
    key, label, added, existing: counts.get(key)?.existing ?? 0, merged: counts.get(key)?.merged ?? 0, amount, amountLabel,
  });
  const bills = rows.fixedExpenses.filter((f) => f.kind === 'bill' || f.kind === 'allowance');
  const living = rows.fixedExpenses.filter((f) => f.kind === 'living');
  const summary: ImportSummaryLine[] = [
    line('accounts', '통장', rows.accounts.length, sum(rows.accounts.map((a) => ({ amount: a.openingBalance }))), '시작 잔액'),
    line('categories', '카테고리', rows.categories.length, null, null),
    line('rules', '매달 배분', rows.rules.length, sum(rows.rules), '매달'),
    line('incomePlans', '수입 계획', rows.incomePlans.length, sum(rows.incomePlans), '매달'),
    line('bills', '고정 지출', bills.length, sum(bills), '매달'),
    line('living', '생활비 예산', living.length, sum(living), '매달'),
    line('installments', '할부', installmentLines.length, sum(installmentLines), '매달'),
    line('events', '일정', rows.events.length, sum(rows.events), '합계'),
    line('trips', '여행', rows.trips.length, sum(rows.trips.map((t) => ({ amount: tripBudget(t) }))), '예산'),
    line('expenses', '지출', rows.expenses.length, sum(rows.expenses), '합계'),
    line('transfers', '이체 · 수입', rows.transfers.length, sum(rows.transfers), '합계'),
  ].filter((l) => l.added + l.existing + l.merged > 0);

  const byAccount = new Map<Id, { count: number; amount: Won }>();
  for (const e of rows.expenses) {
    const b = byAccount.get(e.accountId) ?? { count: 0, amount: 0 };
    byAccount.set(e.accountId, { count: b.count + 1, amount: b.amount + e.amount });
  }
  const expensesByAccount = [...byAccount.entries()].map(([id, v]) => ({ name: accountRow(id)?.name ?? '통장', ...v }));
  const pending = [...pendingByPayer.entries()]
    .map(([payer, v]) => ({ payer, ...v }))
    .sort((a, b) => b.amount - a.amount);

  const total = IMPORT_TABLES.reduce((s, t) => s + rows[t].length, 0) + accountUpdates.length;
  return {
    source: file.source,
    name: file.name,
    errors,
    warnings,
    merges,
    summary,
    expensesByAccount,
    claims: {
      pending,
      pendingTotal: sum(pending),
      reservoirPending: [...reservoirByPayer.entries()].map(([payer, v]) => ({ payer, ...v })).sort((a, b) => b.amount - a.amount),
      nextDue,
      settledCount,
      settledAmount,
    },
    notes,
    rows,
    accountUpdates,
    total,
  };
}

/** 계획을 데이터에 더한 모습 (쓰기와 같은 규칙: 같은 키는 건너뛰고, 합친 통장은 교체) */
export function applyImportPlan(data: LedgerData, plan: Pick<ImportPlan, 'rows' | 'accountUpdates'>): LedgerData {
  const next: LedgerData = { ...data };
  for (const t of IMPORT_TABLES) {
    const list = data[t] as { id: Id }[];
    const seen = new Set(list.map((r) => r.id));
    const add = (plan.rows[t] as { id: Id }[]).filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
    if (add.length > 0) (next as unknown as Record<string, unknown>)[t] = [...list, ...add];
  }
  if (plan.accountUpdates.length > 0) {
    const upd = new Map(plan.accountUpdates.map((a) => [a.id, a]));
    next.accounts = next.accounts.map((a) => upd.get(a.id) ?? a);
  }
  return next;
}
