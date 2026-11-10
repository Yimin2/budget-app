/**
 * 이 가계부의 사람들 — PLAN 4-8 · 4-9.
 * 사람 = 멤버(가계부를 공유한 구글 계정). 멤버마다 이어진 통장(사람별 수입통장)이 있으면 그 통장 주인 이름으로 부른다.
 * - 멤버와 통장이 이어지는 조건
 *   (a) 통장 주인 이메일 = 멤버 이메일 (대소문자 무시)
 *   (b) (a)가 없을 때만: 주인 이메일이 빈 통장의 주인 이름이 멤버 표시 이름 · 이메일 앞부분과 맞음 (nameMatchesOwner:
 *       '김가람' · '가람 김' · '김 가람' ↔ '가람'). 그 통장에 맞는 멤버가 딱 한 명일 때만 잇는다.
 *       열 때 autoLinkOwnerEmails 가 이 짝을 주인 이메일로 시트에 써 둬서, 다음부터는 이름에 기대지 않는다
 * - 어느 멤버와도 이어지지 않은 통장 주인은 사람으로 치지 않는다 (청구 낸 사람으로 고를 수 없음)
 * - 공유가 풀린 멤버(공유 = 아니오)는 사람으로 치지 않는다. 예전 기록의 이름은 memberName 으로 읽는다
 */
import { activeAccountsSorted } from './internal';
import { isSharedMember } from './members';
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

