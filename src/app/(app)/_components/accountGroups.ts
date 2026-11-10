/* 통장 고르기(AccountPicker)의 순수 도우미: 사람별 묶기 · 짧은 이름 · 최근 쓴 통장 */
import { ledgerPeople, nameMatchesOwner } from '@/domain';
import type { Account, Id, LedgerData } from '@/domain/types';
import { RECENT_ACCOUNTS_KEY } from '@/state';

const RECENT_MAX = 12;

export type AccountGroupKind = 'me' | 'other' | 'shared';

export interface AccountGroup {
  /** 사람 키 (이메일 소문자 · 'name:이름' · '' = 함께) */
  key: string;
  kind: AccountGroupKind;
  /** 묶음 머리: '나 · 민지' · '준호' · '함께' */
  label: string;
  accounts: Account[];
}

function lower(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 통장 주인 (사람 키 · 부를 이름). 이메일이 멤버와 맞으면 그 멤버, 이메일이 없으면 이름이 맞는 멤버 한 명,
 * 그래도 없으면 주인 이름. 주인이 없으면 null (함께 쓰는 통장)
 */
export function accountOwner(data: LedgerData | null, account: Pick<Account, 'ownerName' | 'ownerEmail'>): { key: string; name: string } | null {
  const email = lower(account.ownerEmail);
  const ownerName = (account.ownerName ?? '').trim();
  const people = data ? ledgerPeople(data) : [];
  if (email) {
    const p = people.find((x) => lower(x.email) === email);
    return { key: email, name: p?.name || ownerName || email.split('@')[0] || email };
  }
  if (!ownerName) return null;
  const byName = people.filter((p) => p.name === ownerName || nameMatchesOwner(p.displayName, ownerName, p.email));
  if (byName.length === 1) return { key: lower(byName[0]!.email), name: byName[0]!.name || ownerName };
  return { key: `name:${ownerName}`, name: ownerName };
}

/** 통장 이름에서 주인 이름을 뺀 짧은 이름: '생활비(민지)' → '생활비', '민지 수입통장' → '수입통장' */
export function baseAccountName(name: string, owner: string | null): string {
  const n = name.trim();
  if (!owner) return n;
  const o = escapeRe(owner.trim());
  const stripped = n
    .replace(new RegExp(`\\s*[(（]\\s*${o}\\s*[)）]\\s*`, 'g'), ' ')
    .replace(new RegExp(`^${o}(\\s+|\\s*[·-]\\s*)`), '')
    .replace(new RegExp(`(\\s+|\\s*[·-]\\s*)${o}$`), '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || n;
}

/** 닫힌 단추에 보일 짧은 이름: '생활비 · 민지' · '이벤트통장' (지운 통장은 '(지운 통장)') */
export function accountShortLabel(data: LedgerData | null, account: Account): string {
  const owner = accountOwner(data, account);
  const base = baseAccountName(account.name, owner?.name ?? null);
  const label = owner ? `${base} · ${owner.name}` : base;
  return account.deleted ? `${label} (지운 통장)` : label;
}

/** 로그인한 나의 사람 키: 내 생활비 통장 주인 → 내 이메일 (모르면 null) */
export function meKeyOf(data: LedgerData | null, meEmail: string | null | undefined, myLivingAccountId: Id | null | undefined): string | null {
  if (data && myLivingAccountId) {
    const acc = data.accounts.find((a) => a.id === myLivingAccountId);
    const owner = acc ? accountOwner(data, acc) : null;
    if (owner) return owner.key;
  }
  const email = lower(meEmail);
  if (email && data && data.accounts.some((a) => !a.deleted && accountOwner(data, a)?.key === email)) return email;
  return null;
}

export interface GroupOptions {
  meKey: string | null;
  /** 최근 고른 통장 id (최근 것이 앞) */
  recent?: Id[];
  /** 묶음 안에서 앞에 둘 통장 (예: 수입을 기록할 때 수입통장) */
  prefer?: (a: Account) => boolean;
}

/**
 * 통장을 사람별로 묶어요: 나 → 다른 사람(가계부 사람 순) → 함께.
 * 묶음 안에서는 앞에 둘 통장 → 최근 고른 통장(최근 순) → 통장 순서
 */
export function groupAccounts(data: LedgerData | null, accounts: Account[], opts: GroupOptions): AccountGroup[] {
  const recent = opts.recent ?? [];
  const peopleOrder = (data ? ledgerPeople(data) : []).map((p) => lower(p.email));
  const groups = new Map<string, AccountGroup>();
  const firstSeen: string[] = [];
  for (const a of accounts) {
    const owner = accountOwner(data, a);
    const key = owner?.key ?? '';
    let g = groups.get(key);
    if (!g) {
      const kind: AccountGroupKind = key === '' ? 'shared' : opts.meKey && key === opts.meKey ? 'me' : 'other';
      const label = kind === 'shared' ? '함께' : kind === 'me' ? `나 · ${owner!.name}` : owner!.name;
      g = { key, kind, label, accounts: [] };
      groups.set(key, g);
      firstSeen.push(key);
    }
    g.accounts.push(a);
  }
  const kindRank = { me: 0, other: 1, shared: 2 } as const;
  const personRank = (key: string) => {
    const i = peopleOrder.indexOf(key);
    return i >= 0 ? i : peopleOrder.length + firstSeen.indexOf(key);
  };
  const recentRank = (id: Id) => {
    const i = recent.indexOf(id);
    return i >= 0 ? i : Number.MAX_SAFE_INTEGER;
  };
  const preferRank = (a: Account) => (opts.prefer?.(a) ? 0 : 1);
  return [...groups.values()]
    .sort((x, y) => kindRank[x.kind] - kindRank[y.kind] || personRank(x.key) - personRank(y.key))
    .map((g) => ({
      ...g,
      accounts: [...g.accounts].sort(
        (x, y) => preferRank(x) - preferRank(y) || recentRank(x.id) - recentRank(y.id) || x.order - y.order,
      ),
    }));
}

/** 최근 고른 통장 읽기 */
export function readRecentAccounts(): Id[] {
  try {
    if (typeof window === 'undefined') return [];
    const v: unknown = JSON.parse(window.localStorage.getItem(RECENT_ACCOUNTS_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 고른 통장을 최근 목록 맨 앞에 */
export function pushRecentAccount(id: Id): Id[] {
  const next = [id, ...readRecentAccounts().filter((x) => x !== id)].slice(0, RECENT_MAX);
  try {
    window.localStorage.setItem(RECENT_ACCOUNTS_KEY, JSON.stringify(next));
  } catch {
    // 사생활 보호 모드 · 저장 공간 부족은 무시 (최근 순서만 없어요)
  }
  return next;
}
