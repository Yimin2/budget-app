/**
 * 구글 시트 백엔드 — Sheets REST v4 + Drive v3 를 fetch 로 직접 호출한다.
 * 가계부 하나 = 스프레드시트 하나. 탭·머리글은 schema.ts.
 * 쓰기: valueInputOption=RAW / 읽기: valueRenderOption=UNFORMATTED_VALUE.
 */
import { memberRoleOf, type SharedUser, type SharingList } from '@/domain/members';
import type { LedgerData, LedgerSettings } from '@/domain/types';
import {
  ALL_TABS, SETTINGS_HEADERS, SETTINGS_TAB, TABLE_NAMES, TAB_NAMES, canonicalHeaders, decodeKeyCell,
  decodeSettings, decodeTable, encodeRow, encodeRowForHeaders, encodeSettings, encodeTable, hasKeyHeader,
  isLedgerSettings, keyOf, mapHeaders, SCHEMAS, type CellValue, type RawCell, type SettingsExtras,
} from './schema';
import type { LedgerBackend, LedgerRef, LedgerRepository, TableName, TableRows } from './types';

export const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
export const DRIVE_API = 'https://www.googleapis.com/drive/v3';

/** forceRefresh=true 면 캐시된 토큰 대신 새 토큰을 받아 달라는 뜻 (401 뒤 한 번) */
export type AccessTokenGetter = (forceRefresh?: boolean) => Promise<string>;

export interface SheetsOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** 429/5xx 재시도 횟수 (기본 3) */
  maxRetries?: number;
  /** 첫 재시도 대기 ms (기본 500, 2배씩) */
  backoffMs?: number;
}

/** 사용자에게 보여줄 한글 메시지 + HTTP 상태 */
export class StorageError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'StorageError';
    this.status = status;
  }
}

export const MESSAGES = {
  forbidden: '이 가계부에 접근할 권한이 없어요. 가계부를 만든 사람에게 공유를 부탁해 주세요',
  notFound: '가계부를 찾을 수 없어요. 삭제됐거나 주소가 바뀌었을 수 있어요',
  unauthorized: '구글 로그인이 만료됐어요. 다시 로그인해 주세요',
  busy: '구글 서버가 잠시 바빠요. 잠시 뒤 다시 시도해 주세요',
  network: '인터넷 연결을 확인해 주세요',
  badRequest: '요청을 처리하지 못했어요. 시트 구조가 바뀌었는지 확인해 주세요',
  unknown: '구글 시트와 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요',
  shareFailed: '초대하지 못했어요. 이메일 주소를 확인해 주세요',
  notLedger: '이 파일은 가계부로 열 수 없어요. 이 앱에서 만든 가계부 파일을 골라 주세요',
} as const;

/** 요청이 서버에서 처리됐는지 알 수 없는 실패 (연결 끊김 · 5xx) */
export function isAmbiguousFailure(e: unknown): boolean {
  return e instanceof StorageError && (e.status === 0 || e.status >= 500);
}

/** 0 → 'A', 25 → 'Z', 26 → 'AA' */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export interface RequestOptions {
  /**
   * 같은 요청을 다시 보내도 결과가 같은지 (기본 true).
   * false(행 추가 · 탭 추가 · 파일 만들기)면 처리 여부를 알 수 없는 실패(연결 끊김 · 5xx)에 다시 보내지 않는다 — 행이 두 번 생길 수 있어서.
   * 429 는 처리 전에 거절된 것이라 다시 보낸다.
   */
  idempotent?: boolean;
}

function messageFor(status: number): string {
  if (status === 401) return MESSAGES.unauthorized;
  if (status === 403) return MESSAGES.forbidden;
  if (status === 404) return MESSAGES.notFound;
  if (status === 429 || status >= 500) return MESSAGES.busy;
  if (status === 400) return MESSAGES.badRequest;
  return MESSAGES.unknown;
}

