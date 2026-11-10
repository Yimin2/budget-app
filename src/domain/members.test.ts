import { describe, expect, it } from 'vitest';
import { isSharedMember, memberRoleOf, mergeMembers, type SharingList } from './members';
import { ledgerPeople, memberName } from './people';
import { claimPayers } from './claims';
import { account, emptyLedger } from './_fixtures';
import { livingOwners } from './household';
import type { Member } from './types';

const ME = { email: 'me@example.com', name: '가나다' };
const sharing = (users: SharingList['users'], complete = true): SharingList => ({ users, complete });

describe('mergeMembers — 드라이브 공유 목록과 멤버 탭 맞추기', () => {
  const base: Member[] = [
    { email: 'me@example.com', displayName: '가나다', shared: true, role: 'owner' },
    { email: 'Partner@example.com', displayName: '라마', shared: true, role: 'writer' },
  ];

  it('공유 목록에 새로 생긴 사람을 더하고, 구글 이름이 바뀌면 고쳐요 (이메일 대소문자 무시)', () => {
    const out = mergeMembers(
      base,
      sharing([
        { email: 'me@example.com', displayName: '가나다', role: 'owner' },
        { email: 'partner@example.com', displayName: '라마바', role: 'writer' },
        { email: 'viewer@example.com', displayName: '사아', role: 'reader' },
      ]),
      ME,
    );
    expect(out.changed).toEqual([
      { email: 'Partner@example.com', displayName: '라마바', shared: true, role: 'writer' },
      { email: 'viewer@example.com', displayName: '사아', shared: true, role: 'reader' },
    ]);
    expect(out.members).toHaveLength(3);
  });

  it('구글 이름이 비어 있으면 원래 이름을 지켜요', () => {
    const out = mergeMembers(base, sharing([
      { email: 'me@example.com', displayName: '', role: 'owner' },
      { email: 'partner@example.com', displayName: '', role: 'writer' },
    ]), null);
    expect(out.changed).toEqual([]);
  });

  it('공유가 풀린 사람은 지우지 않고 공유 안 됨으로 표시해요. 나는 목록에 없어도 공유됨', () => {
    const out = mergeMembers(base, sharing([{ email: 'other@example.com', displayName: '차카', role: 'owner' }]), ME);
    const partner = out.members.find((m) => m.email === 'Partner@example.com')!;
    expect(partner.shared).toBe(false);
    expect(partner.displayName).toBe('라마');
    expect(out.members.find((m) => m.email === 'me@example.com')!.shared).toBe(true);
    expect(out.changed.map((m) => m.email)).toEqual(['Partner@example.com', 'other@example.com']);
  });

  it('다시 공유되면 공유됨으로 되돌려요', () => {
    const removed: Member[] = [base[0]!, { ...base[1]!, shared: false }];
    const out = mergeMembers(removed, sharing([
      { email: 'me@example.com', displayName: '가나다', role: 'owner' },
      { email: 'partner@example.com', displayName: '라마', role: 'reader' },
    ]), ME);
    expect(out.changed).toEqual([{ email: 'Partner@example.com', displayName: '라마', shared: true, role: 'reader' }]);
  });

  it('바뀐 게 없으면 쓸 행이 없어요 (같은 입력을 두 번 넣어도)', () => {
    const list = sharing([
      { email: 'me@example.com', displayName: '가나다', role: 'owner' },
      { email: 'partner@example.com', displayName: '라마바', role: 'writer' },
    ]);
    const first = mergeMembers(base, list, ME);
    expect(first.changed).toHaveLength(1);
    expect(mergeMembers(first.members, list, ME).changed).toEqual([]);
  });

  it('그룹 · 링크 공유가 있으면(complete=false) 누가 빠졌는지 몰라 공유 안 됨으로 표시하지 않아요', () => {
    const out = mergeMembers(base, sharing([{ email: 'me@example.com', displayName: '가나다', role: 'owner' }], false), ME);
    expect(out.changed).toEqual([]);
  });

  it('공유 목록을 못 읽으면(null) 다른 멤버는 그대로, 나만 확인해요', () => {
    expect(mergeMembers(base, null, ME).changed).toEqual([]);
    const out = mergeMembers([{ email: 'partner@example.com', displayName: '라마' }], null, ME);
    expect(out.changed).toEqual([{ email: 'me@example.com', displayName: '가나다', shared: true, role: null }]);
    expect(out.members.map((m) => m.email)).toEqual(['partner@example.com', 'me@example.com']);
  });

  it('나: 이름이 빈 행은 구글 프로필 이름으로 채우고, 예전 이름은 구글 이름으로 바꿔요', () => {
    expect(mergeMembers([{ email: 'ME@example.com', displayName: '' }], null, ME).changed).toEqual([
      { email: 'ME@example.com', displayName: '가나다', shared: true, role: null },
    ]);
    expect(mergeMembers([{ email: 'me@example.com', displayName: 'me' }], null, ME).changed[0]!.displayName).toBe('가나다');
    // 빈 칸(shared · role 없음)인 예전 행은 그대로면 쓰지 않아요
    expect(mergeMembers([{ email: 'me@example.com', displayName: '가나다' }], null, ME).changed).toEqual([]);
  });

  it('드라이브 권한 이름', () => {
    expect(['owner', 'organizer', 'fileOrganizer', 'writer', 'commenter', 'reader', 'x'].map(memberRoleOf)).toEqual([
      'owner', 'writer', 'writer', 'writer', 'commenter', 'reader', null,
    ]);
    expect(isSharedMember({})).toBe(true);
    expect(isSharedMember({ shared: false })).toBe(false);
  });
});

describe('사람 = 공유된 멤버', () => {
  it('공유가 풀린 멤버는 사람(고르기 · 낸 사람)에서 빠지고, 예전 기록 이름은 그대로 읽혀요', () => {
    const data = {
      ...emptyLedger(),
      members: [
        { email: 'me@example.com', displayName: '가나다', shared: true },
        { email: 'left@example.com', displayName: '라마', shared: false },
      ],
    };
    expect(ledgerPeople(data).map((p) => p.name)).toEqual(['가나다']);
    expect(claimPayers(data)).toEqual(['가나다']);
    expect(memberName(data, 'left@example.com')).toBe('라마');
    expect(memberName(data, 'stranger@example.com')).toBe('stranger');
  });
});

describe('혼자 쓰는 가계부 — 생활비 이름', () => {
  it('주인 없는 생활비 통장은 하나뿐인 사람(나)의 이름으로 불러요 (\'생활비\'·통장 이름 대신)', () => {
    const data = emptyLedger({
      accounts: [account('fixed', { name: '고정지출통장' })],
      members: [{ email: 'me@example.com', displayName: '가나다' }],
    });
    expect(livingOwners(data, '2026-11').map((o) => o.name)).toEqual(['가나다']);
    // 두 사람이면 통장 이름 그대로
    const two = { ...data, members: [...data.members, { email: 'b@example.com', displayName: '라마' }] };
    expect(livingOwners(two, '2026-11').map((o) => o.name)).toEqual(['고정지출통장']);
  });
});
