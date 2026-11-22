'use client';

import { useState } from 'react';
import { formatDateKo, formatWon, isPayeeAccount } from '@/domain';
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
  bank: string;
  accountNumber: string;
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
  // 통장은 잔액을 관리하는 것만 (월급 · 이벤트 · 저수지 등), 각자 생활비 · 용돈은 '보낼 곳'으로 따로 (2026-11)
  const managed = accounts.filter((a) => !isPayeeAccount(a));
  const payees = accounts.filter(isPayeeAccount);
  const groups = groupAccounts(ledger.data, managed, { meKey: meKeyOf(ledger.data, session.user?.email, ledger.myLivingAccountId) });

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
      bank: '',
      accountNumber: '',
    });
  }
  function openEdit(a: Account) {
    setNameError(undefined);
    setEmailError(undefined);
    setDraft({
      id: a.id,
      name: a.name,
      role: a.role,
      // 고치기 창의 잔액 칸은 '지금 잔액' (시작 잔액이 아니에요, 2026-11)
      openingBalance: ledger.balances[a.id] ?? 0,
      openingDate: a.openingDate,
      ownerName: a.ownerName ?? '',
      ownerEmail: a.ownerEmail ?? '',
      bank: a.bank ?? '',
      accountNumber: a.accountNumber ?? '',
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
    // 은행 · 계좌번호 ('오늘 보낼 돈'에서 복사). 비우면 없앰
    const bankInfo = (a: Account): Account => {
      const next: Account = { ...a };
      const bank = draft.bank.trim();
      const no = draft.accountNumber.trim();
      if (bank) next.bank = bank;
      else delete next.bank;
      if (no) next.accountNumber = no;
      else delete next.accountNumber;
      return next;
    };
    const balance = draft.openingBalance ?? 0;
    const ok = draft.id
      ? await run(
          'save',
          async () => {
            const prev = ledger.data.accounts.find((a) => a.id === draft.id);
            if (!prev) throw new Error('통장을 찾을 수 없어요');
            await ledger.saveAccount(bankInfo({ ...prev, ...owner, name, role: draft.role }));
            // 지금 잔액을 바꿨으면 차이만큼 오늘 날짜 '잔액 조정' 기록 (시작 잔액 · 지난 기록은 그대로)
            const current = ledger.balances[prev.id] ?? 0;
            if (!prev.payee && draft.openingBalance !== null && balance !== current) await ledger.adjustBalance(prev.id, balance);
            // 한 이메일은 한 통장에만: 같은 주인 이메일인 다른 통장은 비워요 (멤버 화면의 수입통장과 같게)
            if (owner.ownerEmail) await ledger.linkMemberAccount(owner.ownerEmail, prev.id);
          },
          '통장을 저장했어요',
        )
      : await run(
          'save',
          async () => {
            // 새 통장: 지금 잔액 = 오늘 기준 시작 잔액
            const created = await ledger.addAccount({ ...owner, name, role: draft.role, openingBalance: balance });
            const withBank = bankInfo({ ...created, openingDate: ledger.today });
            if (withBank.openingDate !== created.openingDate || withBank.bank || withBank.accountNumber) {
              await ledger.saveAccount(withBank);
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
    <Card id="st-accounts" title="통장" aside={<span className="muted">{managed.length}개</span>}>
      <p className="st-desc">잔액을 관리하는 통장이에요. 눌러서 지금 잔액을 실제 금액으로 고칠 수 있어요.</p>
      {managed.length === 0 ? (
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
                        {a.bank || a.accountNumber ? <span>{[a.bank, a.accountNumber].filter(Boolean).join(' ')}</span> : null}
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
      {payees.length > 0 ? (
        <section className="stack gap-2" aria-labelledby="st-payees-title">
          <h3 id="st-payees-title" className="st-group-title">
            보낼 곳 · {payees.length}
          </h3>
          <p className="st-desc">월급에서 돈을 보내기만 하는 곳이에요 (각자 생활비 · 용돈). 잔액은 관리하지 않고, 이름 · 은행 · 계좌번호만 적어요.</p>
          <ul className="list" aria-label="보낼 곳">
            {payees.map((a) => (
              <li key={a.id}>
                <ListRow
                  icon={ACCOUNT_ROLE_ICON[a.role]}
                  title={a.name}
                  subtitle={
                    <span className="st-sub">
                      {/* 주인은 이메일 대신 이름만, 통장 이름에 이미 있으면 빼요 */}
                      {a.ownerName && !a.name.includes(a.ownerName) ? (
                        <Badge size="sm" tone="info" dot={false}>
                          {a.ownerName}
                        </Badge>
                      ) : null}
                      <span>{[a.bank, a.accountNumber].filter(Boolean).join(' ') || '계좌번호를 넣어 주세요'}</span>
                    </span>
                  }
                  onClick={() => openEdit(a)}
                  className="st-acc-row"
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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
            <Field label="은행" optional hint="월급통장에서 이 통장으로 보낼 때 '오늘 보낼 돈'에 보여요.">
              <TextInput value={draft.bank} maxLength={20} placeholder="예: 카카오뱅크" onChange={(e) => setDraft({ ...draft, bank: e.target.value })} />
            </Field>
            <Field label="계좌번호" optional hint="'오늘 보낼 돈'에서 눌러 복사해요. 가계부 시트에만 저장돼요.">
              <TextInput
                value={draft.accountNumber}
                maxLength={30}
                inputMode="numeric"
                placeholder="예: 3333-01-1234567"
                onChange={(e) => setDraft({ ...draft, accountNumber: e.target.value })}
              />
            </Field>
            {draft.id && accounts.find((x) => x.id === draft.id)?.payee ? null : (
            <Field
              label="지금 잔액"
              hint={
                draft.id
                  ? '실제 통장 금액으로 고쳐 주세요. 바꾸면 차이만큼 오늘 날짜로 잔액 조정 기록이 남고, 지난 기록은 그대로예요.'
                  : '오늘 통장에 있는 돈이에요.'
              }
            >
              <MoneyInput value={draft.openingBalance} onChange={(v) => setDraft({ ...draft, openingBalance: v })} allowNegative />
            </Field>
            )}
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
