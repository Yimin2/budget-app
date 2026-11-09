'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addMonths,
  adjustmentDelta,
  allBalances,
  autoTransferId,
  compareMonth,
  computeLiving,
  dateInMonth,
  decideMonthEnd as decideMonthEndDomain,
  judgeEvent,
  judgeLiving,
  isMonthActive,
  monthOf,
  newId,
  nextOccurrenceDate,
  nextOccurrenceId,
  pendingAllowanceIncome,
  pendingAutoRecords,
  pendingMonthEnd as pendingMonthEndDomain,
  projectEventAccount,
  seriesAnchorDay,
  suggestShortageFixes,
  toISODate,
} from '@/domain';
import type {
  Account,
  AllocationRule,
  Category,
  Expense,
  Favorite,
  FixedExpense,
  Id,
  ISODate,
  LedgerData,
  Member,
  PlannedEvent,
  Transfer,
  Won,
  YearMonth,
} from '@/domain/types';
import { isGoogleError } from '@/google/errors';
import { StorageError } from '@/storage/sheets';
import type { LedgerRef, LedgerRepository, TableName, TableRows } from '@/storage/types';
import { useSession, useSessionInternals } from './session';
import type { LedgerApi, NewEvent, NewExpense } from './types';

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

  const judge = useCallback<LedgerApi['judge']>(
    (amount, source, categoryId) => {
      if (!data) return null;
      if (source === 'living') {
        if (!living) return null;
        if (categoryId === undefined) {
          const budgeted = living.items.filter((i) => !i.unbudgeted);
          if (budgeted.length !== 1) return null;
          return judgeLiving(living, budgeted[0]!.categoryId, amount);
        }
        return judgeLiving(living, categoryId, amount);
      }
      return judgeEvent(data, today, amount);
    },
    [data, living, today],
  );

  const displayName = useCallback(
    (email: string) => {
      const m = data?.members.find((x) => x.email.toLowerCase() === email.toLowerCase());
      if (m?.displayName) return m.displayName;
      return email.split('@')[0] || email;
    },
    [data],
  );

  /* ---------- 지출 ---------- */

  const addExpense = useCallback(
    async (input: NewExpense): Promise<Expense> => {
      if (!(input.amount > 0)) throw new Error('금액을 입력해 주세요');
      const row: Expense = {
        id: newId(),
        date: input.date,
        amount: Math.round(input.amount),
        accountId: input.accountId,
        categoryId: input.categoryId,
        memo: input.memo ?? '',
        eventId: input.eventId ?? null,
        fixedExpenseId: null,
        ...stamp(),
      };
      await insertRows('expenses', [row], '지출을 기록하지 못했어요');
      return row;
    },
    [insertRows, stamp],
  );

  const updateExpense = useCallback(
    (expense: Expense) => upsertRow('expenses', { ...expense, updatedAt: nowIso() }, '지출을 고치지 못했어요'),
    [upsertRow, nowIso],
  );

  const deleteExpense = useCallback(
    async (id: Id) => {
      const row = requireData().data.expenses.find((e) => e.id === id);
      if (!row) throw new Error('지출 기록을 찾을 수 없어요');
      await upsertRow('expenses', { ...row, deleted: true, updatedAt: nowIso() }, '지출을 지우지 못했어요');
    },
    [requireData, upsertRow, nowIso],
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
      await upsertRow('rules', rule, '매달 배분을 저장하지 못했어요');
      await syncAutoNow();
    },
    [upsertRow, syncAutoNow],
  );

  const addRule = useCallback(
    async (input: Omit<AllocationRule, 'id' | 'deleted'>): Promise<AllocationRule> => {
      if (input.fromAccountId === input.toAccountId) throw new Error('보내는 통장과 받는 통장이 같아요');
      const row: AllocationRule = { ...input, id: newId(), deleted: false };
      await insertRows('rules', [row], '매달 배분을 추가하지 못했어요');
      await syncAutoNow();
      return row;
    },
    [insertRows, syncAutoNow],
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
      const accountId =
        fav.accountId ??
        (category ? accountByRole(category.defaultAccountRole)?.id : undefined) ??
        living?.livingAccountId ??
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
    [requireData, accountByRole, living, activeAccounts, addExpense],
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
      const { monthEnd, transfer } = decideMonthEndDomain(
        latest,
        pending.month,
        pending.leftover,
        choice,
        authorRef.current,
        nowIso(),
        pending.items.map((i) => ({ categoryId: i.categoryId, leftover: i.leftover })),
      );
      await mutate(
        (x) => ({
          ...x,
          monthEnds: upsertIn(x.monthEnds, monthEnd),
          transfers: insertIn(x.transfers, transfer ? [transfer] : []),
        }),
        async (r) => {
          // 이체(결정적 id)를 먼저, 월말 행은 마지막에. 이체는 월말 행이 '저수지'일 때만 잔액에 들어간다
          if (transfer) await r.insert('transfers', [transfer]);
          await r.upsert('monthEnds', monthEnd);
        },
        '월말 처리를 저장하지 못했어요',
        { multiStep: true },
      );
    },
    [requireData, setDataBoth, mutate, nowIso, withPendingWrites],
  );

  /* ---------- 멤버·이름 ---------- */

  const inviteMember = useCallback(
    async (email: string, name: string) => {
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
    },
    [requireData, backendFor, upsertRow],
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
      balances,
      eventProjection,
      shortageFix,
      pendingMonthEnd,
      activeAccounts,
      activeCategories,
      accountByRole,
      incomeAccounts,
      judge,
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
      saveFixed,
      addFixed,
      saveCategory,
      addCategory,
      saveFavorite,
      addFavorite,
      recordFavorite,
      decideMonthEnd,
      inviteMember,
      renameLedger,
      displayName,
    }),
    [
      status, error, needsReconnect, ref, data, today, savingCount, reload, living, balances, eventProjection, shortageFix,
      pendingMonthEnd, activeAccounts, activeCategories, accountByRole, incomeAccounts, judge, addExpense, updateExpense,
      deleteExpense, addEvent, updateEvent, completeEvent, cancelEvent, deleteEvent, applyIncreaseMonthly,
      applyFromReservoir, saveAccount, addAccount, addTransfer, deleteTransfer, adjustBalance, saveRule, addRule,
      changeRuleAmount, saveFixed, addFixed, saveCategory, addCategory, saveFavorite, addFavorite, recordFavorite,
      decideMonthEnd, inviteMember, renameLedger, displayName,
    ],
  );

  return <LedgerContext.Provider value={api}>{children}</LedgerContext.Provider>;
}

export function useLedger(): LedgerApi {
  const v = useContext(LedgerContext);
  if (!v) throw new Error('useLedger 는 AppProviders 안에서만 쓸 수 있어요');
  return v;
}

