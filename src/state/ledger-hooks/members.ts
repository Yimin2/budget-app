import { useCallback } from 'react';
import {
  linkAccountsToEmail, claimOwnerAccounts, 
} from '@/domain';
import type { Id, Member } from '@/domain/types';
import type { LedgerApi } from '../types';
import { koreanMessage } from './helpers';
import type { MonthEndActionsCtx } from './monthEnd';

/** 멤버 · 이름 · 초대 */
export function useMemberActions(ctx: MonthEndActionsCtx) {
  const {
    backendFor, updateRecent, setNotices, authorRef, requireData, requireOnline, mutate, upsertRow, demo,
  } = ctx;
  /* ---------- 멤버·이름 ---------- */

  const linkMemberAccount = useCallback<LedgerApi['linkMemberAccount']>(
    async (email, accountId) => {
      const { data: d } = requireData();
      if (accountId && !d.accounts.some((a) => a.id === accountId && !a.deleted)) throw new Error('통장을 찾을 수 없어요');
      const member = d.members.find((m) => m.email.toLowerCase() === email.trim().toLowerCase());
      const changed = linkAccountsToEmail(d.accounts, email, accountId, member?.displayName);
      if (changed.length === 0) return;
      const byId = new Map(changed.map((a) => [a.id, a]));
      await mutate(
        (cur) => ({ ...cur, accounts: cur.accounts.map((a) => byId.get(a.id) ?? a) }),
        async (repo) => {
          for (const a of changed) await repo.upsert('accounts', a);
        },
        '수입통장을 잇지 못했어요',
        { multiStep: changed.length > 1 },
      );
    },
    [requireData, mutate],
  );

  const claimOwner = useCallback<LedgerApi['claimOwner']>(
    async (ownerName) => {
      const { data: d } = requireData();
      if (demo) return;
      const changed = claimOwnerAccounts(d.accounts, ownerName, authorRef.current);
      if (changed.length === 0) return;
      const byId = new Map(changed.map((a) => [a.id, a]));
      await mutate(
        (cur) => ({ ...cur, accounts: cur.accounts.map((a) => byId.get(a.id) ?? a) }),
        (repo) => repo.upsertMany('accounts', changed),
        '나를 정하지 못했어요',
      );
    },
    [requireData, demo, authorRef, mutate],
  );
  const dismissNotice = useCallback(() => setNotices((list) => list.slice(1)), [setNotices]);

  const inviteMember = useCallback(
    async (email: string, name: string, incomeAccountId?: Id | null) => {
      const clean = email.trim();
      if (!/^[^\s@]+@[^\s@]+$/.test(clean)) throw new Error('이메일 주소를 확인해 주세요');
      requireOnline();
      const { repo } = requireData();
      const backend = backendFor(repo.ref);
      try {
        await backend.share(repo.ref, clean);
      } catch (e) {
        throw new Error(koreanMessage(e, '초대하지 못했어요. 잠시 뒤 다시 시도해 주세요'));
      }
      const existing = requireData().data.members.find((m) => m.email.toLowerCase() === clean.toLowerCase());
      // 구글 이름은 다음 공유 목록 읽기에서 채워져요 (적은 이름은 그때까지만)
      const member: Member = {
        email: existing?.email ?? clean,
        displayName: name.trim() || existing?.displayName || clean.split('@')[0] || clean,
        shared: true,
        role: repo.ref.source === 'sheets' ? 'writer' : (existing?.role ?? null),
      };
      await upsertRow('members', member, '멤버를 저장하지 못했어요');
      if (incomeAccountId) await linkMemberAccount(clean, incomeAccountId);
    },
    [requireOnline, requireData, backendFor, upsertRow, linkMemberAccount],
  );

  const renameLedger = useCallback(
    async (name: string) => {
      const clean = name.trim();
      if (!clean) throw new Error('가계부 이름을 입력해 주세요');
      const { repo } = requireData();
      await mutate(
        (d) => ({ ...d, settings: { ...d.settings, name: clean } }),
        (r) => r.updateSettings({ name: clean }),
        '이름을 바꾸지 못했어요',
      );
      updateRecent({ ...repo.ref, name: clean });
    },
    [requireData, mutate, updateRecent],
  );

  return {
    linkMemberAccount, claimOwner, dismissNotice, inviteMember, renameLedger,
  };
}

export type MemberActionsCtx = MonthEndActionsCtx & ReturnType<typeof useMemberActions>;
