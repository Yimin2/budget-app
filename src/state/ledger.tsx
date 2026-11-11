'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  isValidDate,
  addMonths,
  adjustmentDelta,
  allBalances,
  buildInstallmentRows,
  deleteInstallmentRows,
  earliestChangeMonth,
  installmentPlan,
  installmentPlans,
  installmentPrepayId,
  judgeInstallment,
  prepaidAmounts,
  remainingAmountsFrom,
  replanInstallment,
  revisedAmounts,
  autoTransferId,
  endBillSeries,
  canAutoFill,
  isDatedBill,
  normalizeBill,
  splitBillAmount,
  livingItemChanges,
  livingOverrideRow,
  canClaimOnAccount,
  claimAccountFor,
  linkAccountsToEmail,
  autoLinkOwnerEmails,
  AUTO_KIND_NOTICE,
  rulesToAutoKind,
  repairAllowanceAutoRules,
  migrateAllowanceRows,
  claimOwnerAccounts,
  unlinkedOwnerNames,
  memberName,
  moveCategoryTo as moveCategoryToDomain,
  orderedCategories,
  categoryUseScores,
  setHiddenRows,
  planCategoryMerge,
  applyMergeRows,
  type CategoryMergeRows,
  mergeMembers,
  type MemberSelf,
  type SharingList,
  claimPayers as claimPayersDomain,
  claimTransferId,
  claimLoanTransferId,
  claimLoanMemo,
  claimLoanMovedFrom,
  isLoanRepayId,
  isLoanTransferId,
  isReservoirEventExpense,
  computeSettlement,
  settleRefusal,
  expenseLoanTransferId,
  followLoanTransfers,
  loanCandidates as loanCandidatesDomain,
  loanRepayId,
  compareMonth,
  computeClaimDue,
  computeLiving,
  dateInMonth,
  decideMonthEnd as decideMonthEndDomain,
  judgeEvent,
  judgeLiving,
  isClaimExpense,
  isClaimSettled,
  isMonthActive,
  monthOf,
  isValidMonth,
  newId,
  nextEventDate,
  seriesBaseId,
  nextOccurrenceId,
  pendingAllowanceIncome,
  pendingAutoRecords,
  pendingClaims,
  pendingMonthEnd as pendingMonthEndDomain,
  projectEventAccount,
  pendingSnapshot,
  suggestShortageFixes,
  summarizeClaims,
  toISODate,
  tripStatuses,
  validateTrip,
  cleanTripItems,
  isTripItem,
  planImport,
  applyImportPlan,
  IMPORT_TABLES,
  livingByAccount,
  myLivingAccountId,
  spenderOptions,
  mySpenderKey,
  conflictingRemainderRule,
  isRemainderRule,
  nextBudgetMonth,
  nextMonthCopy,
  nextMonthReset,
  splitFixedRow,
  splitMonthRow,
  type BudgetTable,
  type NextMonthWrites,
} from '@/domain';
import type {
  Account,
  AllocationRule,
  Category,
  Expense,
  FixedExpense,
  Id,
  IncomePlan,
  ISODate,
  LedgerData,
  LivingStatus,
  Member,
  PlannedEvent,
  Transfer,
  Trip,
  Won,
  YearMonth,
} from '@/domain/types';
import { isGoogleError } from '@/google/errors';
import { StorageError } from '@/storage/sheets';
import type { LedgerRef, LedgerRepository, TableName, TableRows } from '@/storage/types';
import { isRefreshHeld, onRefreshGateChange } from '@/ui/refreshGate';
import { useSession, useSessionInternals } from './session';
import type { ImportFile } from '@/domain/importFile';
import type { LedgerApi, NewEvent, NewExpense, NewInstallment, NewTrip, RowSnapshot } from './types';

/* ---------- 순수 도우미 ---------- */

function koreanMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && /[가-힣]/.test(e.message)) return e.message;
  return fallback;
}

/** 구글 토큰을 조용히 받지 못했거나(팝업 차단 · 창 닫힘 · 시간 초과) 토큰이 거절된(401) 오류 → '구글 다시 연결' 필요 */
function isReconnectError(e: unknown): boolean {
  if (isGoogleError(e)) {
    return ['popup_blocked', 'popup_closed', 'not_signed_in', 'timeout', 'account_mismatch'].includes(e.code);
  }
  return e instanceof StorageError && e.status === 401;
}

const RECONNECT_MESSAGE = '구글 연결이 끊겼어요. 아래 버튼으로 다시 연결해 주세요';
/** 열 때 통장 주인을 멤버와 이었을 때 한 번 보여 주는 알림 (PLAN 4-8) */
const OWNER_LINK_NOTICE = '통장 주인을 멤버와 이었어요';
/** 시트를 못 읽어 보관한 내용을 보여 줄 때 (읽기 전용) */
export const OFFLINE_MESSAGE = '연결이 안 돼서 마지막으로 맞춘 내용을 보여 줘요';
/** 연결이 안 된 동안 쓰기를 막을 때 */
export const OFFLINE_WRITE_MESSAGE = '연결되면 다시 시도해 주세요';
/** 다시 보거나 창으로 돌아왔을 때 자동 새로고침 간격 (최소) */
export const AUTO_REFRESH_MS = 60_000;

