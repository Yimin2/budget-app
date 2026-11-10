/**
 * 이 가계부의 사람들 — PLAN 4-8 · 4-9.
 * 사람 = 멤버(가계부를 공유한 구글 계정). 멤버마다 이어진 통장(사람별 수입통장)이 있으면 그 통장 주인 이름으로 부른다.
 * - 멤버와 통장이 이어지는 조건
 *   (a) 통장 주인 이메일 = 멤버 이메일 (대소문자 무시)
 *   (b) (a)가 없을 때만: 주인 이메일이 빈 통장의 주인 이름 = 멤버 표시 이름, 또는 표시 이름이 주인 이름으로 끝남
 *       ('김가람' ↔ '가람'). 그 통장에 맞는 멤버가 딱 한 명일 때만 잇는다
 * - 어느 멤버와도 이어지지 않은 통장 주인은 사람으로 치지 않는다 (청구 낸 사람으로 고를 수 없음)
 */
import { activeAccountsSorted } from './internal';
import type { Account, AccountRole, Id, LedgerData } from './types';

export interface LedgerPerson {
  /** 멤버 이메일 */
  email: string;
  /** 부를 이름: 이어진 통장의 주인 이름, 없으면 멤버 표시 이름 */
  name: string;
  /** 멤버 표시 이름 (구글 프로필 이름 등) */
  displayName: string;
  /** 이어진 통장 (수입통장 먼저). 없으면 null */
  accountId: Id | null;
}

const ROLE_RANK: Partial<Record<AccountRole, number>> = { income: 0, allowance: 1, other: 2 };
function rank(a: Account): number {
  return ROLE_RANK[a.role] ?? 3;
}

function lower(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

/** 표시 이름이 주인 이름과 같거나 주인 이름으로 끝나는지 */
export function nameMatchesOwner(displayName: string, ownerName: string): boolean {
  const d = displayName.trim();
  const o = ownerName.trim();
  return o !== '' && d !== '' && (d === o || d.endsWith(o));
}

/** 이 가계부의 사람들. 이어진 통장 순서(수입통장 먼저) → 이어진 통장이 없는 멤버 순. 같은 이메일은 한 번 */
export function ledgerPeople(data: LedgerData): LedgerPerson[] {
  const accounts = activeAccountsSorted(data).filter((a) => (a.ownerName ?? '').trim() || lower(a.ownerEmail));
  const members: { email: string; displayName: string }[] = [];
  for (const m of data.members) {
    const email = (m.email ?? '').trim();
    if (!email || members.some((x) => lower(x.email) === lower(email))) continue;
    members.push({ email, displayName: (m.displayName ?? '').trim() });
  }

  const linked = new Map<string, Account[]>(); // 멤버 이메일(소문자) → 이어진 통장
  for (const m of members) {
    const byEmail = accounts.filter((a) => lower(a.ownerEmail) === lower(m.email));
    if (byEmail.length > 0) linked.set(lower(m.email), byEmail);
  }
  // (b) 이름으로 잇기: 이메일로 이어진 통장이 없는 멤버만, 그 통장에 맞는 멤버가 딱 한 명일 때만
  for (const a of accounts) {
    if (lower(a.ownerEmail) || !(a.ownerName ?? '').trim()) continue;
    const matches = members.filter((m) => nameMatchesOwner(m.displayName, a.ownerName ?? ''));
    const only = matches.length === 1 ? matches[0] : undefined;
    if (!only) continue;
    const key = lower(only.email);
    const list = linked.get(key);
    if (list && list.some((x) => lower(x.ownerEmail) === key)) continue;
    linked.set(key, [...(list ?? []), a]);
  }

  const people = members.map((m) => {
    const list = [...(linked.get(lower(m.email)) ?? [])].sort((a, b) => rank(a) - rank(b) || a.order - b.order);
    const best = list[0] ?? null;
    const owner = (best?.ownerName ?? '').trim();
    return {
      person: {
        email: m.email,
        name: owner || m.displayName || m.email.split('@')[0] || m.email,
        displayName: m.displayName,
        accountId: best?.id ?? null,
      } satisfies LedgerPerson,
      rankKey: best ? rank(best) : 9,
      orderKey: best ? best.order : 0,
    };
  });
  const indexOf = new Map(people.map((p, i) => [p.person.email, i]));
  return people
    .sort(
      (a, b) =>
        a.rankKey - b.rankKey ||
        a.orderKey - b.orderKey ||
        (indexOf.get(a.person.email) ?? 0) - (indexOf.get(b.person.email) ?? 0),
    )
    .map((p) => p.person);
}

/** 이메일로 사람 찾기 (멤버가 아니면 null) */
export function personByEmail(data: LedgerData, email: string): LedgerPerson | null {
  const key = lower(email);
  if (!key) return null;
  return ledgerPeople(data).find((p) => lower(p.email) === key) ?? null;
}

/** 이름(부를 이름 또는 멤버 표시 이름)으로 사람 찾기 */
export function personByName(data: LedgerData, name: string): LedgerPerson | null {
  const n = name.trim();
  if (!n) return null;
  const people = ledgerPeople(data);
  return people.find((p) => p.name === n) ?? people.find((p) => p.displayName === n) ?? null;
}

/**
 * 멤버와 통장 잇기: accountId 통장의 주인 이메일을 email 로 바꾸고, 같은 이메일인 다른 통장은 주인 이메일을 비운다.
 * accountId=null 이면 비우기만 한다. 주인 이름이 빈 통장은 ownerName 으로 채운다. 바뀐 통장만 돌려준다
 */
export function linkAccountsToEmail(
  accounts: Account[],
  email: string,
  accountId: Id | null,
  ownerName?: string | null,
): Account[] {
  const key = lower(email);
  if (!key) return [];
  const out: Account[] = [];
  for (const a of accounts) {
    if (a.deleted) continue;
    if (a.id === accountId) {
      const name = (a.ownerName ?? '').trim() || (ownerName ?? '').trim() || null;
      if (lower(a.ownerEmail) !== key || name !== a.ownerName) out.push({ ...a, ownerEmail: email.trim(), ownerName: name });
    } else if (lower(a.ownerEmail) === key) {
      out.push({ ...a, ownerEmail: null });
    }
  }
  return out;
}
