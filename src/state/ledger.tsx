'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
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
  canClaimOnAccount,
  claimAccountFor,
  linkAccountsToEmail,
  personByEmail,
  claimPayers as claimPayersDomain,
  claimTransferId,
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
  newId,
  nextOccurrenceDate,
  nextOccurrenceId,
  pendingAllowanceIncome,
  pendingAutoRecords,
  pendingClaims,
  pendingMonthEnd as pendingMonthEndDomain,
  projectEventAccount,
  seriesAnchorDay,
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
} from '@/domain';
import type {
  Account,
  AllocationRule,
  Category,
  Expense,
  Favorite,
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
import { useSession, useSessionInternals } from './session';
import type { ImportFile } from '@/domain/importFile';
import type { LedgerApi, NewEvent, NewExpense, NewInstallment, NewTrip } from './types';

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

function sortedActive<T extends { deleted: boolean; order: number }>(list: T[]): T[] {
  return list.filter((x) => !x.deleted).sort((a, b) => a.order - b.order);
}

function nextOrder(list: { order: number }[]): number {
  return list.reduce((m, x) => Math.max(m, x.order), -1) + 1;
}

/** 반복 일정의 다음 회차 행 (기준 일 유지, 결정적 id). 반복이 아니면 null */
function nextOccurrenceRow(ev: PlannedEvent, events: PlannedEvent[], s: { author: string; createdAt: string; updatedAt: string }): PlannedEvent | null {
  const nextDate = nextOccurrenceDate(ev.date, ev.repeat, ev.repeat === 'none' ? undefined : seriesAnchorDay(events, ev));
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

interface LoadedState {
  repo: LedgerRepository;
  status: 'ready' | 'error';
  error: string | null;
  data: LedgerData | null;
  needsReconnect?: boolean;
}

const LedgerContext = createContext<LedgerApi | null>(null);

export function LedgerProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const { deps, backendFor, updateRecent } = useSessionInternals();
  const author = session.user?.email ?? 'demo';
  const ref = session.status === 'signedIn' ? session.activeLedger : null;

  const [loaded, setLoaded] = useState<LoadedState | null>(null);
  const [savingCount, setSavingCount] = useState(0);
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
  });

  const current = repository && loaded && loaded.repo === repository ? loaded : null;
  const status: LedgerApi['status'] = !repository ? 'idle' : current ? current.status : 'loading';
  const data = current?.data ?? null;
  const error = current?.error ?? null;
  const needsReconnect = current?.needsReconnect ?? false;

  /** 현재 가계부의 데이터 교체 (화면 + 핸들러용 ref) */
  const setDataBoth = useCallback((d: LedgerData) => {
    const repo = repoRef.current;
    if (!repo) return;
    dataRef.current = { repo, data: d };
    setLoaded({ repo, status: 'ready', error: null, data: d });
  }, []);

  const nowIso = useCallback(() => deps.now().toISOString(), [deps]);

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

  const loadAll = useCallback(async () => {
    const repo = repoRef.current;
    if (!repo) return;
    const token = ++loadToken.current;
    const loadStart = ++clock.current;
    try {
      const fresh = await repo.load();
      const synced = await syncAutoRecords(repo, fresh, todayRef.current);
      if (token !== loadToken.current || repo !== repoRef.current) return;
      setDataBoth(withPendingWrites(synced, loadStart));
    } catch (e) {
      if (token !== loadToken.current || repo !== repoRef.current) return;
      const reconnect = isReconnectError(e);
      const message = reconnect ? RECONNECT_MESSAGE : koreanMessage(e, '가계부를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요');
      const prev = dataRef.current?.repo === repo ? dataRef.current.data : null;
      // 이미 보이는 데이터가 있으면 그대로 두고 오류만 알린다
      setLoaded({ repo, status: prev ? 'ready' : 'error', error: message, data: prev, needsReconnect: reconnect });
    }
  }, [setDataBoth, syncAutoRecords, withPendingWrites]);

  // 가계부가 바뀌면 다시 읽기
  useEffect(() => {
    dataRef.current = null;
    writes.current = [];
    if (!repository) {
      loadToken.current++;
      return;
    }
    void loadAll();
  }, [repository, loadAll]);

  // 날짜 바뀜: 자정 / 창 포커스
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      const d = toISODate(deps.now());
      setToday((prev) => (prev === d ? prev : d));
    };
    const schedule = () => {
      timer = setTimeout(() => {
        refresh();
        schedule();
      }, msUntilNextMidnight(deps.now()));
    };
    schedule();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [deps]);

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
      const { repo, data: before } = requireData();
      const optimistic = apply(before);
      const entry: PendingWrite = { apply, doneAt: null };
      writes.current.push(entry);
      setDataBoth(optimistic);
      setSavingCount((n) => n + 1);
      try {
        await persist(repo);
        entry.doneAt = ++clock.current;
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
    [requireData, setDataBoth, loadAll],
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
  const accountByRole = useCallback(
    (role: Account['role']) => activeAccounts.find((a) => a.role === role) ?? null,
    [activeAccounts],
  );
  const incomeAccounts = useMemo(() => activeAccounts.filter((a) => a.role === 'income'), [activeAccounts]);
  const living = useMemo(() => (data ? computeLiving(data, today) : null), [data, today]);
  // 사람별 생활비 (PLAN 4-14): 생활비 통장마다, 로그인한 사람의 통장, '누가 썼나요?'에서 고를 사람
  const livingViews = useMemo(() => (data ? livingByAccount(data, today) : []), [data, today]);
  const myLivingId = useMemo(() => (data ? myLivingAccountId(data, monthOf(today), author) : null), [data, today, author]);
  const spenders = useMemo(() => (data ? spenderOptions(data, monthOf(today)) : []), [data, today]);
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

  const displayName = useCallback(
    (email: string) => {
      const person = data ? personByEmail(data, email) : null;
      if (person?.name) return person.name;
      return email.split('@')[0] || email;
    },
    [data],
  );

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
      };
      await insertRows('expenses', [row], '지출을 기록하지 못했어요');
      return row;
    },
    [insertRows, stamp, requireData, tripFields],
  );

  /** 지출과 그 청구의 돌려준 이체(claim:<지출id>)를 함께 쓴다. 이체 먼저: 끊기면 다시 읽어 맞춘다 */
  const writeExpenseAndSettle = useCallback(
    (expense: Expense, settle: Transfer, failMessage: string) =>
      mutate(
        (x) => ({ ...x, expenses: upsertIn(x.expenses, expense), transfers: upsertIn(x.transfers, settle) }),
        async (repo) => {
          await repo.upsert('transfers', settle);
          await repo.upsert('expenses', expense);
        },
        failMessage,
        { multiStep: true },
      ),
    [mutate],
  );

  /**
   * 고치기. 아직 돌려주지 않은 청구는 낸 사람 · 통장 · 금액이 바뀌면 돌려받을 통장과 정산일을 다시 정해요.
   * 낸 사람을 비우면 보통 지출이 돼요. 이미 돌려준 청구는 청구 칸을 그대로 둬요
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
      // 지웠던 지출을 되살리면, 함께 지웠던 돌려준 이체도 되살린다 (deleteExpense 가 같은 시각으로 지운 것만)
      const settle = prev ? d.transfers.find((t) => t.id === claimTransferId(prev.id)) : undefined;
      if (prev && settle && prev.deleted && !next.deleted && settle.deleted && settle.updatedAt === prev.updatedAt && isClaimExpense(prev)) {
        const revived: Transfer = { ...settle, deleted: false, updatedAt: next.updatedAt };
        next = { ...next, paidBy: prev.paidBy, claimAccountId: prev.claimAccountId ?? null, claimDue: prev.claimDue ?? null };
        await writeExpenseAndSettle(next, revived, '지출을 고치지 못했어요');
        return;
      }
      if (prev && isClaimExpense(prev) && isClaimSettled(d, prev.id)) {
        next = { ...next, paidBy: prev.paidBy, claimAccountId: prev.claimAccountId ?? null, claimDue: prev.claimDue ?? null };
        // 이미 돌려준 청구의 금액 · 통장을 바꾸면 돌려준 이체도 같이 고친다 (낸 사람 통장 · 함께 쓰는 통장 잔액이 어긋나지 않게)
        if (settle && (next.amount !== settle.amount || next.accountId !== settle.fromAccountId || next.deleted)) {
          if (!next.deleted && !canClaimOnAccount(d, next.accountId)) {
            throw new Error('돌려준 청구는 이벤트통장 · 고정지출통장 · 저수지통장으로만 옮길 수 있어요');
          }
          const fixed: Transfer = next.deleted
            ? { ...settle, deleted: true, updatedAt: next.updatedAt }
            : { ...settle, amount: next.amount, fromAccountId: next.accountId, updatedAt: next.updatedAt };
          await writeExpenseAndSettle(next, fixed, '지출을 고치지 못했어요');
          return;
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
      await upsertRow('expenses', next, '지출을 고치지 못했어요');
    },
    [requireData, upsertRow, nowIso, tripFields, writeExpenseAndSettle],
  );

  /* ---------- 청구 ---------- */

  const settleClaims = useCallback<LedgerApi['settleClaims']>(
    async (expenseIds, date) => {
      const { data: d } = requireData();
      const ids = new Set(expenseIds);
      const due = pendingClaims(d, todayRef.current).filter((c) => ids.has(c.expense.id));
      if (due.length === 0) return;
      const s = stamp();
      const day = date ?? todayRef.current;
      const rows: Transfer[] = due.map((c) => {
        const cat = c.expense.categoryId ? d.categories.find((x) => x.id === c.expense.categoryId)?.name : undefined;
        const what = c.expense.memo.trim() || cat || '지출';
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
      const ids = new Set(expenseIds.map(claimTransferId));
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

  const deleteExpense = useCallback(
    async (id: Id) => {
      const d = requireData().data;
      const row = d.expenses.find((e) => e.id === id);
      if (!row) throw new Error('지출 기록을 찾을 수 없어요');
      const updatedAt = nowIso();
      const deleted: Expense = { ...row, deleted: true, updatedAt };
      // 돌려준 청구를 지우면 돌려준 이체도 같은 시각으로 지운다 (되살리면 함께 되살아난다)
      const settle = isClaimExpense(row) ? d.transfers.find((t) => t.id === claimTransferId(row.id) && !t.deleted) : undefined;
      if (settle) {
        await writeExpenseAndSettle(deleted, { ...settle, deleted: true, updatedAt }, '지출을 지우지 못했어요');
        return;
      }
      await upsertRow('expenses', deleted, '지출을 지우지 못했어요');
    },
    [requireData, upsertRow, nowIso, writeExpenseAndSettle],
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
      };
      await insertRows('events', [row], '일정을 추가하지 못했어요');
      return row;
    },
    [accountByRole, activeAccounts, insertRows, stamp],
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
      await upsertRow('rules', rule, '매달 배분을 저장하지 못했어요');
      await syncAutoNow();
    },
    [upsertRow, syncAutoNow, requireData],
  );

  const addRule = useCallback(
    async (input: Omit<AllocationRule, 'id' | 'deleted'>): Promise<AllocationRule> => {
      if (input.fromAccountId === input.toAccountId) throw new Error('보내는 통장과 받는 통장이 같아요');
      if (isRemainderRule(input) && conflictingRemainderRule(requireData().data, input)) {
        throw new Error('같은 통장에서 같은 날 나머지를 보내는 배분이 이미 있어요');
      }
      const row: AllocationRule = isRemainderRule(input) ? { ...input, amount: 0, id: newId(), deleted: false } : { ...input, id: newId(), deleted: false };
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
    async (input) => {
      const row: IncomePlan = { ...cleanIncomePlan(input), id: newId(), deleted: false };
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
        await upsertRow('rules', { ...target, amount: rounded }, '적립액을 바꾸지 못했어요');
        return;
      }
      const ended: AllocationRule = { ...target, endMonth: addMonths(from, -1) };
      const created: AllocationRule = {
        ...target,
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
    async (ruleId, amount) => {
      await changeRuleAmountFrom(ruleId, amount);
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
      await upsertRow('fixedExpenses', fixed, '고정 지출을 저장하지 못했어요');
      await syncAutoNow();
    },
    [upsertRow, syncAutoNow],
  );
  const addFixed = useCallback(
    async (input: Omit<FixedExpense, 'id' | 'deleted'>): Promise<FixedExpense> => {
      if (!input.name.trim()) throw new Error('이름을 입력해 주세요');
      const row: FixedExpense = { ...input, name: input.name.trim(), id: newId(), deleted: false };
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

  const saveFavorite = useCallback(
    (favorite: Favorite) => upsertRow('favorites', favorite, '자주 쓰는 지출을 저장하지 못했어요'),
    [upsertRow],
  );
  const addFavorite = useCallback(
    async (input: Omit<Favorite, 'id' | 'deleted' | 'order'>): Promise<Favorite> => {
      const { data: d } = requireData();
      if (!input.name.trim()) throw new Error('이름을 입력해 주세요');
      const row: Favorite = { ...input, name: input.name.trim(), id: newId(), order: nextOrder(d.favorites), deleted: false };
      await insertRows('favorites', [row], '자주 쓰는 지출을 추가하지 못했어요');
      return row;
    },
    [requireData, insertRows],
  );

  const recordFavorite = useCallback(
    async (id: Id): Promise<Expense> => {
      const { data: d } = requireData();
      const fav = d.favorites.find((f) => f.id === id && !f.deleted);
      if (!fav) throw new Error('자주 쓰는 지출을 찾을 수 없어요');
      const category = fav.categoryId ? d.categories.find((c) => c.id === fav.categoryId) : undefined;
      // 통장을 비워 둔 즐겨찾기: 생활비 카테고리는 누른 사람(나)의 생활비 통장에서 (PLAN 4-14)
      const mine = myLivingId ?? living?.livingAccountId ?? null;
      const accountId =
        fav.accountId ??
        (category ? (category.defaultAccountRole === 'fixed' ? (mine ?? undefined) : undefined) : undefined) ??
        (category ? accountByRole(category.defaultAccountRole)?.id : undefined) ??
        mine ??
        activeAccounts[0]?.id;
      if (!accountId) throw new Error('지출을 기록할 통장이 없어요');
      return addExpense({
        date: todayRef.current,
        amount: fav.amount,
        accountId,
        categoryId: fav.categoryId,
        memo: fav.name,
      });
    },
    [requireData, accountByRole, living, myLivingId, activeAccounts, addExpense],
  );

  /* ---------- 월말 ---------- */

  const decideMonthEnd = useCallback(
    async (choice: 'reservoir' | 'carryover') => {
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
    [requireData, setDataBoth, mutate, nowIso, withPendingWrites],
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

  const inviteMember = useCallback(
    async (email: string, name: string, incomeAccountId?: Id | null) => {
      const clean = email.trim();
      if (!/^[^\s@]+@[^\s@]+$/.test(clean)) throw new Error('이메일 주소를 확인해 주세요');
      const { repo } = requireData();
      const backend = backendFor(repo.ref);
      try {
        await backend.share(repo.ref, clean);
      } catch (e) {
        throw new Error(koreanMessage(e, '초대하지 못했어요. 잠시 뒤 다시 시도해 주세요'));
      }
      const member: Member = { email: clean, displayName: name.trim() || clean.split('@')[0] || clean };
      await upsertRow('members', member, '멤버를 저장하지 못했어요');
      if (incomeAccountId) await linkMemberAccount(clean, incomeAccountId);
    },
    [requireData, backendFor, upsertRow, linkMemberAccount],
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
      living,
      livingViews,
      myLivingAccountId: myLivingId,
      livingFor,
      spenders,
      mySpenderKey: mySpender,
      balances,
      eventProjection,
      shortageFix,
      pendingMonthEnd,
      activeAccounts,
      activeCategories,
      accountByRole,
      incomeAccounts,
      judge,
      claims,
      claimPayers,
      previewClaimDue,
      settleClaims,
      unsettleClaims,
      saveSettleDay,
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
      addEvent,
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
      addIncomePlan,
      saveIncomePlan,
      saveFixed,
      addFixed,
      saveCategory,
      addCategory,
      saveFavorite,
      addFavorite,
      recordFavorite,
      decideMonthEnd,
      inviteMember,
      linkMemberAccount,
      renameLedger,
      previewImport,
      importFile,
      displayName,
    }),
    [
      status, error, needsReconnect, ref, data, today, savingCount, reload, living, livingViews, myLivingId, livingFor, spenders,
      mySpender, addIncomePlan, saveIncomePlan, balances, eventProjection, shortageFix,
      pendingMonthEnd, activeAccounts, activeCategories, accountByRole, incomeAccounts, judge, claims, claimPayers,
      previewClaimDue, settleClaims, unsettleClaims, saveSettleDay, installments, installmentHint, addInstallment,
      reviseInstallment, prepayInstallment, endInstallment, deleteInstallment, trips, addTrip, updateTrip, deleteTrip,
      restoreTrip, addExpense, updateExpense,
      deleteExpense, addEvent, updateEvent, completeEvent, cancelEvent, deleteEvent, applyIncreaseMonthly,
      applyFromReservoir, saveAccount, addAccount, addTransfer, deleteTransfer, adjustBalance, saveRule, addRule,
      changeRuleAmount, saveFixed, addFixed, saveCategory, addCategory, saveFavorite, addFavorite, recordFavorite,
      decideMonthEnd, inviteMember, linkMemberAccount, renameLedger, displayName, previewImport, importFile,
    ],
  );

  return <LedgerContext.Provider value={api}>{children}</LedgerContext.Provider>;
}

export function useLedger(): LedgerApi {
  const v = useContext(LedgerContext);
  if (!v) throw new Error('useLedger 는 AppProviders 안에서만 쓸 수 있어요');
  return v;
}

