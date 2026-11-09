'use client';

import { useId, useState } from 'react';
import { isMonthActive, monthOf } from '@/domain';
import type { FixedExpense, FixedKind } from '@/domain/types';
import {
  Badge, Banner, Button, Card, ConfirmDialog, Dialog, EmptyState, Field, ListRow, Money, MoneyInput,
  SegmentedControl, Select, TextInput, focusFirstInvalid,
} from '@/ui';
import type { ReadyLedger } from '../../_components/RequireLedger';
import { DAY_OPTIONS, isEmail } from '@/app/start/new/wizard';
import { accountName, periodLabel, startMonthForNew, startMonthHint, visibleFixed } from '../helpers';
import { useRunner } from '../useRunner';

const KIND_OPTIONS: { value: FixedKind; label: string }[] = [
  { value: 'bill', label: '고정비' },
  { value: 'living', label: '생활비' },
  { value: 'allowance', label: '용돈' },
];

const GROUPS: { kind: FixedKind; title: string }[] = [
  { kind: 'living', title: '생활비' },
  { kind: 'bill', title: '고정비' },
  { kind: 'allowance', title: '용돈' },
];

interface Draft {
  id: string | null;
  kind: FixedKind;
  name: string;
  amount: number | null;
  day: number;
  accountId: string;
  categoryId: string;
  targetEmail: string;
}

type Errors = Partial<Record<'name' | 'amount' | 'email' | 'account', string>>;

