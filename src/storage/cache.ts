/**
 * 구글 시트 가계부의 마지막 불러온 내용을 브라우저에 보관해요 (PLAN 7).
 * 열 때 먼저 이 내용으로 바로 그리고, 시트에서 새로 읽어 조용히 바꿔요. 시트가 원본이라 쓰기는 언제나 시트에 먼저 해요.
 * 열쇠 = 캐시 버전 + 이메일 + 가계부 id. IndexedDB 를 쓸 수 없으면(사생활 보호 모드 · 서버 · 테스트) 메모리에 둬요.
 * 모든 동작은 실패해도 던지지 않아요 (캐시는 없어도 앱이 그대로 돌아가야 해요).
 */
import type { LedgerData } from '@/domain/types';

/** 캐시 모양이 바뀌면 올려요. 다른 버전의 내용은 읽지 않고 지워요 */
export const LEDGER_CACHE_VERSION = 1;

export interface CachedLedger {
  version: number;
  email: string;
  ledgerId: string;
  /** 시트와 마지막으로 맞춘 시각 (ISO) */
  savedAt: string;
  data: LedgerData;
}

/** 열쇠-값 저장소 (IndexedDB · 메모리 · 테스트 가짜) */
export interface CacheStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

export function createMemoryCacheStore(): CacheStore {
  const map = new Map<string, unknown>();
  return {
    get: async (k) => map.get(k),
    set: async (k, v) => void map.set(k, v),
    delete: async (k) => void map.delete(k),
    keys: async () => [...map.keys()],
    clear: async () => map.clear(),
  };
}

const DB_NAME = 'budget-cache';
const STORE = 'ledgers';

function promised<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexeddb'));
  });
}

/** IndexedDB 저장소. 열지 못하면 첫 동작에서 던져요 (아래 fallback 이 메모리로 바꿔요) */
export function createIndexedDbCacheStore(factory: IDBFactory): CacheStore {
  let dbp: Promise<IDBDatabase> | null = null;
  const db = () => {
    dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexeddb'));
      req.onblocked = () => reject(new Error('indexeddb blocked'));
    });
    return dbp;
  };
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const d = await db();
    return promised(fn(d.transaction(STORE, mode).objectStore(STORE)));
  };
  return {
    get: (k) => run('readonly', (s) => s.get(k)),
    set: async (k, v) => void (await run('readwrite', (s) => s.put(v, k))),
    delete: async (k) => void (await run('readwrite', (s) => s.delete(k))),
    keys: async () => (await run('readonly', (s) => s.getAllKeys())).map(String),
    clear: async () => void (await run('readwrite', (s) => s.clear())),
  };
}

/** 앞 저장소가 한 번이라도 실패하면 그 뒤로는 메모리를 써요 */
export function withMemoryFallback(primary: CacheStore | null): CacheStore {
  const memory = createMemoryCacheStore();
  let active: CacheStore = primary ?? memory;
  const call = async <T>(fn: (s: CacheStore) => Promise<T>): Promise<T> => {
    if (active !== memory) {
      try {
        return await fn(active);
      } catch {
        active = memory;
      }
    }
    return fn(memory);
  };
  return {
    get: (k) => call((s) => s.get(k)),
    set: (k, v) => call((s) => s.set(k, v)),
    delete: (k) => call((s) => s.delete(k)),
    keys: () => call((s) => s.keys()),
    clear: () => call((s) => s.clear()),
  };
}

function isCachedLedger(v: unknown): v is CachedLedger {
  if (!v || typeof v !== 'object') return false;
  const c = v as Partial<CachedLedger>;
  return (
    typeof c.version === 'number' &&
    typeof c.email === 'string' &&
    typeof c.ledgerId === 'string' &&
    typeof c.savedAt === 'string' &&
    !!c.data &&
    typeof c.data === 'object'
  );
}

const SEP = '|';

/** 가계부 캐시. 실패는 모두 삼키고 '없음'으로 다뤄요 */
export class LedgerCache {
  constructor(
    private readonly store: CacheStore,
    readonly version: number = LEDGER_CACHE_VERSION,
  ) {}

  key(email: string, ledgerId: string): string {
    return ['v' + this.version, email.trim().toLowerCase(), ledgerId].join(SEP);
  }

  async read(email: string, ledgerId: string): Promise<CachedLedger | null> {
    const key = this.key(email, ledgerId);
    try {
      const v = await this.store.get(key);
      if (v === undefined || v === null) return null;
      if (!isCachedLedger(v) || v.version !== this.version) {
        await this.store.delete(key);
        return null;
      }
      return v;
    } catch {
      return null;
    }
  }

  async write(email: string, ledgerId: string, data: LedgerData, savedAt: string): Promise<void> {
    const entry: CachedLedger = { version: this.version, email: email.trim().toLowerCase(), ledgerId, savedAt, data };
    try {
      await this.store.set(this.key(email, ledgerId), entry);
    } catch {
      // 다음에 맞출 때 다시 써요
    }
  }

  /** 이 계정 · 이 버전이 아닌 내용은 모두 지워요 (계정 바뀜 · 버전 바뀜) */
  async retainOnly(email: string): Promise<void> {
    const prefix = ['v' + this.version, email.trim().toLowerCase(), ''].join(SEP);
    try {
      const keys = await this.store.keys();
      for (const k of keys) if (!k.startsWith(prefix)) await this.store.delete(k);
    } catch {
      // 무시
    }
  }

  async clear(): Promise<void> {
    try {
      await this.store.clear();
    } catch {
      // 무시
    }
  }
}

/** 브라우저 기본 캐시: IndexedDB, 없거나 실패하면 메모리 */
export function createLedgerCache(): LedgerCache {
  let idb: CacheStore | null = null;
  try {
    if (typeof indexedDB !== 'undefined' && indexedDB) idb = createIndexedDbCacheStore(indexedDB);
  } catch {
    idb = null;
  }
  return new LedgerCache(withMemoryFallback(idb));
}
