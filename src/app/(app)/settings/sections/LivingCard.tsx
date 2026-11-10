'use client';

import { useState } from 'react';
import { addMonths, defaultSpreadFor, formatWon, hasLegacyLivingRow, isMonthActive, monthOf } from '@/domain';
import type { Category, FixedExpense, LivingSpread } from '@/domain/types';
import {
  Badge, Banner, Button, Card, Chip, ChipGroup, ConfirmDialog, Dialog, EmptyState, Field, Icon, ListRow, Money, MoneyInput,
  SegmentedControl, Select, focusFirstInvalid, isIconName,
} from '@/ui';
import type { ReadyLedger } from '../../_components/RequireLedger';
import { defaultLivingDrafts, livingDraftFor, livingTotal, type LivingDraft } from '@/app/start/new/wizard';
import { periodLabel, visibleFixed, accountNameWithOwner, accountOptions as accountOptionsOf } from '../helpers';
import { OwnerTabs, ownerKeyOf, useOwnerFilter } from './OwnerTabs';
import { useRunner } from '../useRunner';

export const SPREAD_TEXT: Record<LivingSpread, string> = { daily: '하루에 나눠 쓰기', monthly: '한 달 한도만' };
const SPREAD_OPTIONS: { value: LivingSpread; label: string }[] = [
  { value: 'daily', label: SPREAD_TEXT.daily },
  { value: 'monthly', label: SPREAD_TEXT.monthly },
];

interface Draft {
  id: string | null;
  categoryId: string; // '' = 카테고리 없음 (예전 생활비 한 줄)
  amount: number | null;
  spread: LivingSpread;
  /** 이 항목을 쓰는 생활비 통장 (사람별 생활비 통장이면 그 사람) */
  accountId: string;
}

type Errors = Partial<Record<'category' | 'amount' | 'account', string>>;

/**
 * 생활비 예산: 항목(카테고리)마다 한 달 예산과 쓰는 방식(하루에 나눠 쓰기 / 한 달 한도만).
 * 예전 방식의 '생활비' 한 줄이 있으면 항목으로 나누라고 안내하고, 나누면 그 줄은 이번 달부터 빼요.
 */