/** A1 표기의 탭 이름 ('설정' → "'설정'") */
export function quoteTab(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

interface ValueRange {
  range?: string;
  values?: RawCell[][];
}

/** HTTP 호출 + 토큰 + 재시도 */
export class GoogleClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly backoffMs: number;

  constructor(private readonly getAccessToken: AccessTokenGetter, opts: SheetsOptions = {}) {
    this.fetchImpl = opts.fetch ?? ((...args) => globalThis.fetch(...args));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = opts.maxRetries ?? 3;
    this.backoffMs = opts.backoffMs ?? 500;
  }

  /** n 번째 재시도 전 대기 (500ms · 1s · 2s …) */
  wait(attempt: number): Promise<void> {
    return this.sleep(this.backoffMs * 2 ** attempt);
  }

  get retries(): number {
    return this.maxRetries;
  }

  async request<T = unknown>(method: string, url: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    const idempotent = opts.idempotent ?? true;
    let refreshed = false;
    let retries = 0;
    for (;;) {
      const token = await this.getAccessToken(refreshed);
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch {
        if (idempotent && retries < this.maxRetries) {
          await this.sleep(this.backoffMs * 2 ** retries++);
          continue;
        }
        throw new StorageError(MESSAGES.network, 0);
      }
      if (res.ok) {
        const text = await res.text();
        return (text ? JSON.parse(text) : {}) as T;
      }
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        continue;
      }
      if ((res.status === 429 || (idempotent && res.status >= 500)) && retries < this.maxRetries) {
        await this.sleep(this.backoffMs * 2 ** retries++);
        continue;
      }
      throw new StorageError(messageFor(res.status), res.status);
    }
  }
}

const enc = encodeURIComponent;

/* ---------- 저장소 ---------- */

interface TabSnapshot {
  headers: RawCell[];
  keys: Set<string>;
}

export class SheetsRepository implements LedgerRepository {
  readonly ref: LedgerRef;
  private readonly client: GoogleClient;
  private readonly tabs = new Map<TableName, TabSnapshot>();
  private missingTabs = new Set<string>();
  private settings: LedgerSettings | null = null;
  private settingsExtras: SettingsExtras = [];

  constructor(ref: LedgerRef, getAccessToken: AccessTokenGetter, opts?: SheetsOptions);
  constructor(ref: LedgerRef, client: GoogleClient);
  constructor(ref: LedgerRef, auth: AccessTokenGetter | GoogleClient, opts?: SheetsOptions) {
    this.ref = ref;
    this.client = auth instanceof GoogleClient ? auth : new GoogleClient(auth, opts);
  }

  private get base(): string {
    return `${SHEETS_API}/${enc(this.ref.id)}`;
  }

  private async batchGet(tabs: string[]): Promise<ValueRange[]> {
    const ranges = tabs.map((t) => `ranges=${enc(quoteTab(t))}`).join('&');
    const url = `${this.base}/values:batchGet?${ranges}&majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`;
    const res = await this.client.request<{ valueRanges?: ValueRange[] }>('GET', url);
    return res.valueRanges ?? [];
  }

  private async existingTabs(): Promise<Set<string>> {
    const res = await this.client.request<{ sheets?: { properties?: { title?: string } }[] }>(
      'GET', `${this.base}?fields=${enc('sheets.properties.title')}`,
    );
    return new Set((res.sheets ?? []).map((s) => s.properties?.title ?? ''));
  }

