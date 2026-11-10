/**
 * 사람별 생활비 · 누가 썼나요 — PLAN 4-14.
 * 사람마다 생활비 통장(역할 고정지출, 주인 = 그 사람)과 용돈 통장(역할 용돈)을 둘 수 있다.
 * - 생활비 예산 행 · 고정비는 통장에 속하므로 그 통장 주인의 것이다
 * - 통장과 사람 잇기: 통장 주인 이메일 = 사람 이메일 (대소문자 무시), 주인 이메일이 비었으면 주인 이름 = 사람 이름 ·
 *   표시 이름이 주인 이름으로 끝남 ('김가람' ↔ '가람')
 * - 나 = 로그인한 멤버와 이어진 생활비 통장. 없으면 첫 생활비 통장 (체험 모드는 첫 사람)
 */
import { livingAccountIdsFor } from './internal';
import { ledgerPeople, nameMatchesOwner, type LedgerPerson } from './people';
import type { Account, Id, LedgerData, YearMonth } from './types';

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** 이 통장의 주인이 이 사람인지 */
export function accountBelongsTo(account: Pick<Account, 'ownerName' | 'ownerEmail'>, person: Pick<LedgerPerson, 'email' | 'name' | 'displayName'>): boolean {
  const email = lower(account.ownerEmail);
  if (email) return email === lower(person.email);
  const owner = (account.ownerName ?? '').trim();
  if (!owner) return false;
  return owner === person.name.trim() || nameMatchesOwner(person.displayName, owner);
}

export interface LivingOwner {
  /** 생활비 통장 */
  accountId: Id;
  /** 부를 이름: 이어진 사람 이름 → 통장 주인 → 통장 이름 */
  name: string;
  /** 이어진 사람 (멤버가 아니면 null) */
  person: LedgerPerson | null;
}

/**
 * 생활비 통장을 부를 이름: 이어진 사람 이름 → 통장 주인 이름 → 주인 이메일 앞부분 →
 * (주인 없는 통장이고 가계부의 사람이 한 명뿐이며 그 사람 통장이 따로 없으면) 그 사람 이름 → 통장 이름.
 * 혼자 쓰는 가계부에서 '생활비' 대신 내 이름이 보이게 해요
 */
export function livingOwnerName(data: LedgerData, accountId: Id, people: LedgerPerson[] = ledgerPeople(data)): string {
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account) return '생활비';
  const person = people.find((p) => accountBelongsTo(account, p));
  if (person?.name) return person.name;
  const owner = account.ownerName?.trim() || (account.ownerEmail ?? '').trim().split('@')[0];
  if (owner) return owner;
  const only = people.length === 1 ? people[0]! : null;
  if (only && !data.accounts.some((a) => !a.deleted && a.id !== accountId && a.role === account.role && accountBelongsTo(a, only))) {
    return only.name;
  }
  return account.name || '생활비';
}

/** 그달 생활비 통장마다 주인 (통장 순서) */
export function livingOwners(data: LedgerData, month: YearMonth): LivingOwner[] {
  const people = ledgerPeople(data);
  return livingAccountIdsFor(data, month).map((id) => {
    const account = data.accounts.find((a) => a.id === id);
    const person = account ? (people.find((p) => accountBelongsTo(account, p)) ?? null) : null;
    return { accountId: id, name: livingOwnerName(data, id, people), person };
  });
}

/**
 * 로그인한 사람의 생활비 통장: 이어진 사람 이메일 = email → 통장 주인 이메일 = email → 첫 생활비 통장.
 * 생활비 통장이 없으면 null
 */
export function myLivingAccountId(data: LedgerData, month: YearMonth, email: string | null | undefined): Id | null {
  const owners = livingOwners(data, month);
  const key = lower(email);
  if (key) {
    const hit =
      owners.find((o) => lower(o.person?.email) === key) ??
      owners.find((o) => lower(data.accounts.find((a) => a.id === o.accountId)?.ownerEmail) === key);
    if (hit) return hit.accountId;
  }
  return owners[0]?.accountId ?? null;
}

export interface Spender {
  /** 고르기 키 (멤버 이메일, 멤버가 아니면 'acc:<통장id>') */
  key: string;
  name: string;
  email: string | null;
  /** 이 사람의 생활비 통장 (없으면 null = 기본 생활비 통장) */
  livingAccountId: Id | null;
}

/**
 * '누가 썼나요?'에서 고를 사람: 가계부의 사람(멤버) 한 번씩, 그 사람의 생활비 통장과 함께.
 * 멤버와 이어지지 않은 생활비 통장 주인도 뒤에 넣는다 (아직 초대하지 않은 사람)
 */
export function spenderOptions(data: LedgerData, month: YearMonth): Spender[] {
  const owners = livingOwners(data, month);
  const out: Spender[] = ledgerPeople(data).map((p) => ({
    key: p.email,
    name: p.name,
    email: p.email,
    livingAccountId: owners.find((o) => o.person && lower(o.person.email) === lower(p.email))?.accountId ?? null,
  }));
  for (const o of owners) {
    if (o.person || out.some((s) => s.livingAccountId === o.accountId)) continue;
    // 주인이 없는 통장(함께 쓰는 고정지출통장)은 사람이 아니에요
    const acc = data.accounts.find((a) => a.id === o.accountId);
    if (!acc || !((acc.ownerName ?? '').trim() || (acc.ownerEmail ?? '').trim())) continue;
    out.push({ key: `acc:${o.accountId}`, name: o.name, email: null, livingAccountId: o.accountId });
  }
  return out;
}

/** '누가 썼나요?'를 보여 줄지: 서로 다른 생활비 통장을 가진 사람이 둘 이상일 때 (고르면 예산이 달라질 때) */
export function hasSpenderChoice(spenders: Spender[]): boolean {
  return new Set(spenders.map((s) => s.livingAccountId).filter((id): id is Id => !!id)).size >= 2;
}

/** 로그인한 사람의 '누가 썼나요?' 키 (멤버가 아니면 생활비 통장으로, 그것도 없으면 첫 사람) */
export function mySpenderKey(spenders: Spender[], email: string | null | undefined, myLivingId: Id | null): string | null {
  const key = lower(email);
  return (
    spenders.find((s) => key && lower(s.email) === key)?.key ??
    spenders.find((s) => myLivingId && s.livingAccountId === myLivingId)?.key ??
    spenders[0]?.key ??
    null
  );
}

/** 이 지출 통장이 사람별 생활비 통장이면 그 사람의 키 (고치는 지출의 '누가 썼나요?' 기본값) */
export function spenderKeyForAccount(spenders: Spender[], accountId: Id | null | undefined): string | null {
  if (!accountId) return null;
  return spenders.find((s) => s.livingAccountId === accountId)?.key ?? null;
}
