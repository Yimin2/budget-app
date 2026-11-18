import {
  nextEventDate, nextOccurrenceId, 
} from '@/domain';
import type { Expense, Id, LedgerData, PlannedEvent, YearMonth } from '@/domain/types';
import { isGoogleError } from '@/google/errors';
import { StorageError } from '@/storage/sheets';
import type { LedgerRepository } from '@/storage/types';

/* ---------- 순수 도우미 ---------- */

export function koreanMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && /[가-힣]/.test(e.message)) return e.message;
  return fallback;
}

/** 구글 토큰을 조용히 받지 못했거나(팝업 차단 · 창 닫힘 · 시간 초과) 토큰이 거절된(401) 오류 → '구글 다시 연결' 필요 */
export function isReconnectError(e: unknown): boolean {
  if (isGoogleError(e)) {
    return ['popup_blocked', 'popup_closed', 'not_signed_in', 'timeout', 'account_mismatch'].includes(e.code);
  }
  return e instanceof StorageError && e.status === 401;
}

export const RECONNECT_MESSAGE = '구글 연결이 끊겼어요. 아래 버튼으로 다시 연결해 주세요';
/** 열 때 통장 주인을 멤버와 이었을 때 한 번 보여 주는 알림 (PLAN 4-8) */
export const OWNER_LINK_NOTICE = '통장 주인을 멤버와 이었어요';
/** 시트를 못 읽어 보관한 내용을 보여 줄 때 (읽기 전용) */
export const OFFLINE_MESSAGE = '연결이 안 돼서 마지막으로 맞춘 내용을 보여 줘요';
/** 연결이 안 된 동안 쓰기를 막을 때 */
export const OFFLINE_WRITE_MESSAGE = '연결되면 다시 시도해 주세요';
/** 다시 보거나 창으로 돌아왔을 때 자동 새로고침 간격 (최소) */
export const AUTO_REFRESH_MS = 60_000;

/** 연결 자체가 안 된 실패 (인터넷 끊김) */
export function isNetworkFailure(e: unknown): boolean {
  if (e instanceof StorageError) return e.status === 0;
  if (e instanceof TypeError) return true;
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export type Keyed = { id: string } | { month: string } | { email: string };
export function keyOfRow(row: Keyed): string {
  if ('id' in row) return row.id;
  if ('month' in row) return row.month;
  return row.email.toLowerCase();
}

/** 같은 키는 교체, 없으면 뒤에 추가 */
export function upsertIn<T extends Keyed>(list: T[], row: T): T[] {
  const k = keyOfRow(row);
  const i = list.findIndex((r) => keyOfRow(r) === k);
  if (i < 0) return [...list, row];
  const next = list.slice();
  next[i] = row;
  return next;
}

/** 같은 키가 없을 때만 추가 (repository.insert 와 같은 규칙) */
export function insertIn<T extends Keyed>(list: T[], rows: T[]): T[] {
  const seen = new Set(list.map(keyOfRow));
  const out = list.slice();
  for (const r of rows) {
    const k = keyOfRow(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/** 이체 메모에 쓸 지출 이름: 메모 → 카테고리 → '지출' */
export function claimWhat(d: LedgerData, e: Expense): string {
  const cat = e.categoryId ? d.categories.find((x) => x.id === e.categoryId)?.name : undefined;
  return e.memo.trim() || cat || '지출';
}

export function sortedActive<T extends { deleted: boolean; order: number }>(list: T[]): T[] {
  return list.filter((x) => !x.deleted).sort((a, b) => a.order - b.order);
}

export function nextOrder(list: { order: number }[]): number {
  return list.reduce((m, x) => Math.max(m, x.order), -1) + 1;
}

/** 반복 일정의 다음 회차 행 (기준 일 유지, 결정적 id). 반복이 아니면 null */
export function nextOccurrenceRow(ev: PlannedEvent, events: PlannedEvent[], s: { author: string; createdAt: string; updatedAt: string }): PlannedEvent | null {
  const nextDate = nextEventDate(events, ev);
  if (!nextDate) return null;
  return { ...ev, id: nextOccurrenceId(ev, nextDate), date: nextDate, status: 'planned', ...s, deleted: false };
}

/**
 * 완료·취소 때 써야 할 다음 회차 행. 이미 살아 있는 같은 행이 있으면(재시도 등) 손대지 않도록 null,
 * 지워진 행이면(되돌리기 뒤 다시 취소) 되살린다
 */
export function nextToWrite(ev: PlannedEvent, events: PlannedEvent[], s: { author: string; createdAt: string; updatedAt: string }): PlannedEvent | null {
  const next = nextOccurrenceRow(ev, events, s);
  if (!next) return null;
  const existing = events.find((e) => e.id === next.id);
  return existing && !existing.deleted ? null : next;
}

/** 적립액 변경으로 만든 다음 규칙의 결정적 id ('r' · 2027-01 → 'r@2027-01'). 다시 시도해도 같은 행 */
export function successorRuleId(ruleId: Id, from: YearMonth): Id {
  const i = ruleId.indexOf('@');
  return `${i < 0 ? ruleId : ruleId.slice(0, i)}@${from}`;
}

/** 쓰기 기록 (불러오는 동안 생긴 쓰기를 불러온 데이터 위에 다시 얹기 위해) */
export interface PendingWrite {
  apply: (d: LedgerData) => LedgerData;
  /** 저장이 끝난 시점 (clock). 아직 저장 중이면 null */
  doneAt: number | null;
}

export function msUntilNextMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

/* ---------- 컨텍스트 ---------- */

export interface SyncMeta {
  /** 시트와 마지막으로 맞춘 시각 (ISO). 보관한 내용이면 보관할 때 시각 */
  syncedAt: string | null;
  /** 지금 보이는 데이터가 보관한 내용(아직 시트에서 못 읽음)인지 */
  fromCache: boolean;
  /** 시트를 못 읽어 보관한 내용을 읽기 전용으로 보여 주는 중 */
  offline: boolean;
}

export interface LoadedState extends SyncMeta {
  repo: LedgerRepository;
  status: 'ready' | 'error';
  error: string | null;
  data: LedgerData | null;
  needsReconnect?: boolean;
}

export const NO_SYNC: SyncMeta = { syncedAt: null, fromCache: false, offline: false };