/** 고정 지출: 고정비 · 생활비 · 용돈. 결제일에 자동 기록 (생활비는 한 달 금액으로만 써요) */
export function FixedCard({ ledger }: { ledger: ReadyLedger }) {
  const { busy, run } = useRunner();
  const listId = `st-members-${useId().replace(/:/g, '')}`;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [confirm, setConfirm] = useState<{ action: 'end' | 'delete'; row: FixedExpense } | null>(null);

  const month = monthOf(ledger.today);
  const accounts = ledger.activeAccounts;
  const items = visibleFixed(ledger.data.fixedExpenses, month);
  const hasLiving = items.some((f) => f.kind === 'living' && isMonthActive(month, f.startMonth, f.endMonth));
  const isShared = ledger.data.settings.kind === 'shared';
  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }));
  const categoryOptions = [{ value: '', label: '없음' }, ...ledger.activeCategories.map((c) => ({ value: c.id, label: c.name }))];
  const editing = draft?.id ? ledger.data.fixedExpenses.find((f) => f.id === draft.id) : undefined;

  function defaultAccountId(): string {
    return (ledger.accountByRole('fixed') ?? ledger.accountByRole('allowance') ?? accounts[0])?.id ?? '';
  }

  function openNew(kind: FixedKind = 'bill') {
    setErrors({});
    setDraft({
      id: null,
      kind,
      name: kind === 'living' ? '생활비' : '',
      amount: null,
      day: 1,
      accountId: defaultAccountId(),
      categoryId: '',
      targetEmail: '',
    });
  }

  function openEdit(f: FixedExpense) {
    setErrors({});
    setDraft({
      id: f.id,
      kind: f.kind,
      name: f.name,
      amount: f.amount,
      day: f.dayOfMonth ?? 1,
      accountId: f.accountId,
      categoryId: f.categoryId ?? '',
      targetEmail: f.targetEmail ?? '',
    });
  }

  async function save() {
    if (!draft) return;
    const next: Errors = {};
    if (!draft.name.trim()) next.name = '이름을 입력해 주세요';
    if (draft.amount === null || draft.amount <= 0) next.amount = '금액을 입력해 주세요';
    if (!draft.accountId) next.account = '통장을 골라 주세요';
    if (draft.kind === 'allowance' && !isEmail(draft.targetEmail)) next.email = '받는 사람 이메일을 확인해 주세요';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusFirstInvalid();
      return;
    }
    const fields = {
      name: draft.name.trim(),
      amount: draft.amount!,
      kind: draft.kind,
      accountId: draft.accountId,
      categoryId: draft.kind === 'living' ? null : draft.categoryId || null,
      dayOfMonth: draft.kind === 'living' ? null : draft.day,
      targetEmail: draft.kind === 'allowance' ? draft.targetEmail.trim() : null,
    };
    const ok = await run(
      'save',
      async () => {
        if (!draft.id) {
          await ledger.addFixed({ ...fields, startMonth: startMonthForNew(ledger.today, fields.dayOfMonth), endMonth: null });
          return;
        }
        const prev = ledger.data.fixedExpenses.find((f) => f.id === draft.id);
        if (!prev) throw new Error('고정 지출을 찾을 수 없어요');
        await ledger.saveFixed({ ...prev, ...fields });
      },
      draft.id ? '고정 지출을 저장했어요' : '고정 지출을 추가했어요',
    );
    if (ok) setDraft(null);
  }

  async function applyConfirm() {
    if (!confirm) return;
    const { action, row } = confirm;
    const ok =
      action === 'end'
        ? await run('end', () => ledger.saveFixed({ ...row, endMonth: month }), '다음 달부터 멈출게요')
        : await run('delete', () => ledger.saveFixed({ ...row, deleted: true }), '고정 지출을 지웠어요');
    if (ok) setConfirm(null);
  }

  function subtitle(f: FixedExpense) {
    const label = periodLabel(f.startMonth, f.endMonth, month);
    const parts =
      f.kind === 'living'
        ? ['한 달 금액 · 하루 생활비 기준']
        : f.kind === 'allowance'
          ? [`매달 ${f.dayOfMonth ?? 1}일`, `${f.targetEmail ? ledger.displayName(f.targetEmail) : '받는 사람 없음'}에게`]
          : [`매달 ${f.dayOfMonth ?? 1}일`, accountName(accounts, f.accountId)];
    return (
      <span className="st-sub">
        <span>{parts.join(' · ')}</span>
        {label ? (
          <Badge size="sm" tone="info">
            {label}
          </Badge>
        ) : null}
      </span>
    );
  }

  return (
    <Card id="st-fixed" title="고정 지출">
      <p className="st-desc">고정비와 용돈은 결제일에 지출로 자동 기록돼요. 생활비는 하루 생활비를 계산하는 한 달 금액이에요.</p>

      {!hasLiving ? (
        <Banner tone="info" title="생활비 금액을 정해 주세요" action={{ label: '생활비 정하기', onClick: () => openNew('living') }}>
          정하면 오늘 써도 되는 돈과 &lsquo;사도 돼?&rsquo;를 알려 드려요.
        </Banner>
      ) : null}

      {items.length === 0 ? (
        <EmptyState icon="receipt" headingLevel={3} title="고정 지출이 없어요" description="월세·통신비처럼 매달 나가는 돈을 등록해 주세요." />
      ) : (
        GROUPS.map((g) => {
          const rows = items.filter((f) => f.kind === g.kind);
          if (rows.length === 0) return null;
          return (
            <div key={g.kind}>
              <h3 className="st-group-title">{g.title}</h3>
              <ul className="list">
                {rows.map((f) => (
                  <li key={f.id}>
                    <ListRow
                      icon={g.kind === 'living' ? 'wallet' : g.kind === 'allowance' ? 'user' : 'receipt'}
                      title={f.name}
                      subtitle={subtitle(f)}
                      trailing={<Money amount={f.amount} />}
                      onClick={() => openEdit(f)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}

      <div className="st-foot">
        <Button variant="outline" icon="plus" onClick={() => openNew('bill')} disabled={accounts.length === 0}>
          고정 지출 추가
        </Button>
      </div>

      <Dialog
        open={draft !== null}
        onClose={() => (busy ? undefined : setDraft(null))}
        title={draft?.id ? '고정 지출 고치기' : '고정 지출 추가'}
        actions={
          <>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={busy !== null}>
              취소
            </Button>
            <Button type="submit" form="st-fixed-form" loading={busy === 'save'}>
              저장
            </Button>
          </>
        }
      >
        {draft ? (
          <form
            id="st-fixed-form"
            className="stack"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <SegmentedControl
              ariaLabel="종류"
              block
              options={KIND_OPTIONS.map((o) => ({ ...o, disabled: o.value === 'allowance' && !isShared && draft.kind !== 'allowance' }))}
              value={draft.kind}
              onChange={(kind) =>
                setDraft({ ...draft, kind, name: kind === 'living' && !draft.name.trim() ? '생활비' : draft.name })
              }
            />
            <Field label="이름" error={errors.name} required>
              <TextInput value={draft.name} maxLength={30} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label={draft.kind === 'living' ? '한 달 생활비' : '금액'} error={errors.amount} required>
              <MoneyInput value={draft.amount} onChange={(v) => setDraft({ ...draft, amount: v })} data-autofocus="" />
            </Field>
            {draft.kind === 'allowance' ? (
              <Field label="받는 사람 이메일" error={errors.email} required hint="받는 사람의 개인 가계부에 수입으로 들어가요.">
                <TextInput
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  list={listId}
                  value={draft.targetEmail}
                  onChange={(e) => setDraft({ ...draft, targetEmail: e.target.value })}
                />
              </Field>
            ) : null}
            <datalist id={listId}>
              {ledger.data.members.map((m) => (
                <option key={m.email} value={m.email}>
                  {m.displayName}
                </option>
              ))}
            </datalist>
            {draft.kind !== 'living' ? (
              <Field
                label={draft.kind === 'allowance' ? '주는 날' : '결제일'}
                hint={draft.id ? undefined : startMonthHint(ledger.today, draft.day)}
              >
                <Select value={String(draft.day)} onChange={(v) => setDraft({ ...draft, day: Number(v) })} options={DAY_OPTIONS} />
              </Field>
            ) : null}
            <Field label={draft.kind === 'living' ? '생활비를 쓰는 통장' : '나가는 통장'} error={errors.account}>
              <Select
                value={draft.accountId}
                onChange={(v) => setDraft({ ...draft, accountId: v })}
                options={accountOptions}
                placeholder="통장 고르기"
              />
            </Field>
            {draft.kind !== 'living' ? (
              <Field label="카테고리" optional>
                <Select value={draft.categoryId} onChange={(v) => setDraft({ ...draft, categoryId: v })} options={categoryOptions} />
              </Field>
            ) : null}
            {editing ? (
              <div className="st-danger">
                {editing.endMonth === null || editing.endMonth > month ? (
                  <Button
                    variant="ghost"
                    icon="x-circle"
                    disabled={busy !== null}
                    onClick={() => {
                      setDraft(null);
                      setConfirm({ action: 'end', row: editing });
                    }}
                  >
                    이번 달까지만
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  icon="trash"
                  disabled={busy !== null}
                  onClick={() => {
                    setDraft(null);
                    setConfirm({ action: 'delete', row: editing });
                  }}
                >
                  지우기
                </Button>
              </div>
            ) : null}
          </form>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={confirm !== null}
        tone="danger"
        title={confirm?.action === 'end' ? '이번 달까지만 쓸까요?' : '이 고정 지출을 지울까요?'}
        description={
          confirm?.action === 'end'
            ? confirm.row.kind === 'living'
              ? '다음 달부터 생활비 금액에서 빠져요. 이번 달 계산은 그대로예요.'
              : '다음 달부터는 자동으로 기록하지 않아요. 이번 달 기록은 그대로 둬요.'
            : '지난달 계산에서도 빠져요. 이미 자동 기록된 지출은 남아요. 그만 쓰는 거라면 이번 달까지만을 골라 주세요.'
        }
        confirmLabel={confirm?.action === 'end' ? '이번 달까지만' : '지우기'}
        loading={busy === 'end' || busy === 'delete'}
        onConfirm={() => void applyConfirm()}
        onCancel={() => setConfirm(null)}
      />
    </Card>
  );
}
