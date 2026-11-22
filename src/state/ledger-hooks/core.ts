import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  autoLinkOwnerEmails, AUTO_KIND_NOTICE, rulesToAutoKind, repairAllowanceAutoRules, migrateAllowanceRows,
  mergeMembers, type MemberSelf, type SharingList, 
  monthOf, pendingAllowanceIncome, pendingAutoRecords,
  projectEventAccount, pendingSnapshot, toISODate,
  accountsToPayee, incomeAccountsToMerge, autoMonthEnds, duplicateAutoIncome,
} from '@/domain';
import type { ISODate, LedgerData } from '@/domain/types';
import { isConflict } from '@/storage/sheets';
import type { LedgerRef, LedgerRepository, TableName, TableRows } from '@/storage/types';
import { isRefreshHeld, onRefreshGateChange } from '@/ui/refreshGate';
import { useSession, useSessionInternals } from '../session';
import type { LedgerApi } from '../types';
import {
  koreanMessage, isReconnectError, RECONNECT_MESSAGE, OWNER_LINK_NOTICE, OFFLINE_MESSAGE, OFFLINE_WRITE_MESSAGE, AUTO_REFRESH_MS,
  isNetworkFailure, type Keyed, upsertIn, insertIn, type PendingWrite, msUntilNextMidnight, type SyncMeta, type LoadedState, NO_SYNC,
} from './helpers';