function norm(s: string | null | undefined): string {
  return (s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * 표시 이름(또는 이메일 앞부분)이 통장 주인 이름을 가리키는지. 대소문자 · 띄어쓰기 무시
 * - 같음 · 주인 이름으로 끝나거나 시작함 ('이민구' ↔ '민구', '민구이')
 * - 띄어 쓴 낱말 하나가 주인 이름 ('민구 이' · '이 민구' · 'Mingu Lee' ↔ 'mingu')
 * - 성을 앞으로 옮긴 꼴 ('민구 이' → '이민구' ↔ '이민구' · '민구')
 * - 이메일 앞부분이 같거나 그 조각 하나가 주인 이름 ('mingu.lee@…' ↔ 'mingu')
 * 끝나거나 시작하는 꼴은 주인 이름이 두 글자 이상일 때만 봐요
 */
export function nameMatchesOwner(displayName: string, ownerName: string, email?: string | null): boolean {
  const o = norm(ownerName);
  if (!o) return false;
  const d = norm(displayName);
  if (d) {
    const tokens = d.split(' ');
    const compact = tokens.join('');
    const forms = [d, compact];
    if (tokens.length >= 2) forms.push(tokens[tokens.length - 1]! + tokens.slice(0, -1).join(''));
    if (forms.includes(o) || tokens.includes(o)) return true;
    if (o.length >= 2 && forms.some((f) => f.endsWith(o) || f.startsWith(o))) return true;
  }
  const local = norm((email ?? '').split('@')[0]);
  if (local && (local === o || local.split(/[._+\-0-9]+/).includes(o))) return true;
  return false;
}

/** 이 가계부의 사람들. 이어진 통장 순서(수입통장 먼저) → 이어진 통장이 없는 멤버 순. 같은 이메일은 한 번 */
export function ledgerPeople(data: LedgerData): LedgerPerson[] {
  const accounts = activeAccountsSorted(data).filter((a) => (a.ownerName ?? '').trim() || lower(a.ownerEmail));
  const members: { email: string; displayName: string }[] = [];
  for (const m of data.members) {
    const email = (m.email ?? '').trim();
    if (!email || !isSharedMember(m) || members.some((x) => lower(x.email) === lower(email))) continue;
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
    const matches = members.filter((m) => nameMatchesOwner(m.displayName, a.ownerName ?? '', m.email));
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

/**
 * 기록에 보일 이름: 가계부의 사람이면 부를 이름, 공유가 풀린 멤버면 멤버 표시 이름, 아니면 이메일 앞부분.
 * (공유가 풀려도 예전 기록의 이름은 그대로 읽혀요)
 */
export function memberName(data: LedgerData | null, email: string): string {
  const person = data ? personByEmail(data, email) : null;
  if (person?.name) return person.name;
  const key = lower(email);
  const row = key ? data?.members.find((m) => lower(m.email) === key && (m.displayName ?? '').trim()) : undefined;
  if (row) return row.displayName.trim();
  return email.split('@')[0] || email;
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

interface MemberLike {
  email: string;
  displayName: string;
  shared?: boolean;
}

/**
 * 통장 주인을 멤버와 잇기 (기존 시트 자동 고치기, PLAN 4-8): 주인 이름만 있고 주인 이메일이 빈 통장마다
 * 그 이름에 맞는 멤버(nameMatchesOwner)가 딱 한 명이면 그 멤버 이메일을 주인 이메일로 써요.
 * - 이미 주인 이메일이 있는 통장은 건드리지 않아요
 * - 다른 주인 이름의 통장과 이메일로 이어진 멤버는 고르지 않아요. 한 멤버가 여러 주인 이름에 맞으면 잇지 않아요
 * - 공유가 풀린 멤버 · 지운 통장은 빼요. 다시 해도 두 번째는 빈 목록 (바뀐 통장만 돌려줘요)
 */
export function autoLinkOwnerEmails(accounts: Account[], members: MemberLike[]): Account[] {
  const live = accounts.filter((a) => !a.deleted);
  const people = members.filter((m) => lower(m.email) && isSharedMember(m));
  const owners = [...new Set(live.filter((a) => !lower(a.ownerEmail) && (a.ownerName ?? '').trim()).map((a) => (a.ownerName ?? '').trim()))];
  const pick = new Map<string, MemberLike>(); // 주인 이름 → 멤버
  for (const owner of owners) {
    const hits = people.filter((m) => {
      if (!nameMatchesOwner(m.displayName, owner, m.email)) return false;
      // 이미 다른 사람 이름의 통장과 이메일로 이어진 멤버는 아니에요
      return !live.some((a) => lower(a.ownerEmail) === lower(m.email) && (a.ownerName ?? '').trim() && (a.ownerName ?? '').trim() !== owner);
    });
    if (hits.length === 1) pick.set(owner, hits[0]!);
  }
  const usedBy = new Map<string, number>();
  for (const m of pick.values()) usedBy.set(lower(m.email), (usedBy.get(lower(m.email)) ?? 0) + 1);
  const out: Account[] = [];
  for (const a of live) {
    if (lower(a.ownerEmail)) continue;
    const m = pick.get((a.ownerName ?? '').trim());
    if (!m || (usedBy.get(lower(m.email)) ?? 0) > 1) continue;
    out.push({ ...a, ownerEmail: m.email.trim() });
  }
  return out;
}

/**
 * 주인 이메일이 비었고 어느 사람과도 이어지지 않은 통장 주인 이름 (한 번씩, 통장 순서).
 * '누가 나인지 골라 주세요'에서 고를 이름이에요
 */
export function unlinkedOwnerNames(data: LedgerData): string[] {
  const people = ledgerPeople(data);
  const linked = new Set(people.map((p) => p.name));
  const out: string[] = [];
  for (const a of activeAccountsSorted(data)) {
    const owner = (a.ownerName ?? '').trim();
    if (!owner || lower(a.ownerEmail) || linked.has(owner) || out.includes(owner)) continue;
    out.push(owner);
  }
  return out;
}

/** '이 사람이 나예요': 주인 이름이 ownerName 이고 주인 이메일이 빈 통장을 모두 email 과 이어요. 바뀐 통장만 돌려줘요 */
export function claimOwnerAccounts(accounts: Account[], ownerName: string, email: string): Account[] {
  const owner = ownerName.trim();
  const clean = email.trim();
  if (!owner || !clean) return [];
  return accounts
    .filter((a) => !a.deleted && !lower(a.ownerEmail) && (a.ownerName ?? '').trim() === owner)
    .map((a) => ({ ...a, ownerEmail: clean }));
}