  async load(): Promise<LedgerData> {
    let tabs = ALL_TABS;
    let ranges: ValueRange[];
    try {
      ranges = await this.batchGet(tabs);
      this.missingTabs = new Set();
    } catch (e) {
      // 탭이 지워졌으면 범위 해석 오류(400) — 있는 탭만 다시 읽는다
      if (!(e instanceof StorageError) || e.status !== 400) throw e;
      const existing = await this.existingTabs();
      tabs = ALL_TABS.filter((t) => existing.has(t));
      this.missingTabs = new Set(ALL_TABS.filter((t) => !existing.has(t)));
      ranges = tabs.length ? await this.batchGet(tabs) : [];
    }
    const byTab = new Map<string, RawCell[][]>();
    tabs.forEach((t, i) => byTab.set(t, ranges[i]?.values ?? []));

    // 가계부 파일이 아니면 (설정 탭도, id 머리글이 있는 앱 탭도 없음) 열지 않는다 — 다른 시트에 행을 쓰지 않게
    if (!isLedgerSettings(byTab.get(SETTINGS_TAB)) && !TABLE_NAMES.some((t) => hasKeyHeader(t, byTab.get(TAB_NAMES[t])))) {
      throw new StorageError(MESSAGES.notLedger, 400);
    }

    // 나중에 더한 탭(예: 여행)이 없는 예전 가계부: 한 번 만들어 둔다. 그러지 않으면 불러올 때마다
    // 400 → 탭 목록 → 다시 읽기로 요청이 세 번씩 나가 분당 읽기 한도를 빨리 쓴다
    if (this.missingTabs.size > 0) await this.createMissingTabs();

    const { settings, extras } = decodeSettings(byTab.get(SETTINGS_TAB));
    if (!settings.name) settings.name = this.ref.name;
    if (!byTab.get(SETTINGS_TAB)?.length) settings.kind = this.ref.kind;
    this.settings = settings;
    this.settingsExtras = extras;

    const data = { settings } as LedgerData;
    for (const table of TABLE_NAMES) {
      const values = byTab.get(TAB_NAMES[table]) ?? [];
      const rows = decodeTable(table, values);
      (data as unknown as Record<string, unknown>)[table] = rows;
      this.tabs.set(table, {
        headers: values[0]?.length ? values[0] : canonicalHeaders(table),
        keys: new Set(rows.map((r) => keyOf(table, r as never))),
      });
    }
    return data;
  }

  /** 없는 앱 탭(표)을 만든다. 만들지 못해도(읽기 권한만 등) 불러오기는 계속하고, 쓸 때 readTab 이 다시 시도한다 */
  private async createMissingTabs(): Promise<void> {
    for (const table of TABLE_NAMES) {
      const tab = TAB_NAMES[table];
      if (!this.missingTabs.has(tab)) continue;
      try {
        await this.createTab(tab, canonicalHeaders(table));
      } catch {
        // 그대로 둔다 (missingTabs 에 남아 쓸 때 다시 만든다)
      }
    }
  }

  /**
   * 탭이 없으면 만들고 머리글을 쓴다. 이미 있으면(다른 사람이 먼저 만들었거나 앞선 시도가 처리됨) false.
   * 탭 추가는 다시 보내면 '이미 있음' 오류가 나므로 자동 재시도하지 않고, 실패하면 탭 목록을 확인한다
   */
  private async createTab(tab: string, headers: CellValue[]): Promise<boolean> {
    try {
      await this.client.request(
        'POST',
        `${this.base}:batchUpdate`,
        { requests: [{ addSheet: { properties: { title: tab, gridProperties: { frozenRowCount: 1 } } } }] },
        { idempotent: false },
      );
    } catch (e) {
      if (!(e instanceof StorageError) || !(e.status === 400 || isAmbiguousFailure(e))) throw e;
      const existing = await this.existingTabs();
      if (!existing.has(tab)) throw e;
      this.missingTabs.delete(tab);
      return false;
    }
    await this.client.request(
      'PUT',
      `${this.base}/values/${enc(`${quoteTab(tab)}!A1`)}?valueInputOption=RAW`,
      { range: `${quoteTab(tab)}!A1`, majorDimension: 'ROWS', values: [headers] },
    );
    this.missingTabs.delete(tab);
    return true;
  }

  /** 탭 전체를 새로 읽는다. 탭이 없으면 만든다. 빈 탭이면 머리글을 쓴다 */
  private async readTab(table: TableName): Promise<RawCell[][]> {
    const tab = TAB_NAMES[table];
    if (this.missingTabs.has(tab) && (await this.createTab(tab, canonicalHeaders(table)))) {
      return [canonicalHeaders(table)];
    }
    let values: RawCell[][];
    try {
      values = (await this.batchGet([tab]))[0]?.values ?? [];
    } catch (e) {
      if (!(e instanceof StorageError) || e.status !== 400) throw e;
      const existing = await this.existingTabs();
      if (existing.has(tab)) throw e;
      if (await this.createTab(tab, canonicalHeaders(table))) return [canonicalHeaders(table)];
      values = (await this.batchGet([tab]))[0]?.values ?? [];
    }
    if (values.length === 0 || (values[0] ?? []).every((c) => c === '' || c == null)) {
      await this.client.request(
        'PUT',
        `${this.base}/values/${enc(`${quoteTab(tab)}!A1`)}?valueInputOption=RAW`,
        { range: `${quoteTab(tab)}!A1`, majorDimension: 'ROWS', values: [canonicalHeaders(table)] },
      );
      values = [canonicalHeaders(table), ...values.slice(1)];
    }
    return this.ensureHeaders(table, values);
  }

