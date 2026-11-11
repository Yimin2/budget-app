'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createDefaultLedger, createDemoLedger, toISODate } from '@/domain';
import * as googleModule from '@/google';
import { createLedgerCache, LocalBackend, SheetsBackend, type LedgerCache } from '@/storage';
import type { LedgerBackend, LedgerRef } from '@/storage/types';
import { openInviteDirect, openInvitedLedger as runInviteOpen, type DirectOpenResult, type InviteOpenResult } from './invite';
import { DEMO_LEDGER_ID, REMEMBER_KEY, SESSION_KEY, browserStorage, readJson, removeKey, writeJson, type SessionStorageLike } from './storageKeys';
import type { SessionApi, SessionMode, SessionUser } from './types';

/* ---------- 바꿔 끼울 수 있는 의존성 (테스트 주입용) ---------- */

type GoogleUserInfo = { email: string; name: string; picture: string | null };

export interface GoogleDeps {
  isGoogleConfigured(): boolean;
  /** 서버 로그인이면 구글 로그인 화면으로 이동해서 끝나지 않아요 (돌아오면 returnTo) */
  signIn(opts?: { returnTo?: string }): Promise<GoogleUserInfo>;
  /** revoke: 앱 권한 철회 (모든 기기에서 로그아웃) */
  signOut(opts?: { revoke?: boolean }): void;
  restoreSession(emailHint: string): Promise<{ email: string; name: string; picture: string | null } | null>;
  /** opts.fileId: 그 파일을 미리 골라 둔 선택 창 (초대 링크) */
  pickSpreadsheet(opts?: { fileId?: string }): Promise<{ id: string; name: string } | null>;
  /** forceRefresh: 401 뒤 캐시된 토큰을 버리고 새로 받기 */
  getAccessToken(forceRefresh?: boolean): Promise<string>;
  /** 사용자 클릭 안에서 같은 계정으로 다시 연결 (없으면 getAccessToken(true) 로 대신) */
  reconnect?(emailHint: string): Promise<{ email: string; name: string; picture: string | null } | null>;
  /**
   * 로그아웃 상태에서 로그인 서버 쿠키로 이어서 쓰기. force: 구글 로그인 화면에서 막 돌아왔어요.
   * 만료면 GoogleError('session_expired'). 없으면 이 단계를 건너뛰어요
   */
  resumeServerSession?(opts?: { force?: boolean }): Promise<GoogleUserInfo | null>;
  /** 서버가 로그인 만료 · 없음을 알리면 불러요. 구독 해제 함수를 돌려줘요 */
  onSessionEnded?(listener: (reason: 'expired' | 'signed_out') => void): () => void;
  /** 로그인 서버가 돌려보낸 표시 (?auth=1 · ?auth_error=) 를 읽고 주소에서 지워요 */
  consumeAuthReturn?(): { returned: boolean; error: string | null };
}

export interface StateDeps {
  google: GoogleDeps;
  /** 브라우저 저장 백엔드 (체험 모드) */
  local: LocalBackend;
  /** 구글 시트 백엔드 */
  sheets: LedgerBackend;
  /** 현재 시각 (테스트에서 고정) */
  now: () => Date;
  /** 세션 저장소 (기본 localStorage) */
  storage: SessionStorageLike | null;
  /** google 모드 조용한 복구를 기다리는 최대 시간(ms) */
  restoreTimeoutMs: number;
  /**
   * 체험 가계부를 부부 예시(월급통장 하나 · 수입 계획 · 나머지 배분 · 사람별 생활비, PLAN 4-13 · 4-14)로 만들지.
   * 기본 true. 예전 예시(사람별 수입통장)의 숫자에 기대는 테스트는 false
   */
  demoCouple: boolean;
  /**
   * 체험 가계부에 이벤트통장 지난 12개월 기록(적립 · 지난 일정 · 예측 기록)을 넣을지 (PLAN 4-2 지난 달 막대).
   * 기본 true. 이번 달부터 시작하는 예시 숫자에 기대는 테스트는 false
   */
  demoHistory: boolean;
  /**
   * 구글 시트 가계부의 마지막 내용 보관 (PLAN 7). 기본은 IndexedDB(안 되면 메모리). null 이면 보관하지 않아요.
   * 로그아웃 · 계정이 바뀌면 지워요
   */
  cache: LedgerCache | null;
}

