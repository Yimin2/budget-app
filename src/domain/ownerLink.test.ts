/** 통장 주인을 멤버와 잇기 (PLAN 4-8): 이름 맞추기 · 자동으로 주인 이메일 쓰기 · '누가 나인지' 고르기 */
import { describe, expect, it } from 'vitest';
import { account } from './_fixtures';
import { createDemoLedger } from './defaults';
import { myLivingAccountId } from './household';
import { autoLinkOwnerEmails, claimOwnerAccounts, nameMatchesOwner, unlinkedOwnerNames } from './people';
import type { Account, LedgerData, Member } from './types';

const m = (email: string, displayName: string, shared = true): Member => ({ email, displayName, shared, role: null });
const owned = (id: string, ownerName: string, ownerEmail: string | null = null): Account =>
  account('fixed', { id, ownerName, ownerEmail });

describe('nameMatchesOwner', () => {
  it('같음 · 끝남 · 띄어 쓴 낱말 · 성을 앞으로 옮긴 꼴 · 이메일 앞부분', () => {
    expect(nameMatchesOwner('민구', '민구')).toBe(true);
    expect(nameMatchesOwner('이민구', '민구')).toBe(true);
    expect(nameMatchesOwner('민구 이', '민구')).toBe(true);
    expect(nameMatchesOwner('이 민구', '민구')).toBe(true);
    expect(nameMatchesOwner('민구 이', '이민구')).toBe(true);
    expect(nameMatchesOwner('Mingu Lee', 'mingu')).toBe(true);
    expect(nameMatchesOwner('', 'mingu', 'mingu.lee@example.com')).toBe(true);
    expect(nameMatchesOwner('', 'lee', 'mingu_lee92@example.com')).toBe(true);
  });
  it('다른 이름 · 빈 이름 · 한 글자 주인 이름의 부분 맞춤은 아니에요', () => {
    expect(nameMatchesOwner('Mingu Lee', '민구')).toBe(false);
    expect(nameMatchesOwner('기쁜', '민구')).toBe(false);
    expect(nameMatchesOwner('민구', '')).toBe(false);
    expect(nameMatchesOwner('이민구', '구')).toBe(false);
  });
});

describe('autoLinkOwnerEmails — 기존 시트 자동 고치기', () => {
  const accounts = [owned('a1', '민구'), owned('a2', '민구'), owned('a3', '기쁜')];

  it('띄어 쓴 낱말로 맞는 멤버가 딱 한 명이면 그 이메일을 주인 이메일로 써요', () => {
    const out = autoLinkOwnerEmails(accounts, [m('mg@x.com', '민구 이'), m('gb@x.com', '기쁜')]);
    expect(out.map((a) => [a.id, a.ownerEmail])).toEqual([
      ['a1', 'mg@x.com'],
      ['a2', 'mg@x.com'],
      ['a3', 'gb@x.com'],
    ]);
  });

  it('성을 앞으로 옮긴 꼴 ("민구 이" ↔ "이민구")', () => {
    const out = autoLinkOwnerEmails([owned('a1', '이민구')], [m('mg@x.com', '민구 이')]);
    expect(out.map((a) => a.ownerEmail)).toEqual(['mg@x.com']);
  });

  it('맞는 멤버가 둘이면 잇지 않아요 (모호함)', () => {
    expect(autoLinkOwnerEmails([owned('a1', '민구')], [m('a@x.com', '민구 이'), m('b@x.com', '김민구')])).toEqual([]);
  });

  it('이미 주인 이메일이 있는 통장은 그대로 · 다시 해도 두 번째는 빈 목록', () => {
    const start = [owned('a1', '민구', 'old@x.com'), owned('a2', '민구')];
    const members = [m('mg@x.com', '민구 이')];
    const first = autoLinkOwnerEmails(start, members);
    expect(first.map((a) => [a.id, a.ownerEmail])).toEqual([['a2', 'mg@x.com']]);
    const byId = new Map(first.map((a) => [a.id, a]));
    const after = start.map((a) => byId.get(a.id) ?? a);
    expect(after[0]!.ownerEmail).toBe('old@x.com');
    expect(autoLinkOwnerEmails(after, members)).toEqual([]);
  });

  it('다른 주인 이름의 통장과 이미 이어진 멤버 · 공유가 풀린 멤버 · 지운 통장은 빼요', () => {
    const list = [owned('a1', '기쁜', 'gb@x.com'), owned('a2', '쁜'), { ...owned('a3', '민구'), deleted: true }];
    expect(autoLinkOwnerEmails(list, [m('gb@x.com', '기쁜')])).toEqual([]);
    expect(autoLinkOwnerEmails([owned('a1', '민구')], [m('mg@x.com', '민구', false)])).toEqual([]);
    expect(autoLinkOwnerEmails(list, [m('mg@x.com', '민구')])).toEqual([]);
  });
});