  /**
   * 머리글에 앱이 쓰는 열이 빠졌으면(사용자가 열을 지움) 머리글 오른쪽 끝에 다시 붙인다.
   * 그러지 않으면 그 열의 값(예: 삭제됨)이 저장되지 않는데도 저장된 것처럼 보인다
   */
  private async ensureHeaders(table: TableName, values: RawCell[][]): Promise<RawCell[][]> {
    const headers = values[0] ?? [];
    const mapping = mapHeaders(table, headers);
    if (mapping.every((m) => m === null)) return values; // 머리글 없는 표
    const present = new Set(mapping.filter((m): m is NonNullable<typeof m> => m !== null).map((m) => m.field));
    const missing = SCHEMAS[table].columns.filter((col) => !present.has(col.field));
    if (missing.length === 0) return values;
    const width = values.reduce((w, row) => Math.max(w, row?.length ?? 0), headers.length);
    const next: CellValue[] = [];
    for (let i = 0; i < width; i++) {
      const h = headers[i];
      next.push(h === null || h === undefined ? '' : h);
    }
    next.push(...missing.map((col) => col.header));
    const tab = TAB_NAMES[table];
    await this.client.request(
      'PUT',
      `${this.base}/values/${enc(`${quoteTab(tab)}!A1`)}?valueInputOption=RAW`,
      { range: `${quoteTab(tab)}!A1`, majorDimension: 'ROWS', values: [next] },
    );
    return [next, ...values.slice(1)];
  }

  private snapshotFrom(table: TableName, values: RawCell[][]): TabSnapshot {
    const snap: TabSnapshot = {
      headers: values[0] ?? canonicalHeaders(table),
      keys: new Set(decodeTable(table, values).map((r) => keyOf(table, r as never))),
    };
    this.tabs.set(table, snap);
    return snap;
  }

