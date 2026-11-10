'use client';

import { useState } from 'react';
import {
  activeLivingRows, addMonths, defaultSpreadFor, isLivingOverride, livingOverridesOf, splitLivingRow, formatDateKo, formatWon, hasLegacyLivingRow, HOLIDAY_YEARS, holidayTableEndingSoon, isMonthActive,
  isValidDate, monthOf, normalizeDays, previewLivingItem, scheduleLabel, scheduleMode, scheduleOf, schedulePreviewText, WEEK_ORDER,
  WEEKDAY_SHORT, WEEKDAYS, WEEKENDS, type ScheduleMode,
} from '@/domain';
import type { Category, FixedExpense, LivingSchedule, LivingSpread } from '@/domain/types';
import {
  Badge, Banner, Button, Card, Chip, ChipGroup, ConfirmDialog, DateInput, Dialog, EmptyState, Field, Icon, ListRow, Money, MoneyInput,
  SegmentedControl, Select, TextInput, focusFirstInvalid, isIconName,
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

const MODE_OPTIONS: { value: ScheduleMode; label: string }[] = [
  { value: 'all', label: '매일' },
  { value: 'weekdays', label: '평일' },
  { value: 'weekends', label: '주말' },
  { value: 'custom', label: '요일 직접' },
  { value: 'weekly', label: '주 N회' },
];

interface Draft {
  id: string | null;
  categoryId: string; // '' = 카테고리 없음 (예전 생활비 한 줄)
  amount: number | null;
  spread: LivingSpread;
  /** 이 항목을 쓰는 생활비 통장 (사람별 생활비 통장이면 그 사람) */
  accountId: string;
  /** 쓰는 날 (하루에 나눠 쓰기만) */
  mode: ScheduleMode;
  /** 요일 직접: 고른 요일 (0=일 … 6=토) */
  days: number[];
  skipHolidays: boolean;
  /** 주 N회의 N (입력 중이면 null) */
  perWeek: number | null;
}

type Errors = Partial<Record<'category' | 'amount' | 'account' | 'days' | 'perWeek', string>>;

/** 고르는 중인 쓰는 날 → 저장할 쓰는 날 */
function scheduleOfDraft(d: Draft): LivingSchedule {
  switch (d.mode) {
    case 'weekly':
      return { days: null, skipHolidays: false, perWeek: d.perWeek };
    case 'weekdays':
      return { days: WEEKDAYS, skipHolidays: d.skipHolidays, perWeek: null };
    case 'weekends':
      return { days: WEEKENDS, skipHolidays: d.skipHolidays, perWeek: null };
    case 'custom':
      return { days: normalizeDays(d.days), skipHolidays: d.skipHolidays, perWeek: null };
    default:
      return { days: null, skipHolidays: d.skipHolidays, perWeek: null };
  }
}

/** 고정지출 행에 넣을 쓰는 날 칸. 한 달 한도만 · 매일이면 비워요 (예전 행과 같게) */
function scheduleFields(d: Draft): Pick<FixedExpense, 'useDays' | 'skipHolidays' | 'perWeek'> {
  if (d.spread !== 'daily') return { useDays: undefined, skipHolidays: undefined, perWeek: undefined };
  const s = scheduleOfDraft(d);
  return { useDays: s.days ?? undefined, skipHolidays: s.skipHolidays || undefined, perWeek: s.perWeek ?? undefined };
}

/** 고정지출 행 → 쓰는 날 고르기 값 */
function draftScheduleOf(f: FixedExpense | null): Pick<Draft, 'mode' | 'days' | 'skipHolidays' | 'perWeek'> {
  const s = f ? scheduleOf(f) : null;
  if (!s) return { mode: 'all', days: [...WEEKDAYS], skipHolidays: false, perWeek: 2 };
  return { mode: scheduleMode(s), days: s.days ?? [...WEEKDAYS], skipHolidays: s.skipHolidays, perWeek: s.perWeek ?? 2 };
}

/** '2026-12' → '12월' (올해가 아니면 '2027년 1월') */
function monthText(m: string, base: string): string {
  const now = Number(base.slice(0, 4));
  const y = Number(m.slice(0, 4));
  const mm = Number(m.slice(5, 7));
  return y === now ? `${mm}월` : `${y}년 ${mm}월`;
}

/** 고치는 중인 값으로 만든 저장할 행 */
function nextOf(prev: FixedExpense, d: Draft, cat: Category | undefined): FixedExpense {
  return {
    ...prev,
    name: cat?.name ?? prev.name,
    categoryId: d.categoryId || null,
    amount: d.amount!,
    spread: d.spread,
    ...scheduleFields(d),
    accountId: d.accountId,
  };
}

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
  const [newOff, setNewOff] = useState('');
  const [offError, setOffError] = useState<string | undefined>(undefined);
  // '이 달만 다른 금액' 넣는 칸 (고치는 항목 창 안)
  const [ovMonth, setOvMonth] = useState('');
  const [ovAmount, setOvAmount] = useState<number | null>(null);
  const [ovError, setOvError] = useState<string | undefined>(undefined);

  const month = monthOf(ledger.today);
  const data = ledger.data;
  const accountOrder = new Map(ledger.activeAccounts.map((a, i) => [a.id, i]));
  const catById = new Map(data.categories.map((c) => [c.id, c]));
  // 통장 순서 → 카테고리 순서(설정에서 정한 순서). 카테고리 없는 예전 한 줄 · 지운 카테고리는 뒤에
  const catPos = new Map(ledger.activeCategories.map((c, i) => [c.id, i]));
  const catRank = (f: FixedExpense) => (f.categoryId ? (catPos.get(f.categoryId) ?? Number.MAX_SAFE_INTEGER - 1) : Number.MAX_SAFE_INTEGER);
  const rows = visibleFixed(data.fixedExpenses, month)
    .filter((f) => f.kind === 'living' && !isLivingOverride(f))
    .sort((a, b) => (accountOrder.get(a.accountId) ?? 999) - (accountOrder.get(b.accountId) ?? 999) || catRank(a) - catRank(b));
  const categories = ledger.activeCategories.filter((c) => c.defaultAccountRole !== 'event');
  const legacy = hasLegacyLivingRow(data, month);
  const legacyRows = rows.filter((f) => f.categoryId === null && isMonthActive(month, f.startMonth, f.endMonth));
  // 이번 달 실제로 쓰는 금액 ('이 달만 다른 금액'이 있으면 그 금액)
  const thisMonthTotal = activeLivingRows(data, month).reduce((s, f) => s + f.amount, 0);
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
    setDraft({
      id: null, categoryId: first?.id ?? '', amount: null, spread: first ? defaultSpreadFor(first.name) : 'daily', accountId: newAccountId,
      ...draftScheduleOf(null),
    });
  }

  function openEdit(f: FixedExpense) {
    setErrors({});
    setOvMonth('');
    setOvAmount(null);
    setOvError(undefined);
    setDraft({ id: f.id, categoryId: f.categoryId ?? '', amount: f.amount, spread: f.spread, accountId: f.accountId, ...draftScheduleOf(f) });
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
    if (draft.spread === 'daily' && draft.mode === 'custom' && draft.days.length === 0) next.days = '요일을 하나 이상 골라 주세요';
    if (draft.spread === 'daily' && draft.mode === 'weekly' && !(draft.perWeek !== null && draft.perWeek >= 1 && draft.perWeek <= 7)) {
      next.perWeek = '1~7회로 넣어 주세요';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusFirstInvalid();
      return;
    }
    const cat: Category | undefined = draft.categoryId ? catById.get(draft.categoryId) : undefined;
    const splitsNow = !!editing && splitLivingRow(editing, nextOf(editing, draft, cat), month).length > 1;
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
            ...scheduleFields(draft),
            startMonth: month,
            endMonth: null,
          });
          return;
        }
        const prev = data.fixedExpenses.find((f) => f.id === draft.id);
        if (!prev) throw new Error('생활비 예산을 찾을 수 없어요');
        await ledger.saveLivingItem(prev.id, nextOf(prev, draft, cat));
      },
      draft.id ? (splitsNow ? '이번 달부터 바꿨어요. 지난달은 그대로예요' : '생활비 예산을 저장했어요') : '생활비 항목을 추가했어요',
    );
    if (ok) setDraft(null);
  }

  async function applyConfirm() {
    if (!confirm) return;
    const { action, row } = confirm;
    const ok =
      action === 'end'
        ? await run('end', () => ledger.saveLivingItem(row.id, { ...row, endMonth: month }), '다음 달부터 이 항목을 뺄게요')
        : await run('delete', () => ledger.saveLivingItem(row.id, { ...row, deleted: true }), '생활비 항목을 지웠어요');
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

  // 이 항목의 '이 달만 다른 금액' (이번 달 이후)
  const overrides = editing ? livingOverridesOf(data.fixedExpenses, editing, month) : [];
  const editingEnd = editing?.endMonth || null;
  const overrideMonths = Array.from({ length: 12 }, (_, i) => addMonths(month, i)).filter(
    (m) => (!editingEnd || m <= editingEnd) && !overrides.some((o) => o.startMonth === m),
  );
  const startsBefore = !!editing && editing.startMonth < month;

  async function addOverride() {
    if (!editing) return;
    if (!ovMonth) {
      setOvError('달을 골라 주세요');
      return;
    }
    if (ovAmount === null || ovAmount < 0) {
      setOvError('금액을 입력해 주세요');
      return;
    }
    setOvError(undefined);
    const ok = await run('override', () => ledger.setLivingOverride(editing.id, ovMonth, ovAmount), `${monthText(ovMonth, month)}만 ${formatWon(ovAmount)}으로 할게요`);
    if (ok) {
      setOvMonth('');
      setOvAmount(null);
    }
  }

  const categoryOptions = [
    ...(editing && editing.categoryId === null ? [{ value: '', label: '카테고리 없음 (예전 생활비 한 줄)' }] : []),
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ];
  const splitTotal = split ? livingTotal(split) : 0;
  const legacyTotal = legacyRows.reduce((s, f) => s + f.amount, 0);
  const splitUsed = new Set(split?.map((d) => d.categoryId) ?? []);
  const splitAddable = categories.filter((c) => !splitUsed.has(c.id) && !rows.some((f) => f.categoryId === c.id));

  // 쓰는 날 미리 보기: 고치는 중인 행으로 이번 달을 다시 계산해요
  const preview = (() => {
    if (!draft || draft.spread !== 'daily' || draft.amount === null || draft.amount <= 0 || !draft.accountId) return '';
    if (draft.mode === 'custom' && draft.days.length === 0) return '';
    if (draft.mode === 'weekly' && !(draft.perWeek !== null && draft.perWeek >= 1 && draft.perWeek <= 7)) return '';
    const row: FixedExpense = {
      ...(editing ?? { name: '', dayOfMonth: null, targetEmail: null, deleted: false }),
      id: draft.id ?? '__preview__',
      kind: 'living',
      categoryId: draft.categoryId || null,
      amount: draft.amount,
      accountId: draft.accountId,
      spread: 'daily',
      ...scheduleFields(draft),
      startMonth: month,
      endMonth: null,
    };
    const item = previewLivingItem(data, ledger.today, row);
    return item ? schedulePreviewText(item, ledger.today) : '';
  })();

  // 쉬는 날 (회사 휴무 등): '공휴일 빼기' 항목이 있거나 이미 넣은 날이 있을 때 보여요
  const daysOff = data.settings.daysOff ?? [];
  const upcomingOff = daysOff.filter((d) => d >= `${month}-01`);
  const usesHolidays = rows.some((f) => f.kind === 'living' && f.spread === 'daily' && scheduleOf(f).skipHolidays);
  const showDaysOff = usesHolidays || upcomingOff.length > 0;
  const tableEnding = usesHolidays && holidayTableEndingSoon(ledger.today);

  async function addDayOff() {
    if (!isValidDate(newOff)) {
      setOffError('날짜를 골라 주세요');
      return;
    }
    if (daysOff.includes(newOff)) {
      setOffError('이미 넣은 날이에요');
      return;
    }
    setOffError(undefined);
    const ok = await run('off', () => ledger.saveDaysOff([...daysOff, newOff]), '쉬는 날을 넣었어요');
    if (ok) setNewOff('');
  }

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
            const once = livingOverridesOf(data.fixedExpenses, f, month);
            return (
              <li key={f.id}>
                <ListRow
                  icon={iconOf(f)}
                  title={nameOf(f)}
                  subtitle={
                    <span className="st-sub">
                      {multiAccount && (!people.show || people.selected === null) ? <span>{accountLabel(f.accountId)}</span> : null}
                      <span>{SPREAD_TEXT[f.spread]}</span>
                      {f.spread === 'daily' && scheduleLabel(scheduleOf(f)) ? <span>{scheduleLabel(scheduleOf(f))}</span> : null}
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
                      {once[0] ? (
                        <span>
                          {monthText(once[0].startMonth, month)}만 {formatWon(once[0].amount)}
                          {once.length > 1 ? ` 외 ${once.length - 1}달` : ''}
                        </span>
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

      {showDaysOff ? (
        <section className="st-daysoff" aria-labelledby="st-daysoff-title">
          <h3 className="st-label" id="st-daysoff-title">
            쉬는 날
          </h3>
          <p className="st-desc">회사 휴무처럼 쉬는 날을 넣으면 &lsquo;공휴일 빼기&rsquo; 항목은 그날도 빼고 나눠요.</p>
          {tableEnding ? (
            <Banner tone="info" title={`공휴일은 ${HOLIDAY_YEARS.to}년까지 알고 있어요`}>
              그 뒤로는 주말만 빼요. 공휴일은 쉬는 날로 넣어 주세요.
            </Banner>
          ) : null}
          {upcomingOff.length > 0 ? (
            <ChipGroup label="넣은 쉬는 날">
              {upcomingOff.map((d) => (
                <Chip
                  key={d}
                  removeLabel={`${formatDateKo(d)} 빼기`}
                  onRemove={() =>
                    void run('off', () => ledger.saveDaysOff(daysOff.filter((x) => x !== d)), '쉬는 날을 뺐어요')
                  }
                >
                  {formatDateKo(d)}
                </Chip>
              ))}
            </ChipGroup>
          ) : null}
          <div className="st-daysoff-add">
            <Field label="쉬는 날 추가 (회사 휴무 등)" error={offError}>
              <DateInput value={newOff} onChange={(v) => setNewOff(v)} min={`${month}-01`} />
            </Field>
            <Button variant="outline" icon="plus" onClick={() => void addDayOff()} loading={busy === 'off'} disabled={!newOff}>
              추가
            </Button>
          </div>
        </section>
      ) : null}

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
            <Field
              label="한 달 예산"
              error={errors.amount}
              required
              hint={startsBefore ? `바꾸면 ${monthText(month, month)}부터 적용돼요. 지난달 계산은 그대로예요.` : undefined}
            >
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
            {draft.spread === 'daily' ? (
              <div className="stack gap-2">
                <span className="st-label" id="st-living-days">
                  쓰는 날
                </span>
                <SegmentedControl<ScheduleMode>
                  ariaLabel="쓰는 날"
                  block
                  value={draft.mode}
                  onChange={(mode) => setDraft({ ...draft, mode })}
                  options={MODE_OPTIONS}
                />
                {draft.mode === 'custom' ? (
                  <Field label="요일" hideLabel error={errors.days}>
                    <ChipGroup label="쓰는 요일">
                      {WEEK_ORDER.map((d) => {
                        const on = draft.days.includes(d);
                        return (
                          <Chip
                            key={d}
                            selected={on}
                            onClick={() =>
                              setDraft({ ...draft, days: on ? draft.days.filter((x) => x !== d) : [...draft.days, d].sort((a, b) => a - b) })
                            }
                          >
                            {WEEKDAY_SHORT[d]}
                          </Chip>
                        );
                      })}
                    </ChipGroup>
                  </Field>
                ) : null}
                {draft.mode === 'weekly' ? (
                  <Field label="한 주에 몇 번 쓰나요?" error={errors.perWeek} hint="월요일부터 일요일까지 쓴 날을 세요.">
                    <TextInput
                      inputMode="numeric"
                      value={draft.perWeek === null ? '' : String(draft.perWeek)}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, '').slice(0, 1);
                        setDraft({ ...draft, perWeek: v ? Number(v) : null });
                      }}
                    />
                  </Field>
                ) : (
                  <label className="st-check">
                    <input
                      type="checkbox"
                      checked={draft.skipHolidays}
                      onChange={(e) => setDraft({ ...draft, skipHolidays: e.target.checked })}
                    />
                    <span>공휴일 빼기 (넣어 둔 쉬는 날도 빼요)</span>
                  </label>
                )}
                {preview ? (
                  <p className="st-preview" aria-live="polite">
                    {preview}
                  </p>
                ) : null}
              </div>
            ) : null}
            {editing ? (
              <section className="st-once" aria-labelledby="st-once-title">
                <h3 className="st-label" id="st-once-title">
                  이 달만 다른 금액
                </h3>
                <p className="st-desc">한 달만 예산이 다르면 넣어 주세요. 그 달만 평소 금액 대신 써요.</p>
                {overrides.length > 0 ? (
                  <ul className="st-once-list" aria-label="이 달만 다른 금액 목록">
                    {overrides.map((o) => (
                      <li key={o.id}>
                        <span>
                          {o.startMonth} · <strong>{formatWon(o.amount)}</strong>
                        </span>
                        <Button
                          variant="ghost"
                          disabled={busy !== null}
                          aria-label={`${o.startMonth} 금액 지우기`}
                          onClick={() =>
                            void run('override', () => ledger.setLivingOverride(editing.id, o.startMonth, null), `${monthText(o.startMonth, month)} 금액을 지웠어요`)
                          }
                        >
                          지우기
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {overrideMonths.length > 0 ? (
                  <div className="st-once-add">
                    <Field label="달" error={ovError}>
                      <Select
                        value={ovMonth}
                        onChange={(v) => setOvMonth(v)}
                        options={overrideMonths.map((m) => ({ value: m, label: m }))}
                        placeholder="달 고르기"
                      />
                    </Field>
                    <Field label="그 달 금액">
                      <MoneyInput value={ovAmount} onChange={(v) => setOvAmount(v)} />
                    </Field>
                    <Button variant="outline" icon="plus" onClick={() => void addOverride()} loading={busy === 'override'} disabled={busy !== null}>
                      넣기
                    </Button>
                  </div>
                ) : null}
              </section>
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
