/**
 * 브라우저 저장(localStorage) 백엔드 — 체험 모드와 오프라인용.
 * 가계부 하나 = 키 'budget:ledger:<id>' 에 LedgerData JSON. id 는 'local:<uuid>'.
 * localStorage 를 쓸 수 없으면(SSR, 사생활 보호 모드) 메모리에 저장한다.
 */
import type { LedgerData, LedgerSettings } from '@/domain/types';
import { SCHEMAS, keyOf } from './schema';
import type { LedgerBackend, LedgerRef, LedgerRepository, TableName, TableRows } from './types';

export const LOCAL_KEY_PREFIX = 'budget:ledger:';
export const LOCAL_ID_PREFIX = 'local:';

/** localStorage 와 같은 모양의 최소 저장소 (테스트용 주입 가능) */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

export function createMemoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
  };
}

let fallbackStorage: KeyValueStorage | null = null;

function defaultStorage(): KeyValueStorage {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const probe = '__budget_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    }
  } catch {
    // 사생활 보호 모드 등
  }
  fallbackStorage ??= createMemoryStorage();
  return fallbackStorage;
}

export function localStorageKey(id: string): string {
  return LOCAL_KEY_PREFIX + id;
}

export function isLocalLedgerId(id: string): boolean {
  return id.startsWith(LOCAL_ID_PREFIX);
}

function randomUuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const NOT_FOUND = '가계부를 찾을 수 없어요. 이 브라우저에 저장된 기록이 지워졌을 수 있어요';
const SAVE_FAILED = '브라우저에 저장하지 못했어요. 저장 공간이 부족한지 확인해 주세요';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function readLedger(storage: KeyValueStorage, id: string): LedgerData {
  let raw: string | null = null;
  try {
    raw = storage.getItem(localStorageKey(id));
  } catch {
    raw = null;
  }
  if (!raw) throw new Error(NOT_FOUND);
  try {
    return normalize(JSON.parse(raw) as Partial<LedgerData>);
  } catch {
    throw new Error('저장된 가계부를 읽지 못했어요');
  }
}

function writeLedger(storage: KeyValueStorage, id: string, data: LedgerData): void {
  try {
    storage.setItem(localStorageKey(id), JSON.stringify(data));
  } catch {
    throw new Error(SAVE_FAILED);
  }
}

/** 빠진 표(여행 등)는 빈 배열로, 나중에 더한 열(주인 · 나눠쓰기 · 항목별)은 시트 빈 칸과 같은 기본값으로 채운다 (옛 저장본 호환) */
function normalize(d: Partial<LedgerData>): LedgerData {
  return {
    settings: d.settings as LedgerSettings,
    accounts: (d.accounts ?? []).map((a) => ({ ...a, ownerName: a.ownerName ?? null, ownerEmail: a.ownerEmail ?? null })),
    rules: d.rules ?? [],
    transfers: d.transfers ?? [],
    fixedExpenses: (d.fixedExpenses ?? []).map((f) => ({ ...f, spread: f.spread === 'monthly' ? 'monthly' : 'daily' })),
    events: d.events ?? [],
    expenses: d.expenses ?? [],
    monthEnds: (d.monthEnds ?? []).map((m) => ({ ...m, items: m.items ?? null })),
    categories: d.categories ?? [],
    favorites: d.favorites ?? [],
    members: d.members ?? [],
    trips: (d.trips ?? []).map((t) => ({ ...t, items: t.items ?? {} })),
    incomePlans: d.incomePlans ?? [],
  };
}

function refFor(id: string, data: LedgerData): LedgerRef {
  return { id, name: data.settings?.name ?? '', kind: data.settings?.kind ?? 'shared', source: 'local' };
}

export class LocalRepository implements LedgerRepository {
  readonly ref: LedgerRef;
  private readonly storage: KeyValueStorage;

  constructor(ref: LedgerRef, storage: KeyValueStorage = defaultStorage()) {
    this.ref = ref;
    this.storage = storage;
  }

  async load(): Promise<LedgerData> {
    return readLedger(this.storage, this.ref.id);
  }

  async insert<T extends TableName>(table: T, rows: TableRows[T][]): Promise<void> {
    if (rows.length === 0) return;
    const data = readLedger(this.storage, this.ref.id);
    const list = data[table] as TableRows[T][];
    const seen = new Set(list.map((r) => keyOf(table, r)));
    let changed = false;
    for (const row of rows) {
      const k = keyOf(table, row);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      list.push(clone(row));
      changed = true;
    }
    if (changed) writeLedger(this.storage, this.ref.id, data);
  }

  async upsert<T extends TableName>(table: T, row: TableRows[T]): Promise<void> {
    const data = readLedger(this.storage, this.ref.id);
    const list = data[table] as TableRows[T][];
    const k = keyOf(table, row);
    if (!k) throw new Error(`${SCHEMAS[table].tab} 항목의 키가 비어 있어요`);
    const i = list.findIndex((r) => keyOf(table, r) === k);
    if (i >= 0) list[i] = clone(row);
    else list.push(clone(row));
    writeLedger(this.storage, this.ref.id, data);
  }

  async updateSettings(patch: Partial<LedgerSettings>): Promise<void> {
    const data = readLedger(this.storage, this.ref.id);
    data.settings = { ...data.settings, ...patch };
    writeLedger(this.storage, this.ref.id, data);
  }
}

export class LocalBackend implements LedgerBackend {
  readonly source = 'local' as const;
  private readonly storage: KeyValueStorage;

  constructor(storage?: KeyValueStorage) {
    this.storage = storage ?? defaultStorage();
  }

  /** id 를 주면 그 id 로 만든다 (예: 체험 모드 'local:demo'). 같은 id 가 있으면 덮어쓴다 */
  async create(data: LedgerData, id?: string): Promise<LedgerRef> {
    const ledgerId = id ?? LOCAL_ID_PREFIX + randomUuid();
    if (!isLocalLedgerId(ledgerId)) throw new Error('브라우저 저장 가계부 id 는 local: 로 시작해야 해요');
    const copy = normalize(clone(data));
    writeLedger(this.storage, ledgerId, copy);
    return refFor(ledgerId, copy);
  }

  open(ref: LedgerRef): LedgerRepository {
    return new LocalRepository(ref, this.storage);
  }

  async share(ref: LedgerRef, email: string): Promise<void> {
    const repo = new LocalRepository(ref, this.storage);
    const clean = email.trim();
    if (!clean) throw new Error('이메일을 입력해 주세요');
    await repo.insert('members', [{ email: clean, displayName: clean.split('@')[0] ?? clean }]);
  }

  async describe(id: string): Promise<LedgerRef> {
    return refFor(id, readLedger(this.storage, id));
  }

  /** 이 브라우저에 저장된 가계부 목록 */
  list(): LedgerRef[] {
    const out: LedgerRef[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (!key?.startsWith(LOCAL_KEY_PREFIX)) continue;
      const id = key.slice(LOCAL_KEY_PREFIX.length);
      try {
        out.push(refFor(id, readLedger(this.storage, id)));
      } catch {
        // 깨진 저장본은 건너뛴다
      }
    }
    return out;
  }

  has(id: string): boolean {
    try {
      return this.storage.getItem(localStorageKey(id)) !== null;
    } catch {
      return false;
    }
  }

  remove(id: string): void {
    try {
      this.storage.removeItem(localStorageKey(id));
    } catch {
      // 무시
    }
  }
}
