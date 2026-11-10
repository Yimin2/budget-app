/**
 * 멤버 = 구글 시트를 공유받은 사람 — PLAN 4-8 · 5장 `멤버`.
 * 가계부를 열 때(와 '공유 목록 새로고침') 드라이브 공유 목록을 읽어 멤버 탭에 맞춘다. 이름은 구글에 보이는 그대로.
 * - 공유 목록에 있는 사람(type=user, 이메일 있음, 지워진 계정 아님): 없으면 더하고, 구글 이름이 비지 않고 다르면 이름을 고친다
 * - 멤버 탭에 있는데 공유 목록에 없는 사람: 행을 지우지 않고 '공유 안 됨'으로 표시한다 (예전 기록의 이름은 그대로 읽힌다).
 *   공유 목록에 그룹 · 도메인 · 링크 공유가 있으면 누가 빠졌는지 알 수 없으므로 표시하지 않는다
 * - 로그인한 나는 언제나 멤버 (공유 목록을 못 읽어도). 이름은 구글 프로필 이름
 * - 공유 목록을 못 읽으면(보기 권한 · 연결 오류) 나만 확인하고 다른 멤버는 그대로 둔다
 */
import type { Member, MemberRole } from './types';

/** 드라이브 공유 목록의 사람 한 명 */
export interface SharedUser {
  email: string;
  /** 구글 프로필 이름 (비어 있을 수 있음) */
  displayName: string;
  role: MemberRole;
}

/** 드라이브 공유 목록 */
export interface SharingList {
  users: SharedUser[];
  /**
   * 사람 목록이 공유받은 사람 전부인지. 그룹 · 도메인 · 링크(anyone) 공유가 있으면 false —
   * 목록에 없는 멤버도 그쪽으로 볼 수 있어 '공유 안 됨'으로 표시하지 않는다
   */
  complete: boolean;
}

/** 로그인한 나 (구글 계정) */
export interface MemberSelf {
  email: string;
  name: string;
}

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  owner: '소유자',
  writer: '편집자',
  commenter: '댓글 작성자',
  reader: '보기 전용',
};

/** 드라이브 권한 이름 → 멤버 권한. 모르는 권한은 null */
export function memberRoleOf(driveRole: string | null | undefined): MemberRole | null {
  switch ((driveRole ?? '').trim()) {
    case 'owner':
      return 'owner';
    case 'organizer':
    case 'fileOrganizer':
    case 'writer':
      return 'writer';
    case 'commenter':
      return 'commenter';
    case 'reader':
      return 'reader';
    default:
      return null;
  }
}

/** 지금 공유돼 있는 멤버인지 (빈 칸 = 공유됨) */
export function isSharedMember(m: Pick<Member, 'shared'>): boolean {
  return m.shared !== false;
}

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

function sameMember(a: Member, b: Member): boolean {
  return (
    a.email === b.email &&
    a.displayName === b.displayName &&
    isSharedMember(a) === isSharedMember(b) &&
    (a.role ?? null) === (b.role ?? null)
  );
}

export interface MemberMerge {
  /** 합친 멤버 목록 (원래 순서, 새 사람은 뒤에) */
  members: Member[];
  /** 바뀌었거나 새로 생긴 행 (쓸 것). 비면 쓰지 않는다 */
  changed: Member[];
}

/**
 * 멤버 탭 + 드라이브 공유 목록(못 읽었으면 null) + 로그인한 나 → 합친 멤버와 바뀐 행.
 * 같은 입력을 두 번 넣어도 두 번째는 changed 가 빈다 (다시 해도 안전)
 */
export function mergeMembers(members: Member[], sharing: SharingList | null, me: MemberSelf | null): MemberMerge {
  const out: Member[] = members.map((m) => ({ ...m }));
  const index = new Map<string, number>();
  out.forEach((m, i) => {
    const k = lower(m.email);
    if (k && !index.has(k)) index.set(k, i);
  });
  const touched = new Set<number>();
  const upsert = (email: string, patch: (m: Member | null) => Member) => {
    const k = lower(email);
    const i = index.get(k);
    if (i === undefined) {
      index.set(k, out.length);
      touched.add(out.length);
      out.push(patch(null));
      return;
    }
    const next = patch(out[i]!);
    if (!sameMember(out[i]!, next)) {
      out[i] = next;
      touched.add(i);
    }
  };

  const meKey = lower(me?.email);
  const listed = new Set<string>();
  if (sharing) {
    for (const u of sharing.users) {
      const email = u.email.trim();
      const k = lower(email);
      if (!k || listed.has(k)) continue;
      listed.add(k);
      const name = u.displayName.trim();
      upsert(email, (m) =>
        m
          ? { ...m, displayName: name && name !== m.displayName ? name : m.displayName, shared: true, role: u.role }
          : { email, displayName: name, shared: true, role: u.role },
      );
    }
  }

  if (me && meKey) {
    const name = me.name.trim();
    upsert(me.email.trim(), (m) =>
      m
        ? { ...m, displayName: name && name !== m.displayName ? name : m.displayName, shared: true, role: m.role ?? null }
        : { email: me.email.trim(), displayName: name, shared: true, role: null },
    );
  }

  // 공유가 풀린 사람: 사람 목록이 전부이고 비어 있지 않을 때만 (나는 빼고)
  if (sharing && sharing.complete && listed.size > 0) {
    out.forEach((m, i) => {
      const k = lower(m.email);
      if (!k || k === meKey || listed.has(k) || !isSharedMember(m) || index.get(k) !== i) return;
      out[i] = { ...m, shared: false };
      touched.add(i);
    });
  }

  const changed = [...touched].sort((a, b) => a - b).map((i) => out[i]!);
  return { members: out, changed };
}