/** 가계부 상태의 뼈대: 세션 · 불러오기 · 자동 새로고침 · 쓰기 공통(먼저 화면에 반영하고 저장) */
export function useLedgerCore() {
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
  const clockRef = useRef(0);
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
   * 통장은 월급 · 이벤트 · 저수지만 관리해요 (2026-11): 각자 생활비 · 용돈 통장은 '보낼 곳'으로 표시해요 (다시 해도 같음).
   * 지우는 기록은 없어요 — 그 사람 생활비 기록을 묶는 이름표로 계속 쓰고, 잔액만 안 보여요
   */
  const migratePayees = useCallback(
    async (repo: LedgerRepository, loaded: LedgerData): Promise<LedgerData> => {
      // 월급통장은 하나만: 다른 수입통장은 각자 통장으로 빼고 배분 · 수입 계획을 월급통장으로 옮겨요 (2026-11)
      const merge = incomeAccountsToMerge(loaded);
      const changed = [...accountsToPayee(loaded), ...merge.accounts];
      if (changed.length === 0) return loaded;
      try {
        if (merge.rules.length > 0) await repo.upsertMany('rules', merge.rules);
        if (merge.incomePlans.length > 0) await repo.upsertMany('incomePlans', merge.incomePlans);
        if (merge.transfers.length > 0) await repo.upsertMany('transfers', merge.transfers);
        await repo.upsertMany('accounts', changed);
      } catch {
        return loaded;
      }
      const byId = new Map(changed.map((a) => [a.id, a]));
      const ruleById = new Map(merge.rules.map((r) => [r.id, r]));
      const planById = new Map(merge.incomePlans.map((p) => [p.id, p]));
      const transferById = new Map(merge.transfers.map((t) => [t.id, t]));
      return {
        ...loaded,
        accounts: loaded.accounts.map((a) => byId.get(a.id) ?? a),
        rules: loaded.rules.map((r) => ruleById.get(r.id) ?? r),
        transfers: loaded.transfers.map((t) => transferById.get(t.id) ?? t),
        ...(loaded.incomePlans ? { incomePlans: loaded.incomePlans.map((p) => planById.get(p.id) ?? p) } : {}),
      };
    },
    [],
  );

  /**
   * 월급은 직접 기록해요 (PLAN 4-13, 2026-11): 예전에 수입 계획이 자동으로 만든 월급 기록(income:…) 중
   * 직접 기록한 월급과 겹치는 것만 지워요 (지운 표시, 다시 해도 같음). 겹친 게 있으면 한 번 알려요
   */
  const removeDuplicateIncome = useCallback(
    async (repo: LedgerRepository, loaded: LedgerData): Promise<LedgerData> => {
      const gone = duplicateAutoIncome(loaded, nowIso());
      if (gone.length === 0) return loaded;
      try {
        await repo.upsertMany('transfers', gone);
      } catch {
        // 보기 권한 등: 그대로 두고 다음에 열 때 다시 해 봐요
        return loaded;
      }
      setNotice(`직접 기록한 월급과 겹친 자동 월급 기록 ${gone.length}건을 지웠어요`);
      const byId = new Map(gone.map((t) => [t.id, t]));
      return { ...loaded, transfers: loaded.transfers.map((t) => byId.get(t.id) ?? t) };
    },
    [nowIso, setNotice],
  );

  /**
   * 넘친 돈만 있는 지난달(남은 항목 없음)은 묻지 않고 월말을 적어요 (2026-11): 넘친 항목을 다음 달 같은 항목 예산에서 빼요.
   * 쓰지 못하면(보기 권한 등) 그대로 두고 다음에 열 때 다시 해 봐요
   */
  const recordOverspentMonths = useCallback(
    async (repo: LedgerRepository, loaded: LedgerData): Promise<LedgerData> => {
      const rows = autoMonthEnds(loaded, todayRef.current, nowIso());
      if (rows.length === 0) return loaded;
      try {
        await repo.upsertMany('monthEnds', rows);
      } catch {
        return loaded;
      }
      const months = new Set(rows.map((r) => r.month));
      return { ...loaded, monthEnds: [...loaded.monthEnds.filter((m) => !months.has(m.month)), ...rows] };
    },
    [nowIso, todayRef],
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
          entry.doneAt = ++clockRef.current;
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
    const loadStart = ++clockRef.current;
    lastLoadAt.current = deps.now().getTime();
    setLoadingCount((n) => n + 1);
    try {
      const members = await syncMembers(repo, await repo.load());
      const moved = await migrateAllowances(repo, members);
      const repaired = await repairAllowanceRules(repo, moved, todayRef.current);
      const kinds = await migrateRuleKinds(repo, repaired, todayRef.current);
      const payees = await migratePayees(repo, kinds);
      const deduped = await removeDuplicateIncome(repo, payees);
      const fresh = await recordOverspentMonths(repo, deduped);
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
  }, [deps, nowIso, saveCache, setDataBoth, syncMembers, migrateAllowances, repairAllowanceRules, migrateRuleKinds, migratePayees, removeDuplicateIncome, recordOverspentMonths, syncAutoRecords, withPendingWrites, saveForecastSnapshot]);
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
        entry.doneAt = ++clockRef.current;
        // 시트에 저장됐으면 보관한 내용도 바꿔요 (맞춘 시각은 마지막 불러오기 그대로)
        const shown = dataRef.current;
        if (shown && shown.repo === repo && repoRef.current === repo) saveCache(repo, shown.data, syncRef.current.syncedAt);
      } catch (e) {
        writes.current = writes.current.filter((w) => w !== entry);
        const untouched = dataRef.current?.data === optimistic;
        if (untouched) setDataBoth(before);
        // 일부만 저장됐거나 그사이 다른 변경이 있었으면 저장본으로 맞춘다
        // 다른 기기가 먼저 고친 행이면(덮어쓰지 않고 멈춤) 그 내용을 바로 보여 준다
        if (opts?.multiStep || !untouched || isConflict(e)) void loadAll();
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

  return {
    session, deps, backendFor, updateRecent, author, ref, self, loaded, setLoaded, savingCount, setSavingCount, loadingCount,
    setLoadingCount, notices, setNotices, notice, setNotice, today, setToday, refKey, repository, repoRef, todayRef, authorRef, selfRef,
    cacheEmail, cacheEmailRef, syncRef, lastFailure, lastLoadAt, sharingRef, dataRef, loadToken, clockRef, writes, current, status, data,
    error, needsReconnect, syncedAt, fromCache, offline, setDataBoth, nowIso, saveCache, withPendingWrites, syncAutoRecords, syncMembers,
    repairAllowanceRules, migrateRuleKinds, migrateAllowances, snapshotKeys, saveForecastSnapshot, loadAll, loadAllRef, deferredRefresh,
    autoRefresh, lastSyncedDay, requireData, requireOnline, mutate, upsertRow, insertRows, stamp,
  };
}

export type LedgerCoreCtx = ReturnType<typeof useLedgerCore>;
