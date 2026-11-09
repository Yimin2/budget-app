'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createDefaultLedger, createDemoLedger, toISODate } from '@/domain';
import * as googleModule from '@/google';
import { LocalBackend, SheetsBackend } from '@/storage';
import type { LedgerBackend, LedgerRef } from '@/storage/types';
import { DEMO_LEDGER_ID, SESSION_KEY, browserStorage, readJson, removeKey, writeJson, type SessionStorageLike } from './storageKeys';
import type { SessionApi, SessionMode, SessionUser } from './types';

/* ---------- 바꿔 끼울 수 있는 의존성 (테스트 주입용) ---------- */

export interface GoogleDeps {
  isGoogleConfigured(): boolean;
  signIn(): Promise<{ email: string; name: string; picture: string | null }>;
  signOut(): void;
  restoreSession(emailHint: string): Promise<{ email: string; name: string; picture: string | null } | null>;
  pickSpreadsheet(): Promise<{ id: string; name: string } | null>;
  /** forceRefresh: 401 뒤 캐시된 토큰을 버리고 새로 받기 */
  getAccessToken(forceRefresh?: boolean): Promise<string>;
  /** 사용자 클릭 안에서 같은 계정으로 다시 연결 (없으면 getAccessToken(true) 로 대신) */
  reconnect?(emailHint: string): Promise<{ email: string; name: string; picture: string | null } | null>;
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
}

const defaultGoogle: GoogleDeps = {
  isGoogleConfigured: googleModule.isGoogleConfigured,
  signIn: googleModule.signIn,
  signOut: googleModule.signOut,
  restoreSession: googleModule.restoreSession,
  pickSpreadsheet: googleModule.pickSpreadsheet,
  getAccessToken: googleModule.getAccessToken,
  reconnect: googleModule.reconnect,
};

function buildDeps(partial?: Partial<StateDeps>): StateDeps {
  const google = partial?.google ?? defaultGoogle;
  return {
    google,
    local: partial?.local ?? new LocalBackend(),
    sheets: partial?.sheets ?? new SheetsBackend((forceRefresh) => google.getAccessToken(forceRefresh)),
    now: partial?.now ?? (() => new Date()),
    storage: partial && 'storage' in partial ? (partial.storage ?? null) : browserStorage(),
    restoreTimeoutMs: partial?.restoreTimeoutMs ?? 3000,
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
}

const SIGNED_OUT: SessionState = { status: 'signedOut', mode: null, user: null, recentLedgers: [], activeLedgerId: null };

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(restored);
    if (!isValidPersisted(saved)) return;
    if (saved.mode === 'google') {
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), deps.restoreTimeoutMs));
      Promise.race([deps.google.restoreSession(saved.user.email).catch(() => null), timeout])
        .then((user) => {
          if (!alive || !user) return;
          update((s) =>
            s.mode === 'google' && s.user?.email.toLowerCase() === user.email.toLowerCase()
              ? { ...s, user: { email: user.email, name: user.name, picture: user.picture } }
              : s,
          );
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [deps, update]);

  const startDemo = useCallback(async () => {
    const now = deps.now();
    let ref: LedgerRef;
    if (deps.local.has(DEMO_LEDGER_ID)) {
      try {
        ref = await deps.local.describe(DEMO_LEDGER_ID);
      } catch {
        ref = await deps.local.create(createDemoLedger(toISODate(now), now.toISOString(), { claims: true }), DEMO_LEDGER_ID);
      }
    } else {
      ref = await deps.local.create(createDemoLedger(toISODate(now), now.toISOString(), { claims: true }), DEMO_LEDGER_ID);
    }
    update((s) => ({
      status: 'signedIn',
      mode: 'demo',
      user: DEMO_USER,
      recentLedgers: withRecent(s.mode === 'demo' ? s.recentLedgers : [], ref),
      activeLedgerId: ref.id,
    }));
  }, [deps, update]);

  const signInWithGoogle = useCallback(async () => {
    const user = await deps.google.signIn();
    update((s) => {
      const same = s.mode === 'google' && s.user?.email.toLowerCase() === user.email.toLowerCase();
      return {
        status: 'signedIn',
        mode: 'google',
        user: { email: user.email, name: user.name, picture: user.picture },
        recentLedgers: same ? s.recentLedgers : [],
        activeLedgerId: same ? s.activeLedgerId : null,
      };
    });
  }, [deps, update]);

  const signOut = useCallback(() => {
    if (stateRef.current.mode === 'google') {
      try {
        deps.google.signOut();
      } catch {
        // 무시
      }
    }
    update(() => SIGNED_OUT);
  }, [deps, update]);

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
      googleAvailable,
      signInWithGoogle,
      startDemo,
      signOut,
      recentLedgers: state.recentLedgers,
      activeLedger,
      selectLedger,
      createLedger,
      openSharedLedger,
      forgetLedger,
      reconnectGoogle,
    }),
    [state, googleAvailable, signInWithGoogle, startDemo, signOut, activeLedger, selectLedger, createLedger, openSharedLedger, forgetLedger, reconnectGoogle],
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
