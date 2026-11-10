'use client';

import { useMemo, useState } from 'react';
import {
  addDays, billAmountOn, billSeries, billSeriesId, billTimeline, currentBillRow, dateInMonth, daysInMonth, formatMan, formatWon,
  hasSubItems, monthOf, nextChargeOnOrAfter, normalizeBill,
} from '@/domain';
import type { FixedExpense, FixedKind, FixedSubItem, LedgerData } from '@/domain/types';
import {
  Badge, Button, Card, ConfirmDialog, DateInput, Dialog, EmptyState, Field, ListRow, Money, MoneyInput,
  SegmentedControl, Select, TextInput, focusFirstInvalid,
} from '@/ui';
import type { ReadyLedger } from '../../_components/RequireLedger';
import { PersonPicker, peopleOptions } from '../../_components/PersonPicker';
import { OwnerTabs, ownerKeyOf, useOwnerFilter } from './OwnerTabs';
import { DAY_OPTIONS, isEmail } from '@/app/start/new/wizard';
import { accountNameWithOwner, accountOptions as accountOptionsOf, categorySelectOptions, periodLabel, startMonthForNew, startMonthHint, visibleFixed } from '../helpers';
import { useRunner } from '../useRunner';

/** 생활비 항목 예산은 생활비 예산 카드(LivingCard), 할부는 할부 카드(InstallmentCard)에서 다뤄요 */
type BillKind = Exclude<FixedKind, 'living' | 'installment'>;

const KIND_OPTIONS: { value: BillKind; label: string }[] = [
  { value: 'bill', label: '고정비' },
  { value: 'allowance', label: '용돈' },
];

const GROUPS: { kind: BillKind; title: string }[] = [
  { kind: 'bill', title: '고정비' },
  { kind: 'allowance', title: '용돈' },
];

interface ItemDraft {
  key: number;
  name: string;
  amount: number | null;
  startDate: string;
  endDate: string;
  /** 기간 칸을 펼쳤는지 */
  open: boolean;
}

interface Draft {
  id: string | null;
  kind: BillKind;
  name: string;
  amount: number | null;
  day: number;
  /** 결제일을 직접 골랐는지 (아니면 시작일의 날로 따라가요) */
  dayTouched: boolean;
  accountId: string;
  categoryId: string;
  targetEmail: string;
  startDate: string;
  endDate: string;
  items: ItemDraft[];
  /** 금액 변경 언제부터 */
  amountFrom: string;
}

type Errors = Partial<Record<'name' | 'amount' | 'email' | 'account' | 'end' | 'items' | 'from', string>>;

let itemKey = 0;

function toItemDrafts(list: FixedSubItem[] | null | undefined): ItemDraft[] {
  return (list ?? []).map((s) => ({
    key: ++itemKey,
    name: s.name,
    amount: s.amount,
    startDate: s.startDate ?? '',
    endDate: s.endDate ?? '',
    open: !!(s.startDate || s.endDate),
  }));
}

function toSubItems(items: ItemDraft[]): FixedSubItem[] {
  return items.map((x) => ({
    name: x.name.trim(),
    amount: x.amount ?? 0,
    ...(x.startDate ? { startDate: x.startDate } : {}),
    ...(x.endDate ? { endDate: x.endDate } : {}),
  }));
}

/** 세부 항목 짧게: '목장 4만 · 초원 3만 · 가족 9만' */
export function subItemsSummary(f: Pick<FixedExpense, 'subItems'>, date: string): string {
  return (f.subItems ?? [])
    .filter((s) => (!s.startDate || s.startDate <= date) && (!s.endDate || s.endDate >= date))
    .map((s) => `${s.name} ${formatMan(s.amount)}`)
    .join(' · ');
}