const defaultGoogle: GoogleDeps = {
  isGoogleConfigured: googleModule.isGoogleConfigured,
  signIn: googleModule.signIn,
  signOut: googleModule.signOut,
  restoreSession: googleModule.restoreSession,
  pickSpreadsheet: googleModule.pickSpreadsheet,
  getAccessToken: googleModule.getAccessToken,
  reconnect: googleModule.reconnect,
  resumeServerSession: googleModule.resumeServerSession,
  onSessionEnded: googleModule.onSessionEnded,
  consumeAuthReturn: googleModule.consumeAuthReturn,
};

export const EXPIRED_NOTICE = '로그인이 만료됐어요. 다시 로그인해 주세요';

/** 로그인 서버가 돌려보낸 오류 코드 → 화면 문구 */
export function authErrorMessage(code: string): string {
  switch (code) {
    case 'consent_denied':
      return '구글 드라이브 권한을 허용해야 쓸 수 있어요. 다시 로그인해 주세요';
    case 'state':
      return '로그인 확인 시간이 지났어요. 다시 로그인해 주세요';
    case 'unconfigured':
      return '구글 로그인 서버가 아직 설정되지 않았어요';
    case 'expired':
      return EXPIRED_NOTICE;
    default:
      return '구글 로그인을 마치지 못했어요. 다시 시도해 주세요';
  }
}

function buildDeps(partial?: Partial<StateDeps>): StateDeps {
  const google = partial?.google ?? defaultGoogle;
  return {
    google,
    local: partial?.local ?? new LocalBackend(),
    sheets: partial?.sheets ?? new SheetsBackend((forceRefresh) => google.getAccessToken(forceRefresh)),
    now: partial?.now ?? (() => new Date()),
    storage: partial && 'storage' in partial ? (partial.storage ?? null) : browserStorage(),
    restoreTimeoutMs: partial?.restoreTimeoutMs ?? 3000,
    demoCouple: partial?.demoCouple ?? true,
    demoHistory: partial?.demoHistory ?? true,
    cache: partial && 'cache' in partial ? (partial.cache ?? null) : createLedgerCache(),
  };
}

/* ---------- 저장 형태 ---------- */

interface PersistedSession {
  mode: SessionMode;
  user: SessionUser;
  recentLedgers: LedgerRef[];
  activeLedgerId: string | null;
}

interface SessionState {
  status: SessionApi['status'];
  mode: SessionMode | null;
  user: SessionUser | null;
  recentLedgers: LedgerRef[];
  activeLedgerId: string | null;
  /** 로그인 화면에 보여 줄 안내 (로그인 만료 등) */
  notice?: string | null;
}

const SIGNED_OUT: SessionState = { status: 'signedOut', mode: null, user: null, recentLedgers: [], activeLedgerId: null };

interface Remembered {
  email: string;
  recentLedgers: LedgerRef[];
  activeLedgerId: string | null;
}

function isRemembered(v: unknown): v is Remembered {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<Remembered>;
  return typeof r.email === 'string' && Array.isArray(r.recentLedgers);
}

const sameEmail = (a: string | undefined | null, b: string | undefined | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export const DEMO_USER: SessionUser = { email: 'minji@demo', name: '민지', picture: null };

function isValidPersisted(v: unknown): v is PersistedSession {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<PersistedSession>;
  return (
    (p.mode === 'demo' || p.mode === 'google') &&
    !!p.user &&
    typeof p.user.email === 'string' &&
    Array.isArray(p.recentLedgers)
  );
}

function withRecent(list: LedgerRef[], ref: LedgerRef): LedgerRef[] {
  return [ref, ...list.filter((r) => r.id !== ref.id)];
}

function koreanMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && /[가-힣]/.test(e.message)) return e.message;
  return fallback;
}

/* ---------- 내부 컨텍스트 (LedgerProvider 용) ---------- */

export interface SessionInternals {
  deps: StateDeps;
  backendFor(ref: Pick<LedgerRef, 'source'>): LedgerBackend;
  /** 가계부 이름이 바뀌면 최근 목록도 고친다 */
  updateRecent(ref: LedgerRef): void;
}

const SessionContext = createContext<SessionApi | null>(null);
const InternalsContext = createContext<SessionInternals | null>(null);