  /** 탭 끝에 행 추가. 탭 전체 범위를 주어 빈 행이 끼어 있어도 표 중간에 끼워 넣지 않게 한다. 재시도하지 않는다 */
  private async appendOnce(table: TableName, rows: CellValue[][]): Promise<void> {
    const range = quoteTab(TAB_NAMES[table]);
    await this.client.request(
      'POST',
      `${this.base}/values/${enc(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { range, majorDimension: 'ROWS', values: rows },
      { idempotent: false },
    );
  }

  /**
   * 행 추가. 처리 여부를 알 수 없게 실패하면(연결 끊김 · 5xx) 탭을 다시 읽어 아직 없는 키만 다시 추가한다.
   * (같은 append 를 그대로 다시 보내면 행이 두 번 생긴다)
   */
  private async appendRows<T extends TableName>(table: T, rows: TableRows[T][], headers: RawCell[]): Promise<void> {
    let pending = rows;
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.client.retries; attempt++) {
      if (attempt > 0) {
        await this.client.wait(attempt - 1);
        const values = await this.readTab(table);
        const snap = this.snapshotFrom(table, values);
        headers = snap.headers;
        pending = pending.filter((r) => !snap.keys.has(keyOf(table, r)));
        if (pending.length === 0) return;
      }
      try {
        await this.appendOnce(table, pending.map((r) => encodeRowForHeaders(table, r, headers)));
        return;
      } catch (e) {
        if (!isAmbiguousFailure(e)) throw e;
        lastError = e;
      }
    }
    throw lastError;
  }

  async insert<T extends TableName>(table: T, rows: TableRows[T][]): Promise<void> {
    if (rows.length === 0) return;
    // 이미 아는 키는 바로 건너뛴다 (행은 지우지 않으므로 아는 키는 시트에 있다)
    const known = this.tabs.get(table);
    const batch = new Set<string>();
    const candidates: TableRows[T][] = [];
    for (const row of rows) {
      const k = keyOf(table, row);
      if (!k || batch.has(k) || (known && !this.missingTabs.has(TAB_NAMES[table]) && known.keys.has(k))) continue;
      batch.add(k);
      candidates.push(row);
    }
    if (candidates.length === 0) return;
    // 쓰기 직전에 새로 읽는다: 다른 기기가 방금 쓴 키(자동 기록)를 건너뛰고, 바뀐 열 순서에 맞춰 쓴다
    const snap = this.snapshotFrom(table, await this.readTab(table));
    const fresh = candidates.filter((r) => !snap.keys.has(keyOf(table, r)));
    if (fresh.length === 0) return;
    await this.appendRows(table, fresh, snap.headers);
    for (const r of fresh) snap.keys.add(keyOf(table, r));
  }

  async upsert<T extends TableName>(table: T, row: TableRows[T]): Promise<void> {
    const k = keyOf(table, row);
    if (!k) throw new Error(`${SCHEMAS[table].tab} 항목의 키가 비어 있어요`);
    await this.upsertMany(table, [row]);
  }

  /**
   * 여러 행 upsert: 탭을 한 번 읽고, 있는 행은 한 번의 batchUpdate 로 고치고, 없는 행은 한 번의 append 로 붙인다.
   * 같은 키가 여럿이면 마지막 행을 쓴다
   */
  async upsertMany<T extends TableName>(table: T, rows: TableRows[T][]): Promise<void> {
    const byKey = new Map<string, TableRows[T]>();
    for (const row of rows) {
      const k = keyOf(table, row);
      if (!k) throw new Error(`${SCHEMAS[table].tab} 항목의 키가 비어 있어요`);
      byKey.set(k, row);
    }
    if (byKey.size === 0) return;
    const values = await this.readTab(table);
    const snap = this.snapshotFrom(table, values);
    const headers = snap.headers;
    const mapping = mapHeaders(table, headers);
    const headerless = mapping.every((m) => m === null);
    let keyCol = mapping.findIndex((m) => m?.field === SCHEMAS[table].key);
    let start = 1;
    if (headerless) {
      // 머리글 없는 표: 기본 열 순서
      keyCol = SCHEMAS[table].columns.findIndex((col) => col.field === SCHEMAS[table].key);
      start = 0;
    }
    // 같은 키 행이 여럿이면(동시에 쓴 중복) 모두 고친다 — 지우기가 남은 한 줄 때문에 무시되지 않게
    const rowIndexes = new Map<string, number[]>();
    if (keyCol >= 0) {
      for (let i = start; i < values.length; i++) {
        const k = decodeKeyCell(table, values[i]?.[keyCol]);
        if (!byKey.has(k)) continue;
        rowIndexes.set(k, [...(rowIndexes.get(k) ?? []), i]);
      }
    }
    const tab = quoteTab(TAB_NAMES[table]);
    const data: { range: string; majorDimension: 'ROWS'; values: CellValue[][] }[] = [];
    const missing: TableRows[T][] = [];
    for (const [k, row] of byKey) {
      const indexes = rowIndexes.get(k);
      if (!indexes) {
        missing.push(row);
        continue;
      }
      for (const rowIndex of indexes) {
        const sheetRow = rowIndex + 1;
        if (headerless) {
          const cells = encodeRow(table, row);
          data.push({ range: `${tab}!A${sheetRow}:${columnLetter(cells.length - 1)}${sheetRow}`, majorDimension: 'ROWS', values: [cells] });
          continue;
        }
        // 앱이 아는 열만 쓴다 (사용자가 추가한 열 · 수식은 건드리지 않는다)
        const cells = encodeRowForHeaders(table, row, headers);
        let i = 0;
        while (i < mapping.length) {
          if (!mapping[i]) {
            i++;
            continue;
          }
          let j = i;
          while (j + 1 < mapping.length && mapping[j + 1]) j++;
          data.push({
            range: `${tab}!${columnLetter(i)}${sheetRow}:${columnLetter(j)}${sheetRow}`,
            majorDimension: 'ROWS',
            values: [cells.slice(i, j + 1)],
          });
          i = j + 1;
        }
      }
    }
    if (data.length > 0) {
      await this.client.request('POST', `${this.base}/values:batchUpdate`, { valueInputOption: 'RAW', data });
    }
    if (missing.length > 0) {
      await this.appendRows(table, missing, headers);
      for (const r of missing) snap.keys.add(keyOf(table, r));
    }
  }

  /**
   * 설정 탭을 쓰기 직전에 새로 읽어 바꾼 값만 합치고, 한 번의 쓰기로 덮어쓴다 (지우고 쓰는 두 단계가 아님).
   * 예전보다 줄이 줄면 남는 줄은 빈 칸으로 채운다. A·B 열만 쓰고 다른 열은 건드리지 않는다
   */
  async updateSettings(patch: Partial<LedgerSettings>): Promise<void> {
    let values: RawCell[][] = [];
    let missing = this.missingTabs.has(SETTINGS_TAB);
    if (!missing) {
      try {
        values = (await this.batchGet([SETTINGS_TAB]))[0]?.values ?? [];
      } catch (e) {
        if (!(e instanceof StorageError) || e.status !== 400) throw e;
        missing = true;
      }
    }
    if (missing && !(await this.createTab(SETTINGS_TAB, SETTINGS_HEADERS))) {
      values = (await this.batchGet([SETTINGS_TAB]))[0]?.values ?? [];
    }
    const decoded = decodeSettings(values);
    const base: LedgerSettings = { ...decoded.settings, name: decoded.settings.name || this.settings?.name || this.ref.name };
    if (!values.some((r) => r && r.length && r[0] !== '' && r[0] != null)) {
      base.kind = this.settings?.kind ?? this.ref.kind;
      if (this.settings) {
        base.sharedLedgerId = this.settings.sharedLedgerId;
        base.createdAt = this.settings.createdAt;
        base.schemaVersion = this.settings.schemaVersion;
      }
    }
    const next: LedgerSettings = { ...base, ...patch };
    const rows: CellValue[][] = encodeSettings(next, decoded.extras);
    while (rows.length < values.length) rows.push(['', '']);
    const range = quoteTab(SETTINGS_TAB);
    await this.client.request(
      'PUT',
      `${this.base}/values/${enc(`${range}!A1`)}?valueInputOption=RAW`,
      { range: `${range}!A1`, majorDimension: 'ROWS', values: rows },
    );
    if (patch.name !== undefined && patch.name !== base.name && patch.name.trim()) {
      await this.client.request('POST', `${this.base}:batchUpdate`, {
        requests: [{ updateSpreadsheetProperties: { properties: { title: patch.name }, fields: 'title' } }],
      });
    }
    this.settings = next;
    this.settingsExtras = decoded.extras;
  }
}

/* ---------- 백엔드 ---------- */

interface DrivePermissionList {
  nextPageToken?: string;
  permissions?: {
    id?: string;
    type?: string;
    role?: string;
    emailAddress?: string;
    displayName?: string;
    deleted?: boolean;
  }[];
}

export class SheetsBackend implements LedgerBackend {
  readonly source = 'sheets' as const;
  private readonly client: GoogleClient;

  constructor(getAccessToken: AccessTokenGetter, opts?: SheetsOptions) {
    this.client = new GoogleClient(getAccessToken, opts);
  }

  async create(data: LedgerData): Promise<LedgerRef> {
    const title = data.settings.name.trim() || '가계부';
    // 파일 만들기는 다시 보내면 파일이 하나 더 생기므로 처리 여부를 모르는 실패에 자동 재시도하지 않는다
    const created = await this.client.request<{ spreadsheetId: string }>(
      'POST',
      SHEETS_API,
      {
        properties: { title, locale: 'ko_KR', timeZone: 'Asia/Seoul' },
        sheets: ALL_TABS.map((tab, index) => ({
          properties: { title: tab, index, gridProperties: { frozenRowCount: 1 } },
        })),
      },
      { idempotent: false },
    );
    const id = created.spreadsheetId;
    const valueData = [
      { range: `${quoteTab(SETTINGS_TAB)}!A1`, majorDimension: 'ROWS', values: encodeSettings(data.settings) },
      ...TABLE_NAMES.map((table) => ({
        range: `${quoteTab(TAB_NAMES[table])}!A1`,
        majorDimension: 'ROWS',
        values: encodeTable(table, data[table] as never),
      })),
    ];
    await this.client.request('POST', `${SHEETS_API}/${enc(id)}/values:batchUpdate`, {
      valueInputOption: 'RAW',
      data: valueData,
    });
    return { id, name: title, kind: data.settings.kind, source: 'sheets' };
  }

  open(ref: LedgerRef): LedgerRepository {
    return new SheetsRepository(ref, this.client);
  }

  async share(ref: LedgerRef, email: string): Promise<void> {
    const clean = email.trim();
    if (!clean) throw new Error('이메일을 입력해 주세요');
    try {
      await this.client.request(
        'POST',
        `${DRIVE_API}/files/${enc(ref.id)}/permissions?sendNotificationEmail=true`,
        { role: 'writer', type: 'user', emailAddress: clean },
      );
    } catch (e) {
      if (e instanceof StorageError && e.status === 400) throw new StorageError(MESSAGES.shareFailed, 400);
      throw e;
    }
  }

  /**
   * 공유받은 사람 목록 — Drive v3 permissions.list (drive.file 로도 앱이 만들었거나 파일 선택 창에서 고른 파일이면 된다).
   * 사람(type=user)만 모으고, 그룹 · 도메인 · 링크 공유가 있으면 complete=false. 지워진 계정 · 모르는 권한은 뺀다.
   * 보기 · 댓글 권한이면 구글이 403 으로 거절할 수 있다 (그대로 던진다)
   */
  async listSharing(ref: LedgerRef): Promise<SharingList> {
    const users: SharedUser[] = [];
    let complete = true;
    let pageToken: string | undefined;
    const fields = enc('nextPageToken,permissions(id,type,role,emailAddress,displayName,deleted)');
    for (let page = 0; page < 20; page++) {
      const url =
        `${DRIVE_API}/files/${enc(ref.id)}/permissions?supportsAllDrives=true&pageSize=100&fields=${fields}` +
        (pageToken ? `&pageToken=${enc(pageToken)}` : '');
      const res = await this.client.request<DrivePermissionList>('GET', url);
      for (const p of res.permissions ?? []) {
        if (p.type !== 'user') {
          if (p.type) complete = false;
          continue;
        }
        const email = (p.emailAddress ?? '').trim();
        const role = memberRoleOf(p.role);
        if (!email || p.deleted || !role) continue;
        users.push({ email, displayName: (p.displayName ?? '').trim(), role });
      }
      pageToken = res.nextPageToken || undefined;
      if (!pageToken) break;
    }
    return { users, complete };
  }

  async describe(id: string): Promise<LedgerRef> {
    const base = `${SHEETS_API}/${enc(id)}`;
    const [meta, settingsRange] = await Promise.all([
      this.client.request<{ properties?: { title?: string } }>('GET', `${base}?fields=${enc('properties.title')}`),
      this.client
        .request<ValueRange>('GET', `${base}/values/${enc(quoteTab(SETTINGS_TAB))}?valueRenderOption=UNFORMATTED_VALUE`)
        .catch((e: unknown) => {
          if (e instanceof StorageError && e.status === 400) return null; // 설정 탭 없음
          throw e;
        }),
    ]);
    // 이 앱이 만든 가계부만 (설정 탭에 스키마버전·종류가 있어야 함). 아무 스프레드시트에나 탭·행을 쓰지 않게
    if (!settingsRange || !isLedgerSettings(settingsRange.values)) throw new StorageError(MESSAGES.notLedger, 400);
    const { settings } = decodeSettings(settingsRange.values);
    return { id, name: meta.properties?.title ?? settings.name, kind: settings.kind, source: 'sheets' };
  }
}