/** 연결 자체가 안 된 실패 (인터넷 끊김) */
function isNetworkFailure(e: unknown): boolean {
  if (e instanceof StorageError) return e.status === 0;
  if (e instanceof TypeError) return true;
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

type Keyed = { id: string } | { month: string } | { email: string };
function keyOfRow(row: Keyed): string {
  if ('id' in row) return row.id;
  if ('month' in row) return row.month;
  return row.email.toLowerCase();
}

/** 같은 키는 교체, 없으면 뒤에 추가 */
function upsertIn<T extends Keyed>(list: T[], row: T): T[] {
  const k = keyOfRow(row);
  const i = list.findIndex((r) => keyOfRow(r) === k);
  if (i < 0) return [...list, row];
  const next = list.slice();
  next[i] = row;
  return next;
}

/** 같은 키가 없을 때만 추가 (repository.insert 와 같은 규칙) */
function insertIn<T extends Keyed>(list: T[], rows: T[]): T[] {
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
function claimWhat(d: LedgerData, e: Expense): string {
  const cat = e.categoryId ? d.categories.find((x) => x.id === e.categoryId)?.name : undefined;
  return e.memo.trim() || cat || '지출';
}

function sortedActive<T extends { deleted: boolean; order: number }>(list: T[]): T[] {
  return list.filter((x) => !x.deleted).sort((a, b) => a.order - b.order);
}

function nextOrder(list: { order: number }[]): number {
  return list.reduce((m, x) => Math.max(m, x.order), -1) + 1;
}

/** 반복 일정의 다음 회차 행 (기준 일 유지, 결정적 id). 반복이 아니면 null */
function nextOccurrenceRow(ev: PlannedEvent, events: PlannedEvent[], s: { author: string; createdAt: string; updatedAt: string }): PlannedEvent | null {
  const nextDate = nextEventDate(events, ev);
  if (!nextDate) return null;
  return { ...ev, id: nextOccurrenceId(ev, nextDate), date: nextDate, status: 'planned', ...s, deleted: false };
}

/**
 * 완료·취소 때 써야 할 다음 회차 행. 이미 살아 있는 같은 행이 있으면(재시도 등) 손대지 않도록 null,
 * 지워진 행이면(되돌리기 뒤 다시 취소) 되살린다
 */
function nextToWrite(ev: PlannedEvent, events: PlannedEvent[], s: { author: string; createdAt: string; updatedAt: string }): PlannedEvent | null {
  const next = nextOccurrenceRow(ev, events, s);
  if (!next) return null;
  const existing = events.find((e) => e.id === next.id);
  return existing && !existing.deleted ? null : next;
}

/** 적립액 변경으로 만든 다음 규칙의 결정적 id ('r' · 2027-01 → 'r@2027-01'). 다시 시도해도 같은 행 */
function successorRuleId(ruleId: Id, from: YearMonth): Id {
  const i = ruleId.indexOf('@');
  return `${i < 0 ? ruleId : ruleId.slice(0, i)}@${from}`;
}

/** 쓰기 기록 (불러오는 동안 생긴 쓰기를 불러온 데이터 위에 다시 얹기 위해) */
interface PendingWrite {
  apply: (d: LedgerData) => LedgerData;
  /** 저장이 끝난 시점 (clock). 아직 저장 중이면 null */
  doneAt: number | null;
}

function msUntilNextMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

/* ---------- 컨텍스트 ---------- */

interface SyncMeta {
  /** 시트와 마지막으로 맞춘 시각 (ISO). 보관한 내용이면 보관할 때 시각 */
  syncedAt: string | null;
  /** 지금 보이는 데이터가 보관한 내용(아직 시트에서 못 읽음)인지 */
  fromCache: boolean;
  /** 시트를 못 읽어 보관한 내용을 읽기 전용으로 보여 주는 중 */
  offline: boolean;
}

interface LoadedState extends SyncMeta {
  repo: LedgerRepository;
  status: 'ready' | 'error';
  error: string | null;
  data: LedgerData | null;
  needsReconnect?: boolean;
}

const NO_SYNC: SyncMeta = { syncedAt: null, fromCache: false, offline: false };

const LedgerContext = createContext<LedgerApi | null>(null);

export function LedgerProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const { deps, backendFor, updateRecent } = useSessionInternals();
  const author = session.user?.email ?? 'demo';
  const ref = session.status === 'signedIn' ? session.activeLedger : null;
  /** 구글로 로그인한 나 (멤버에 언제나 넣어요). 체험 모드는 null — 체험 멤버는 그대로 */
  const self: MemberSelf | null =
    session.mode === 'google' && session.user ? { email: session.user.email, name: session.user.name } : null;

  const [loaded, setLoaded] = useState<LoadedState | null>(null);
  const [savingCount, setSavingCount] = useState(0);
  const [loadingCount, setLoadingCount] = useState(0);
  /** 열 때 시트를 고쳤으면 한 번씩 보여 줄 알림들 ('통장 주인을 멤버와 이었어요'). 앞에서부터 하나씩 */
  const [notices, setNotices] = useState<string[]>([]);
  const notice = notices[0] ?? null;
  const setNotice = useCallback((text: string) => setNotices((list) => (list.includes(text) ? list : [...list, text])), []);
  const [today, setToday] = useState<ISODate>(() => toISODate(deps.now()));

  const refKey = ref ? `${ref.source}:${ref.id}` : null;
  const repository = useMemo<LedgerRepository | null>(
    () => (ref ? backendFor(ref).open(ref) : null),
    // ref 객체가 이름만 바뀌어도 다시 열지 않도록 키로 비교
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refKey, backendFor],
  );
  const repoRef = useRef(repository);
  const todayRef = useRef(today);
  const authorRef = useRef(author);
  const selfRef = useRef(self);
  /** 보관(캐시)할 계정: 구글 로그인일 때만. 체험 · 브라우저 저장 가계부는 보관하지 않아요 */
  const cacheEmail = session.mode === 'google' ? (session.user?.email ?? null) : null;
  const cacheEmailRef = useRef(cacheEmail);
  /** 지금 가계부의 동기화 상태 (핸들러용) */
  const syncRef = useRef<SyncMeta>(NO_SYNC);
  /** 마지막 불러오기 실패 (아직 보이는 데이터가 없을 때 보관한 내용이 늦게 오면 씀) */
  const lastFailure = useRef<{ reconnect: boolean; network: boolean } | null>(null);
  /** 마지막 불러오기를 시작한 시각 (ms, 자동 새로고침 간격) */
  const lastLoadAt = useRef(0);
  /** 마지막 불러오기에서 공유 목록을 읽었는지 (공유 목록 새로고침 결과) */
  const sharingRef = useRef<'synced' | 'unavailable'>('unavailable');
  const dataRef = useRef<{ repo: LedgerRepository; data: LedgerData } | null>(null);
  const loadToken = useRef(0);
  /** 쓰기·불러오기 순서를 재는 시계와, 아직 불러온 데이터에 들어 있지 않을 수 있는 쓰기 목록 */
  const clock = useRef(0);
  const writes = useRef<PendingWrite[]>([]);
  // 핸들러가 최신 값을 읽도록 (아래 effect 들보다 먼저 선언)
  useEffect(() => {
    repoRef.current = repository;
    todayRef.current = today;
    authorRef.current = author;
    selfRef.current = self;
    cacheEmailRef.current = cacheEmail;
  });

  const current = repository && loaded && loaded.repo === repository ? loaded : null;
  const status: LedgerApi['status'] = !repository ? 'idle' : current ? current.status : 'loading';
  const data = current?.data ?? null;
  const error = current?.error ?? null;
  const needsReconnect = current?.needsReconnect ?? false;
  const syncedAt = current?.syncedAt ?? null;
  const fromCache = current?.fromCache ?? false;
  const offline = current?.offline ?? false;

  /** 현재 가계부의 데이터 교체 (화면 + 핸들러용 ref). meta 를 주지 않으면 동기화 상태는 그대로 */
  const setDataBoth = useCallback((d: LedgerData, meta?: SyncMeta) => {
    const repo = repoRef.current;
    if (!repo) return;
    dataRef.current = { repo, data: d };
    const next = meta ?? syncRef.current;
    syncRef.current = next;
    setLoaded({ repo, status: 'ready', error: next.offline ? OFFLINE_MESSAGE : null, data: d, ...next });
  }, []);

  const nowIso = useCallback(() => deps.now().toISOString(), [deps]);

  /**
   * 시트와 맞춘 데이터를 보관해요 (구글 시트 가계부만). 아직 저장 중인 쓰기가 있으면 건너뛰어요
   * (그 쓰기가 끝날 때 보관해요. 실패할 수 있는 쓰기가 보관되지 않게)
   */
  const saveCache = useCallback(
    (repo: LedgerRepository, d: LedgerData, at: string | null) => {
      const cache = deps.cache;
      const email = cacheEmailRef.current;
      if (!cache || !email || !at || repo.ref.source !== 'sheets') return;
      if (writes.current.some((w) => w.doneAt === null)) return;
      void cache.write(email, repo.ref.id, d, at);
    },
    [deps],
  );

  /**
   * loadStart 시점에 시작한 불러오기 결과 위에, 그 뒤에 끝났거나 아직 저장 중인 쓰기를 다시 얹는다.
   * (불러오는 동안 기록한 지출이 화면에서 사라지지 않게. 쓰기는 키로 교체·추가라 두 번 얹어도 같다)
   */
  const withPendingWrites = useCallback((d: LedgerData, loadStart: number): LedgerData => {
    const keep = writes.current.filter((w) => w.doneAt === null || w.doneAt > loadStart);
    writes.current = keep;
    return keep.reduce((acc, w) => w.apply(acc), d);
  }, []);

  /** 자동 기록(배분·고정 지출·용돈 수입)을 만들고 최신 데이터 반환 */
  const syncAutoRecords = useCallback(
    async (repo: LedgerRepository, loaded: LedgerData, day: ISODate): Promise<LedgerData> => {
      const now = nowIso();
      const who = authorRef.current;
      let merged = loaded;
      let wrote = false;
      const auto = pendingAutoRecords(loaded, day, who, now);
      try {
        if (auto.transfers.length) {
          await repo.insert('transfers', auto.transfers);
          wrote = true;
        }
        if (auto.expenses.length) {
          await repo.insert('expenses', auto.expenses);
          wrote = true;
        }
      } catch {
        // 쓰기 실패해도 화면에는 반영 (다음 접속 때 다시 시도, id 가 같아 중복 없음)
      }
      merged = {
        ...merged,
        transfers: insertIn(merged.transfers, auto.transfers),
        expenses: insertIn(merged.expenses, auto.expenses),
      };

      const sharedId = loaded.settings.kind === 'personal' ? loaded.settings.sharedLedgerId : null;
      if (sharedId) {
        try {
          const sharedRef: LedgerRef = {
            id: sharedId,
            name: '',
            kind: 'shared',
            source: sharedId.startsWith('local:') ? 'local' : 'sheets',
          };
          const shared = await backendFor(sharedRef).open(sharedRef).load();
          const income = pendingAllowanceIncome(merged, shared, sharedId, who, day, now);
          if (income.length) {
            try {
              await repo.insert('transfers', income);
              wrote = true;
            } catch {
              // 무시
            }
            merged = { ...merged, transfers: insertIn(merged.transfers, income) };
          }
        } catch {
          // 공용 가계부를 못 읽으면 용돈 자동 기록만 건너뛴다
        }
      }

      if (wrote) {
        try {
          const fresh = await repo.load();
          // 다른 사람이 동시에 쓴 행까지 합친다
          return {
            ...fresh,
            transfers: insertIn(fresh.transfers, merged.transfers),
            expenses: insertIn(fresh.expenses, merged.expenses),
          };
        } catch {
          return merged;
        }
      }
      return merged;
    },
    [backendFor, nowIso],
  );

  /**
   * 멤버를 구글 시트 공유 목록 · 로그인한 나에 맞춘다 (PLAN 4-8). 구글 시트 가계부만.
   * 공유 목록을 못 읽으면(보기 · 댓글 권한 403, 연결 오류) 나만 확인하고, 바뀐 행이 있을 때만 한 번에 쓴다.
   * 쓰기가 실패해도(보기 권한) 화면에는 합친 멤버를 보여 준다
   */
  const syncMembers = useCallback(
    async (repo: LedgerRepository, loaded: LedgerData): Promise<LedgerData> => {
      sharingRef.current = 'unavailable';
      if (repo.ref.source !== 'sheets') return loaded;
      const me = selfRef.current;
      const backend = backendFor(repo.ref);
      let sharing: SharingList | null = null;
      if (backend.listSharing) {
        try {
          sharing = await backend.listSharing(repo.ref);
          sharingRef.current = 'synced';
        } catch {
          sharing = null;
        }
      }
      const merged = mergeMembers(loaded.members, sharing, me);
      let next = loaded;
      if (merged.changed.length > 0) {
        try {
          await repo.upsertMany('members', merged.changed);
        } catch {
          // 다음에 열 때 다시 맞춘다
        }
        next = { ...next, members: merged.members };
      }
      // 기존 시트 자동 고치기: 주인 이름만 있는 통장을 이름이 맞는 멤버의 이메일과 이어요 (다시 해도 같음, 행은 지우지 않음)
      const linked = autoLinkOwnerEmails(next.accounts, next.members);
      if (linked.length > 0) {
        const byId = new Map(linked.map((a) => [a.id, a]));
        next = { ...next, accounts: next.accounts.map((a) => byId.get(a.id) ?? a) };
        try {
          await repo.upsertMany('accounts', linked);
          setNotice(OWNER_LINK_NOTICE);
        } catch {
          // 보기 권한 등: 화면에서만 잇고, 다음에 열 때 다시 써 봐요
        }
      }
      return next;
    },
    [backendFor, setNotice],
  );

  /**
   * 기존 시트 자동 고치기 (PLAN 4-7): 지난 고치기가 '알아서 맞추기'로 바꾼 용돈 배분을 다시 '매달 같은 금액'으로 써요.
   * 금액은 바뀌기 전 마지막 자동 기록 → 나뉜 규칙 · 예전 용돈 행 → 그 통장 고정비 합(확인 필요). 구글 시트 가계부만,
   * 다시 해도 같고(고칠 게 없으면 쓰지 않음), 쓰기에 성공했을 때만 한 번 알려요
   */
  const repairAllowanceRules = useCallback(
    async (repo: LedgerRepository, loaded: LedgerData, today: ISODate): Promise<LedgerData> => {
      if (repo.ref.source !== 'sheets') return loaded;
      const fixed = repairAllowanceAutoRules(loaded, today);
      if (fixed.rules.length === 0) return loaded;
      try {
        await repo.upsertMany('rules', fixed.rules);
      } catch {
        return loaded;
      }
      if (fixed.notice) setNotice(fixed.notice);
      const byId = new Map(fixed.rules.map((r) => [r.id, r]));
      return { ...loaded, rules: loaded.rules.map((r) => byId.get(r.id) ?? r) };
    },
    [setNotice],
  );

  /**
   * 기존 시트 자동 고치기 (PLAN 4-15): 생활비 통장으로 가는 '매달 같은 금액' 배분을 '알아서 맞추기'로 한 번에 써요 (용돈 통장은 건드리지 않아요).
   * 구글 시트 가계부만. 다시 해도 같고(바꿀 게 없으면 쓰지 않음), 쓰기에 성공했을 때만 한 번 알려요
   */
  const migrateRuleKinds = useCallback(
    async (repo: LedgerRepository, loaded: LedgerData, today: ISODate): Promise<LedgerData> => {
      if (repo.ref.source !== 'sheets') return loaded;
      const changed = rulesToAutoKind(loaded, today);
      if (changed.length === 0) return loaded;
      try {
        await repo.upsertMany('rules', changed);
      } catch {
        // 보기 권한 등: 그대로 두고 다음에 열 때 다시 써 봐요
        return loaded;
      }
      setNotice(AUTO_KIND_NOTICE);
      const byId = new Map(changed.map((r) => [r.id, r]));
      return { ...loaded, rules: loaded.rules.map((r) => byId.get(r.id) ?? r) };
    },
    [setNotice],
  );

  /**
   * 기존 시트 자동 고치기 (8-2): 예전 '용돈' 고정지출 행을 용돈 통장으로 가는 배분 또는 일반 고정비로 옮겨요.
   * 구글 시트 가계부만. 배분 → 고정지출 순서로 한 번에 쓰고(다시 해도 같음), 다 썼을 때만 한 번 알려요
   */
  const migrateAllowances = useCallback(
    async (repo: LedgerRepository, loaded: LedgerData): Promise<LedgerData> => {
      if (repo.ref.source !== 'sheets') return loaded;
      const moved = migrateAllowanceRows(loaded);
      if (moved.fixedExpenses.length === 0) return loaded;
      let next = loaded;
      try {
        if (moved.rules.length > 0) {
          await repo.upsertMany('rules', moved.rules);
          const ids = new Set(moved.rules.map((r) => r.id));
          next = { ...next, rules: [...next.rules.filter((r) => !ids.has(r.id)), ...moved.rules] };
        }
        await repo.upsertMany('fixedExpenses', moved.fixedExpenses);
      } catch {
        // 보기 권한 등: 그대로 두고 다음에 열 때 다시 써 봐요 (배분 id 가 정해져 있어 두 번 생기지 않아요)
        return loaded;
      }
      const byId = new Map(moved.fixedExpenses.map((f) => [f.id, f]));
      if (moved.notice) setNotice(moved.notice);
      return { ...next, fixedExpenses: next.fixedExpenses.map((f) => byId.get(f.id) ?? f) };
    },
    [setNotice],
  );

  /** 예측 기록을 쓰는 중이거나 쓴 (가계부:달). 같은 달을 두 번 쓰지 않게 */
  const snapshotKeys = useRef(new Set<string>());

  /**
   * 예측 기록 (PLAN 4-2 · 5장 예측기록): 구글 시트 가계부를 불러온 뒤, 이번 달 기록이 없으면 이번 달 + 다음 11개월 예측을 써요.
   * 화면을 기다리게 하지 않아요 (불러오기가 끝난 뒤 따로). 이미 있으면 쓰지 않고(그달 처음 것이 기록), 실패하면 조용히 남기고 다음에 열 때 다시 써요
   */
  const saveForecastSnapshot = useCallback(
    (repo: LedgerRepository, loaded: LedgerData, day: ISODate) => {
      if (repo.ref.source !== 'sheets') return;
      const key = `${repo.ref.id}:${monthOf(day)}`;
      if (snapshotKeys.current.has(key)) return;
      const rows = pendingSnapshot(loaded, projectEventAccount(loaded, day), day, nowIso());
      if (rows.length === 0) return;
      snapshotKeys.current.add(key);
      const entry: PendingWrite = { apply: (d) => ({ ...d, forecasts: insertIn(d.forecasts ?? [], rows) }), doneAt: null };
      void repo
        .insert('forecasts', rows)
        .then(() => {
          entry.doneAt = ++clock.current;
          writes.current.push(entry);
          const shown = dataRef.current;
          if (!shown || shown.repo !== repo || repoRef.current !== repo) return;
          const next = entry.apply(shown.data);
          setDataBoth(next);
          saveCache(repo, next, syncRef.current.syncedAt);
        })
        .catch((e: unknown) => {
          snapshotKeys.current.delete(key);
          console.warn('예측 기록을 남기지 못했어요', e);
        });
    },
    [nowIso, setDataBoth, saveCache],
  );

  const loadAll = useCallback(async () => {
    const repo = repoRef.current;
    if (!repo) return;
    const token = ++loadToken.current;
    const loadStart = ++clock.current;
    lastLoadAt.current = deps.now().getTime();
    setLoadingCount((n) => n + 1);
    try {
      const members = await syncMembers(repo, await repo.load());
      const moved = await migrateAllowances(repo, members);
      const repaired = await repairAllowanceRules(repo, moved, todayRef.current);
      const fresh = await migrateRuleKinds(repo, repaired, todayRef.current);
      const synced = await syncAutoRecords(repo, fresh, todayRef.current);
      if (token !== loadToken.current || repo !== repoRef.current) return;
      const merged = withPendingWrites(synced, loadStart);
      const at = nowIso();
      lastFailure.current = null;
      setDataBoth(merged, { syncedAt: at, fromCache: false, offline: false });
      saveCache(repo, merged, at);
      saveForecastSnapshot(repo, merged, todayRef.current);
    } catch (e) {
      if (token !== loadToken.current || repo !== repoRef.current) return;
      const reconnect = isReconnectError(e);
      const network = isNetworkFailure(e);
      lastFailure.current = { reconnect, network };
      const prev = dataRef.current?.repo === repo ? dataRef.current.data : null;
      // 보관한 내용만 보이는 채로 시트를 못 읽었거나 인터넷이 끊겼으면 읽기 전용으로 보여 줘요
      const isOffline = !!prev && ((!reconnect && syncRef.current.fromCache) || network);
      const meta: SyncMeta = { ...syncRef.current, offline: isOffline };
      syncRef.current = meta;
      const message = isOffline
        ? OFFLINE_MESSAGE
        : reconnect
          ? RECONNECT_MESSAGE
          : koreanMessage(e, '가계부를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요');
      // 이미 보이는 데이터가 있으면 그대로 두고 오류만 알린다
      setLoaded({ repo, status: prev ? 'ready' : 'error', error: message, data: prev, needsReconnect: reconnect, ...meta });
    } finally {
      setLoadingCount((n) => n - 1);
    }
  }, [deps, nowIso, saveCache, setDataBoth, syncMembers, migrateAllowances, repairAllowanceRules, migrateRuleKinds, syncAutoRecords, withPendingWrites, saveForecastSnapshot]);
  const loadAllRef = useRef(loadAll);
  useEffect(() => {
    loadAllRef.current = loadAll;
  });

  // 가계부가 바뀌면 다시 읽기
  useEffect(() => {
    dataRef.current = null;
    writes.current = [];
    syncRef.current = NO_SYNC;
    lastFailure.current = null;
    if (!repository) {
      loadToken.current++;
      return;
    }
    // 보관한 내용이 있으면 먼저 그려요 (맞추는 중). 시트에서 먼저 읽혔으면 쓰지 않아요
    const cache = deps.cache;
    const email = cacheEmailRef.current;
    if (cache && email && repository.ref.source === 'sheets') {
      const repo = repository;
      void cache.read(email, repo.ref.id).then((hit) => {
        if (!hit || repoRef.current !== repo || dataRef.current !== null) return;
        const failed = lastFailure.current;
        const isOffline = !!failed && (!failed.reconnect || failed.network);
        setDataBoth(hit.data, { syncedAt: hit.savedAt, fromCache: true, offline: isOffline });
        if (failed && !isOffline) {
          // 구글 다시 연결이 필요해요: 보관한 내용은 보여 주고 연결 안내는 그대로
          setLoaded((prev) => (prev && prev.repo === repo ? { ...prev, error: RECONNECT_MESSAGE, needsReconnect: true } : prev));
        }
      });
    }
    void loadAll();
  }, [repository, loadAll, deps, setDataBoth]);

  /**
   * 다시 보거나 창으로 돌아왔을 때 자동 새로고침: 1분에 한 번까지. 창 · 시트가 열려 있거나 입력 중이면
   * 미뤄 두고, 닫히면 해요
   */
  const deferredRefresh = useRef(false);
  const autoRefresh = useCallback(
    (opts?: { ignoreInterval?: boolean }) => {
      if (!repoRef.current || dataRef.current?.repo !== repoRef.current) return;
      if (!opts?.ignoreInterval && deps.now().getTime() - lastLoadAt.current < AUTO_REFRESH_MS) return;
      if (isRefreshHeld()) {
        deferredRefresh.current = true;
        return;
      }
      deferredRefresh.current = false;
      void loadAllRef.current();
    },
    [deps],
  );
  useEffect(
    () =>
      onRefreshGateChange(() => {
        if (deferredRefresh.current && !isRefreshHeld()) autoRefresh({ ignoreInterval: true });
      }),
    [autoRefresh],
  );

  // 날짜 바뀜: 자정 / 창 포커스 (날짜가 그대로면 자동 새로고침)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const updateDay = () => {
      const d = toISODate(deps.now());
      setToday((prev) => (prev === d ? prev : d));
    };
    const refresh = () => {
      const d = toISODate(deps.now());
      // 날짜가 바뀌었으면 아래 '날짜가 바뀌면' 효과가 다시 읽어요
      if (d !== todayRef.current) updateDay();
      else autoRefresh();
    };
    const onOnline = () => autoRefresh({ ignoreInterval: true });
    const schedule = () => {
      timer = setTimeout(() => {
        updateDay();
        schedule();
      }, msUntilNextMidnight(deps.now()));
    };
    schedule();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [deps, autoRefresh]);

  // 날짜가 바뀌면 새 자동 기록 확인 (화면은 그대로)
  const lastSyncedDay = useRef(today);
  useEffect(() => {
    if (lastSyncedDay.current === today) return;
    lastSyncedDay.current = today;
    if (status === 'ready') void loadAll();
  }, [today, status, loadAll]);

  /* ---------- 쓰기 공통 ---------- */

  const requireData = useCallback((): { repo: LedgerRepository; data: LedgerData } => {
    const repo = repoRef.current;
    const d = dataRef.current;
    if (!repo || !d || d.repo !== repo) throw new Error('가계부를 먼저 열어 주세요');
    return { repo, data: d.data };
  }, []);

  /** 연결이 안 돼 보관한 내용을 보여 주는 중이면 쓰기를 막아요 */
  const requireOnline = useCallback(() => {
    if (syncRef.current.offline) throw new Error(OFFLINE_WRITE_MESSAGE);
  }, []);

  /**
   * 화면에 먼저 반영하고 저장한다. 실패하면 되돌리고 한국어 오류를 던진다.
   * multiStep: 저장이 여러 번의 쓰기라 일부만 저장됐을 수 있으면 true → 실패 때 저장본을 다시 읽어 화면을 맞춘다
   */
  const mutate = useCallback(
    async (
      apply: (d: LedgerData) => LedgerData,
      persist: (repo: LedgerRepository) => Promise<void>,
      failMessage: string,
      opts?: { multiStep?: boolean },
    ): Promise<void> => {
      requireOnline();
      const { repo, data: before } = requireData();
      const optimistic = apply(before);
      const entry: PendingWrite = { apply, doneAt: null };
      writes.current.push(entry);
      setDataBoth(optimistic);
      setSavingCount((n) => n + 1);
      try {
        await persist(repo);
        entry.doneAt = ++clock.current;
        // 시트에 저장됐으면 보관한 내용도 바꿔요 (맞춘 시각은 마지막 불러오기 그대로)
        const shown = dataRef.current;
        if (shown && shown.repo === repo && repoRef.current === repo) saveCache(repo, shown.data, syncRef.current.syncedAt);
      } catch (e) {
        writes.current = writes.current.filter((w) => w !== entry);
        const untouched = dataRef.current?.data === optimistic;
        if (untouched) setDataBoth(before);
        // 일부만 저장됐거나 그사이 다른 변경이 있었으면 저장본으로 맞춘다
        if (opts?.multiStep || !untouched) void loadAll();
        throw new Error(koreanMessage(e, failMessage));
      } finally {
        setSavingCount((n) => n - 1);
      }
    },
    [requireOnline, requireData, setDataBoth, loadAll, saveCache],
  );

  const upsertRow = useCallback(
    <T extends TableName>(table: T, row: TableRows[T], failMessage: string) =>
      mutate(
        (d) => ({ ...d, [table]: upsertIn(d[table] as Keyed[], row as Keyed) }),
        (repo) => repo.upsert(table, row),
        failMessage,
      ),
    [mutate],
  );

  const insertRows = useCallback(
    <T extends TableName>(table: T, rows: TableRows[T][], failMessage: string) =>
      mutate(
        (d) => ({ ...d, [table]: insertIn(d[table] as Keyed[], rows as Keyed[]) }),
        (repo) => repo.insert(table, rows),
        failMessage,
      ),
    [mutate],
  );

  const stamp = useCallback(() => {
    const now = nowIso();
    return { author: authorRef.current, createdAt: now, updatedAt: now, deleted: false as const };
  }, [nowIso]);

  /* ---------- 계산값 ---------- */

  const activeAccounts = useMemo(() => (data ? sortedActive(data.accounts) : []), [data]);
  const activeCategories = useMemo(() => (data ? sortedActive(data.categories) : []), [data]);
  const pickableCategories = useMemo(() => activeCategories.filter((c) => c.hidden !== true), [activeCategories]);
  const categoryScores = useMemo(() => (data ? categoryUseScores(data.expenses, today) : new Map<Id, number>()), [data, today]);
  const accountByRole = useCallback(
    (role: Account['role']) => activeAccounts.find((a) => a.role === role) ?? null,
    [activeAccounts],
  );
  const incomeAccounts = useMemo(() => activeAccounts.filter((a) => a.role === 'income'), [activeAccounts]);
  const living = useMemo(() => (data ? computeLiving(data, today) : null), [data, today]);
  // 사람별 생활비 (PLAN 4-14): 생활비 통장마다, 로그인한 사람의 통장, '누가 썼나요?'에서 고를 사람
  const demo = session.mode === 'demo';
  const myLivingId = useMemo(
    () => (data ? myLivingAccountId(data, monthOf(today), author, { fallbackFirst: demo }) : null),
    [data, today, author, demo],
  );
  // 로그인한 사람(나)을 맨 앞(왼쪽)에, 나머지는 원래 순서대로
  const livingViews = useMemo(() => {
    const views = data ? livingByAccount(data, today) : [];
    return myLivingId ? [...views.filter((v) => v.accountId === myLivingId), ...views.filter((v) => v.accountId !== myLivingId)] : views;
  }, [data, today, myLivingId]);
  const spenders = useMemo(() => {
    const list = data ? spenderOptions(data, monthOf(today)) : [];
    return myLivingId
      ? [...list.filter((x) => x.livingAccountId === myLivingId), ...list.filter((x) => x.livingAccountId !== myLivingId)]
      : list;
  }, [data, today, myLivingId]);
  const mySpender = useMemo(() => mySpenderKey(spenders, author, myLivingId), [spenders, author, myLivingId]);
  const livingFor = useCallback<LedgerApi['livingFor']>(
    (accountId) => {
      if (!data) return null;
      // 통장이 하나면(예전 가계부) 합친 계산과 같다
      if (livingViews.length <= 1) return living;
      const id = accountId ?? myLivingId;
      const hit = livingViews.find((v) => v.accountId === id);
      if (hit) return hit.status;
      return id ? computeLiving(data, today, id) : living;
    },
    [data, today, living, livingViews, myLivingId],
  );
  // 로그인한 내가 어느 생활비 통장과도 이어지지 않았으면 고를 주인 이름 (홈 '누가 나인지 골라 주세요')
  const meChoices = useMemo(
    () => (data && !demo && !myLivingId && livingViews.length > 1 ? unlinkedOwnerNames(data) : []),
    [data, demo, myLivingId, livingViews.length],
  );
  const balances = useMemo(() => (data ? allBalances(data, today) : {}), [data, today]);
  const eventProjection = useMemo(() => (data ? projectEventAccount(data, today) : null), [data, today]);
  const shortageFix = useMemo(
    () =>
      data && eventProjection && eventProjection.shortages.length > 0
        ? suggestShortageFixes(data, today, eventProjection)
        : null,
    [data, today, eventProjection],
  );
  const pendingMonthEnd = useMemo(() => (data ? pendingMonthEndDomain(data, today) : null), [data, today]);
  const claims = useMemo(() => (data ? summarizeClaims(data, today) : null), [data, today]);
  const claimPayers = useMemo(() => (data ? claimPayersDomain(data) : []), [data]);
  const settlement = useMemo(
    () => (data && eventProjection?.accountId ? computeSettlement(data, today, eventProjection) : null),
    [data, today, eventProjection],
  );
  const loanCandidates = useMemo(() => (data ? loanCandidatesDomain(data) : []), [data]);
  const installments = useMemo(() => (data ? installmentPlans(data, today) : []), [data, today]);
  const trips = useMemo(() => (data ? tripStatuses(data, today) : []), [data, today]);
  const installmentHint = useCallback<LedgerApi['installmentHint']>(
    (amount, source, categoryId, opts) => {
      if (!data) return null;
      if (source === 'event') return judgeInstallment({ source: 'event', data, today, tripId: opts?.tripId ?? null }, amount);
      const living: LivingStatus | null = livingFor(opts?.livingAccountId);
      if (!living) return null;
      let cat: Id | null;
      if (categoryId === undefined) {
        const budgeted = living.items.filter((i) => !i.unbudgeted);
        if (budgeted.length !== 1) return null;
        cat = budgeted[0]!.categoryId;
      } else cat = categoryId;
      return judgeInstallment({ source: 'living', living, categoryId: cat }, amount);
    },
    [data, livingFor, today],
  );
  const previewClaimDue = useCallback<LedgerApi['previewClaimDue']>(
    (accountId, amount, expenseId) => {
      if (!data || !canClaimOnAccount(data, accountId)) return null;
      return computeClaimDue(data, { accountId, amount: Math.max(0, amount), expenseId }, today);
    },
    [data, today],
  );

  const judge = useCallback<LedgerApi['judge']>(
    (amount, source, categoryId, opts) => {
      if (!data) return null;
      if (source === 'living') {
        // 고른 사람의 생활비 예산으로 (기본: 나)
        const living = livingFor(opts?.livingAccountId);
        if (!living) return null;
        if (categoryId === undefined) {
          const budgeted = living.items.filter((i) => !i.unbudgeted);
          if (budgeted.length !== 1) return null;
          return judgeLiving(living, budgeted[0]!.categoryId, amount);
        }
        return judgeLiving(living, categoryId, amount);
      }
      return judgeEvent(data, today, amount, { tripId: opts?.tripId ?? null });
    },
    [data, livingFor, today],
  );

  const displayName = useCallback((email: string) => memberName(data, email), [data]);

  /* ---------- 지출 ---------- */

  /** 지출의 여행 칸. 여행 id 가 있으면 지우지 않은 여행인지 확인해요 (지금 묶인 여행은 지웠어도 그대로) */
  const tripFields = useCallback(
    (tripId: Id | null | undefined, tripItem: unknown, keep?: Id | null): Pick<Expense, 'tripId' | 'tripItem'> => {
      const id = tripId?.trim() || null;
      if (!id) return {};
      const t = requireData().data.trips.find((x) => x.id === id);
      if (!t || (t.deleted && id !== keep)) throw new Error('여행을 찾을 수 없어요. 여행을 다시 골라 주세요');
      return { tripId: id, tripItem: isTripItem(tripItem) ? tripItem : null };
    },
    [requireData],
  );

  const addExpense = useCallback(
    async (input: NewExpense): Promise<Expense> => {
      if (!(input.amount > 0)) throw new Error('금액을 입력해 주세요');
      const amount = Math.round(input.amount);
      const payer = input.paidBy?.trim() || null;
      let claim: Pick<Expense, 'paidBy' | 'claimAccountId' | 'claimDue'> = {};
      if (payer) {
        const { data: d } = requireData();
        if (!canClaimOnAccount(d, input.accountId)) {
          throw new Error('개인 돈으로 낸 지출은 이벤트통장 · 고정지출통장 · 저수지통장 중 하나에 기록해 주세요');
        }
        claim = {
          paidBy: payer,
          claimAccountId: claimAccountFor(d, payer),
          claimDue: computeClaimDue(d, { accountId: input.accountId, amount }, todayRef.current),
        };
      }
      const trip = tripFields(input.tripId, input.tripItem);
      // 일정과 여행은 하나만 (둘 다 묶으면 일정 남은 금액과 여행 남은 예산에서 두 번 빠진다)
      if (trip.tripId && input.eventId) throw new Error('일정과 여행 중 하나만 연결해 주세요');
      const row: Expense = {
        id: newId(),
        date: input.date,
        amount,
        accountId: input.accountId,
        categoryId: input.categoryId,
        memo: input.memo ?? '',
        eventId: input.eventId ?? null,
        fixedExpenseId: null,
        ...stamp(),
        ...claim,
        ...trip,
        ...(input.excluded ? { excluded: true } : {}),
      };
      await insertRows('expenses', [row], '지출을 기록하지 못했어요');
      return row;
    },
    [insertRows, stamp, requireData, tripFields],
  );

  const setExpenseExclusions = useCallback<LedgerApi['setExpenseExclusions']>(
    async (changes) => {
      const { data: d } = requireData();
      const at = nowIso();
      const rows: Expense[] = [];
      for (const c of changes) {
        const prev = d.expenses.find((e) => e.id === c.id && !e.deleted);
        if (!prev || (prev.excluded === true) === c.excluded) continue;
        const { excluded: _old, ...rest } = prev;
        rows.push({ ...rest, ...(c.excluded ? { excluded: true } : {}), updatedAt: at });
      }
      if (rows.length === 0) return 0;
      const byId = new Map(rows.map((r) => [r.id, r]));
      // 화면에 먼저 반영하고, 바뀐 행만 한 번에 저장해요. 실패하면 되돌려요
      await mutate(
        (cur) => ({ ...cur, expenses: cur.expenses.map((e) => byId.get(e.id) ?? e) }),
        (repo) => repo.upsertMany('expenses', rows),
        '예외 표시를 저장하지 못했어요',
      );
      return rows.length;
    },
    [requireData, mutate, nowIso],
  );

  /** 지출과 그 지출에 딸린 이체(돌려준 이체 claim:<지출id> · 빌린 이체 loan:…)를 함께 쓴다. 이체 먼저: 끊기면 다시 읽어 맞춘다 */
  const writeExpenseWith = useCallback(
    (expense: Expense, linked: Transfer[], failMessage: string) =>
      linked.length === 0
        ? upsertRow('expenses', expense, failMessage)
        : mutate(
            (x) => ({
              ...x,
              expenses: upsertIn(x.expenses, expense),
              transfers: linked.reduce((list, t) => upsertIn(list, t), x.transfers),
            }),
            async (repo) => {
              for (const t of linked) await repo.upsert('transfers', t);
              await repo.upsert('expenses', expense);
            },
            failMessage,
            { multiStep: true },
          ),
    [mutate, upsertRow],
  );

  /**
   * 고치기. 아직 돌려주지 않은 청구는 낸 사람 · 통장 · 금액이 바뀌면 돌려받을 통장과 정산일을 다시 정해요.
   * 낸 사람을 비우면 보통 지출이 돼요. 이미 돌려준 청구는 청구 칸을 그대로 둬요.
   * 저수지에서 빌린 이체(loan:<지출id> · loan:claim:<지출id>)는 금액 · 날짜를 따라 고치고, 지출을 지우거나 이벤트통장 밖으로 옮기면 지워요
   */
  const updateExpense = useCallback(
    async (expense: Expense) => {
      const { data: d } = requireData();
      const prev = d.expenses.find((e) => e.id === expense.id);
      let next: Expense = { ...expense, updatedAt: nowIso() };
      if (expense.tripId !== undefined || prev?.tripId) {
        const trip = tripFields(expense.tripId, expense.tripItem, prev?.tripId ?? null);
        next = { ...next, tripId: trip.tripId ?? null, tripItem: trip.tripItem ?? null };
      }
      // 일정과 여행은 하나만: 여행에 묶이면 일정 연결은 푼다 (예전 기록이 둘 다 가졌어도)
      if (next.tripId && next.eventId) next = { ...next, eventId: null };
      // 지웠던 지출을 되살리면, 함께 지웠던 이체(돌려준 이체 · 빌린 이체)도 되살린다 (deleteExpense 가 같은 시각으로 지운 것만)
      if (prev && prev.deleted && !next.deleted) {
        const ids = new Set([claimTransferId(prev.id), claimLoanTransferId(prev.id), expenseLoanTransferId(prev.id)]);
        const revived = d.transfers
          .filter((t) => ids.has(t.id) && t.deleted && t.updatedAt === prev.updatedAt)
          .map((t) => ({ ...t, deleted: false, updatedAt: next.updatedAt }));
        if (revived.length > 0) {
          if (isClaimExpense(prev)) {
            next = { ...next, paidBy: prev.paidBy, claimAccountId: prev.claimAccountId ?? null, claimDue: prev.claimDue ?? null };
          }
          await writeExpenseWith(next, revived, '지출을 고치지 못했어요');
          return;
        }
      }
      const linked: Transfer[] = [];
      const settle = prev ? d.transfers.find((t) => t.id === claimTransferId(prev.id)) : undefined;
      if (prev && isClaimExpense(prev) && isClaimSettled(d, prev.id)) {
        next = { ...next, paidBy: prev.paidBy, claimAccountId: prev.claimAccountId ?? null, claimDue: prev.claimDue ?? null };
        // 이미 돌려준 청구의 금액 · 통장을 바꾸면 돌려준 이체도 같이 고친다 (낸 사람 통장 · 함께 쓰는 통장 잔액이 어긋나지 않게)
        if (settle && (next.amount !== settle.amount || next.accountId !== settle.fromAccountId || next.deleted)) {
          if (!next.deleted && !canClaimOnAccount(d, next.accountId)) {
            throw new Error('돌려준 청구는 이벤트통장 · 고정지출통장 · 저수지통장으로만 옮길 수 있어요');
          }
          linked.push(
            next.deleted
              ? { ...settle, deleted: true, updatedAt: next.updatedAt }
              : { ...settle, amount: next.amount, fromAccountId: next.accountId, updatedAt: next.updatedAt },
          );
        }
      } else if (isClaimExpense(next)) {
        const payer = next.paidBy!.trim();
        const changed =
          !prev || !isClaimExpense(prev) || prev.paidBy?.trim() !== payer || prev.accountId !== next.accountId || prev.amount !== next.amount;
        if (changed) {
          if (!canClaimOnAccount(d, next.accountId)) {
            throw new Error('개인 돈으로 낸 지출은 이벤트통장 · 고정지출통장 · 저수지통장 중 하나에 기록해 주세요');
          }
          next = {
            ...next,
            paidBy: payer,
            claimAccountId: claimAccountFor(d, payer),
            claimDue: computeClaimDue(d, { accountId: next.accountId, amount: next.amount, expenseId: next.id }, todayRef.current),
          };
        }
      } else if (prev && isClaimExpense(prev)) {
        next = { ...next, paidBy: null, claimAccountId: null, claimDue: null };
      }
      if (prev) linked.push(...followLoanTransfers(d, next));
      await writeExpenseWith(next, linked, '지출을 고치지 못했어요');
    },
    [requireData, nowIso, tripFields, writeExpenseWith],
  );

  /* ---------- 청구 ---------- */

  const settleClaims = useCallback<LedgerApi['settleClaims']>(
    async (expenseIds, date) => {
      const { data: d } = requireData();
      const ids = new Set(expenseIds);
      const due = pendingClaims(d, todayRef.current).filter((c) => ids.has(c.expense.id));
      if (due.length === 0) return;
      // 이벤트통장에서 바로 주는 몫은 지급할 수 있는 돈 안에서만 (넘는 것은 [저수지에서 빌려 지급]으로)
      const current = computeSettlement(d, todayRef.current);
      const refusal = settleRefusal(d, current, due.map((c) => c.expense.id));
      if (refusal) throw new Error(refusal);
      const s = stamp();
      const day = date ?? todayRef.current;
      const rows: Transfer[] = due.map((c) => {
        const what = claimWhat(d, c.expense);
        return {
          id: claimTransferId(c.expense.id),
          date: day,
          kind: 'transfer',
          fromAccountId: c.accountId,
          toAccountId: c.claimAccountId,
          amount: c.amount,
          status: 'done',
          ruleId: null,
          memo: `${c.payer}에게 돌려줌 · ${what}`,
          ...s,
        };
      });
      // 늘 키로 덮어쓴다(없으면 추가). 다른 기기에서 돌려줬다 되돌린(지운) 행이 시트에 있을 수 있는데,
      // insert 는 같은 키를 건너뛰어 아무것도 쓰지 않은 채 돌려준 것처럼 보이기 때문이다
      await mutate(
        (x) => ({ ...x, transfers: rows.reduce((list, r) => upsertIn(list, r), x.transfers) }),
        async (repo) => {
          for (const r of rows) await repo.upsert('transfers', r);
        },
        '돌려준 기록을 저장하지 못했어요',
        { multiStep: rows.length > 1 },
      );
    },
    [requireData, stamp, mutate],
  );

  const unsettleClaims = useCallback<LedgerApi['unsettleClaims']>(
    async (expenseIds) => {
      const { data: d } = requireData();
      // 저수지에서 빌려 지급한 청구는 빌린 이체(loan:claim:<지출id>)도 함께 지운다
      const ids = new Set([...expenseIds.map(claimTransferId), ...expenseIds.map(claimLoanTransferId)]);
      const rows = d.transfers
        .filter((t) => ids.has(t.id) && !t.deleted)
        .map((t) => ({ ...t, deleted: true, updatedAt: nowIso() }));
      if (rows.length === 0) return;
      await mutate(
        (x) => ({ ...x, transfers: rows.reduce((list, r) => upsertIn(list, r), x.transfers) }),
        async (repo) => {
          for (const r of rows) await repo.upsert('transfers', r);
        },
        '되돌리지 못했어요',
        { multiStep: rows.length > 1 },
      );
    },
    [requireData, mutate, nowIso],
  );

  /** 지운 행을 되살릴 수 있게 늘 키로 덮어쓰며 이체 여러 개를 쓴다 (순서대로) */
  const upsertTransfers = useCallback(
    (rows: Transfer[], failMessage: string) =>
      mutate(
        (x) => ({ ...x, transfers: rows.reduce((list, r) => upsertIn(list, r), x.transfers) }),
        async (repo) => {
          for (const r of rows) await repo.upsert('transfers', r);
        },
        failMessage,
        { multiStep: rows.length > 1 },
      ),
    [mutate],
  );

  const borrowAndSettleClaims = useCallback<LedgerApi['borrowAndSettleClaims']>(
    async (expenseIds) => {
      const { data: d } = requireData();
      const reservoir = d.accounts.find((a) => !a.deleted && a.role === 'reservoir');
      if (!reservoir) throw new Error('저수지통장이 없어요');
      const ids = new Set(expenseIds);
      const due = pendingClaims(d, todayRef.current).filter((c) => ids.has(c.expense.id));
      if (due.length === 0) return;
      const s = stamp();
      const day = todayRef.current;
      const base = { date: day, kind: 'transfer' as const, status: 'done' as const, ruleId: null, ...s };
      // 빌린 이체를 먼저: 끊겨도 이벤트통장이 모자라지 않고, 다시 누르면 같은 키라 하나씩만 남는다
      const loans: Transfer[] = due.map((c) => ({
        ...base,
        id: claimLoanTransferId(c.expense.id),
        fromAccountId: reservoir.id,
        toAccountId: c.accountId,
        amount: c.amount,
        memo: `저수지에서 빌림 · ${c.payer}에게 돌려줌 · ${claimWhat(d, c.expense)}`,
      }));
      const settles: Transfer[] = due.map((c) => ({
        ...base,
        id: claimTransferId(c.expense.id),
        fromAccountId: c.accountId,
        toAccountId: c.claimAccountId,
        amount: c.amount,
        memo: `${c.payer}에게 돌려줌 · ${claimWhat(d, c.expense)}`,
      }));
      await upsertTransfers([...loans, ...settles], '저수지에서 빌린 기록을 저장하지 못했어요');
    },
    [requireData, stamp, upsertTransfers],
  );

  const repayLoan = useCallback<LedgerApi['repayLoan']>(
    async (amount) => {
      const { data: d } = requireData();
      const value = Math.round(amount);
      if (!(value > 0)) throw new Error('갚을 금액을 확인해 주세요');
      const event = d.accounts.find((a) => !a.deleted && a.role === 'event');
      const reservoir = d.accounts.find((a) => !a.deleted && a.role === 'reservoir');
      if (!event || !reservoir) throw new Error('이벤트통장과 저수지통장이 있어야 해요');
      const day = todayRef.current;
      const row: Transfer = {
        id: loanRepayId(monthOf(day)),
        date: day,
        kind: 'transfer',
        fromAccountId: event.id,
        toAccountId: reservoir.id,
        amount: value,
        status: 'done',
        ruleId: null,
        memo: '저수지에 갚음',
        ...stamp(),
      };
      await upsertTransfers([row], '갚은 기록을 저장하지 못했어요');
    },
    [requireData, stamp, upsertTransfers],
  );

  const undoRepayLoan = useCallback<LedgerApi['undoRepayLoan']>(async () => {
    const { data: d } = requireData();
    const id = loanRepayId(monthOf(todayRef.current));
    const row = d.transfers.find((t) => t.id === id && !t.deleted);
    if (!row) return;
    await upsertTransfers([{ ...row, deleted: true, updatedAt: nowIso() }], '되돌리지 못했어요');
  }, [requireData, upsertTransfers, nowIso]);

  /** 지출과 이체를 함께 쓴다 (expensesFirst: 지출 먼저). 끊기면 다시 읽어 맞춘다 */
  const writeExpensesAndTransfers = useCallback(
    (expenses: Expense[], transfers: Transfer[], failMessage: string, expensesFirst: boolean) =>
      mutate(
        (x) => ({
          ...x,
          expenses: expenses.reduce((list, r) => upsertIn(list, r), x.expenses),
          transfers: transfers.reduce((list, r) => upsertIn(list, r), x.transfers),
        }),
        async (repo) => {
          const writeE = async () => {
            for (const e of expenses) await repo.upsert('expenses', e);
          };
          const writeT = async () => {
            for (const t of transfers) await repo.upsert('transfers', t);
          };
          if (expensesFirst) {
            await writeE();
            await writeT();
          } else {
            await writeT();
            await writeE();
          }
        },
        failMessage,
        { multiStep: true },
      ),
    [mutate],
  );

  const convertToLoan = useCallback<LedgerApi['convertToLoan']>(
    async (expenseIds) => {
      const { data: d } = requireData();
      const event = d.accounts.find((a) => !a.deleted && a.role === 'event');
      if (!event) throw new Error('이벤트통장이 없어요');
      const ids = new Set(expenseIds);
      const rows = loanCandidatesDomain(d).filter((e) => ids.has(e.id));
      if (rows.length === 0) return;
      const s = stamp();
      const transfers: Transfer[] = rows.map((e) => ({
        id: expenseLoanTransferId(e.id),
        date: e.date,
        kind: 'transfer',
        fromAccountId: e.accountId,
        toAccountId: event.id,
        amount: e.amount,
        status: 'done',
        ruleId: null,
        memo: `저수지에서 빌림 · ${claimWhat(d, e)}`,
        ...s,
      }));
      const expenses: Expense[] = rows.map((e) => ({ ...e, accountId: event.id, updatedAt: s.updatedAt }));
      // 빌린 이체 먼저, 그다음 지출의 통장을 옮긴다
      await writeExpensesAndTransfers(expenses, transfers, '갚을 돈으로 바꾸지 못했어요', false);
    },
    [requireData, stamp, writeExpensesAndTransfers],
  );

  const unconvertLoan = useCallback<LedgerApi['unconvertLoan']>(
    async (expenseIds) => {
      const { data: d } = requireData();
      const updatedAt = nowIso();
      const transfers: Transfer[] = [];
      const expenses: Expense[] = [];
      for (const id of expenseIds) {
        const t = d.transfers.find((x) => x.id === expenseLoanTransferId(id) && !x.deleted);
        const e = d.expenses.find((x) => x.id === id);
        if (!t || !e || !t.fromAccountId) continue;
        transfers.push({ ...t, deleted: true, updatedAt });
        expenses.push({ ...e, accountId: t.fromAccountId, updatedAt });
      }
      if (transfers.length === 0) return;
      // 지출을 먼저 저수지로 되돌리고 빌린 이체를 지운다
      await writeExpensesAndTransfers(expenses, transfers, '되돌리지 못했어요', true);
    },
    [requireData, nowIso, writeExpensesAndTransfers],
  );

  /**
   * 저수지에서 빌려 지급 (저수지통장 이벤트 청구): 지출을 이벤트통장으로 옮긴 뒤 빌린 이체 loan:claim:<id>(저수지 → 이벤트통장)와
   * 돌려준 이체 claim:<id>(이벤트통장 → 낸 사람)를 남겨요. 지출을 먼저 옮겨서, 도중에 끊겨 다시 눌러도 같은 키로 하나씩만 남아요
   */
  const borrowReservoirClaims = useCallback<LedgerApi['borrowReservoirClaims']>(
    async (expenseIds) => {
      const { data: d } = requireData();
      const event = d.accounts.find((a) => !a.deleted && a.role === 'event');
      const reservoir = d.accounts.find((a) => !a.deleted && a.role === 'reservoir');
      if (!event || !reservoir) throw new Error('이벤트통장과 저수지통장이 있어야 해요');
      const ids = new Set(expenseIds);
      const due = pendingClaims(d, todayRef.current).filter(
        (c) => ids.has(c.expense.id) && (isReservoirEventExpense(d, c.expense) || c.expense.accountId === event.id),
      );
      if (due.length === 0) return;
      const s = stamp();
      const day = todayRef.current;
      const base = { date: day, kind: 'transfer' as const, status: 'done' as const, ruleId: null, ...s };
      const fromOf = (e: Expense) => (e.accountId === event.id ? reservoir.id : e.accountId);
      const transfers: Transfer[] = [
        ...due.map((c) => ({
          ...base,
          id: claimLoanTransferId(c.expense.id),
          fromAccountId: fromOf(c.expense),
          toAccountId: event.id,
          amount: c.amount,
          // 저수지 지출을 이벤트통장으로 옮기는 것만 표시해 둬요 ([지급 취소]가 지출을 저수지로 되돌릴 수 있게)
          memo: claimLoanMemo(`${c.payer}에게 돌려줌 · ${claimWhat(d, c.expense)}`, c.expense.accountId !== event.id),
        })),
        ...due.map((c) => ({
          ...base,
          id: claimTransferId(c.expense.id),
          fromAccountId: event.id,
          toAccountId: c.claimAccountId,
          amount: c.amount,
          memo: `${c.payer}에게 돌려줌 · ${claimWhat(d, c.expense)}`,
        })),
      ];
      const expenses: Expense[] = due
        .filter((c) => c.expense.accountId !== event.id)
        .map((c) => ({ ...c.expense, accountId: event.id, updatedAt: s.updatedAt }));
      await writeExpensesAndTransfers(expenses, transfers, '저수지에서 빌린 기록을 저장하지 못했어요', true);
    },
    [requireData, stamp, writeExpensesAndTransfers],
  );

  /**
   * 저수지에서 이미 돌려준 이벤트 청구를 갚을 돈으로 바꾸기: 지출 → 이벤트통장, 돌려준 이체 → 이벤트통장에서 나간 것,
   * 빌린 이체 loan:claim:<id>(저수지 → 이벤트통장, 돌려준 날) 추가. 잔액은 그대로이고 저수지에 갚을 돈만 늘어요
   */
  const convertSettledReservoirClaims = useCallback<LedgerApi['convertSettledReservoirClaims']>(
    async (expenseIds) => {
      const { data: d } = requireData();
      const event = d.accounts.find((a) => !a.deleted && a.role === 'event');
      if (!event) throw new Error('이벤트통장이 없어요');
      const live = (id: string) => d.transfers.find((t) => t.id === id && !t.deleted && t.status === 'done');
      const isReservoir = (id: Id | null) => !!id && d.accounts.some((a) => a.id === id && a.role === 'reservoir');
      const s = stamp();
      const expenses: Expense[] = [];
      const transfers: Transfer[] = [];
      for (const id of expenseIds) {
        const e = d.expenses.find((x) => x.id === id && !x.deleted);
        const settle = live(claimTransferId(id));
        if (!e || !settle) continue;
        const loan = live(claimLoanTransferId(id));
        const reservoirId = loan?.fromAccountId ?? (isReservoir(settle.fromAccountId) ? settle.fromAccountId : isReservoir(e.accountId) ? e.accountId : null);
        if (!reservoirId) continue;
        if (!loan) {
          transfers.push({
            ...settle,
            ...s,
            id: claimLoanTransferId(id),
            fromAccountId: reservoirId,
            toAccountId: event.id,
            memo: claimLoanMemo(settle.memo, e.accountId !== event.id),
          });
        }
        if (settle.fromAccountId !== event.id) transfers.push({ ...settle, fromAccountId: event.id, updatedAt: s.updatedAt });
        if (e.accountId !== event.id) expenses.push({ ...e, accountId: event.id, updatedAt: s.updatedAt });
      }
      if (expenses.length === 0 && transfers.length === 0) return;
      // 빌린 이체 먼저 (끊겨도 이벤트통장이 모자라지 않게), 그다음 돌려준 이체와 지출
      await writeExpensesAndTransfers(expenses, transfers, '저수지에 갚을 돈으로 바꾸지 못했어요', false);
    },
    [requireData, stamp, writeExpensesAndTransfers],
  );

  /**
   * 위 두 가지 되돌리기: 빌린 이체를 지우고 지출을 그 저수지통장으로 되돌려요.
   * mode='borrowed' 는 돌려준 이체도 지우고(아직 안 돌려준 청구로), 'converted' 는 돌려준 이체를 저수지에서 나간 것으로 되돌려요
   */
  const undoReservoirClaims = useCallback<LedgerApi['undoReservoirClaims']>(
    async (expenseIds, mode) => {
      const { data: d } = requireData();
      const updatedAt = nowIso();
      const expenses: Expense[] = [];
      const transfers: Transfer[] = [];
      for (const id of expenseIds) {
        const loan = d.transfers.find((t) => t.id === claimLoanTransferId(id) && !t.deleted);
        const settle = d.transfers.find((t) => t.id === claimTransferId(id) && !t.deleted);
        const e = d.expenses.find((x) => x.id === id);
        if (!loan || !loan.fromAccountId) continue;
        transfers.push({ ...loan, deleted: true, updatedAt });
        if (settle) {
          transfers.push(mode === 'borrowed' ? { ...settle, deleted: true, updatedAt } : { ...settle, fromAccountId: loan.fromAccountId, updatedAt });
        }
        if (e && e.accountId !== loan.fromAccountId) expenses.push({ ...e, accountId: loan.fromAccountId, updatedAt });
      }
      if (transfers.length === 0) return;
      await writeExpensesAndTransfers(expenses, transfers, '되돌리지 못했어요', true);
    },
    [requireData, nowIso, writeExpensesAndTransfers],
  );

  /* ---------- 지급한 기록 · 저수지 기록 고치기 (정산 화면) ---------- */

  /**
   * 지급 취소: 돌려준 이체 claim:<id> 와 (빌려 지급했으면) 빌린 이체 loan:claim:<id> 를 지우고, 빌려 지급할 때 저수지 지출을
   * 이벤트통장으로 옮겼으면 지출을 그 저수지로 되돌려요 → 다시 '줄 돈'. 이미 취소했으면 아무것도 하지 않아요. 바꾸기 전 행을 돌려줘요
   */
  const undoClaimPayments = useCallback<LedgerApi['undoClaimPayments']>(
    async (expenseIds) => {
      const { data: d } = requireData();
      const updatedAt = nowIso();
      const before: RowSnapshot = { expenses: [], transfers: [] };
      const expenses: Expense[] = [];
      const transfers: Transfer[] = [];
      for (const id of new Set(expenseIds)) {
        const settle = d.transfers.find((t) => t.id === claimTransferId(id) && !t.deleted);
        const loan = d.transfers.find((t) => t.id === claimLoanTransferId(id) && !t.deleted);
        if (!settle) continue;
        const movedFrom = claimLoanMovedFrom(d, id);
        const e = d.expenses.find((x) => x.id === id);
        if (movedFrom && e) {
          before.expenses.push(e);
          expenses.push({ ...e, accountId: movedFrom, updatedAt });
        }
        for (const t of loan ? [loan, settle] : [settle]) {
          before.transfers.push(t);
          transfers.push({ ...t, deleted: true, updatedAt });
        }
      }
      if (transfers.length === 0) return before;
      // 지출을 먼저 저수지로 되돌리고 이체를 지워요 (끊겨도 다시 누르면 남은 것만)
      await writeExpensesAndTransfers(expenses, transfers, '지급을 취소하지 못했어요', true);
      return before;
    },
    [requireData, nowIso, writeExpensesAndTransfers],
  );

  /**
   * 빌린 기록만 취소 (지급은 그대로): 빌린 이체 loan:claim:<id> 를 지워요. 저수지 지출을 옮겨 빌려 지급한 것이면
   * 지출과 돌려준 이체를 저수지로 되돌려 '저수지에서 지급'한 청구로 남겨요 (잔액이 어긋나지 않게)
   */
  const cancelClaimLoans = useCallback<LedgerApi['cancelClaimLoans']>(
    async (expenseIds) => {
      const { data: d } = requireData();
      const updatedAt = nowIso();
      const before: RowSnapshot = { expenses: [], transfers: [] };
      const expenses: Expense[] = [];
      const transfers: Transfer[] = [];
      for (const id of new Set(expenseIds)) {
        const loan = d.transfers.find((t) => t.id === claimLoanTransferId(id) && !t.deleted);
        if (!loan) continue;
        const movedFrom = claimLoanMovedFrom(d, id);
        before.transfers.push(loan);
        transfers.push({ ...loan, deleted: true, updatedAt });
        if (movedFrom) {
          const settle = d.transfers.find((t) => t.id === claimTransferId(id) && !t.deleted);
          if (settle && settle.fromAccountId !== movedFrom) {
            before.transfers.push(settle);
            transfers.push({ ...settle, fromAccountId: movedFrom, updatedAt });
          }
          const e = d.expenses.find((x) => x.id === id);
          if (e) {
            before.expenses.push(e);
            expenses.push({ ...e, accountId: movedFrom, updatedAt });
          }
        }
      }
      if (transfers.length === 0) return before;
      await writeExpensesAndTransfers(expenses, transfers, '빌린 기록을 취소하지 못했어요', true);
      return before;
    },
    [requireData, nowIso, writeExpensesAndTransfers],
  );

  /**
   * 빌린 · 갚은 이체 하나 취소: loanpay:<월> 은 갚은 기록을 지우고, loan:<지출id> 는 바꾸기를 되돌려요(지출 → 저수지).
   * loan:claim:<id> 는 cancelClaimLoans · undoClaimPayments 로 해요
   */
  const cancelLoanTransfer = useCallback<LedgerApi['cancelLoanTransfer']>(
    async (transferId) => {
      const { data: d } = requireData();
      const row = d.transfers.find((t) => t.id === transferId && !t.deleted);
      const before: RowSnapshot = { expenses: [], transfers: [] };
      if (!row) return before;
      const updatedAt = nowIso();
      if (isLoanRepayId(transferId)) {
        before.transfers.push(row);
        await upsertTransfers([{ ...row, deleted: true, updatedAt }], '갚은 기록을 취소하지 못했어요');
        return before;
      }
      if (transferId.startsWith('loan:claim:')) throw new Error('청구를 빌려 지급한 기록은 지급과 함께 정해 취소해 주세요');
      if (!isLoanTransferId(transferId)) throw new Error('저수지 기록이 아니에요');
      const e = d.expenses.find((x) => x.id === transferId.slice('loan:'.length));
      before.transfers.push(row);
      const expenses: Expense[] = [];
      if (e && row.fromAccountId && e.accountId !== row.fromAccountId) {
        before.expenses.push(e);
        expenses.push({ ...e, accountId: row.fromAccountId, updatedAt });
      }
      await writeExpensesAndTransfers(expenses, [{ ...row, deleted: true, updatedAt }], '되돌리지 못했어요', true);
      return before;
    },
    [requireData, nowIso, upsertTransfers, writeExpensesAndTransfers],
  );

  /** 빌린 · 갚은 이체(loan: · loanpay:)의 금액만 고쳐요 ('저수지에 갚을 돈' 셈). 청구 지급 · 지출은 그대로 */
  const updateLoanAmount = useCallback<LedgerApi['updateLoanAmount']>(
    async (transferId, amount) => {
      const { data: d } = requireData();
      if (!isLoanTransferId(transferId) && !isLoanRepayId(transferId)) throw new Error('저수지 기록이 아니에요');
      const value = Math.round(amount);
      if (!(value > 0)) throw new Error('금액을 확인해 주세요');
      const row = d.transfers.find((t) => t.id === transferId && !t.deleted);
      const before: RowSnapshot = { expenses: [], transfers: [] };
      if (!row) throw new Error('기록을 찾지 못했어요');
      if (row.amount === value) return before;
      before.transfers.push(row);
      await upsertTransfers([{ ...row, amount: value, updatedAt: nowIso() }], '금액을 고치지 못했어요');
      return before;
    },
    [requireData, nowIso, upsertTransfers],
  );

  /** 위 고치기 · 취소의 되돌리기: 바꾸기 전 행을 그대로 다시 써요 (이체 먼저) */
  const restoreRows = useCallback<LedgerApi['restoreRows']>(
    async (snapshot) => {
      if (snapshot.expenses.length === 0 && snapshot.transfers.length === 0) return;
      const updatedAt = nowIso();
      await writeExpensesAndTransfers(
        snapshot.expenses.map((e) => ({ ...e, updatedAt })),
        snapshot.transfers.map((t) => ({ ...t, updatedAt })),
        '되돌리지 못했어요',
        false,
      );
    },
    [nowIso, writeExpensesAndTransfers],
  );

  const saveSettleDay = useCallback<LedgerApi['saveSettleDay']>(
    async (day) => {
      const value = day !== null && Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
      await mutate(
        (d) => ({ ...d, settings: { ...d.settings, settleDay: value } }),
        (r) => r.updateSettings({ settleDay: value }),
        '정산일을 저장하지 못했어요',
      );
    },
    [mutate],
  );

  const saveDaysOff = useCallback<LedgerApi['saveDaysOff']>(
    async (days) => {
      const value = [...new Set(days.filter((d) => isValidDate(d)))].sort();
      await mutate(
        (d) => ({ ...d, settings: { ...d.settings, daysOff: value } }),
        (r) => r.updateSettings({ daysOff: value }),
        '쉬는 날을 저장하지 못했어요',
      );
    },
    [mutate],
  );

  const saveDismissedRecurring = useCallback<LedgerApi['saveDismissedRecurring']>(
    async (keys) => {
      const value = [...new Set(keys.map((k) => k.trim()).filter((k) => k && !k.includes(',')))].sort();
      await mutate(
        (d) => ({ ...d, settings: { ...d.settings, dismissedRecurring: value } }),
        (r) => r.updateSettings({ dismissedRecurring: value }),
        '숨긴 제안을 저장하지 못했어요',
      );
    },
    [mutate],
  );

  const deleteExpense = useCallback(
    async (id: Id) => {
      const d = requireData().data;
      const row = d.expenses.find((e) => e.id === id);
      if (!row) throw new Error('지출 기록을 찾을 수 없어요');
      const updatedAt = nowIso();
      const deleted: Expense = { ...row, deleted: true, updatedAt };
      // 지출을 지우면 딸린 이체(돌려준 이체 · 빌린 이체)도 같은 시각으로 지운다 (되살리면 함께 되살아난다)
      const ids = new Set([claimTransferId(row.id), claimLoanTransferId(row.id), expenseLoanTransferId(row.id)]);
      const linked = d.transfers.filter((t) => ids.has(t.id) && !t.deleted).map((t) => ({ ...t, deleted: true, updatedAt }));
      await writeExpenseWith(deleted, linked, '지출을 지우지 못했어요');
    },
    [requireData, nowIso, writeExpenseWith],
  );

  /* ---------- 여행 ---------- */

  const tripRow = useCallback((input: NewTrip): Pick<Trip, 'name' | 'startDate' | 'endDate' | 'budget' | 'items' | 'memo'> => {
    const err = validateTrip(input);
    if (err) throw new Error(err);
    return {
      name: input.name.trim(),
      startDate: input.startDate,
      endDate: input.endDate,
      budget: Math.max(0, Math.round(input.budget || 0)),
      items: cleanTripItems(input.items),
      memo: input.memo?.trim() ?? '',
    };
  }, []);

  const addTrip = useCallback<LedgerApi['addTrip']>(
    async (input) => {
      const row: Trip = { id: newId(), ...tripRow(input), ...stamp() };
      await insertRows('trips', [row], '여행을 추가하지 못했어요');
      return row;
    },
    [tripRow, stamp, insertRows],
  );

  const findTrip = useCallback(
    (id: Id): Trip => {
      const t = requireData().data.trips.find((x) => x.id === id);
      if (!t) throw new Error('여행을 찾을 수 없어요');
      return t;
    },
    [requireData],
  );

  const updateTrip = useCallback<LedgerApi['updateTrip']>(
    async (id, input) => {
      const t = findTrip(id);
      await upsertRow('trips', { ...t, ...tripRow(input), updatedAt: nowIso() }, '여행을 고치지 못했어요');
    },
    [findTrip, tripRow, upsertRow, nowIso],
  );

  const deleteTrip = useCallback<LedgerApi['deleteTrip']>(
    async (id) => {
      const t = findTrip(id);
      if (t.deleted) return;
      await upsertRow('trips', { ...t, deleted: true, updatedAt: nowIso() }, '여행을 지우지 못했어요');
    },
    [findTrip, upsertRow, nowIso],
  );

  const restoreTrip = useCallback<LedgerApi['restoreTrip']>(
    async (id) => {
      const t = findTrip(id);
      if (!t.deleted) return;
      await upsertRow('trips', { ...t, deleted: false, updatedAt: nowIso() }, '여행을 되살리지 못했어요');
    },
    [findTrip, upsertRow, nowIso],
  );

  /* ---------- 일정 ---------- */

  const findEvent = useCallback(
    (id: Id): PlannedEvent => {
      const ev = requireData().data.events.find((e) => e.id === id);
      if (!ev) throw new Error('일정을 찾을 수 없어요');
      return ev;
    },
    [requireData],
  );

  const addEvent = useCallback(
    async (input: NewEvent): Promise<PlannedEvent> => {
      if (!input.name.trim()) throw new Error('일정 이름을 입력해 주세요');
      if (!(input.amount >= 0)) throw new Error('금액을 확인해 주세요');
      const accountId =
        input.accountId ?? accountByRole('event')?.id ?? accountByRole('allowance')?.id ?? activeAccounts[0]?.id;
      if (!accountId) throw new Error('일정에 쓸 통장이 없어요. 통장을 먼저 만들어 주세요');
      const row: PlannedEvent = {
        id: newId(),
        date: input.date,
        name: input.name.trim(),
        amount: Math.round(input.amount),
        accountId,
        categoryId: input.categoryId ?? null,
        status: 'planned',
        repeat: input.repeat ?? 'none',
        memo: input.memo ?? '',
        ...stamp(),
        ...(input.lunar && (input.repeat ?? 'none') === 'yearly' ? { lunar: input.lunar } : {}),
      };
      await insertRows('events', [row], '일정을 추가하지 못했어요');
      return row;
    },
    [accountByRole, activeAccounts, insertRows, stamp],
  );

  /** 매년 일정 한 번에 등록: 결정적 id 라 다시 눌러도(함께 쓰는 사람이 동시에 눌러도) 같은 행이에요 */
  const registerAnnualEvents = useCallback<LedgerApi['registerAnnualEvents']>(
    async (drafts) => {
      const { data: d } = requireData();
      const accountId = accountByRole('event')?.id ?? accountByRole('allowance')?.id ?? activeAccounts[0]?.id;
      if (!accountId) throw new Error('일정에 쓸 통장이 없어요. 통장을 먼저 만들어 주세요');
      const s = stamp();
      const rows: PlannedEvent[] = [];
      for (const dr of drafts) {
        if (rows.some((r) => r.id === dr.id)) continue;
        if (d.events.some((e) => !e.deleted && seriesBaseId(e.id) === dr.id)) continue;
        rows.push({
          id: dr.id,
          date: dr.date,
          name: dr.name,
          amount: Math.round(dr.amount),
          accountId,
          categoryId: dr.categoryId,
          status: 'planned',
          repeat: 'yearly',
          memo: '',
          ...s,
          ...(dr.lunar ? { lunar: dr.lunar } : {}),
        });
      }
      if (rows.length === 0) return [];
      const byId = new Map(rows.map((r) => [r.id, r]));
      await mutate(
        (cur) => ({ ...cur, events: [...cur.events.filter((e) => !byId.has(e.id)), ...rows] }),
        (repo) => repo.upsertMany('events', rows),
        '매년 일정을 넣지 못했어요',
      );
      return rows;
    },
    [requireData, accountByRole, activeAccounts, stamp, mutate],
  );

  const updateEvent = useCallback(
    (event: PlannedEvent) => upsertRow('events', { ...event, updatedAt: nowIso() }, '일정을 고치지 못했어요'),
    [upsertRow, nowIso],
  );

  /**
   * 완료: 지출(id = event:<일정id>) → 반복이면 다음 회차(결정적 id) → 상태 done 순서로 저장.
   * 중간에 실패해도 다시 누르면 같은 행을 다시 쓰므로 지출이 두 번 생기지 않는다
   */
  const completeEvent = useCallback(
    async (id: Id, actualAmount: Won, date?: ISODate) => {
      const ev = findEvent(id);
      if (!(actualAmount >= 0)) throw new Error('쓴 금액을 확인해 주세요');
      const { data: d } = requireData();
      const day = todayRef.current;
      const s = stamp();
      const expense: Expense = {
        id: `event:${ev.id}`,
        date: date ?? (ev.date <= day ? ev.date : day),
        amount: Math.round(actualAmount),
        accountId: ev.accountId,
        categoryId: ev.categoryId,
        memo: ev.name,
        eventId: ev.id,
        fixedExpenseId: null,
        ...s,
      };
      const done: PlannedEvent = { ...ev, status: 'done', updatedAt: s.updatedAt };
      const next = nextToWrite(ev, d.events, s);
      await mutate(
        (x) => ({
          ...x,
          expenses: actualAmount > 0 ? upsertIn(x.expenses, expense) : x.expenses,
          events: upsertIn(next ? upsertIn(x.events, next) : x.events, done),
        }),
        async (repo) => {
          if (actualAmount > 0) await repo.upsert('expenses', expense);
          if (next) await repo.upsert('events', next);
          await repo.upsert('events', done);
        },
        '일정을 완료하지 못했어요',
        { multiStep: true },
      );
    },
    [findEvent, requireData, mutate, stamp],
  );

  /** 이번 회차만 취소. 반복 일정이면 다음 회차를 만들어 반복이 이어진다 */
  const cancelEvent = useCallback(
    async (id: Id) => {
      const ev = findEvent(id);
      const { data: d } = requireData();
      const s = stamp();
      const canceled: PlannedEvent = { ...ev, status: 'canceled', updatedAt: s.updatedAt };
      const next = nextToWrite(ev, d.events, s);
      if (!next) {
        await upsertRow('events', canceled, '일정을 취소하지 못했어요');
        return;
      }
      await mutate(
        (x) => ({ ...x, events: upsertIn(upsertIn(x.events, next), canceled) }),
        async (repo) => {
          await repo.upsert('events', next);
          await repo.upsert('events', canceled);
        },
        '일정을 취소하지 못했어요',
        { multiStep: true },
      );
    },
    [findEvent, requireData, stamp, upsertRow, mutate],
  );

  const deleteEvent = useCallback(
    async (id: Id) => {
      const ev = findEvent(id);
      await upsertRow('events', { ...ev, deleted: true, updatedAt: nowIso() }, '일정을 지우지 못했어요');
    },
    [findEvent, upsertRow, nowIso],
  );

  /* ---------- 설정: 규칙 ---------- */

  /** 규칙·고정 지출·통장이 바뀐 뒤 지금 만들어야 할 자동 기록을 바로 만든다 (다음에 열 때 금액이 바뀌어 보이지 않게) */
  const syncAutoNow = useCallback(async () => {
    let current: { repo: LedgerRepository; data: LedgerData };
    try {
      current = requireData();
    } catch {
      return;
    }
    const auto = pendingAutoRecords(current.data, todayRef.current, authorRef.current, nowIso());
    if (auto.transfers.length === 0 && auto.expenses.length === 0) return;
    try {
      await mutate(
        (d) => ({
          ...d,
          transfers: insertIn(d.transfers, auto.transfers),
          expenses: insertIn(d.expenses, auto.expenses),
        }),
        async (repo) => {
          if (auto.transfers.length) await repo.insert('transfers', auto.transfers);
          if (auto.expenses.length) await repo.insert('expenses', auto.expenses);
        },
        '자동 기록을 저장하지 못했어요',
        { multiStep: true },
      );
    } catch {
      // 다음에 열 때 다시 만든다 (id 가 같아 중복 없음)
    }
  }, [requireData, mutate, nowIso]);

  const saveRule = useCallback(
    async (rule: AllocationRule) => {
      if (!rule.deleted && isRemainderRule(rule) && conflictingRemainderRule(requireData().data, rule)) {
        throw new Error('같은 통장에서 같은 날 나머지를 보내는 배분이 이미 있어요');
      }
      // 용돈 등 생활비가 아닌 통장으로 가는 배분은 알아서 맞추기로 저장하지 않아요 (4-7)
      if (!rule.deleted && rule.kind === 'auto' && !canAutoFill(requireData().data.accounts.find((a) => a.id === rule.toAccountId))) {
        throw new Error('알아서 맞추기는 생활비 통장으로 보낼 때만 고를 수 있어요');
      }
      await upsertRow('rules', rule, '매달 배분을 저장하지 못했어요');
      await syncAutoNow();
    },
    [upsertRow, syncAutoNow, requireData],
  );

  const addRule = useCallback(
    async ({ id: givenId, ...input }: Omit<AllocationRule, 'id' | 'deleted'> & { id?: string }): Promise<AllocationRule> => {
      if (input.fromAccountId === input.toAccountId) throw new Error('보내는 통장과 받는 통장이 같아요');
      if (isRemainderRule(input) && conflictingRemainderRule(requireData().data, input)) {
        throw new Error('같은 통장에서 같은 날 나머지를 보내는 배분이 이미 있어요');
      }
      if (input.kind === 'auto' && !canAutoFill(requireData().data.accounts.find((a) => a.id === input.toAccountId))) {
        throw new Error('알아서 맞추기는 생활비 통장으로 보낼 때만 고를 수 있어요');
      }
      const computed = isRemainderRule(input) || input.kind === 'auto';
      const id = givenId || newId();
      const row: AllocationRule = computed ? { ...input, amount: 0, id, deleted: false } : { ...input, id, deleted: false };
      await insertRows('rules', [row], '매달 배분을 추가하지 못했어요');
      await syncAutoNow();
      return row;
    },
    [insertRows, syncAutoNow, requireData],
  );

  /* ---------- 설정: 수입 계획 ---------- */

  const cleanIncomePlan = useCallback((plan: Omit<IncomePlan, 'id' | 'deleted'>): Omit<IncomePlan, 'id' | 'deleted'> => {
    if (!plan.personName.trim()) throw new Error('누구 수입인지 이름을 입력해 주세요');
    if (!(plan.amount > 0)) throw new Error('금액을 입력해 주세요');
    if (!plan.accountId) throw new Error('받는 통장을 골라 주세요');
    const day = Math.min(31, Math.max(1, Math.round(plan.dayOfMonth || 1)));
    return {
      ...plan,
      personName: plan.personName.trim(),
      personEmail: plan.personEmail?.trim() || null,
      amount: Math.round(plan.amount),
      dayOfMonth: day,
      memo: plan.memo?.trim() ?? '',
    };
  }, []);

  const addIncomePlan = useCallback<LedgerApi['addIncomePlan']>(
    async ({ id: givenId, ...input }) => {
      const row: IncomePlan = { ...cleanIncomePlan(input), id: givenId || newId(), deleted: false };
      await insertRows('incomePlans', [row], '수입 계획을 추가하지 못했어요');
      await syncAutoNow();
      return row;
    },
    [cleanIncomePlan, insertRows, syncAutoNow],
  );

  /** 수입 계획 고치기 · 지우기 (그 자리에서 고쳐요. 이미 생긴 수입 기록은 그대로) */
  const saveIncomePlan = useCallback<LedgerApi['saveIncomePlan']>(
    async (plan) => {
      const row: IncomePlan = plan.deleted ? plan : { ...plan, ...cleanIncomePlan(plan) };
      await upsertRow('incomePlans', row, '수입 계획을 저장하지 못했어요');
      await syncAutoNow();
    },
    [cleanIncomePlan, upsertRow, syncAutoNow],
  );

  /**
   * 적립액 변경. from(기본: 이번 달 자동 이체가 기록됐으면 다음 달, 아니면 이번 달)부터 새 금액.
   * - 규칙이 from 이후에 시작하면 금액만 바꾼다
   * - 아니면 기존 규칙을 from 전 달로 끝내고 from 부터 새 규칙 (id 는 결정적이라 다시 시도해도 하나만 생긴다)
   * - 이미 끝난 규칙이면 그 뒤를 잇는 규칙(같은 통장 쌍, 끝난 다음 달 시작)을 대신 바꾼다
   */
  const changeRuleAmountFrom = useCallback(
    async (ruleId: Id, amount: Won, fromMonth?: YearMonth) => {
      const { data: d } = requireData();
      if (!(amount >= 0)) throw new Error('금액을 확인해 주세요');
      const cur = monthOf(todayRef.current);
      let rule = d.rules.find((r) => r.id === ruleId && !r.deleted);
      if (!rule) throw new Error('매달 배분 규칙을 찾을 수 없어요');
      const recordedThisMonth = (r: AllocationRule) => d.transfers.some((t) => t.id === autoTransferId(r.id, cur));
      const fromFor = (r: AllocationRule) => fromMonth ?? (recordedThisMonth(r) ? addMonths(cur, 1) : cur);
      // 끝난 규칙 → 뒤를 잇는 규칙으로 (두 번째 변경이 나란한 규칙을 하나 더 만들지 않게)
      for (let guard = 0; guard < 24; guard++) {
        const r: AllocationRule = rule;
        if (r.endMonth === null || compareMonth(r.endMonth, fromFor(r)) >= 0) break;
        const nextStart = addMonths(r.endMonth, 1);
        const successor = d.rules.find(
          (x) =>
            !x.deleted &&
            x.id !== r.id &&
            x.fromAccountId === r.fromAccountId &&
            x.toAccountId === r.toAccountId &&
            x.startMonth === nextStart,
        );
        if (!successor) throw new Error('이미 끝난 배분이라 금액을 바꿀 수 없어요');
        rule = successor;
      }
      const target: AllocationRule = rule;
      const from = fromFor(target);
      const rounded = Math.round(amount);
      const inPlace =
        compareMonth(target.startMonth, from) >= 0 ||
        (compareMonth(target.startMonth, cur) >= 0 && compareMonth(from, addMonths(cur, 1)) <= 0 && recordedThisMonth(target));
      if (inPlace) {
        await upsertRow('rules', { ...target, amount: rounded, needsReview: undefined }, '적립액을 바꾸지 못했어요');
        return;
      }
      const ended: AllocationRule = { ...target, endMonth: addMonths(from, -1), needsReview: undefined };
      const created: AllocationRule = {
        ...target,
        needsReview: undefined,
        id: successorRuleId(target.id, from),
        amount: rounded,
        startMonth: from,
        endMonth: target.endMonth && compareMonth(target.endMonth, from) >= 0 ? target.endMonth : null,
      };
      await mutate(
        (x) => ({ ...x, rules: upsertIn(upsertIn(x.rules, created), ended) }),
        async (repo) => {
          // 새 규칙을 먼저 (결정적 id → 다시 시도해도 하나), 기존 규칙 끝내기는 마지막에
          await repo.insert('rules', [created]);
          await repo.upsert('rules', ended);
        },
        '적립액을 바꾸지 못했어요',
        { multiStep: true },
      );
    },
    [requireData, upsertRow, mutate],
  );

  const changeRuleAmount = useCallback<LedgerApi['changeRuleAmount']>(
    async (ruleId, amount, fromMonth) => {
      await changeRuleAmountFrom(ruleId, amount, fromMonth);
      await syncAutoNow();
    },
    [changeRuleAmountFrom, syncAutoNow],
  );

  /* ---------- 부족 대처 ---------- */

  const applyIncreaseMonthly = useCallback<LedgerApi['applyIncreaseMonthly']>(
    async (fix) => {
      const { data: d } = requireData();
      const event = accountByRole('event');
      if (!event) throw new Error('이벤트통장이 없어요');
      // fix.fromMonth 에 유효한 이벤트통장 적립 규칙 (여럿이면 가장 늦게 시작한 것)
      const active = d.rules
        .filter(
          (r) =>
            !r.deleted &&
            r.toAccountId === event.id &&
            r.amount > 0 &&
            isMonthActive(fix.fromMonth, r.startMonth, r.endMonth),
        )
        .sort((a, b) => compareMonth(b.startMonth, a.startMonth));
      const rule = active[0];
      if (rule) {
        await changeRuleAmountFrom(rule.id, rule.amount + fix.amount, fix.fromMonth);
        await syncAutoNow();
        return;
      }
      // 수입통장이 여럿이면(사람별) 이번 달 배분을 가장 많이 보내는 통장에서 적립해요
      const incomes = sortedActive(d.accounts).filter((a) => a.role === 'income');
      const sent = (id: Id) =>
        d.rules
          .filter((r) => !r.deleted && r.fromAccountId === id && isMonthActive(fix.fromMonth, r.startMonth, r.endMonth))
          .reduce((s, r) => s + r.amount, 0);
      const income = incomes.reduce<Account | null>((best, a) => (!best || sent(a.id) > sent(best.id) ? a : best), null);
      if (!income) throw new Error('수입통장이 없어서 적립을 늘릴 수 없어요');
      await addRule({
        fromAccountId: income.id,
        toAccountId: event.id,
        amount: fix.amount,
        dayOfMonth: 1,
        startMonth: fix.fromMonth,
        endMonth: null,
      });
    },
    [requireData, accountByRole, changeRuleAmountFrom, syncAutoNow, addRule],
  );

  const applyFromReservoir = useCallback<LedgerApi['applyFromReservoir']>(
    async (fix) => {
      const event = accountByRole('event');
      if (!event) throw new Error('이벤트통장이 없어요');
      const row: Transfer = {
        id: newId(),
        date: dateInMonth(fix.month, 1),
        kind: 'transfer',
        fromAccountId: fix.reservoirAccountId,
        toAccountId: event.id,
        amount: fix.amount,
        status: 'planned',
        ruleId: null,
        memo: '이벤트 부족 대비',
        ...stamp(),
      };
      await insertRows('transfers', [row], '저수지에서 옮기는 계획을 저장하지 못했어요');
    },
    [accountByRole, insertRows, stamp],
  );

  /* ---------- 할부 ---------- */

  /**
   * 할부 행 쓰기. replanInstallment 가 준 순서(뒤 행 지우기 → 새 행 → 앞 행 끝내기)대로 쓰고, 미리 갚기 지출은 맨 마지막에 쓴다.
   * 그래서 중간에 끊겨도 미리 갚은 돈이 기록된 채 옛 회차가 계속 기록되는 일(두 번 내기)이 없다.
   * 같은 id 의 지운 미리 갚기 지출이 있으면(지웠다가 다시 미리 갚기) 되살린다
   */
  const writeInstallmentRows = useCallback(
    async (rows: FixedExpense[], failMessage: string, expense?: Expense) => {
      if (rows.length === 0 && !expense) return;
      const revive = !!expense && requireData().data.expenses.some((e) => e.id === expense.id);
      await mutate(
        (x) => ({
          ...x,
          fixedExpenses: rows.reduce((list, r) => upsertIn(list, r), x.fixedExpenses),
          expenses: expense ? (revive ? upsertIn(x.expenses, expense) : insertIn(x.expenses, [expense])) : x.expenses,
        }),
        async (repo) => {
          for (const r of rows) await repo.upsert('fixedExpenses', r);
          if (expense) {
            if (revive) await repo.upsert('expenses', expense);
            else await repo.insert('expenses', [expense]);
          }
        },
        failMessage,
        { multiStep: rows.length + (expense ? 1 : 0) > 1 },
      );
      await syncAutoNow();
    },
    [mutate, syncAutoNow, requireData],
  );

  const findPlan = useCallback(
    (planId: Id) => {
      const plan = installmentPlan(requireData().data, planId, todayRef.current);
      if (!plan) throw new Error('할부를 찾을 수 없어요');
      return plan;
    },
    [requireData],
  );

  const addInstallment = useCallback<LedgerApi['addInstallment']>(
    async (input: NewInstallment) => {
      const planId = newId();
      const rows = buildInstallmentRows(input, planId, todayRef.current);
      await mutate(
        (x) => ({ ...x, fixedExpenses: insertIn(x.fixedExpenses, rows) }),
        (repo) => repo.insert('fixedExpenses', rows),
        '할부를 추가하지 못했어요',
      );
      await syncAutoNow();
      return planId;
    },
    [mutate, syncAutoNow],
  );

  const reviseInstallment = useCallback<LedgerApi['reviseInstallment']>(
    async (planId, change) => {
      const plan = findPlan(planId);
      const from = change.fromMonth ?? earliestChangeMonth(plan);
      if (!from) throw new Error('이미 다 낸 할부예요');
      const amounts = revisedAmounts(plan, from, { monthly: change.monthly, remaining: change.remaining });
      if (amounts.length === 0) throw new Error('남은 회차를 1회 이상으로 정해 주세요. 그만 낼 거라면 그만 내기를 골라 주세요');
      const { name, accountId, categoryId, dayOfMonth } = change;
      const rows = replanInstallment(plan, from, amounts, { name, accountId, categoryId, dayOfMonth });
      await writeInstallmentRows(rows, '할부를 고치지 못했어요');
    },
    [findPlan, writeInstallmentRows],
  );

  const prepayInstallment = useCallback<LedgerApi['prepayInstallment']>(
    async (planId, input) => {
      const plan = findPlan(planId);
      const from = earliestChangeMonth(plan);
      if (!from || !plan.next) throw new Error('이미 다 낸 할부예요');
      const remaining = remainingAmountsFrom(plan, from).reduce((s, a) => s + a, 0);
      const amounts = prepaidAmounts(plan, from, input.amount, input.keep);
      const rows = replanInstallment(plan, from, amounts);
      const s = stamp();
      const expense: Expense = {
        id: installmentPrepayId(plan.id, from, remaining, input.amount),
        date: input.date ?? todayRef.current,
        amount: Math.round(input.amount),
        accountId: plan.next.accountId,
        categoryId: plan.categoryId,
        memo: `${plan.name} 미리 갚기`,
        eventId: null,
        // 할부 id 행(첫 행)은 지우지 않으므로 늘 남아 있다
        fixedExpenseId: plan.id,
        ...s,
      };
      try {
        await writeInstallmentRows(rows, '미리 갚기를 끝까지 저장하지 못했어요', expense);
      } catch (e) {
        // 지출은 맨 마지막에 쓰므로, 실패했으면 미리 갚은 돈은 아직 기록되지 않았다
        const why = e instanceof Error ? e.message.replace(/[.\s]+$/, '') : '미리 갚기를 끝까지 저장하지 못했어요';
        throw new Error(`${why}. 미리 갚은 돈은 아직 기록되지 않았어요. 할부 회차를 확인하고 다시 해 주세요`);
      }
    },
    [findPlan, stamp, writeInstallmentRows],
  );

  const endInstallment = useCallback<LedgerApi['endInstallment']>(
    async (planId) => {
      const plan = findPlan(planId);
      const from = earliestChangeMonth(plan);
      if (!from) return;
      await writeInstallmentRows(replanInstallment(plan, from, []), '할부를 멈추지 못했어요');
    },
    [findPlan, writeInstallmentRows],
  );

  const deleteInstallment = useCallback<LedgerApi['deleteInstallment']>(
    async (planId) => {
      await writeInstallmentRows(deleteInstallmentRows(findPlan(planId)), '할부를 지우지 못했어요');
    },
    [findPlan, writeInstallmentRows],
  );

  /* ---------- 통장·이체 ---------- */

  const saveAccount = useCallback(
    async (account: Account) => {
      await upsertRow('accounts', account, '통장을 저장하지 못했어요');
      await syncAutoNow();
    },
    [upsertRow, syncAutoNow],
  );

  const addAccount = useCallback<LedgerApi['addAccount']>(
    async (input) => {
      const { data: d } = requireData();
      if (!input.name.trim()) throw new Error('통장 이름을 입력해 주세요');
      const row: Account = {
        id: newId(),
        name: input.name.trim(),
        role: input.role,
        openingBalance: Math.round(input.openingBalance),
        openingDate: todayRef.current,
        order: nextOrder(d.accounts),
        ownerName: input.ownerName?.trim() || null,
        ownerEmail: input.ownerEmail?.trim() || null,
        deleted: false,
      };
      await insertRows('accounts', [row], '통장을 추가하지 못했어요');
      await syncAutoNow();
      return row;
    },
    [requireData, insertRows, syncAutoNow],
  );

  const addTransfer = useCallback<LedgerApi['addTransfer']>(
    async (input) => {
      if (!(input.amount > 0)) throw new Error('금액을 입력해 주세요');
      if (input.kind === 'transfer' && input.fromAccountId === input.toAccountId)
        throw new Error('보내는 통장과 받는 통장이 같아요');
      const row: Transfer = {
        id: newId(),
        date: input.date,
        kind: input.kind,
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        amount: Math.round(input.amount),
        status: 'done',
        ruleId: null,
        memo: input.memo ?? '',
        ...stamp(),
      };
      await insertRows('transfers', [row], '기록하지 못했어요');
    },
    [insertRows, stamp],
  );

  const deleteTransfer = useCallback(
    async (id: Id) => {
      const row = requireData().data.transfers.find((t) => t.id === id);
      if (!row) throw new Error('기록을 찾을 수 없어요');
      await upsertRow('transfers', { ...row, deleted: true, updatedAt: nowIso() }, '기록을 지우지 못했어요');
    },
    [requireData, upsertRow, nowIso],
  );

  const adjustBalance = useCallback(
    async (accountId: Id, actual: Won) => {
      const { data: d } = requireData();
      const day = todayRef.current;
      const delta = adjustmentDelta(d, accountId, Math.round(actual), day);
      if (delta === 0) return;
      const row: Transfer = {
        id: newId(),
        date: day,
        kind: 'adjustment',
        fromAccountId: delta < 0 ? accountId : null,
        toAccountId: delta > 0 ? accountId : null,
        amount: Math.abs(delta),
        status: 'done',
        ruleId: null,
        memo: '잔액 맞추기',
        ...stamp(),
      };
      await insertRows('transfers', [row], '잔액을 맞추지 못했어요');
    },
    [requireData, insertRows, stamp],
  );

  /* ---------- 설정: 고정 지출·카테고리·즐겨찾기 ---------- */

  const saveFixed = useCallback(
    async (fixed: FixedExpense) => {
      // 고정비 · 용돈: 시작일 · 해지일 · 세부 항목에 맞춰 시작월 · 종료월 · 합계를 맞춰요 (PLAN 4-15)
      const row = !fixed.deleted && isDatedBill(fixed) ? normalizeBill(fixed, todayRef.current) : fixed;
      await upsertRow('fixedExpenses', row, '고정 지출을 저장하지 못했어요');
      await syncAutoNow();
    },
    [upsertRow, syncAutoNow],
  );
  /** 고정비 금액 변경 (언제부터): 행을 나눠 지난 자동 기록은 그대로 (PLAN 4-15) */
  const changeFixedAmount = useCallback<LedgerApi['changeFixedAmount']>(
    async (rowId, amount, from) => {
      const { data: d } = requireData();
      const recorded = new Set(d.expenses.map((e) => e.id));
      const res = splitBillAmount(d.fixedExpenses, rowId, amount, from, recorded, todayRef.current);
      if (!res.ok) throw new Error(res.error);
      await mutate(
        (x) => ({ ...x, fixedExpenses: res.rows.reduce((list, r) => upsertIn(list, r), x.fixedExpenses) }),
        async (repo) => {
          // 새 행을 먼저 (결정적 id), 앞 행 끝내기는 마지막에
          for (const r of res.rows) await repo.upsert('fixedExpenses', r);
        },
        '금액을 바꾸지 못했어요',
        { multiStep: res.rows.length > 1 },
      );
      await syncAutoNow();
    },
    [requireData, mutate, syncAutoNow],
  );
  /** 생활비 항목 고치기 · 끝내기 · 지우기: 금액 · 쓰는 방식 · 쓰는 날은 이번 달부터만 (PLAN 4-1) */
  const saveLivingItem = useCallback<LedgerApi['saveLivingItem']>(
    async (prevId, next) => {
      const { data: d } = requireData();
      const prev = d.fixedExpenses.find((f) => f.id === prevId);
      if (!prev) throw new Error('생활비 예산을 찾을 수 없어요');
      const rows = livingItemChanges(d.fixedExpenses, prev, next, monthOf(todayRef.current));
      await mutate(
        (x) => ({ ...x, fixedExpenses: rows.reduce((list, r) => upsertIn(list, r), x.fixedExpenses) }),
        async (repo) => {
          // 새 행을 먼저 (결정적 id), 앞 행 끝내기는 그다음
          for (const r of rows) await repo.upsert('fixedExpenses', r);
        },
        '생활비 예산을 저장하지 못했어요',
        { multiStep: rows.length > 1 },
      );
      await syncAutoNow();
    },
    [requireData, mutate, syncAutoNow],
  );
  /** 생활비 항목의 '이 달만 다른 금액' 넣기 · 고치기 (amount=null 이면 지우기) */
  const setLivingOverride = useCallback<LedgerApi['setLivingOverride']>(
    async (rowId, month, amount) => {
      const { data: d } = requireData();
      const base = d.fixedExpenses.find((f) => f.id === rowId);
      if (!base) throw new Error('생활비 예산을 찾을 수 없어요');
      if (!isValidMonth(month)) throw new Error('달을 골라 주세요');
      if (amount !== null && !(amount >= 0)) throw new Error('금액을 입력해 주세요');
      const row = livingOverrideRow(d.fixedExpenses, base, month, amount ?? 0);
      const exists = d.fixedExpenses.some((f) => f.id === row.id && !f.deleted);
      if (amount === null && !exists) return;
      const saved = amount === null ? { ...(d.fixedExpenses.find((f) => f.id === row.id) ?? row), deleted: true } : row;
      await upsertRow('fixedExpenses', saved, amount === null ? '이 달 금액을 지우지 못했어요' : '이 달 금액을 저장하지 못했어요');
      await syncAutoNow();
    },
    [requireData, upsertRow, syncAutoNow],
  );
  /** 고정비 그만 내기 (해지일) · 지우기 (모든 행) */
  const endFixedSeries = useCallback<LedgerApi['endFixedSeries']>(
    async (seriesId, end) => {
      const { data: d } = requireData();
      const rows =
        end === null
          ? d.fixedExpenses.filter((f) => !f.deleted && isDatedBill(f) && (f.id === seriesId || f.id.startsWith(`${seriesId}@`))).map((f) => ({ ...f, deleted: true }))
          : endBillSeries(d.fixedExpenses, seriesId, end, todayRef.current);
      if (rows.length === 0) return;
      await mutate(
        (x) => ({ ...x, fixedExpenses: rows.reduce((list, r) => upsertIn(list, r), x.fixedExpenses) }),
        async (repo) => {
          for (const r of rows) await repo.upsert('fixedExpenses', r);
        },
        end === null ? '고정 지출을 지우지 못했어요' : '고정 지출을 끝내지 못했어요',
        { multiStep: rows.length > 1 },
      );
      await syncAutoNow();
    },
    [requireData, mutate, syncAutoNow],
  );
  /* ---------- 예산 달별 보기: 다음 달 준비 (작업정리 13) ---------- */

  /** 다음 달 행 나누기 · 지우기를 표마다 한 번에: first(새 행 / 지울 행) → then(앞 행) → 설정 '준비한달' */
  const writeNextMonth = useCallback(
    async (w: NextMonthWrites, preparedMonth: YearMonth | null, failMessage: string) => {
      const tables: BudgetTable[] = ['rules', 'incomePlans', 'fixedExpenses'];
      await mutate(
        (x) => {
          let out: LedgerData = { ...x, settings: { ...x.settings, preparedMonth } };
          for (const step of [w.first, w.then]) {
            for (const t of tables) {
              const rows = step[t] as Keyed[];
              if (rows.length) out = { ...out, [t]: rows.reduce((list, r) => upsertIn(list, r), out[t] as Keyed[]) };
            }
          }
          return out;
        },
        async (repo) => {
          for (const step of [w.first, w.then]) {
            for (const t of tables) {
              const rows = step[t];
              if (rows.length) await repo.upsertMany(t, rows as never);
            }
          }
          await repo.updateSettings({ preparedMonth });
        },
        failMessage,
        { multiStep: true },
      );
    },
    [mutate],
  );

  const prepareNextMonth = useCallback<LedgerApi['prepareNextMonth']>(async () => {
    const { data: d } = requireData();
    await writeNextMonth(nextMonthCopy(d, todayRef.current), nextBudgetMonth(todayRef.current), '다음 달 예산을 준비하지 못했어요');
  }, [requireData, writeNextMonth]);

  const resetNextMonth = useCallback<LedgerApi['resetNextMonth']>(async () => {
    const { data: d } = requireData();
    await writeNextMonth(nextMonthReset(d, todayRef.current), null, '다음 달 예산을 초기화하지 못했어요');
    await syncAutoNow();
  }, [requireData, writeNextMonth, syncAutoNow]);

  const splitForNextMonth = useCallback<LedgerApi['splitForNextMonth']>(
    async (table, rowId) => {
      const { data: d } = requireData();
      const today = todayRef.current;
      const next = nextBudgetMonth(today);
      const w: NextMonthWrites = {
        first: { rules: [], incomePlans: [], fixedExpenses: [] },
        then: { rules: [], incomePlans: [], fixedExpenses: [] },
      };
      let createdId: Id = rowId;
      if (table === 'rules') {
        const row = d.rules.find((r) => r.id === rowId);
        const s = row ? splitMonthRow('rules', row, next) : null;
        if (s) [w.first.rules, w.then.rules, createdId] = [[s.created], [s.ended], s.created.id];
      } else if (table === 'incomePlans') {
        const row = d.incomePlans.find((r) => r.id === rowId);
        const s = row ? splitMonthRow('incomePlans', row, next) : null;
        if (s) [w.first.incomePlans, w.then.incomePlans, createdId] = [[s.created], [s.ended], s.created.id];
      } else {
        const row = d.fixedExpenses.find((r) => r.id === rowId);
        const s = row ? splitFixedRow(row, next, today) : null;
        if (s) [w.first.fixedExpenses, w.then.fixedExpenses, createdId] = [[s.created], [s.ended], s.created.id];
      }
      if (createdId === rowId) return rowId;
      await writeNextMonth(w, d.settings.preparedMonth ?? null, '다음 달 예산을 나누지 못했어요');
      return createdId;
    },
    [requireData, writeNextMonth],
  );

  const addFixed = useCallback(
    async ({ id: givenId, ...input }: Omit<FixedExpense, 'id' | 'deleted'> & { id?: string }): Promise<FixedExpense> => {
      if (!input.name.trim()) throw new Error('이름을 입력해 주세요');
      const raw: FixedExpense = { ...input, name: input.name.trim(), id: givenId || newId(), deleted: false };
      const row = isDatedBill(raw) ? normalizeBill(raw, todayRef.current) : raw;
      await insertRows('fixedExpenses', [row], '고정 지출을 추가하지 못했어요');
      await syncAutoNow();
      return row;
    },
    [insertRows, syncAutoNow],
  );

  const saveCategory = useCallback(
    (category: Category) => upsertRow('categories', category, '카테고리를 저장하지 못했어요'),
    [upsertRow],
  );
  const addCategory = useCallback(
    async (input: Omit<Category, 'id' | 'deleted' | 'order'>): Promise<Category> => {
      const { data: d } = requireData();
      if (!input.name.trim()) throw new Error('카테고리 이름을 입력해 주세요');
      const row: Category = { ...input, name: input.name.trim(), id: newId(), order: nextOrder(d.categories), deleted: false };
      await insertRows('categories', [row], '카테고리를 추가하지 못했어요');
      return row;
    },
    [requireData, insertRows],
  );

  const moveCategoryTo = useCallback<LedgerApi['moveCategoryTo']>(
    async (id, toIndex) => {
      const { data: d } = requireData();
      const changed = moveCategoryToDomain(d.categories, id, toIndex);
      if (changed.length === 0) return false;
      const byId = new Map(changed.map((c) => [c.id, c]));
      // 화면에 먼저 반영하고, 바뀐 행만 한 번에 저장해요. 실패하면 되돌려요
      await mutate(
        (cur) => ({ ...cur, categories: cur.categories.map((c) => byId.get(c.id) ?? c) }),
        (repo) => repo.upsertMany('categories', changed),
        '카테고리 순서를 바꾸지 못했어요',
      );
      return true;
    },
    [requireData, mutate],
  );

  const setCategoriesHidden = useCallback<LedgerApi['setCategoriesHidden']>(
    async (ids, hidden) => {
      const { data: d } = requireData();
      const changed = setHiddenRows(d.categories, ids, hidden);
      if (changed.length === 0) return 0;
      const byId = new Map(changed.map((c) => [c.id, c]));
      await mutate(
        (cur) => ({ ...cur, categories: cur.categories.map((c) => byId.get(c.id) ?? c) }),
        (repo) => repo.upsertMany('categories', changed),
        hidden ? '카테고리를 숨기지 못했어요' : '카테고리를 다시 보이게 하지 못했어요',
      );
      return changed.length;
    },
    [requireData, mutate],
  );

  /** 합치기 · 되돌리기 행 쓰기: 다시 해도 같은 옮기기를 먼저, 금액을 더하는 예산 행은 한 번에, 카테고리 지우기는 마지막에 */
  const writeMergeRows = useCallback(
    (rows: CategoryMergeRows, failMessage: string) =>
      mutate(
        (cur) => applyMergeRows(cur, rows),
        async (repo) => {
          if (rows.expenses.length > 0) await repo.upsertMany('expenses', rows.expenses);
          if (rows.events.length > 0) await repo.upsertMany('events', rows.events);
          if (rows.favorites.length > 0) await repo.upsertMany('favorites', rows.favorites);
          if (rows.fixedExpenses.length > 0) await repo.upsertMany('fixedExpenses', rows.fixedExpenses);
          if (rows.categories.length > 0) await repo.upsertMany('categories', rows.categories);
        },
        failMessage,
        { multiStep: true },
      ),
    [mutate],
  );
  const mergeCategory = useCallback<LedgerApi['mergeCategory']>(
    async (sourceId, targetId) => {
      const { data: d } = requireData();
      const plan = planCategoryMerge(d, sourceId, targetId);
      await writeMergeRows(plan, '카테고리를 합치지 못했어요');
      return plan;
    },
    [requireData, writeMergeRows],
  );
  const undoCategoryMerge = useCallback<LedgerApi['undoCategoryMerge']>(
    (plan) => writeMergeRows(plan.undo, '합치기를 되돌리지 못했어요'),
    [writeMergeRows],
  );

  /** 한 칸씩 옮기기 (-1 위로 · +1 아래로) = 지금 자리 + delta 로 옮기기 */
  const moveCategory = useCallback<LedgerApi['moveCategory']>(
    async (id, delta) => {
      const { data: d } = requireData();
      const from = orderedCategories(d.categories).findIndex((c) => c.id === id);
      if (from < 0) return false;
      return moveCategoryTo(id, from + Math.trunc(delta));
    },
    [requireData, moveCategoryTo],
  );

  /* ---------- 월말 ---------- */

  const decideMonthEnd = useCallback(
    async (choice: 'reservoir' | 'carryover') => {
      requireOnline();
      const { repo, data: d } = requireData();
      const day = todayRef.current;
      // 공용 가계부: 먼저 고른 사람의 선택을 따른다
      let latest = d;
      const loadStart = ++clock.current;
      try {
        latest = withPendingWrites(await repo.load(), loadStart);
      } catch {
        latest = d;
      }
      if (repoRef.current !== repo) return;
      if (latest !== d) setDataBoth(latest);
      const pending = pendingMonthEndDomain(latest, day);
      if (!pending) return;
      const { monthEnd, transfers: endTransfers } = decideMonthEndDomain(
        latest,
        pending.month,
        pending.leftover,
        choice,
        authorRef.current,
        nowIso(),
        pending.items.map((i) => ({ categoryId: i.categoryId, leftover: i.leftover, ...(i.accountId ? { accountId: i.accountId } : {}) })),
      );
      await mutate(
        (x) => ({
          ...x,
          monthEnds: upsertIn(x.monthEnds, monthEnd),
          transfers: insertIn(x.transfers, endTransfers),
        }),
        async (r) => {
          // 이체(결정적 id)를 먼저, 월말 행은 마지막에. 이체는 월말 행이 '저수지'일 때만 잔액에 들어간다
          if (endTransfers.length) await r.insert('transfers', endTransfers);
          await r.upsert('monthEnds', monthEnd);
        },
        '월말 처리를 저장하지 못했어요',
        { multiStep: true },
      );
    },
    [requireOnline, requireData, setDataBoth, mutate, nowIso, withPendingWrites],
  );

  /* ---------- 멤버·이름 ---------- */

  const linkMemberAccount = useCallback<LedgerApi['linkMemberAccount']>(
    async (email, accountId) => {
      const { data: d } = requireData();
      if (accountId && !d.accounts.some((a) => a.id === accountId && !a.deleted)) throw new Error('통장을 찾을 수 없어요');
      const member = d.members.find((m) => m.email.toLowerCase() === email.trim().toLowerCase());
      const changed = linkAccountsToEmail(d.accounts, email, accountId, member?.displayName);
      if (changed.length === 0) return;
      const byId = new Map(changed.map((a) => [a.id, a]));
      await mutate(
        (cur) => ({ ...cur, accounts: cur.accounts.map((a) => byId.get(a.id) ?? a) }),
        async (repo) => {
          for (const a of changed) await repo.upsert('accounts', a);
        },
        '수입통장을 잇지 못했어요',
        { multiStep: changed.length > 1 },
      );
    },
    [requireData, mutate],
  );

  const claimOwner = useCallback<LedgerApi['claimOwner']>(
    async (ownerName) => {
      const { data: d } = requireData();
      if (demo) return;
      const changed = claimOwnerAccounts(d.accounts, ownerName, authorRef.current);
      if (changed.length === 0) return;
      const byId = new Map(changed.map((a) => [a.id, a]));
      await mutate(
        (cur) => ({ ...cur, accounts: cur.accounts.map((a) => byId.get(a.id) ?? a) }),
        (repo) => repo.upsertMany('accounts', changed),
        '나를 정하지 못했어요',
      );
    },
    [requireData, mutate, demo],
  );
  const dismissNotice = useCallback(() => setNotices((list) => list.slice(1)), []);

  const inviteMember = useCallback(
    async (email: string, name: string, incomeAccountId?: Id | null) => {
      const clean = email.trim();
      if (!/^[^\s@]+@[^\s@]+$/.test(clean)) throw new Error('이메일 주소를 확인해 주세요');
      requireOnline();
      const { repo } = requireData();
      const backend = backendFor(repo.ref);
      try {
        await backend.share(repo.ref, clean);
      } catch (e) {
        throw new Error(koreanMessage(e, '초대하지 못했어요. 잠시 뒤 다시 시도해 주세요'));
      }
      const existing = requireData().data.members.find((m) => m.email.toLowerCase() === clean.toLowerCase());
      // 구글 이름은 다음 공유 목록 읽기에서 채워져요 (적은 이름은 그때까지만)
      const member: Member = {
        email: existing?.email ?? clean,
        displayName: name.trim() || existing?.displayName || clean.split('@')[0] || clean,
        shared: true,
        role: repo.ref.source === 'sheets' ? 'writer' : (existing?.role ?? null),
      };
      await upsertRow('members', member, '멤버를 저장하지 못했어요');
      if (incomeAccountId) await linkMemberAccount(clean, incomeAccountId);
    },
    [requireOnline, requireData, backendFor, upsertRow, linkMemberAccount],
  );

  const renameLedger = useCallback(
    async (name: string) => {
      const clean = name.trim();
      if (!clean) throw new Error('가계부 이름을 입력해 주세요');
      const { repo } = requireData();
      await mutate(
        (d) => ({ ...d, settings: { ...d.settings, name: clean } }),
        (r) => r.updateSettings({ name: clean }),
        '이름을 바꾸지 못했어요',
      );
      updateRecent({ ...repo.ref, name: clean });
    },
    [requireData, mutate, updateRecent],
  );

  /* ---------- 파일에서 가져오기 ---------- */

  const previewImport = useCallback<LedgerApi['previewImport']>(
    (file: ImportFile) => (data ? planImport(data, file, { today, author, now: deps.now().toISOString() }) : null),
    [data, today, author, deps],
  );

  const importFile = useCallback<LedgerApi['importFile']>(
    async (file: ImportFile) => {
      const { data: d } = requireData();
      // 미리보기 뒤에 바뀐 데이터가 있을 수 있어 지금 데이터로 다시 만든다 (이미 가져온 행은 건너뛴다)
      const plan = planImport(d, file, { today: todayRef.current, author: authorRef.current, now: nowIso() });
      if (plan.errors.length > 0) throw new Error(plan.errors[0]);
      if (plan.total === 0) return plan;
      await mutate(
        (x) => applyImportPlan(x, plan),
        async (repo) => {
          // 통장 · 카테고리 · 여행 · 일정 · 규칙 · 고정 지출 → 지출 → 이체 순서. 같은 키는 건너뛰어 끊긴 뒤 다시 해도 안전하다.
          // 돌려준 청구의 이체(claim:<지출id>)는 지출 뒤에 써서, 끊겨도 지출 없는 이체가 잔액을 옮기지 않게 한다
          for (const t of IMPORT_TABLES) {
            const rows = plan.rows[t];
            if (rows.length > 0) await repo.insert(t, rows as never);
          }
          for (const a of plan.accountUpdates) await repo.upsert('accounts', a);
        },
        '가져오지 못했어요. 다시 가져오면 빠진 것만 더해요',
        { multiStep: true },
      );
      await syncAutoNow();
      return plan;
    },
    [requireData, nowIso, mutate, syncAutoNow],
  );

  const reload = useCallback(() => loadAll(), [loadAll]);
  const sync = useMemo<LedgerApi['sync']>(
    () => ({ syncing: loadingCount > 0, syncedAt, fromCache, offline }),
    [loadingCount, syncedAt, fromCache, offline],
  );
  const refreshSharing = useCallback(async () => {
    await loadAll();
    return sharingRef.current;
  }, [loadAll]);

  const api = useMemo<LedgerApi>(
    () => ({
      status,
      error,
      needsReconnect,
      ref,
      data,
      today,
      saving: savingCount > 0,
      reload,
      sync,
      now: deps.now,
      living,
      livingViews,
      myLivingAccountId: myLivingId,
      meChoices,
      claimOwner,
      notice,
      dismissNotice,
      livingFor,
      spenders,
      mySpenderKey: mySpender,
      balances,
      eventProjection,
      shortageFix,
      pendingMonthEnd,
      activeAccounts,
      activeCategories,
      pickableCategories,
      categoryScores,
      accountByRole,
      incomeAccounts,
      judge,
      claims,
      claimPayers,
      previewClaimDue,
      settleClaims,
      unsettleClaims,
      settlement,
      loanCandidates,
      borrowAndSettleClaims,
      repayLoan,
      undoRepayLoan,
      convertToLoan,
      unconvertLoan,
      saveSettleDay,
      saveDaysOff,
      saveDismissedRecurring,
      borrowReservoirClaims,
      convertSettledReservoirClaims,
      undoReservoirClaims,
      undoClaimPayments,
      cancelClaimLoans,
      cancelLoanTransfer,
      updateLoanAmount,
      restoreRows,
      installments,
      installmentHint,
      addInstallment,
      reviseInstallment,
      prepayInstallment,
      endInstallment,
      deleteInstallment,
      trips,
      addTrip,
      updateTrip,
      deleteTrip,
      restoreTrip,
      addExpense,
      updateExpense,
      deleteExpense,
      setExpenseExclusions,
      addEvent,
      registerAnnualEvents,
      updateEvent,
      completeEvent,
      cancelEvent,
      deleteEvent,
      applyIncreaseMonthly,
      applyFromReservoir,
      saveAccount,
      addAccount,
      addTransfer,
      deleteTransfer,
      adjustBalance,
      saveRule,
      addRule,
      changeRuleAmount,
      changeFixedAmount,
      endFixedSeries,
      saveLivingItem,
      setLivingOverride,
      addIncomePlan,
      saveIncomePlan,
      saveFixed,
      addFixed,
      prepareNextMonth,
      resetNextMonth,
      splitForNextMonth,
      saveCategory,
      moveCategory,
      moveCategoryTo,
      addCategory,
      setCategoriesHidden,
      mergeCategory,
      undoCategoryMerge,
      decideMonthEnd,
      inviteMember,
      linkMemberAccount,
      refreshSharing,
      renameLedger,
      previewImport,
      importFile,
      displayName,
    }),
    [
      status, error, needsReconnect, ref, data, today, savingCount, reload, sync, deps.now, living, livingViews, myLivingId, meChoices, claimOwner, notice, dismissNotice, livingFor, spenders,
      mySpender, addIncomePlan, saveIncomePlan, balances, eventProjection, shortageFix,
      pendingMonthEnd, activeAccounts, activeCategories, pickableCategories, categoryScores, accountByRole, incomeAccounts, judge, claims, claimPayers,
      previewClaimDue, settleClaims, unsettleClaims, settlement, loanCandidates, borrowAndSettleClaims, repayLoan,
      undoRepayLoan, convertToLoan, unconvertLoan, saveSettleDay, saveDaysOff, saveDismissedRecurring, borrowReservoirClaims, convertSettledReservoirClaims, undoReservoirClaims, undoClaimPayments, cancelClaimLoans, cancelLoanTransfer, updateLoanAmount, restoreRows, installments, installmentHint, addInstallment,
      reviseInstallment, prepayInstallment, endInstallment, deleteInstallment, trips, addTrip, updateTrip, deleteTrip,
      restoreTrip, addExpense, updateExpense,
      deleteExpense, setExpenseExclusions, addEvent, registerAnnualEvents, updateEvent, completeEvent, cancelEvent, deleteEvent, applyIncreaseMonthly,
      applyFromReservoir, saveAccount, addAccount, addTransfer, deleteTransfer, adjustBalance, saveRule, addRule,
      changeRuleAmount, changeFixedAmount, endFixedSeries, saveLivingItem, setLivingOverride, saveFixed, addFixed, prepareNextMonth, resetNextMonth, splitForNextMonth, saveCategory, moveCategory, moveCategoryTo, addCategory, setCategoriesHidden, mergeCategory, undoCategoryMerge,
      decideMonthEnd, inviteMember, linkMemberAccount, refreshSharing, renameLedger, displayName, previewImport, importFile,
    ],
  );

  return <LedgerContext.Provider value={api}>{children}</LedgerContext.Provider>;
}

export function useLedger(): LedgerApi {
  const v = useContext(LedgerContext);
  if (!v) throw new Error('useLedger 는 AppProviders 안에서만 쓸 수 있어요');
  return v;
}