/** 고정 지출: 고정비 · 용돈. 결제일에 자동 기록 (생활비 항목 예산은 LivingCard) */
export function FixedCard({ ledger }: { ledger: ReadyLedger }) {
  const { busy, run } = useRunner();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [confirm, setConfirm] = useState<{ action: 'end' | 'delete'; row: FixedExpense } | null>(null);

  const today = ledger.today;
  const month = monthOf(today);
  const accounts = ledger.activeAccounts;
  const series = useMemo(() => billSeries(ledger.data.fixedExpenses), [ledger.data.fixedExpenses]);
  // 고정비는 행이 여럿일 수 있어요 (금액 변경). 지금 행 하나로 보여요
  const visibleIds = new Set(visibleFixed(ledger.data.fixedExpenses, month).map((f) => billSeriesId(f.id)));
  const items = [...series.entries()]
    .filter(([id]) => visibleIds.has(id))
    .map(([, rows]) => currentBillRow(rows, today))
    .filter((f): f is FixedExpense => !!f)
    .sort((a, b) => (a.dayOfMonth ?? 0) - (b.dayOfMonth ?? 0));
  const isShared = ledger.data.settings.kind === 'shared';
  const accountOptions = accountOptionsOf(accounts);
  const people = peopleOptions(ledger.data);
  const categoryOptions = categorySelectOptions(ledger.activeCategories, [draft?.categoryId]);
  const editing = draft?.id ? ledger.data.fixedExpenses.find((f) => f.id === draft.id) : undefined;
  const editingRows = editing ? (series.get(billSeriesId(editing.id)) ?? [editing]) : [];
  // 사람별로 나눠 보기: 용돈은 받는 사람, 고정비는 나가는 통장 주인
  const keyOf = (f: FixedExpense) =>
    f.kind === 'allowance' && f.targetEmail ? f.targetEmail.trim().toLowerCase() : ownerKeyOf(accounts.find((a) => a.id === f.accountId));
  const myKey = ledger.myLivingAccountId ? ownerKeyOf(ledger.activeAccounts.find((a) => a.id === ledger.myLivingAccountId)) : null;
  const owners = useOwnerFilter(items.map(keyOf), ledger.data, undefined, myKey);
  const shown = items.filter((f) => owners.matches(keyOf(f)));

  function defaultAccountId(): string {
    // 사람별 생활비 통장이 있으면 내 생활비 통장 (고정비도 통장 주인의 것이에요)
    return ledger.myLivingAccountId ?? (ledger.accountByRole('fixed') ?? ledger.accountByRole('allowance') ?? accounts[0])?.id ?? '';
  }

  function openNew(kind: BillKind = 'bill') {
    setErrors({});
    setDraft({
      id: null,
      kind,
      name: '',
      amount: null,
      day: 1,
      dayTouched: false,
      accountId: defaultAccountId(),
      categoryId: '',
      targetEmail: '',
      startDate: '',
      endDate: '',
      items: [],
      amountFrom: '',
    });
  }

  function openEdit(f: FixedExpense) {
    if (f.kind === 'living' || f.kind === 'installment') return;
    setErrors({});
    const rows = series.get(billSeriesId(f.id)) ?? [f];
    const tail = rows[rows.length - 1] ?? f;
    const tomorrow = addDays(today, 1);
    setDraft({
      id: f.id,
      kind: f.kind,
      name: f.name,
      amount: f.amount,
      day: f.dayOfMonth ?? 1,
      dayTouched: true,
      accountId: f.accountId,
      categoryId: f.categoryId ?? '',
      targetEmail: f.targetEmail ?? '',
      startDate: rows[0]?.startDate ?? '',
      endDate: tail.endDate ?? '',
      items: toItemDrafts(f.subItems),
      amountFrom: nextChargeOnOrAfter(f, tomorrow) ?? tomorrow,
    });
  }

  /** 창에서 고치는 중인 모습 (배분 시점 미리 보기용) */
  function previewRows(d: Draft): FixedExpense[] {
    const base: FixedExpense = editing ?? {
      id: '__draft__',
      name: '',
      amount: 0,
      accountId: d.accountId,
      categoryId: null,
      dayOfMonth: d.day,
      kind: d.kind,
      targetEmail: null,
      spread: 'daily',
      startMonth: startMonthForNew(today, d.day),
      endMonth: null,
      deleted: false,
    };
    const subItems = d.kind === 'bill' && d.items.length > 0 ? toSubItems(d.items) : null;
    const isFirst = !editing || editingRows[0]?.id === editing.id;
    const row = normalizeBill(
      {
        ...base,
        name: d.name.trim() || '이 고정비',
        amount: subItems ? 0 : (editing && d.amount !== editing.amount ? editing.amount : (d.amount ?? 0)),
        accountId: d.accountId,
        dayOfMonth: d.day,
        startDate: isFirst ? d.startDate || null : base.startDate,
        endDate: editingRows.length > 1 && editingRows[editingRows.length - 1]?.id !== base.id ? base.endDate : d.endDate || null,
        endMonth: d.endDate ? base.endMonth : editing?.endDate ? null : base.endMonth,
        subItems,
      },
      today,
    );
    const rows = editing ? editingRows.map((r) => (r.id === editing.id ? row : r)) : [row];
    // 금액을 바꾸면 언제부터 새 행을 붙여 보여요
    if (editing && !subItems && d.amount !== null && d.amount !== editing.amount && d.amountFrom) {
      const created = normalizeBill({ ...row, id: `${billSeriesId(row.id)}@${d.amountFrom}`, amount: d.amount, startDate: d.amountFrom }, today);
      const ended = normalizeBill({ ...row, endDate: addDays(d.amountFrom, -1) }, today);
      return rows.map((r) => (r.id === row.id ? ended : r)).concat(created);
    }
    return rows;
  }

  async function save() {
    if (!draft) return;
    const next: Errors = {};
    const withItems = draft.kind === 'bill' && draft.items.length > 0;
    const itemsTotal = draft.items.reduce((s, x) => s + (x.amount ?? 0), 0);
    if (!draft.name.trim()) next.name = '이름을 입력해 주세요';
    if (withItems) {
      if (draft.items.some((x) => !x.name.trim() || x.amount === null || x.amount < 0)) next.items = '세부 항목마다 이름과 금액을 넣어 주세요';
      else if (draft.items.some((x) => x.startDate && x.endDate && x.endDate < x.startDate)) next.items = '세부 항목의 끝나는 날이 시작일보다 앞이에요';
      else if (itemsTotal <= 0) next.items = '세부 항목 금액을 넣어 주세요';
    } else if (draft.amount === null || draft.amount <= 0) next.amount = '금액을 입력해 주세요';
    if (!draft.accountId) next.account = '통장을 골라 주세요';
    if (draft.kind === 'allowance' && !draft.targetEmail.trim()) next.email = '받는 사람을 골라 주세요';
    else if (draft.kind === 'allowance' && !isEmail(draft.targetEmail)) next.email = '받는 사람 이메일을 확인해 주세요';
    if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) next.end = '해지 · 만기일이 시작일보다 앞이에요';
    const amountChanged = !!editing && !withItems && draft.amount !== null && draft.amount !== editing.amount;
    if (amountChanged && !draft.amountFrom) next.from = '언제부터 바뀌는지 골라 주세요';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusFirstInvalid();
      return;
    }
    const dated = draft.kind === 'bill';
    const fields = {
      name: draft.name.trim(),
      kind: draft.kind,
      accountId: draft.accountId,
      categoryId: draft.categoryId || null,
      dayOfMonth: draft.day,
      targetEmail: draft.kind === 'allowance' ? draft.targetEmail.trim() : null,
      subItems: withItems ? toSubItems(draft.items) : null,
    };
    const ok = await run(
      'save',
      async () => {
        if (!draft.id) {
          await ledger.addFixed({
            ...fields,
            amount: withItems ? itemsTotal : draft.amount!,
            spread: 'daily',
            startMonth: draft.startDate && dated ? monthOf(draft.startDate) : startMonthForNew(today, fields.dayOfMonth),
            endMonth: null,
            ...(dated && draft.startDate ? { startDate: draft.startDate } : {}),
            ...(dated && draft.endDate ? { endDate: draft.endDate } : {}),
          });
          return;
        }
        const prev = ledger.data.fixedExpenses.find((f) => f.id === draft.id);
        if (!prev) throw new Error('고정 지출을 찾을 수 없어요');
        const rows = series.get(billSeriesId(prev.id)) ?? [prev];
        const isFirst = rows[0]?.id === prev.id;
        const isTail = rows[rows.length - 1]?.id === prev.id;
        const endChanged = (draft.endDate || null) !== (rows[rows.length - 1]?.endDate ?? null);
        const row: FixedExpense = {
          ...prev,
          ...fields,
          amount: withItems ? itemsTotal : prev.amount,
          ...(dated && isFirst ? { startDate: draft.startDate || null } : {}),
          ...(dated && isTail ? { endDate: draft.endDate || null, endMonth: draft.endDate ? prev.endMonth : prev.endDate ? null : prev.endMonth } : {}),
        };
        // 시작일을 지우면 시작월은 그대로 (예전처럼 달로만 셈)
        await ledger.saveFixed(row);
        // 이름은 모든 행에 (자동 기록 메모가 같게)
        for (const r of rows) if (r.id !== prev.id && r.name !== fields.name) await ledger.saveFixed({ ...r, name: fields.name });
        if (dated && !isTail && endChanged) {
          if (draft.endDate) await ledger.endFixedSeries(billSeriesId(prev.id), draft.endDate);
        }
        if (amountChanged) await ledger.changeFixedAmount(prev.id, draft.amount!, draft.amountFrom);
      },
      draft.id ? '고정 지출을 저장했어요' : '고정 지출을 추가했어요',
    );
    if (ok) setDraft(null);
  }

  async function applyConfirm() {
    if (!confirm) return;
    const { action, row } = confirm;
    const id = billSeriesId(row.id);
    const monthEnd = dateInMonth(month, daysInMonth(month));
    const ok =
      action === 'end'
        ? await run('end', () => ledger.endFixedSeries(id, monthEnd), '다음 달부터 멈출게요')
        : await run('delete', () => ledger.endFixedSeries(id, null), '고정 지출을 지웠어요');
    if (ok) setConfirm(null);
  }

  function subtitle(f: FixedExpense) {
    const rows = series.get(billSeriesId(f.id)) ?? [f];
    const label = periodLabel(rows[0]?.startMonth ?? f.startMonth, rows[rows.length - 1]?.endMonth ?? f.endMonth, month);
    const parts =
      f.kind === 'allowance'
        ? [`매달 ${f.dayOfMonth ?? 1}일`, f.targetEmail ? `${ledger.displayName(f.targetEmail)}(${f.targetEmail})에게` : '받는 사람 없음']
        : [`매달 ${f.dayOfMonth ?? 1}일`, accountNameWithOwner(accounts, f.accountId)];
    const next = nextChargeOnOrAfter(f, today) ?? today;
    const items = hasSubItems(f) ? subItemsSummary(f, next) : '';
    if (items) parts.push(items);
    else if (f.memo?.trim()) parts.push(f.memo.trim());
    const hint = billTimeline(ledger.data, rows, today).find((l) => !l.past)?.text ?? null;
    return (
      <span className="st-sub">
        <span>{parts.join(' · ')}</span>
        {label ? (
          <Badge tone="info">
            {label}
          </Badge>
        ) : null}
        {hint ? <span className="st-hint-line">{hint}</span> : null}
      </span>
    );
  }

  const preview = draft ? billTimeline(ledger.data as LedgerData, previewRows(draft), today) : [];
  const itemsTotal = draft ? draft.items.reduce((s, x) => s + (x.amount ?? 0), 0) : 0;
  const setItem = (key: number, patch: Partial<ItemDraft>) =>
    draft && setDraft({ ...draft, items: draft.items.map((x) => (x.key === key ? { ...x, ...patch } : x)) });

  return (
    <Card id="st-fixed" title="고정 지출">
      <p className="st-desc">고정비와 용돈은 결제일에 지출로 자동 기록돼요. 생활비 예산은 아래 생활비 예산에서 정해요.</p>

      <OwnerTabs filter={owners} label="누구 고정 지출" />

      {shown.length === 0 ? (
        <EmptyState icon="receipt" headingLevel={3} title="고정 지출이 없어요" description="월세·통신비처럼 매달 나가는 돈을 등록해 주세요." />
      ) : (
        GROUPS.map((g) => {
          const rows = shown.filter((f) => f.kind === g.kind);
          if (rows.length === 0) return null;
          return (
            <div key={g.kind}>
              <h3 className="st-group-title">{g.title}</h3>
              <ul className="list">
                {rows.map((f) => (
                  <li key={f.id}>
                    <ListRow
                      icon={g.kind === 'allowance' ? 'user' : 'receipt'}
                      title={f.name}
                      subtitle={subtitle(f)}
                      trailing={<Money amount={billAmountOn(f, nextChargeOnOrAfter(f, today) ?? today)} />}
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
              onChange={(kind) => setDraft({ ...draft, kind })}
            />
            <Field label="이름" error={errors.name} required>
              <TextInput value={draft.name} maxLength={30} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            {draft.kind === 'bill' && draft.items.length > 0 ? (
              <div className="stack gap-2">
                <span className="st-label">세부 항목</span>
                <ul className="st-items" aria-label="세부 항목">
                  {draft.items.map((x, i) => (
                    <li key={x.key} className="st-item">
                      <Field label={`항목 ${i + 1} 이름`}>
                        <TextInput value={x.name} maxLength={30} onChange={(e) => setItem(x.key, { name: e.target.value })} />
                      </Field>
                      <Field label="금액">
                        <MoneyInput value={x.amount} onChange={(v) => setItem(x.key, { amount: v })} />
                      </Field>
                      <Button
                        variant="ghost"
                        icon="trash"
                        aria-label={`${x.name || `항목 ${i + 1}`} 빼기`}
                        onClick={() => setDraft({ ...draft, items: draft.items.filter((y) => y.key !== x.key) })}
                      />
                      {x.open ? (
                        <div className="st-item-dates">
                          <Field label="붙는 날" optional>
                            <DateInput value={x.startDate} onChange={(v) => setItem(x.key, { startDate: v })} />
                          </Field>
                          <Field label="빠지는 날" optional>
                            <DateInput value={x.endDate} onChange={(v) => setItem(x.key, { endDate: v })} />
                          </Field>
                        </div>
                      ) : (
                        <Button variant="ghost" onClick={() => setItem(x.key, { open: true })}>
                          기간 정하기
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="st-items-total" aria-live="polite">
                  <span>합계</span>
                  <strong>{formatWon(itemsTotal)}</strong>
                </div>
                {errors.items ? (
                  <span className="hint err" role="alert">
                    {errors.items}
                  </span>
                ) : null}
              </div>
            ) : (
              <Field
                label="금액"
                error={errors.amount}
                required
                hint={editing && draft.amount !== editing.amount ? '언제부터 바뀌는지 아래에서 골라 주세요. 지난 결제는 그대로예요.' : undefined}
              >
                <MoneyInput value={draft.amount} onChange={(v) => setDraft({ ...draft, amount: v })} data-autofocus="" />
              </Field>
            )}
            {draft.kind === 'bill' ? (
              <div>
                <Button
                  variant="ghost"
                  icon="plus"
                  onClick={() => {
                    // 처음 나누면 지금 금액을 첫 항목으로
                    const first: ItemDraft[] =
                      draft.items.length === 0 && draft.amount
                        ? [{ key: ++itemKey, name: draft.name.trim() || '기본', amount: draft.amount, startDate: '', endDate: '', open: false }]
                        : [];
                    setDraft({
                      ...draft,
                      items: [...draft.items, ...first, { key: ++itemKey, name: '', amount: null, startDate: '', endDate: '', open: false }],
                    });
                  }}
                >
                  세부 항목 추가
                </Button>
              </div>
            ) : null}
            {editing && draft.kind === 'bill' && draft.items.length === 0 && draft.amount !== null && draft.amount !== editing.amount ? (
              <Field label="언제부터 새 금액인가요" error={errors.from} hint="이날 이후 결제부터 새 금액이에요.">
                <DateInput value={draft.amountFrom} onChange={(v) => setDraft({ ...draft, amountFrom: v })} />
              </Field>
            ) : null}
            {editing && draft.kind === 'allowance' && draft.amount !== editing.amount ? (
              <Field label="언제부터 새 금액인가요" error={errors.from}>
                <DateInput value={draft.amountFrom} onChange={(v) => setDraft({ ...draft, amountFrom: v })} />
              </Field>
            ) : null}
            {draft.kind === 'allowance' ? (
              <PersonPicker
                label="받는 사람"
                required
                emailOnly
                emailRequired
                people={people}
                value={{ name: '', email: draft.targetEmail }}
                onChange={(v) => setDraft({ ...draft, targetEmail: v.email })}
                error={errors.email}
                emailError={errors.email}
                hint="받는 사람의 개인 가계부에 수입으로 들어가요."
              />
            ) : null}
            {draft.kind === 'bill' && (!editing || editingRows[0]?.id === editing.id) ? (
              <Field label="시작일" optional hint="첫 결제는 이날 이후 첫 결제일이에요.">
                <DateInput
                  value={draft.startDate}
                  onChange={(v) =>
                    setDraft({ ...draft, startDate: v, day: !draft.dayTouched && v ? Number(v.slice(8, 10)) : draft.day })
                  }
                />
              </Field>
            ) : null}
            <Field
              label={draft.kind === 'allowance' ? '주는 날' : '결제일'}
              hint={draft.id || draft.startDate ? undefined : startMonthHint(today, draft.day)}
            >
              <Select
                value={String(draft.day)}
                onChange={(v) => setDraft({ ...draft, day: Number(v), dayTouched: true })}
                options={DAY_OPTIONS}
              />
            </Field>
            {draft.kind === 'bill' ? (
              <Field label="해지 · 만기일" optional error={errors.end} hint="이날 이전 마지막 결제일까지 내요.">
                <DateInput value={draft.endDate} onChange={(v) => setDraft({ ...draft, endDate: v })} />
              </Field>
            ) : null}
            <Field label="나가는 통장" error={errors.account}>
              <Select
                value={draft.accountId}
                onChange={(v) => setDraft({ ...draft, accountId: v })}
                options={accountOptions}
                placeholder="통장 고르기"
              />
            </Field>
            <Field label="카테고리" optional>
              <Select value={draft.categoryId} onChange={(v) => setDraft({ ...draft, categoryId: v })} options={categoryOptions} />
            </Field>
            {preview.length > 0 ? (
              <div className="stack gap-2">
                <span className="st-label">언제 나가고 어느 배분에 들어가나요</span>
                <ul className="st-timeline" aria-label="결제와 배분 시점">
                  {preview.map((l, i) => (
                    <li key={i} className={l.past ? 'past' : undefined}>
                      {l.text}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {editing ? (
              <div className="st-danger">
                {(editingRows[editingRows.length - 1]?.endMonth ?? null) === null || (editingRows[editingRows.length - 1]?.endMonth ?? '') > month ? (
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
            ? '다음 달부터는 자동으로 기록하지 않아요. 이번 달 기록은 그대로 둬요.'
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