export function LivingCard({ ledger }: { ledger: ReadyLedger }) {
  const { busy, run } = useRunner();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [confirm, setConfirm] = useState<{ action: 'end' | 'delete'; row: FixedExpense } | null>(null);
  const [split, setSplit] = useState<LivingDraft[] | null>(null);

  const month = monthOf(ledger.today);
  const data = ledger.data;
  const accountOrder = new Map(ledger.activeAccounts.map((a, i) => [a.id, i]));
  const catById = new Map(data.categories.map((c) => [c.id, c]));
  // 통장 순서 → 카테고리 순서(설정에서 정한 순서). 카테고리 없는 예전 한 줄 · 지운 카테고리는 뒤에
  const catPos = new Map(ledger.activeCategories.map((c, i) => [c.id, i]));
  const catRank = (f: FixedExpense) => (f.categoryId ? (catPos.get(f.categoryId) ?? Number.MAX_SAFE_INTEGER - 1) : Number.MAX_SAFE_INTEGER);
  const rows = visibleFixed(data.fixedExpenses, month)
    .filter((f) => f.kind === 'living')
    .sort((a, b) => (accountOrder.get(a.accountId) ?? 999) - (accountOrder.get(b.accountId) ?? 999) || catRank(a) - catRank(b));
  const categories = ledger.activeCategories.filter((c) => c.defaultAccountRole !== 'event');
  const legacy = hasLegacyLivingRow(data, month);
  const legacyRows = rows.filter((f) => f.categoryId === null && isMonthActive(month, f.startMonth, f.endMonth));
  const thisMonthTotal = rows
    .filter((f) => isMonthActive(month, f.startMonth, f.endMonth))
    .reduce((s, f) => s + f.amount, 0);
  const accountId =
    ledger.myLivingAccountId ??
    ledger.living?.livingAccountId ??
    (ledger.accountByRole('fixed') ?? ledger.accountByRole('allowance') ?? ledger.activeAccounts[0])?.id ??
    '';
  // 생활비를 쓸 수 있는 통장: 고정지출 역할 통장 (사람별 생활비 통장) + 지금 예산 행이 쓰는 통장
  const livingAccounts = ledger.activeAccounts.filter(
    (a) => a.role === 'fixed' || a.id === accountId || rows.some((f) => f.accountId === a.id),
  );
  const multiAccount = livingAccounts.length > 1;
  const accountLabel = (id: string) => accountNameWithOwner(ledger.activeAccounts, id);
  // 사람별 생활비 통장이면 사람마다 탭 (기본: 내 생활비)
  const keyOfAccount = (id: string) => ownerKeyOf(ledger.activeAccounts.find((a) => a.id === id));
  const meKey = ledger.myLivingAccountId ? keyOfAccount(ledger.myLivingAccountId) : null;
  const people = useOwnerFilter(livingAccounts.map((a) => ownerKeyOf(a)), data, keyOfAccount(accountId), meKey);
  const shownRows = rows.filter((f) => people.matches(keyOfAccount(f.accountId)));
  const newAccountId =
    people.selected !== null ? (livingAccounts.find((a) => ownerKeyOf(a) === people.selected)?.id ?? accountId) : accountId;
  const editing = draft?.id ? data.fixedExpenses.find((f) => f.id === draft.id) : undefined;

  const nameOf = (f: FixedExpense) => (f.categoryId ? (catById.get(f.categoryId)?.name ?? f.name) : f.name || '생활비');
  const iconOf = (f: FixedExpense) => {
    const icon = f.categoryId ? catById.get(f.categoryId)?.icon : 'wallet';
    return icon && isIconName(icon) ? icon : 'dots';
  };

  function openNew() {
    setErrors({});
    const used = new Set(rows.filter((f) => f.accountId === newAccountId || !multiAccount).filter((f) => isMonthActive(month, f.startMonth, f.endMonth)).map((f) => f.categoryId));
    const first = categories.find((c) => !used.has(c.id));
    setDraft({ id: null, categoryId: first?.id ?? '', amount: null, spread: first ? defaultSpreadFor(first.name) : 'daily', accountId: newAccountId });
  }

  function openEdit(f: FixedExpense) {
    setErrors({});
    setDraft({ id: f.id, categoryId: f.categoryId ?? '', amount: f.amount, spread: f.spread, accountId: f.accountId });
  }

  /** 같은 달에 겹치는 같은 카테고리 예산 행 (자기 자신 빼고, 사람별 생활비 통장이면 같은 통장 안에서만) */
  function duplicateOf(categoryId: string, selfId: string | null, inAccount: string): FixedExpense | undefined {
    return rows.find(
      (f) =>
        f.id !== selfId &&
        (f.categoryId ?? '') === categoryId &&
        (!multiAccount || f.accountId === inAccount) &&
        (f.endMonth === null || f.endMonth >= month),
    );
  }

  async function save() {
    if (!draft) return;
    const next: Errors = {};
    if (!draft.id && !draft.categoryId) next.category = '항목을 골라 주세요';
    else if (draft.categoryId && duplicateOf(draft.categoryId, draft.id, draft.accountId)) next.category = '이미 예산이 있는 항목이에요';
    if (draft.amount === null || draft.amount <= 0) next.amount = '금액을 입력해 주세요';
    if (!draft.accountId) next.account = '생활비를 쓸 통장이 없어요';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusFirstInvalid();
      return;
    }
    const cat: Category | undefined = draft.categoryId ? catById.get(draft.categoryId) : undefined;
    const ok = await run(
      'save',
      async () => {
        if (!draft.id) {
          await ledger.addFixed({
            name: cat?.name ?? '생활비',
            amount: draft.amount!,
            accountId: draft.accountId,
            categoryId: draft.categoryId || null,
            dayOfMonth: null,
            kind: 'living',
            targetEmail: null,
            spread: draft.spread,
            startMonth: month,
            endMonth: null,
          });
          return;
        }
        const prev = data.fixedExpenses.find((f) => f.id === draft.id);
        if (!prev) throw new Error('생활비 예산을 찾을 수 없어요');
        await ledger.saveFixed({
          ...prev,
          name: cat?.name ?? prev.name,
          categoryId: draft.categoryId || null,
          amount: draft.amount!,
          spread: draft.spread,
          accountId: draft.accountId,
        });
      },
      draft.id ? '생활비 예산을 저장했어요' : '생활비 항목을 추가했어요',
    );
    if (ok) setDraft(null);
  }

  async function applyConfirm() {
    if (!confirm) return;
    const { action, row } = confirm;
    const ok =
      action === 'end'
        ? await run('end', () => ledger.saveFixed({ ...row, endMonth: month }), '다음 달부터 이 항목을 뺄게요')
        : await run('delete', () => ledger.saveFixed({ ...row, deleted: true }), '생활비 항목을 지웠어요');
    if (ok) setConfirm(null);
  }

  function openSplit() {
    const used = new Set(rows.map((f) => f.categoryId));
    setSplit(defaultLivingDrafts(categories).filter((d) => !used.has(d.categoryId)));
  }

  /** 항목으로 나누기: 항목 행을 이번 달부터 만들고, 예전 '생활비' 줄은 지난달까지로 끝내요 (지난 달 계산은 그대로) */
  async function applySplit() {
    if (!split) return;
    const items = split.filter((d) => d.amount !== null && d.amount > 0);
    if (items.length === 0) return;
    const ok = await run(
      'split',
      async () => {
        for (const d of items) {
          await ledger.addFixed({
            name: d.name,
            amount: d.amount!,
            accountId,
            categoryId: d.categoryId,
            dayOfMonth: null,
            kind: 'living',
            targetEmail: null,
            spread: d.spread,
            startMonth: month,
            endMonth: null,
          });
        }
        for (const row of legacyRows) await ledger.saveFixed({ ...row, endMonth: addMonths(month, -1) });
      },
      '생활비를 항목으로 나눴어요',
    );
    if (ok) setSplit(null);
  }

  const categoryOptions = [
    ...(editing && editing.categoryId === null ? [{ value: '', label: '카테고리 없음 (예전 생활비 한 줄)' }] : []),
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ];
  const splitTotal = split ? livingTotal(split) : 0;
  const legacyTotal = legacyRows.reduce((s, f) => s + f.amount, 0);
  const splitUsed = new Set(split?.map((d) => d.categoryId) ?? []);
  const splitAddable = categories.filter((c) => !splitUsed.has(c.id) && !rows.some((f) => f.categoryId === c.id));

  return (
    <Card
      id="st-living"
      title="생활비 예산"
      aside={thisMonthTotal > 0 ? <span className="muted">한 달 {formatWon(thisMonthTotal)}</span> : undefined}
    >
      <p className="st-desc">
        {multiAccount ? '사람마다 생활비 통장을 고르고 ' : ''}항목마다 한 달 예산을 정해요. 하루에 나눠 쓰는 항목은 오늘 써도 되는 돈을, 한 달 한도만 보는 항목은 이번 달 남은 돈을 알려 드려요.
        예산이 없는 카테고리 지출은 &lsquo;기타(예산 없음)&rsquo;으로 모여요.
      </p>

      {legacy ? (
        <Banner tone="info" title="생활비를 항목별로 나눠 보세요" action={{ label: '항목으로 나누기', onClick: openSplit }}>
          지금은 생활비 {formatWon(legacyTotal)} 한 줄이에요. 식비·카페처럼 나누면 항목마다 따로 알려 드려요.
        </Banner>
      ) : null}

      <OwnerTabs filter={people} label="누구 생활비" />

      {shownRows.length === 0 ? (
        <EmptyState
          icon="wallet"
          headingLevel={3}
          title="생활비 예산이 없어요"
          description="식비·카페·교통처럼 항목마다 한 달 예산을 정하면 오늘 써도 되는 돈과 ‘사도 돼?’를 알려 드려요."
        />
      ) : (
        <ul className="list">
          {shownRows.map((f) => {
            const label = periodLabel(f.startMonth, f.endMonth, month);
            return (
              <li key={f.id}>
                <ListRow
                  icon={iconOf(f)}
                  title={nameOf(f)}
                  subtitle={
                    <span className="st-sub">
                      {multiAccount && (!people.show || people.selected === null) ? <span>{accountLabel(f.accountId)}</span> : null}
                      <span>{SPREAD_TEXT[f.spread]}</span>
                      {f.categoryId === null ? (
                        <Badge size="sm" tone="warning">
                          예전 방식
                        </Badge>
                      ) : null}
                      {label ? (
                        <Badge size="sm" tone="info">
                          {label}
                        </Badge>
                      ) : null}
                    </span>
                  }
                  trailing={<Money amount={f.amount} />}
                  onClick={() => openEdit(f)}
                />
              </li>
            );
          })}
        </ul>
      )}

      <div className="st-foot">
        <Button variant="outline" icon="plus" onClick={openNew} disabled={!accountId || categories.length === 0}>
          생활비 항목 추가
        </Button>
      </div>

      <Dialog
        open={draft !== null}
        onClose={() => (busy ? undefined : setDraft(null))}
        title={draft?.id ? '생활비 예산 고치기' : '생활비 항목 추가'}
        actions={
          <>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={busy !== null}>
              취소
            </Button>
            <Button type="submit" form="st-living-form" loading={busy === 'save'}>
              저장
            </Button>
          </>
        }
      >
        {draft ? (
          <form
            id="st-living-form"
            className="stack"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field label="항목" error={errors.category} required hint="지출을 기록할 때 고르는 카테고리예요.">
              <Select
                value={draft.categoryId}
                onChange={(v) => {
                  const c = catById.get(v);
                  setDraft({ ...draft, categoryId: v, spread: draft.id || !c ? draft.spread : defaultSpreadFor(c.name) });
                }}
                options={categoryOptions}
                placeholder="항목 고르기"
              />
            </Field>
            {multiAccount ? (
              <Field label="누구 생활비인가요?" error={errors.account} required hint="그 사람의 생활비 통장에서 쓴 돈으로 계산해요.">
                <Select
                  value={draft.accountId}
                  onChange={(v) => setDraft({ ...draft, accountId: v })}
                  options={accountOptionsOf(livingAccounts)}
                />
              </Field>
            ) : null}
            <Field label="한 달 예산" error={errors.amount} required>
              <MoneyInput value={draft.amount} onChange={(v) => setDraft({ ...draft, amount: v })} data-autofocus="" />
            </Field>
            <div className="stack gap-2">
              <span className="st-label" id="st-living-spread">
                쓰는 방식
              </span>
              <SegmentedControl<LivingSpread>
                ariaLabel="쓰는 방식"
                block
                value={draft.spread}
                onChange={(spread) => setDraft({ ...draft, spread })}
                options={SPREAD_OPTIONS}
              />
              <p className="st-desc">
                {draft.spread === 'daily'
                  ? '남은 돈을 남은 날로 나눠 오늘 써도 되는 돈을 알려 드려요. 식비·카페처럼 매일 쓰는 항목에 맞아요.'
                  : '이번 달 남은 돈만 봐요. 쇼핑·의료처럼 가끔 쓰는 항목에 맞아요.'}
              </p>
            </div>
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

      <Dialog
        open={split !== null}
        wide
        onClose={() => (busy ? undefined : setSplit(null))}
        title="생활비를 항목으로 나눠요"
        description={`항목마다 한 달 예산을 넣어 주세요. 나누면 이번 달부터 '생활비' ${formatWon(legacyTotal)} 줄 대신 항목 예산을 써요. 지난달 계산은 그대로예요.`}
        actions={
          <>
            <Button variant="outline" onClick={() => setSplit(null)} disabled={busy !== null}>
              취소
            </Button>
            <Button onClick={() => void applySplit()} loading={busy === 'split'} disabled={splitTotal <= 0}>
              나누기
            </Button>
          </>
        }
      >
        {split ? (
          <div className="stack">
            <ul className="st-living-split">
              {split.map((d) => (
                <li key={d.key} role="group" aria-label={d.name}>
                  <span className="name">
                    <Icon name={isIconName(d.icon) ? d.icon : 'dots'} size={20} />
                    {d.name}
                  </span>
                  <Field label="한 달 예산">
                    <MoneyInput
                      value={d.amount}
                      onChange={(v) => setSplit((list) => list && list.map((x) => (x.key === d.key ? { ...x, amount: v } : x)))}
                    />
                  </Field>
                  <SegmentedControl<LivingSpread>
                    ariaLabel={`${d.name} 쓰는 방식`}
                    block
                    value={d.spread}
                    onChange={(spread) => setSplit((list) => list && list.map((x) => (x.key === d.key ? { ...x, spread } : x)))}
                    options={SPREAD_OPTIONS}
                  />
                </li>
              ))}
            </ul>
            {splitAddable.length > 0 ? (
              <ChipGroup label="항목 추가">
                {splitAddable.map((c) => (
                  <Chip key={c.id} icon="plus" onClick={() => setSplit((list) => list && [...list, livingDraftFor(c)])}>
                    {c.name}
                  </Chip>
                ))}
              </ChipGroup>
            ) : null}
            <div className="st-summary" aria-live="polite">
              <div className="line">
                <span>항목 합계</span>
                <strong>{formatWon(splitTotal)}</strong>
              </div>
              <div className="line">
                <span>지금 생활비</span>
                <strong>{formatWon(legacyTotal)}</strong>
              </div>
            </div>
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={confirm !== null}
        tone="danger"
        title={confirm?.action === 'end' ? '이번 달까지만 쓸까요?' : '이 생활비 항목을 지울까요?'}
        description={
          confirm?.action === 'end'
            ? '다음 달부터 이 항목 예산이 빠져요. 이번 달 계산은 그대로예요.'
            : '지난달 계산에서도 빠지고, 이 항목 지출은 기타(예산 없음)로 모여요. 그만 쓰는 거라면 이번 달까지만을 골라 주세요.'
        }
        confirmLabel={confirm?.action === 'end' ? '이번 달까지만' : '지우기'}
        loading={busy === 'end' || busy === 'delete'}
        onConfirm={() => void applyConfirm()}
        onCancel={() => setConfirm(null)}
      />
    </Card>
  );
}