export function SessionProvider({ children, deps: partialDeps }: { children: ReactNode; deps?: Partial<StateDeps> }) {
  const [deps] = useState<StateDeps>(() => buildDeps(partialDeps));

  const [state, setState] = useState<SessionState>({ ...SIGNED_OUT, status: 'loading' });
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // 저장: signedIn 일 때만 기록 (loading 중에는 건드리지 않음)
  const persist = useCallback(
    (s: SessionState) => {
      if (s.status === 'signedIn' && s.mode && s.user) {
        const p: PersistedSession = {
          mode: s.mode,
          user: s.user,
          recentLedgers: s.recentLedgers,
          activeLedgerId: s.activeLedgerId,
        };
        writeJson(deps.storage, SESSION_KEY, p);
      } else if (s.status === 'signedOut') {
        removeKey(deps.storage, SESSION_KEY);
      }
    },
    [deps],
  );

  const update = useCallback(
    (fn: (s: SessionState) => SessionState) => {
      setState((prev) => {
        const next = fn(prev);
        stateRef.current = next;
        persist(next);
        return next;
      });
    },
    [persist],
  );

  /** 구글로 로그인됨: 같은 계정이면 최근 가계부를 그대로, 만료로 남겨 둔 목록이 같은 계정이면 되살려요 */
  const signedInAs = useCallback(
    (user: GoogleUserInfo) => {
      const remembered = readJson<unknown>(deps.storage, REMEMBER_KEY);
      const back = isRemembered(remembered) && sameEmail(remembered.email, user.email) ? remembered : null;
      if (isRemembered(remembered)) removeKey(deps.storage, REMEMBER_KEY);
      // 다른 계정이 남긴 가계부 보관 내용은 지워요
      void deps.cache?.retainOnly(user.email);
      update((s) => {
        const same = s.mode === 'google' && sameEmail(s.user?.email, user.email);
        return {
          status: 'signedIn',
          mode: 'google',
          user: { email: user.email, name: user.name, picture: user.picture },
          recentLedgers: same ? s.recentLedgers : (back?.recentLedgers ?? []),
          activeLedgerId: same ? s.activeLedgerId : (back?.activeLedgerId ?? null),
          notice: null,
        };
      });
    },
    [deps, update],
  );

  // 처음 불러오기
  useEffect(() => {
    let alive = true;
    const saved = readJson<unknown>(deps.storage, SESSION_KEY);
    const restored: SessionState = isValidPersisted(saved)
      ? {
          status: 'signedIn',
          mode: saved.mode,
          user: saved.user,
          recentLedgers: saved.recentLedgers,
          activeLedgerId: saved.activeLedgerId ?? null,
        }
      : SIGNED_OUT;
    // 브라우저 저장소는 하이드레이션 뒤에만 읽을 수 있어 effect 안에서 한 번 반영한다.
    // 화면은 바로 띄운다. google 토큰은 첫 API 호출 때 받는다
    let authReturn: { returned: boolean; error: string | null } = { returned: false, error: null };
    try {
      authReturn = deps.google.consumeAuthReturn?.() ?? authReturn;
    } catch {
      // 무시
    }
    const notice = authReturn.error ? authErrorMessage(authReturn.error) : null;
    let googleOn = false;
    try {
      googleOn = deps.google.isGoogleConfigured();
    } catch {
      googleOn = false;
    }
    const timeout = () => new Promise<null>((resolve) => setTimeout(() => resolve(null), deps.restoreTimeoutMs));

    if (!isValidPersisted(saved)) {
      const resume = deps.google.resumeServerSession;
      if (!googleOn || !resume) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState({ ...restored, notice });
        return;
      }
      // 구글 로그인 화면에서 돌아왔거나 예전에 로그인했으면 로그인 서버 쿠키로 이어서 써요 (팝업 없이)
      setState({ ...SIGNED_OUT, status: 'loading', notice });
      Promise.race([resume({ force: authReturn.returned }), timeout()])
        .then((user) => {
          if (!alive) return;
          if (user) signedInAs(user);
          else update((s) => (s.status === 'loading' ? { ...SIGNED_OUT, notice: s.notice ?? null } : s));
        })
        .catch((e: unknown) => {
          if (!alive) return;
          const expired = e instanceof Error && 'code' in e && (e as { code?: string }).code === 'session_expired';
          update((s) => (s.status === 'loading' ? { ...SIGNED_OUT, notice: expired ? EXPIRED_NOTICE : (s.notice ?? null) } : s));
        });
      return () => {
        alive = false;
      };
    }

    setState({ ...restored, notice });
    if (saved.mode === 'google') {
      Promise.race([deps.google.restoreSession(saved.user.email).catch(() => null), timeout()])
        .then((user) => {
          if (!alive || !user) return;
          const s = stateRef.current;
          if (s.mode !== 'google') return;
          if (sameEmail(s.user?.email, user.email)) {
            update((x) => (x.mode === 'google' && sameEmail(x.user?.email, user.email) ? { ...x, user: { email: user.email, name: user.name, picture: user.picture } } : x));
          } else {
            // 로그인 서버 쿠키가 다른 계정이에요 (다른 탭에서 계정을 바꿈) → 그 계정으로
            signedInAs(user);
          }
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [deps, update, signedInAs]);

  // 서버가 로그인 만료(갱신 토큰 끝남)를 알리면 로그인 화면으로. 최근 가계부는 같은 계정으로 돌아오면 되살려요
  useEffect(() => {
    if (!deps.google.onSessionEnded) return;
    return deps.google.onSessionEnded((reason) => {
      const s = stateRef.current;
      if (s.mode !== 'google' || !s.user) return;
      const r: Remembered = { email: s.user.email, recentLedgers: s.recentLedgers, activeLedgerId: s.activeLedgerId };
      writeJson(deps.storage, REMEMBER_KEY, r);
      update(() => ({ ...SIGNED_OUT, notice: reason === 'expired' ? EXPIRED_NOTICE : '구글 로그인이 끝났어요. 다시 로그인해 주세요' }));
    });
  }, [deps, update]);

  const startDemo = useCallback(async () => {
    const now = deps.now();
    let ref: LedgerRef;
    if (deps.local.has(DEMO_LEDGER_ID)) {
      try {
        ref = await deps.local.describe(DEMO_LEDGER_ID);
      } catch {
        ref = await deps.local.create(createDemoLedger(toISODate(now), now.toISOString(), { claims: true, installments: true, trips: true, couple: deps.demoCouple, history: deps.demoHistory }), DEMO_LEDGER_ID);
      }
    } else {
      ref = await deps.local.create(createDemoLedger(toISODate(now), now.toISOString(), { claims: true, installments: true, trips: true, couple: deps.demoCouple, history: deps.demoHistory }), DEMO_LEDGER_ID);
    }
    update((s) => ({
      notice: null,
      status: 'signedIn',
      mode: 'demo',
      user: DEMO_USER,
      recentLedgers: withRecent(s.mode === 'demo' ? s.recentLedgers : [], ref),
      activeLedgerId: ref.id,
    }));
  }, [deps, update]);

  const signInWithGoogle = useCallback(
    async (opts?: { returnTo?: string }) => {
      const user = await (opts ? deps.google.signIn(opts) : deps.google.signIn());
      signedInAs(user);
    },
    [deps, signedInAs],
  );

  const signOut = useCallback(
    (opts?: { everywhere?: boolean }) => {
      if (stateRef.current.mode === 'google') {
        try {
          if (opts?.everywhere) deps.google.signOut({ revoke: true });
          else deps.google.signOut();
        } catch {
          // 무시
        }
      }
      removeKey(deps.storage, REMEMBER_KEY);
      void deps.cache?.clear();
      update(() => SIGNED_OUT);
    },
    [deps, update],
  );

  /** 구글 다시 연결 — 버튼 클릭 안에서 불러야 창이 막히지 않는다 (await 전에 요청) */
  const reconnectGoogle = useCallback(async () => {
    const s = stateRef.current;
    if (s.mode !== 'google' || !s.user) return;
    const email = s.user.email;
    const pending = deps.google.reconnect ? deps.google.reconnect(email) : deps.google.getAccessToken(true).then(() => null);
    const user = await pending;
    if (user && user.email.toLowerCase() === email.toLowerCase()) {
      update((x) =>
        x.mode === 'google' && x.user?.email.toLowerCase() === user.email.toLowerCase()
          ? { ...x, user: { email: user.email, name: user.name, picture: user.picture } }
          : x,
      );
    }
  }, [deps, update]);

  const backendFor = useCallback(
    (ref: Pick<LedgerRef, 'source'>): LedgerBackend => (ref.source === 'local' ? deps.local : deps.sheets),
    [deps],
  );

  const selectLedger = useCallback(
    (ref: LedgerRef) => {
      update((s) => ({ ...s, recentLedgers: withRecent(s.recentLedgers, ref), activeLedgerId: ref.id }));
    },
    [update],
  );

  const createLedger = useCallback<SessionApi['createLedger']>(
    async (input) => {
      const s = stateRef.current;
      if (s.status !== 'signedIn' || !s.user || !s.mode) throw new Error('먼저 로그인해 주세요');
      const name = input.name.trim();
      if (!name) throw new Error('가계부 이름을 입력해 주세요');
      const now = deps.now();
      const data = createDefaultLedger(input.kind, name, toISODate(now), now.toISOString(), s.user.email, s.user.name);
      if (input.kind === 'personal' && input.sharedLedgerId) data.settings.sharedLedgerId = input.sharedLedgerId;
      const backend: LedgerBackend = s.mode === 'demo' ? deps.local : deps.sheets;
      let ref: LedgerRef;
      try {
        ref = await backend.create(data);
      } catch (e) {
        throw new Error(koreanMessage(e, '가계부를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요'));
      }
      selectLedger(ref);
      return ref;
    },
    [deps, selectLedger],
  );

  const openSharedLedger = useCallback(async (): Promise<LedgerRef | null> => {
    const s = stateRef.current;
    if (s.mode !== 'google') return null;
    const picked = await deps.google.pickSpreadsheet();
    if (!picked) return null;
    let ref: LedgerRef;
    try {
      ref = await deps.sheets.describe(picked.id);
    } catch (e) {
      throw new Error(koreanMessage(e, '이 파일은 가계부로 열 수 없어요'));
    }
    selectLedger(ref);
    return ref;
  }, [deps, selectLedger]);

  const openInvitedLedger = useCallback(
    async (spreadsheetId: string): Promise<InviteOpenResult> => {
      const s = stateRef.current;
      if (s.status !== 'signedIn' || s.mode !== 'google') throw new Error('초대 링크는 구글로 로그인해야 열 수 있어요');
      const result = await runInviteOpen(
        {
          describe: (id) => deps.sheets.describe(id),
          pick: (fileId) => deps.google.pickSpreadsheet({ fileId }),
        },
        spreadsheetId,
      );
      if (result.kind === 'opened') selectLedger(result.ref);
      return result;
    },
    [deps, selectLedger],
  );

  const openLedgerDirect = useCallback(
    async (spreadsheetId: string): Promise<DirectOpenResult> => {
      const s = stateRef.current;
      if (s.status !== 'signedIn' || s.mode !== 'google') throw new Error('공유받은 가계부는 구글로 로그인해야 열 수 있어요');
      const result = await openInviteDirect({ describe: (id) => deps.sheets.describe(id) }, spreadsheetId);
      if (result.kind === 'opened') selectLedger(result.ref);
      return result;
    },
    [deps, selectLedger],
  );

  const forgetLedger = useCallback(
    (id: string) => {
      update((s) => ({
        ...s,
        recentLedgers: s.recentLedgers.filter((r) => r.id !== id),
        activeLedgerId: s.activeLedgerId === id ? null : s.activeLedgerId,
      }));
    },
    [update],
  );

  const updateRecent = useCallback(
    (ref: LedgerRef) => {
      update((s) =>
        s.recentLedgers.some((r) => r.id === ref.id)
          ? { ...s, recentLedgers: s.recentLedgers.map((r) => (r.id === ref.id ? ref : r)) }
          : s,
      );
    },
    [update],
  );

  const googleAvailable = useMemo(() => {
    try {
      return deps.google.isGoogleConfigured();
    } catch {
      return false;
    }
  }, [deps]);

  const activeLedger = useMemo(
    () => state.recentLedgers.find((r) => r.id === state.activeLedgerId) ?? null,
    [state.recentLedgers, state.activeLedgerId],
  );

  const api = useMemo<SessionApi>(
    () => ({
      status: state.status,
      mode: state.mode,
      user: state.user,
      notice: state.notice ?? null,
      googleAvailable,
      signInWithGoogle,
      startDemo,
      signOut,
      recentLedgers: state.recentLedgers,
      activeLedger,
      selectLedger,
      createLedger,
      openSharedLedger,
      openInvitedLedger,
      openLedgerDirect,
      forgetLedger,
      reconnectGoogle,
    }),
    [
      state, googleAvailable, signInWithGoogle, startDemo, signOut, activeLedger, selectLedger, createLedger, openSharedLedger,
      openInvitedLedger, openLedgerDirect, forgetLedger, reconnectGoogle,
    ],
  );

  const internals = useMemo<SessionInternals>(() => ({ deps, backendFor, updateRecent }), [deps, backendFor, updateRecent]);

  return (
    <InternalsContext.Provider value={internals}>
      <SessionContext.Provider value={api}>{children}</SessionContext.Provider>
    </InternalsContext.Provider>
  );
}

export function useSession(): SessionApi {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession 은 AppProviders 안에서만 쓸 수 있어요');
  return v;
}

/** state 내부 전용 */
export function useSessionInternals(): SessionInternals {
  const v = useContext(InternalsContext);
  if (!v) throw new Error('AppProviders 가 필요해요');
  return v;
}