/** 사용자 결함 재현: 가져온 통장(민구 · 기쁜)에 주인 이메일이 없고, 민구의 구글 이름이 영어라 이름으로 못 이어요 */
function imported(minguName: string): LedgerData {
  const d = createDemoLedger('2026-11-10', '2026-11-10T01:00:00.000Z', { couple: true });
  const ownerOf: Record<string, string> = {
    'demo-acc-income': '민구',
    'demo-acc-living-minji': '민구',
    'demo-acc-allowance-minji': '민구',
    'demo-acc-living-junho': '기쁜',
    'demo-acc-allowance-junho': '기쁜',
  };
  return {
    ...d,
    accounts: d.accounts.map((a) => ({ ...a, ownerName: ownerOf[a.id] ?? null, ownerEmail: null })),
    members: [m('gippeun@x.com', '기쁜'), m('mingu@x.com', minguName)],
  };
}

describe("'나' 찾기 — 첫 통장을 짐작하지 않아요", () => {
  it('이름으로 못 이으면 나는 없음(null) · 고를 이름은 민구 · 고르면 민구 통장이 모두 이어져요', () => {
    const d = imported('Mingu Lee');
    expect(autoLinkOwnerEmails(d.accounts, d.members).map((a) => a.ownerName)).toEqual(['기쁜', '기쁜']);
    // 예전에는 첫 생활비 통장을 '나'로 짐작했어요 (실제 시트에서는 기쁜)
    expect(myLivingAccountId(d, '2026-11', 'mingu@x.com')).toBeNull();
    expect(unlinkedOwnerNames(d)).toEqual(['민구']);
    const claimed = claimOwnerAccounts(d.accounts, '민구', 'mingu@x.com');
    expect(claimed.map((a) => a.id)).toEqual(['demo-acc-income', 'demo-acc-living-minji', 'demo-acc-allowance-minji']);
    const byId = new Map(claimed.map((a) => [a.id, a]));
    const after = { ...d, accounts: d.accounts.map((a) => byId.get(a.id) ?? a) };
    expect(myLivingAccountId(after, '2026-11', 'mingu@x.com')).toBe('demo-acc-living-minji');
    expect(unlinkedOwnerNames(after)).toEqual([]);
    expect(claimOwnerAccounts(after.accounts, '민구', 'mingu@x.com')).toEqual([]);
  });

  it('구글 이름이 "민구 이"면 자동으로 이어져 민구가 나예요', () => {
    const d = imported('민구 이');
    const linked = autoLinkOwnerEmails(d.accounts, d.members);
    const byId = new Map(linked.map((a) => [a.id, a]));
    const after = { ...d, accounts: d.accounts.map((a) => byId.get(a.id) ?? a) };
    expect(after.accounts.filter((a) => a.ownerName === '민구').every((a) => a.ownerEmail === 'mingu@x.com')).toBe(true);
    expect(myLivingAccountId(after, '2026-11', 'mingu@x.com')).toBe('demo-acc-living-minji');
    expect(myLivingAccountId(after, '2026-11', 'gippeun@x.com')).toBe('demo-acc-living-junho');
  });
});
