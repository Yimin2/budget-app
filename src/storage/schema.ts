/**
 * 시트 구조 (PLAN.md 5장) — 탭 이름, 한글 머리글, 행 <-> 객체 변환.
 * 머리글 이름으로 열을 찾기 때문에 사용자가 시트에서 열 순서를 바꾸거나
 * 열을 추가해도 읽을 수 있다. 쓰기 값은 RAW(문자열·숫자·불리언).
 */
import type {
  AccountRole, EventStatus, FixedKind, LedgerKind, LedgerSettings, LivingSpread, MemberRole, MonthEndChoice, MonthEndItem, Repeat,
  RuleKind, TransferKind, TransferStatus, TripItem,
} from '@/domain/types';
import { TRIP_ITEMS, TRIP_ITEM_LABELS } from '@/domain/trips';
import type { TableName, TableRows } from './types';

/** 시트에 쓰는 셀 값. 빈 셀은 '' */
export type CellValue = string | number | boolean;
/** 시트에서 읽은 셀 값 (UNFORMATTED_VALUE) */
export type RawCell = string | number | boolean | null | undefined;

export const SETTINGS_TAB = '설정';

export const TAB_NAMES: Record<TableName, string> = {
  accounts: '통장',
  rules: '월배분',
  transfers: '이체',
  fixedExpenses: '고정지출',
  events: '일정',
  expenses: '지출',
  monthEnds: '월말',
  categories: '카테고리',
  favorites: '즐겨찾기',
  members: '멤버',
  trips: '여행',
  incomePlans: '수입계획',
};

export const TABLE_NAMES: TableName[] = [
  'accounts', 'rules', 'transfers', 'fixedExpenses', 'events', 'expenses',
  'monthEnds', 'categories', 'favorites', 'members', 'trips', 'incomePlans',
];

/** 시트 탭 순서 (설정이 맨 앞) */
export const ALL_TABS: string[] = [SETTINGS_TAB, ...TABLE_NAMES.map((t) => TAB_NAMES[t])];

/* ---------- 셀 변환기 ---------- */

interface Codec {
  enc(v: unknown): CellValue;
  dec(c: RawCell): unknown;
}

const DAY_MS = 86_400_000;
const SHEETS_EPOCH = Date.UTC(1899, 11, 30);
const pad = (n: number) => String(n).padStart(2, '0');

function isBlank(c: RawCell): boolean {
  return c === null || c === undefined || (typeof c === 'string' && c.trim() === '');
}

function serialToDate(n: number): Date {
  return new Date(SHEETS_EPOCH + Math.round(n * DAY_MS));
}

