'use client';

import { useState } from 'react';
import { formatDateKo } from '@/domain';
import type { Account, AccountRole } from '@/domain/types';
import { ACCOUNT_ROLE_ICON, Badge, Button, Card, ConfirmDialog, DateInput, Dialog, EmptyState, Field, ListRow, Money, MoneyInput, Select, TextInput, focusFirstInvalid } from '@/ui';
import type { ReadyLedger } from '../../_components/RequireLedger';
import { PersonPicker, peopleOptions } from '../../_components/PersonPicker';
import { ROLE_OPTIONS, ROLE_TEXT, ownerText } from '../helpers';
import { incomeAccountName, isEmail } from '@/app/start/new/wizard';
import { useRunner } from '../useRunner';
import { groupAccounts, meKeyOf } from '../../_components/accountGroups';
import { useSession } from '@/state';

interface Draft {
  id: string | null; // null = 새 통장
  name: string;
  role: AccountRole;
  openingBalance: number | null;
  openingDate: string;
  ownerName: string;
  ownerEmail: string;
}

/** 통장: 이름 · 역할 · 주인(사람별 수입통장) · 시작 잔액/기준일 · 추가 · 지우기 */
export function AccountsCard({ ledger }: { ledger: ReadyLedger }) {
  const { busy, run } = useRunner();
  const session = useSession();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [emailError, setEmailError] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<Account | null>(null);
  const accounts = ledger.activeAccounts;
  const isShared = ledger.data.settings.kind === 'shared';
  const people = peopleOptions(ledger.data);
  // 사람별로 묶어 보여요: 나 → 다른 사람 → 함께
  const groups = groupAccounts(ledger.data, accounts, { meKey: meKeyOf(ledger.data, session.user?.email, ledger.myLivingAccountId) });

  function openNew(role: AccountRole = 'other') {
    setNameError(undefined);
    setEmailError(undefined);
    setDraft({
      id: null,
      name: '',
      role,
      openingBalance: null,
      openingDate: ledger.today,
      ownerName: '',
      ownerEmail: '',
    });
  }
  function openEdit(a: Account) {
    setNameError(undefined);
    setEmailError(undefined);
    setDraft({
      id: a.id,
      name: a.name,
      role: a.role,
      openingBalance: a.openingBalance,
      openingDate: a.openingDate,
      ownerName: a.ownerName ?? '',
      ownerEmail: a.ownerEmail ?? '',
    });
  }

  async function save() {
    if (!draft) return;
    // 수입통장은 이름을 비우면 주인 이름으로 지어 줘요 ('준호 수입통장')
    const name = draft.name.trim() || (draft.role === 'income' && draft.ownerName.trim() ? incomeAccountName(draft.ownerName) : '');
    const badEmail = draft.ownerEmail.trim() !== '' && !isEmail(draft.ownerEmail);
    setNameError(name ? undefined : '통장 이름을 입력해 주세요');
    setEmailError(badEmail ? '이메일 주소를 확인해 주세요' : undefined);
    if (!name || badEmail) {
      focusFirstInvalid();
      return;
    }
    const owner = { ownerName: draft.ownerName.trim() || null, ownerEmail: draft.ownerEmail.trim() || null };
    const balance = draft.openingBalance ?? 0;
    const ok = draft.id
      ? await run(
          'save',
          async () => {
            const prev = ledger.data.accounts.find((a) => a.id === draft.id);
            if (!prev) throw new Error('통장을 찾을 수 없어요');
            await ledger.saveAccount({
              ...prev,
              ...owner,
              name,
              role: draft.role,
              openingBalance: balance,
              openingDate: draft.openingDate || prev.openingDate,
            });
            // 한 이메일은 한 통장에만: 같은 주인 이메일인 다른 통장은 비워요 (멤버 화면의 수입통장과 같게)
            if (owner.ownerEmail) await ledger.linkMemberAccount(owner.ownerEmail, prev.id);
          },
          '통장을 저장했어요',
        )
      : await run(
          'save',
          async () => {
            const created = await ledger.addAccount({ ...owner, name, role: draft.role, openingBalance: balance });
            if (draft.openingDate && draft.openingDate !== created.openingDate) {
              await ledger.saveAccount({ ...created, openingDate: draft.openingDate });
            }
            if (owner.ownerEmail) await ledger.linkMemberAccount(owner.ownerEmail, created.id);
          },
          '통장을 추가했어요',
        );
    if (ok) setDraft(null);
  }

  /** 주인 이메일이 멤버면 이어진다고 알려 줘요 */
  function ownerEmailHint(email: string): string | undefined {
    const clean = email.trim().toLowerCase();
    const member = clean ? ledger.data.members.find((m) => m.email.toLowerCase() === clean) : undefined;
    if (member) return `멤버 ${member.displayName || member.email}님과 이어져요. 다른 통장에 같은 이메일이 있으면 비워요.`;
    return isShared ? '멤버 이메일을 적으면 그 멤버와 이어져요.' : undefined;
  }

  async function remove(a: Account) {
    const ok = await run('delete', () => ledger.saveAccount({ ...a, deleted: true }), '통장을 지웠어요');
    if (ok) setConfirmDelete(null);
  }

  const deleting = confirmDelete;
  const refs = deleting
    ? {
        rules: ledger.data.rules.filter((r) => !r.deleted && (r.fromAccountId === deleting.id || r.toAccountId === deleting.id)).length,
        fixed: ledger.data.fixedExpenses.filter((f) => !f.deleted && f.accountId === deleting.id).length,
      }
    : null;

  return (
    <Card id="st-accounts" title="통장" aside={<span className="muted">{accounts.length}개</span>}>
      <p className="st-desc">잔액은 시작 잔액에 기준일부터의 기록을 더하고 빼서 계산해요.</p>
      {accounts.length === 0 ? (
        <EmptyState icon="wallet" headingLevel={3} title="통장이 없어요" description="통장을 추가하면 잔액을 계산해 드려요." />
      ) : (
        groups.map((g) => (
          <section key={g.key || '__shared'} className="stack gap-2">
            {groups.length > 1 ? (
              <h3 className="st-group-title">
                {g.label}
              </h3>
            ) : null}
            <ul className="list">
              {g.accounts.map((a) => (
                <li key={a.id}>
                  <ListRow
                    icon={ACCOUNT_ROLE_ICON[a.role]}
                    title={a.name}
                    subtitle={
                      <span className="st-sub">
                        <Badge size="sm" dot={false}>
                          {ROLE_TEXT[a.role]}
                        </Badge>
                        {ownerText(a) ? (
                          <Badge size="sm" tone="info" dot={false}>
                            {ownerText(a)}
                          </Badge>
                        ) : null}
                        <span>
                          시작 <Money amount={a.openingBalance} /> · {formatDateKo(a.openingDate, false)}부터
                        </span>
                      </span>
                    }
                    trailing={
                      <span className="st-trail">
                        <Money amount={ledger.balances[a.id] ?? 0} />
                        <span className="st-cap">지금 잔액</span>
                      </span>
                    }
                    onClick={() => openEdit(a)}
                    className="st-acc-row"
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <div className="st-foot">
        <Button variant="outline" icon="plus" onClick={() => openNew()}>
          통장 추가
        </Button>
        {isShared ? (
          <Button variant="ghost" icon="user" onClick={() => openNew('income')}>
            다른 사람 수입통장 추가
          </Button>
        ) : null}
      </div>

      <Dialog
        open={draft !== null}
        onClose={() => (busy ? undefined : setDraft(null))}
        title={draft?.id ? '통장 고치기' : draft?.role === 'income' ? '수입통장 추가' : '통장 추가'}
        actions={
          <>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={busy !== null}>
              취소
            </Button>
            <Button type="submit" form="st-account-form" loading={busy === 'save'} disabled={busy === 'delete'}>
              저장
            </Button>
          </>
        }
      >
        {draft ? (
          <form
            id="st-account-form"
            className="stack"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field
              label="이름"
              error={nameError}
              required={draft.role !== 'income'}
              hint={draft.role === 'income' && !draft.id ? '비우면 \'주인 이름 수입통장\'으로 지어 드려요.' : undefined}
            >
              <TextInput
                value={draft.name}
                maxLength={30}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                data-autofocus=""
              />
            </Field>
            <Field label="역할" hint="역할에 따라 생활비·이벤트 예측·월말 처리에 쓰는 통장이 정해져요.">
              <Select value={draft.role} onChange={(v) => setDraft({ ...draft, role: v as AccountRole })} options={ROLE_OPTIONS} />
            </Field>
            <PersonPicker
              label="주인"
              optional
              people={people}
              noneLabel="함께 쓰는 통장 (주인 없음)"
              value={{ name: draft.ownerName, email: draft.ownerEmail }}
              onChange={(v) => setDraft({ ...draft, ownerName: v.name, ownerEmail: v.email })}
              hint={
                draft.role === 'income'
                  ? '누구 월급이 들어오는 통장인지 골라 주세요. 아직 초대하지 않은 사람은 직접 입력해요.'
                  : '사람별 생활비 · 용돈 통장이면 주인을 골라 주세요. 함께 쓰는 통장이면 비워 두세요.'
              }
              emailError={emailError}
              emailHint={ownerEmailHint(draft.ownerEmail)}
            />
            <Field label="시작 잔액">
              <MoneyInput value={draft.openingBalance} onChange={(v) => setDraft({ ...draft, openingBalance: v })} allowNegative />
            </Field>
            <Field label="기준일" hint="이날의 잔액이에요. 이날부터의 기록만 잔액에 더해져요.">
              <DateInput value={draft.openingDate} onChange={(v) => setDraft({ ...draft, openingDate: v })} />
            </Field>
            {draft.id ? (
              <div className="st-danger">
                <Button
                  variant="ghost"
                  icon="trash"
                  onClick={() => {
                    const a = accounts.find((x) => x.id === draft.id);
                    if (!a) return;
                    // 창을 겹쳐 열지 않도록 고치기 창을 닫고 확인 창을 열어요
                    setDraft(null);
                    setConfirmDelete(a);
                  }}
                  disabled={busy !== null}
                >
                  이 통장 지우기
                </Button>
              </div>
            ) : null}
          </form>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={confirmDelete !== null}
        tone="danger"
        title="이 통장을 지울까요?"
        description={
          refs && refs.rules + refs.fixed > 0
            ? `${confirmDelete?.name}: 이 통장을 쓰는 매달 배분 ${refs.rules}건, 고정 지출 ${refs.fixed}건도 함께 고쳐 주세요. 이미 남긴 기록은 시트에 그대로 있어요.`
            : `${confirmDelete?.name}: 목록과 잔액 계산에서 빠져요. 이미 남긴 기록은 시트에 그대로 있어요.`
        }
        confirmLabel="지우기"
        loading={busy === 'delete'}
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </Card>
  );
}