/** '2026-01-05' / '2026/1/5' / '2026. 1. 5.' / 시리얼 숫자 → 'YYYY-MM-DD' */
export function toISODate(c: RawCell): string | null {
  if (isBlank(c)) return null;
  if (typeof c === 'number') {
    const d = serialToDate(c);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(c).trim();
  const m = /^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  return s;
}

/** 가계부로 쓸 만한 연도 (시트에 숫자 11 처럼 엉뚱한 값을 넣어 1900년이 되는 것을 막는다) */
const MIN_YEAR = 2000;
const MAX_YEAR = 2999;

/**
 * '2026-01' / '2026. 1' / 시리얼 숫자 → 'YYYY-MM'. 해석할 수 없거나 연도·월이 말이 안 되면 null
 * (빈 시작월 · '2026' · 숫자 11 같은 값이 수천 개의 자동 기록을 만들지 않게)
 */
export function toYearMonth(c: RawCell): string | null {
  if (isBlank(c)) return null;
  let y: number;
  let mo: number;
  if (typeof c === 'number') {
    const d = serialToDate(c);
    y = d.getUTCFullYear();
    mo = d.getUTCMonth() + 1;
  } else {
    const m = /^(\d{4})\D+(\d{1,2})/.exec(String(c).trim());
    if (!m) return null;
    y = Number(m[1]);
    mo = Number(m[2]);
  }
  if (!Number.isFinite(y) || y < MIN_YEAR || y > MAX_YEAR || mo < 1 || mo > 12) return null;
  return `${y}-${pad(mo)}`;
}

function toTimestamp(c: RawCell): string | null {
  if (isBlank(c)) return null;
  if (typeof c === 'number') return serialToDate(c).toISOString();
  return String(c).trim();
}

function toNumber(c: RawCell): number | null {
  if (isBlank(c)) return null;
  if (typeof c === 'number') return Number.isFinite(c) ? Math.round(c) : null;
  if (typeof c === 'boolean') return c ? 1 : 0;
  const n = Number(String(c).replace(/[,\s원]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toBool(c: RawCell): boolean {
  if (typeof c === 'boolean') return c;
  if (typeof c === 'number') return c !== 0;
  if (isBlank(c)) return false;
  return ['true', '1', 'y', 'yes', 'o', '예', '네', '삭제'].includes(String(c).trim().toLowerCase());
}

const str: Codec = {
  enc: (v) => (v === null || v === undefined ? '' : String(v)),
  dec: (c) => (isBlank(c) ? '' : String(c).trim()),
};
const optStr: Codec = {
  enc: (v) => (v === null || v === undefined ? '' : String(v)),
  dec: (c) => (isBlank(c) ? null : String(c).trim()),
};
const int: Codec = {
  enc: (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0),
  dec: (c) => toNumber(c) ?? 0,
};
const optInt: Codec = {
  enc: (v) => (typeof v === 'number' && Number.isFinite(v) ? v : ''),
  dec: (c) => toNumber(c),
};
const bool: Codec = { enc: (v) => v === true, dec: toBool };
const date: Codec = { enc: (v) => (v ? String(v) : ''), dec: (c) => toISODate(c) ?? '' };
/** 빈 셀 · 날짜가 아닌 값은 null */
const optDate: Codec = {
  enc: (v) => (v ? String(v) : ''),
  dec: (c) => {
    const d = toISODate(c);
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  },
};
const month: Codec = { enc: (v) => (v ? String(v) : ''), dec: (c) => toYearMonth(c) ?? '' };
const optMonth: Codec = { enc: (v) => (v ? String(v) : ''), dec: (c) => toYearMonth(c) };
const ts: Codec = { enc: (v) => (v ? String(v) : ''), dec: (c) => toTimestamp(c) ?? '' };
const optTs: Codec = { enc: (v) => (v ? String(v) : ''), dec: (c) => toTimestamp(c) };

/** 월말 항목 키: 사람별 생활비 통장이면 '<통장id>|<카테고리id>', 아니면 '<카테고리id>' ('' = 카테고리 없는 묶음) */
const ITEM_SEP = '|';

/**
 * 월말 항목별 남은 돈 <-> JSON 객체 {"카테고리id": 금액, "": 금액(카테고리 없는 묶음), "통장id|카테고리id": 금액}.
 * 빈 셀 · 읽을 수 없는 값은 null (예전 기록: 항목 구분 없음). 통장이 없는 키는 첫 생활비 통장의 항목으로 본다
 */
const monthEndItems: Codec = {
  enc: (v) => {
    if (!Array.isArray(v) || v.length === 0) return '';
    const obj: Record<string, number> = {};
    for (const it of v as MonthEndItem[]) {
      const k = it.accountId ? `${it.accountId}${ITEM_SEP}${it.categoryId ?? ''}` : (it.categoryId ?? '');
      obj[k] = (obj[k] ?? 0) + it.leftover;
    }
    return JSON.stringify(obj);
  },
  dec: (c) => {
    if (isBlank(c) || typeof c !== 'string') return null;
    try {
      const parsed: unknown = JSON.parse(c);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const out: MonthEndItem[] = [];
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const n = typeof v === 'number' ? v : toNumber(v as RawCell);
        if (n === null || !Number.isFinite(n)) continue;
        const sep = k.indexOf(ITEM_SEP);
        const acc = sep >= 0 ? k.slice(0, sep).trim() : '';
        const cat = (sep >= 0 ? k.slice(sep + 1) : k).trim();
        out.push({ categoryId: cat === '' ? null : cat, leftover: Math.round(n), ...(acc ? { accountId: acc } : {}) });
      }
      return out.length > 0 ? out : null;
    } catch {
      return null;
    }
  },
};

/* 여행 항목 (코드 ↔ 한글: 항공 · 숙박 · 교통 · 식비 · 투어 · 쇼핑 · 기타) */
const TRIP_ITEM_CODES = TRIP_ITEMS;
function tripItemOf(raw: string): TripItem | null {
  const k = raw.replace(/\s/g, '');
  if (!k) return null;
  for (const code of TRIP_ITEM_CODES) if (code === k.toLowerCase() || TRIP_ITEM_LABELS[code] === k) return code;
  return null;
}

/** 지출의 여행 항목. 빈 셀 · 모르는 값은 null (기타로 센다) */
const tripItem: Codec = {
  enc: (v) => (typeof v === 'string' && v in TRIP_ITEM_LABELS ? TRIP_ITEM_LABELS[v as TripItem] : ''),
  dec: (c) => (isBlank(c) ? null : tripItemOf(String(c))),
};

/**
 * 여행 항목별 예산 <-> JSON {"항공": 600000, "숙박": 400000}. 읽을 때는 코드 키(flight)도 받는다.
 * 빈 셀 · 읽을 수 없는 값은 {} (항목 예산 없음)
 */
const tripItems: Codec = {
  enc: (v) => {
    if (!v || typeof v !== 'object') return '';
    const obj: Record<string, number> = {};
    for (const code of TRIP_ITEM_CODES) {
      const n = (v as Record<string, unknown>)[code];
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) obj[TRIP_ITEM_LABELS[code]] = Math.round(n);
    }
    return Object.keys(obj).length > 0 ? JSON.stringify(obj) : '';
  },
  dec: (c) => {
    const out: Partial<Record<TripItem, number>> = {};
    if (isBlank(c) || typeof c !== 'string') return out;
    try {
      const parsed: unknown = JSON.parse(c);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const code = tripItemOf(k);
        const n = typeof v === 'number' ? Math.round(v) : toNumber(v as RawCell);
        if (code && n !== null && Number.isFinite(n) && n > 0) out[code] = n;
      }
    } catch {
      // 읽을 수 없는 값은 항목 예산 없음
    }
    return out;
  },
};

/** 코드값 <-> 한글 표시값. 읽을 때는 한글·코드 둘 다 받는다 */
function enumCodec<T extends string>(labels: Record<T, string>, fallback: T): Codec {
  const reverse = new Map<string, T>();
  for (const [code, label] of Object.entries(labels) as [T, string][]) {
    reverse.set(label.replace(/\s/g, ''), code);
    reverse.set(code.toLowerCase(), code);
  }
  return {
    enc: (v) => labels[v as T] ?? labels[fallback],
    dec: (c) => {
      if (isBlank(c)) return fallback;
      const s = String(c).replace(/\s/g, '');
      return reverse.get(s) ?? reverse.get(s.toLowerCase()) ?? fallback;
    },
  };
}

/** 멤버 공유 여부: 빈 칸 = 공유됨 (예전 탭 · 사람이 지운 칸). '아니오' 같은 분명한 부정만 공유 안 됨 */
const NOT_SHARED = new Set(['아니오', '아니요', '아님', 'no', 'n', 'false', '0', 'x']);
const sharedFlag: Codec = {
  enc: (v) => (v === false ? '아니오' : '예'),
  dec: (c) => {
    if (typeof c === 'boolean') return c;
    if (typeof c === 'number') return c !== 0;
    if (isBlank(c)) return true;
    return !NOT_SHARED.has(String(c).replace(/\s/g, '').toLowerCase());
  },
};

export const MEMBER_ROLE_CELL_LABELS: Record<MemberRole, string> = {
  owner: '소유자', writer: '편집자', commenter: '댓글 작성자', reader: '뷰어',
};
/** 멤버 드라이브 권한. 빈 칸 · 모르는 값은 null. '보기 전용' · '댓글' 도 읽는다 */
const memberRole: Codec = {
  enc: (v) => (typeof v === 'string' && v in MEMBER_ROLE_CELL_LABELS ? MEMBER_ROLE_CELL_LABELS[v as MemberRole] : ''),
  dec: (c) => {
    if (isBlank(c)) return null;
    const k = String(c).replace(/\s/g, '').toLowerCase();
    for (const [code, label] of Object.entries(MEMBER_ROLE_CELL_LABELS) as [MemberRole, string][]) {
      if (k === code || k === label.replace(/\s/g, '')) return code;
    }
    if (k === '보기전용' || k === 'viewer') return 'reader';
    if (k === '댓글' || k === '댓글가능') return 'commenter';
    if (k === 'organizer' || k === 'fileorganizer') return 'writer';
    return null;
  },
};

export const ROLE_LABELS: Record<AccountRole, string> = {
  income: '수입', fixed: '고정지출', event: '이벤트', reservoir: '저수지',
  savings: '저축투자', allowance: '용돈', other: '기타',
};
export const TRANSFER_KIND_LABELS: Record<TransferKind, string> = { income: '수입', transfer: '이체', adjustment: '조정' };
export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = { done: '완료', planned: '예정' };
export const FIXED_KIND_LABELS: Record<FixedKind, string> = { bill: '일반', living: '생활비', allowance: '용돈', installment: '할부' };
export const EVENT_STATUS_LABELS: Record<EventStatus, string> = { planned: '예정', done: '완료', canceled: '취소' };
export const REPEAT_LABELS: Record<Repeat, string> = { none: '없음', monthly: '매월', yearly: '매년' };
export const MONTH_END_LABELS: Record<MonthEndChoice, string> = { pending: '미정', reservoir: '저수지', carryover: '이월' };
export const LEDGER_KIND_LABELS: Record<LedgerKind, string> = { shared: '공용', personal: '개인' };
/** 생활비 항목 쓰는 방식. 빈 셀은 하루 (예전 생활비 한 줄도 지금처럼 하루에 나눠 써요) */
export const SPREAD_LABELS: Record<LivingSpread, string> = { daily: '하루', monthly: '한달' };
/** 매달 배분 방식. 빈 셀은 고정 (예전 배분은 모두 정한 금액) */
export const RULE_KIND_LABELS: Record<RuleKind, string> = { fixed: '고정', remainder: '나머지' };

const role = enumCodec(ROLE_LABELS, 'other');

/* ---------- 탭 정의 ---------- */

export interface ColumnDef {
  field: string;
  header: string;
  /** 사용자가 바꿔 쓸 수 있는 다른 머리글 */
  aliases?: string[];
  codec: Codec;
}

export interface TableSchema {
  table: TableName;
  tab: string;
  /** 키 필드 (id / month / email) */
  key: string;
  columns: ColumnDef[];
}

const c = (field: string, header: string, codec: Codec, aliases?: string[]): ColumnDef => ({ field, header, codec, aliases });
const audit = [
  c('author', '작성자', str),
  c('createdAt', '생성일시', ts),
  c('updatedAt', '수정일시', ts),
  c('deleted', '삭제됨', bool, ['삭제']),
];

export const SCHEMAS: { [T in TableName]: TableSchema } = {
  accounts: {
    table: 'accounts', tab: TAB_NAMES.accounts, key: 'id',
    columns: [
      c('id', 'id', str), c('name', '이름', str), c('role', '역할', role),
      c('openingBalance', '시작잔액', int), c('openingDate', '시작일', date),
      c('order', '순서', int),
      c('ownerName', '주인', optStr, ['명의']), c('ownerEmail', '주인이메일', optStr),
      c('deleted', '삭제됨', bool, ['삭제']),
    ],
  },
  rules: {
    table: 'rules', tab: TAB_NAMES.rules, key: 'id',
    columns: [
      c('id', 'id', str), c('fromAccountId', '출금통장', str), c('toAccountId', '입금통장', str),
      c('amount', '금액', int), c('dayOfMonth', '이체일', int),
      c('startMonth', '시작월', month), c('endMonth', '종료월', optMonth),
      c('deleted', '삭제됨', bool, ['삭제']),
      // 방식 (PLAN 4-13). 나중에 더한 열이라 빈 칸 = 고정(정한 금액)
      c('kind', '방식', enumCodec(RULE_KIND_LABELS, 'fixed'), ['배분방식']),
    ],
  },
  transfers: {
    table: 'transfers', tab: TAB_NAMES.transfers, key: 'id',
    columns: [
      c('id', 'id', str), c('date', '날짜', date),
      c('kind', '종류', enumCodec(TRANSFER_KIND_LABELS, 'transfer')),
      c('fromAccountId', '출금통장', optStr), c('toAccountId', '입금통장', optStr),
      c('amount', '금액', int), c('status', '상태', enumCodec(TRANSFER_STATUS_LABELS, 'done')),
      c('ruleId', '월배분id', optStr), c('memo', '메모', str),
      ...audit,
    ],
  },
  fixedExpenses: {
    table: 'fixedExpenses', tab: TAB_NAMES.fixedExpenses, key: 'id',
    columns: [
      c('id', 'id', str), c('name', '이름', str), c('amount', '금액', int),
      c('accountId', '통장', str), c('categoryId', '카테고리', optStr),
      c('dayOfMonth', '결제일', optInt), c('kind', '종류', enumCodec(FIXED_KIND_LABELS, 'bill')),
      c('targetEmail', '대상', optStr), c('startMonth', '시작월', month), c('endMonth', '종료월', optMonth),
      c('spread', '나눠쓰기', enumCodec(SPREAD_LABELS, 'daily'), ['쓰는방식']),
      c('deleted', '삭제됨', bool, ['삭제']),
      // 할부. 나중에 더한 열이라 빈 칸 = 1회차부터 · 전체 회차는 종료월로
      c('installmentNo', '할부회차', optInt, ['시작회차']), c('installmentCount', '할부개월', optInt, ['전체회차']),
      // 메모. 나중에 더한 열이라 빈 칸 = 메모 없음 (없는 값으로 읽는다)
      c('memo', '메모', { enc: str.enc, dec: (cell) => (isBlank(cell) ? undefined : String(cell).trim()) }),
    ],
  },
  events: {
    table: 'events', tab: TAB_NAMES.events, key: 'id',
    columns: [
      c('id', 'id', str), c('date', '날짜', date), c('name', '이름', str),
      c('amount', '예상금액', int, ['금액']), c('accountId', '통장', str), c('categoryId', '카테고리', optStr),
      c('status', '상태', enumCodec(EVENT_STATUS_LABELS, 'planned')),
      c('repeat', '반복', enumCodec(REPEAT_LABELS, 'none')), c('memo', '메모', str),
      ...audit,
    ],
  },
  expenses: {
    table: 'expenses', tab: TAB_NAMES.expenses, key: 'id',
    columns: [
      c('id', 'id', str), c('date', '날짜', date), c('amount', '금액', int),
      c('accountId', '통장', str), c('categoryId', '카테고리', optStr), c('memo', '내용', str, ['메모']),
      c('eventId', '일정id', optStr), c('fixedExpenseId', '고정지출id', optStr),
      ...audit,
      // 청구(돌려받기). 나중에 더한 열이라 빈 칸 = 보통 지출
      c('paidBy', '낸사람', optStr, ['청구자']), c('claimAccountId', '돌려받을통장', optStr),
      c('claimDue', '정산일', optDate, ['돌려줄날']),
      // 여행(PLAN 4-11). 나중에 더한 열이라 빈 칸 = 여행 아님 · 항목은 기타
      c('tripId', '여행id', optStr), c('tripItem', '여행항목', tripItem),
    ],
  },
  monthEnds: {
    table: 'monthEnds', tab: TAB_NAMES.monthEnds, key: 'month',
    columns: [
      c('month', '월', month), c('leftover', '남은생활비', int),
      c('choice', '처리', enumCodec(MONTH_END_LABELS, 'pending')),
      c('decidedBy', '처리자', optStr), c('decidedAt', '처리일시', optTs),
      c('items', '항목별', monthEndItems),
    ],
  },
  categories: {
    table: 'categories', tab: TAB_NAMES.categories, key: 'id',
    columns: [
      c('id', 'id', str), c('name', '이름', str), c('icon', '아이콘', str, ['이모지']),
      c('defaultAccountRole', '기본통장', role), c('order', '순서', int),
      c('deleted', '삭제됨', bool, ['삭제']),
    ],
  },
  favorites: {
    table: 'favorites', tab: TAB_NAMES.favorites, key: 'id',
    columns: [
      c('id', 'id', str), c('name', '이름', str), c('amount', '금액', int),
      c('categoryId', '카테고리', optStr), c('accountId', '통장', optStr), c('order', '순서', int),
      c('deleted', '삭제됨', bool, ['삭제']),
    ],
  },
  members: {
    table: 'members', tab: TAB_NAMES.members, key: 'email',
    columns: [
      c('email', '이메일', str), c('displayName', '표시이름', str, ['이름']),
      c('shared', '공유', sharedFlag, ['공유됨']), c('role', '권한', memberRole),
    ],
  },
  trips: {
    table: 'trips', tab: TAB_NAMES.trips, key: 'id',
    columns: [
      c('id', 'id', str), c('name', '이름', str), c('startDate', '시작일', date, ['떠나는날']),
      c('endDate', '종료일', date, ['돌아오는날']), c('budget', '예산', int, ['총예산']),
      c('items', '항목예산', tripItems), c('memo', '메모', str),
      ...audit,
    ],
  },
  incomePlans: {
    table: 'incomePlans', tab: TAB_NAMES.incomePlans, key: 'id',
    columns: [
      c('id', 'id', str), c('personName', '이름', str, ['사람']), c('personEmail', '이메일', optStr),
      c('amount', '금액', int), c('dayOfMonth', '입금일', int, ['받는날']), c('accountId', '통장', str, ['받는통장']),
      c('startMonth', '시작월', month), c('endMonth', '종료월', optMonth), c('memo', '메모', str),
      c('deleted', '삭제됨', bool, ['삭제']),
    ],
  },
};

/* ---------- 머리글 매핑 ---------- */

const norm = (h: RawCell) => (isBlank(h) ? '' : String(h).replace(/\s/g, '').toLowerCase());

export function canonicalHeaders(table: TableName): string[] {
  return SCHEMAS[table].columns.map((col) => col.header);
}

/** 실제 머리글 각 칸에 해당하는 열 정의 (모르는 열은 null) */
export function mapHeaders(table: TableName, headers: RawCell[]): (ColumnDef | null)[] {
  const byName = new Map<string, ColumnDef>();
  for (const col of SCHEMAS[table].columns) {
    for (const name of [col.field, ...(col.aliases ?? []), col.header]) byName.set(norm(name), col);
  }
  const used = new Set<ColumnDef>();
  return headers.map((h) => {
    const col = byName.get(norm(h));
    if (!col || used.has(col)) return null;
    used.add(col);
    return col;
  });
}

/** 키 셀 값을 비교용 문자열로 */
export function keyOf<T extends TableName>(table: T, row: TableRows[T]): string {
  const v = (row as unknown as Record<string, unknown>)[SCHEMAS[table].key];
  return v === null || v === undefined ? '' : String(v).trim();
}

/** 시트에서 읽은 키 셀을 비교용 문자열로 (월은 'YYYY-MM' 으로 정규화) */
export function decodeKeyCell(table: TableName, cell: RawCell): string {
  const col = SCHEMAS[table].columns.find((x) => x.field === SCHEMAS[table].key)!;
  const v = col.codec.dec(cell);
  return v === null || v === undefined ? '' : String(v).trim();
}

/* ---------- 행 <-> 객체 ---------- */

/** 행 하나 (머리글 매핑 기준). 모든 셀이 비었거나 키가 비면 null */
export function decodeRow<T extends TableName>(table: T, mapping: (ColumnDef | null)[], row: RawCell[]): TableRows[T] | null {
  if (!row || row.every(isBlank)) return null;
  const schema = SCHEMAS[table];
  const cells = new Map<ColumnDef, RawCell>();
  mapping.forEach((col, i) => {
    if (col) cells.set(col, row[i]);
  });
  const obj: Record<string, unknown> = {};
  for (const col of schema.columns) obj[col.field] = col.codec.dec(cells.get(col));
  const key = obj[schema.key];
  if (key === null || key === undefined || String(key).trim() === '') return null;
  // 할부를 모르는 예전 앱이 열린 채 그 행을 고치면 종류가 '일반'으로 덮인다 (모르는 할부 열은 남는다).
  // 할부개월이 적힌 행은 할부로 읽는다 — 일반 고정 지출에는 이 칸을 쓰지 않는다
  if (table === 'fixedExpenses' && obj.kind === 'bill' && typeof obj.installmentCount === 'number' && obj.installmentCount >= 1) {
    obj.kind = 'installment';
  }
  return obj as unknown as TableRows[T];
}

/**
 * 탭 전체 값(첫 행 = 머리글) → 객체 배열.
 * 머리글에 아는 열이 하나도 없으면 머리글 없는 표로 보고 기본 열 순서로 읽는다.
 */
export function decodeTable<T extends TableName>(table: T, values: RawCell[][] | undefined): TableRows[T][] {
  if (!values || values.length === 0) return [];
  const [first, ...rest] = values;
  let mapping = mapHeaders(table, first ?? []);
  let body = rest;
  if (mapping.every((m) => m === null)) {
    mapping = SCHEMAS[table].columns;
    body = values;
  }
  const out: TableRows[T][] = [];
  // 같은 키 행은 처음 것만 (두 기기가 같은 자동 기록을 동시에 쓴 경우 · 응답이 끊겨 다시 쓴 경우 두 번 세지 않게)
  const seen = new Set<string>();
  for (const row of body) {
    const obj = decodeRow(table, mapping, row ?? []);
    if (!obj) continue;
    const k = keyOf(table, obj);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(obj);
  }
  return out;
}

/** 탭 값의 머리글에 이 표의 키 열(id · 월 · 이메일)이 있는지 (가계부 탭인지 가늠) */
export function hasKeyHeader(table: TableName, values: RawCell[][] | undefined): boolean {
  const headers = values?.[0];
  if (!headers) return false;
  return mapHeaders(table, headers).some((m) => m?.field === SCHEMAS[table].key);
}

/** 객체 → 기본 열 순서 행 */
export function encodeRow<T extends TableName>(table: T, row: TableRows[T]): CellValue[] {
  const rec = row as unknown as Record<string, unknown>;
  return SCHEMAS[table].columns.map((col) => col.codec.enc(rec[col.field]));
}

/**
 * 객체 → 실제 시트 머리글 순서 행. 모르는 열은 existing 값을 유지(없으면 '').
 * 시트에 없는 열의 값은 쓰지 않는다.
 */
export function encodeRowForHeaders<T extends TableName>(
  table: T, row: TableRows[T], headers: RawCell[], existing?: RawCell[],
): CellValue[] {
  const rec = row as unknown as Record<string, unknown>;
  const mapping = mapHeaders(table, headers);
  if (mapping.every((m) => m === null)) return encodeRow(table, row);
  return mapping.map((col, i) => {
    if (col) return col.codec.enc(rec[col.field]);
    const old = existing?.[i];
    return old === null || old === undefined ? '' : old;
  });
}

/** 머리글 + 데이터 행 */
export function encodeTable<T extends TableName>(table: T, rows: TableRows[T][]): CellValue[][] {
  return [canonicalHeaders(table), ...rows.map((r) => encodeRow(table, r))];
}

/* ---------- 설정 (키/값) ---------- */

export const SETTINGS_HEADERS = ['키', '값'];

interface SettingDef {
  field: keyof LedgerSettings;
  key: string;
  aliases?: string[];
  codec: Codec;
}

const kindCodec = enumCodec(LEDGER_KIND_LABELS, 'shared');
export const SETTINGS_DEFS: SettingDef[] = [
  { field: 'name', key: '이름', codec: str },
  { field: 'kind', key: '종류', codec: kindCodec },
  { field: 'sharedLedgerId', key: '공용가계부ID', codec: optStr },
  { field: 'schemaVersion', key: '스키마버전', codec: { enc: int.enc, dec: (v) => toNumber(v) ?? 1 } },
  { field: 'createdAt', key: '생성일시', codec: ts },
  // 청구 정산일(매달 며칠). 빈 값 = 자동(수입통장 → 이벤트통장 배분 이체일, 없으면 21일)
  {
    field: 'settleDay',
    key: '정산일',
    codec: {
      enc: (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 31 ? v : ''),
      dec: (c) => {
        const n = toNumber(c);
        return n !== null && n >= 1 && n <= 31 ? n : null;
      },
    },
  },
];

export const DEFAULT_SETTINGS: LedgerSettings = {
  name: '', kind: 'shared', sharedLedgerId: null, schemaVersion: 1, createdAt: '', settleDay: null,
};

/** 앱이 모르는 설정 키 (예: 사용자가 추가한 행) — 다시 쓸 때 그대로 보존 */
export type SettingsExtras = [string, CellValue][];

export function decodeSettings(values: RawCell[][] | undefined): { settings: LedgerSettings; extras: SettingsExtras } {
  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  const extras: SettingsExtras = [];
  const byKey = new Map<string, SettingDef>();
  for (const d of SETTINGS_DEFS) for (const k of [d.key, d.field, ...(d.aliases ?? [])]) byKey.set(norm(k), d);
  for (const row of values ?? []) {
    if (!row || isBlank(row[0])) continue;
    const k = norm(row[0]);
    if (k === norm(SETTINGS_HEADERS[0]!)) continue;
    const def = byKey.get(k);
    if (def) settings[def.field] = def.codec.dec(row[1]);
    else extras.push([String(row[0]).trim(), isBlank(row[1]) ? '' : (row[1] as CellValue)]);
  }
  return { settings: settings as unknown as LedgerSettings, extras };
}

/** 이 앱이 만든 설정 탭인지 (스키마버전 또는 종류 키가 있어야 함) */
export function isLedgerSettings(values: RawCell[][] | undefined): boolean {
  const marks = new Set(
    SETTINGS_DEFS.filter((d) => d.field === 'schemaVersion' || d.field === 'kind').flatMap((d) => [norm(d.key), norm(d.field)]),
  );
  return (values ?? []).some((row) => !!row && !isBlank(row[0]) && marks.has(norm(row[0])));
}

export function encodeSettings(settings: LedgerSettings, extras: SettingsExtras = []): CellValue[][] {
  const rec = settings as unknown as Record<string, unknown>;
  return [
    SETTINGS_HEADERS,
    ...SETTINGS_DEFS.map((d) => [d.key, d.codec.enc(rec[d.field])]),
    ...extras.map(([k, v]) => [k, v]),
  ];
}
