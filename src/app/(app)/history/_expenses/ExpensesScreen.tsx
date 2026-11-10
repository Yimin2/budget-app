'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { addMonths, claimTransferId, compareMonth, formatDateKo, formatWon, isAutoFixedRecord, isClaimExpense, monthOf } from '@/domain';
import type { Account, Category, Expense, Id, YearMonth } from '@/domain/types';
import {
  Avatar, Badge, Button, Card, Chip, ChipGroup, EmptyState, Icon, Money, PageHeader, Skeleton, cx, presenceClass, useChanged, usePresence,
} from '@/ui';
import { useLedger } from '@/state';
import { RequireLedger, isLedgerReady, type ReadyLedger } from '../../_components/RequireLedger';
import { CategoryIcon, ExpenseDialog, categoryIcon } from './ExpenseDialog';
import {
  activeFilterCount, applyFilter, authorOptions, EMPTY_FILTER, groupByDate, monthBounds, monthExpenses, monthLabel,
  parseMonthParam, SPLIT_KEYS, SPLIT_LABEL, splitTotals, type ExpenseFilter, type SplitKey,
} from './selectors';
import styles from './expenses.module.css';
import { ownerLabel } from '../../settings/helpers';

type DialogState = { mode: 'add' } | { mode: 'edit'; expense: Expense } | null;

/**
 * '/history' 내역의 지출 (기본 탭). 주소로 미리 정할 수 있어요:
 * ?month=2026-11 (볼 달) · ?account=<통장 id> (통장 필터) · ?new=1 (열자마자 지출 기록 창)
 */
export function ExpensesScreen({ switcher }: { switcher?: ReactNode } = {}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? '/history';
  const ready = isLedgerReady(useLedger());
  const initialMonth = parseMonthParam(params?.get('month'));
  const initialAccount = params?.get('account') || null;
  const openNew = params?.get('new') === '1';
  const [dialog, setDialog] = useState<DialogState>(openNew ? { mode: 'add' } : null);

  // ?new=1 은 한 번만 쓰고 주소에서 지워요 (새로고침해도 다시 열리지 않게)
  useEffect(() => {
    if (!openNew || !params) return;
    const next = new URLSearchParams(params.toString());
    next.delete('new');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [openNew, params, pathname, router]);

  return (
    <div className={styles.page}>
      <PageHeader
        title="내역"
        subtitle="지출을 날짜별로 모아 보고, 눌러서 고칠 수 있어요"
        actions={
          <Button icon="plus" disabled={!ready} onClick={() => setDialog({ mode: 'add' })}>
            지출 추가
          </Button>
        }
      />
      {switcher}
      <RequireLedger skeleton={<ExpensesSkeleton />}>
        {(ledger) => (
          <ExpensesView
            ledger={ledger}
            initialMonth={initialMonth}
            initialAccount={initialAccount}
            dialog={dialog}
            setDialog={setDialog}
          />
        )}
      </RequireLedger>
    </div>
  );
}

interface ViewProps {
  ledger: ReadyLedger;
  initialMonth: YearMonth | null;
  initialAccount: Id | null;
  dialog: DialogState;
  setDialog: (d: DialogState) => void;
}

function ExpensesView({ ledger, initialMonth, initialAccount, dialog, setDialog }: ViewProps) {
  const { data, today } = ledger;
  const thisMonth = monthOf(today);
  const [month, setMonth] = useState<YearMonth>(initialMonth ?? thisMonth);
  const [filter, setFilter] = useState<ExpenseFilter>(() => ({
    ...EMPTY_FILTER,
    accountId: initialAccount && data.accounts.some((a) => a.id === initialAccount) ? initialAccount : null,
  }));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const panelId = `xf${useId().replace(/:/g, '')}`;

  const bounds = useMemo(() => monthBounds(data, today), [data, today]);
  const min = compareMonth(month, bounds.min) < 0 ? month : bounds.min;
  const max = compareMonth(month, bounds.max) > 0 ? month : bounds.max;
  const all = useMemo(() => monthExpenses(data, month), [data, month]);
  const list = useMemo(() => applyFilter(all, filter), [all, filter]);
  const totals = useMemo(() => splitTotals(data, list, month), [data, list, month]);
  const groups = useMemo(() => groupByDate(list), [list]);
  const visibleIds = useMemo(() => groups.flatMap((g) => g.items.map((e) => e.id)), [groups]);
  const filterCount = activeFilterCount(filter);

  const accountsById = useMemo(() => new Map(data.accounts.map((a) => [a.id, a] as const)), [data.accounts]);
  const categoriesById = useMemo(() => new Map(data.categories.map((c) => [c.id, c] as const)), [data.categories]);
  // 돌려준 청구 (이체 claim:<지출id>)
  const settledClaimIds = useMemo(
    () => new Set(data.transfers.filter((t) => !t.deleted && t.status === 'done').map((t) => t.id)),
    [data.transfers],
  );
  const memberIndex = useMemo(
    () => new Map(data.members.map((m, i) => [m.email.toLowerCase(), i] as const)),
    [data.members],
  );

  // 필터에 보일 선택지: 지금 쓰는 통장·카테고리 + 이달 지출에 쓰인 것 (지운 것 포함)
  const accountOptions = useMemo(() => {
    const used = new Set(all.map((e) => e.accountId));
    if (filter.accountId) used.add(filter.accountId);
    return data.accounts
      .filter((a) => (!a.deleted || used.has(a.id)))
      .sort((a, b) => a.order - b.order);
  }, [data.accounts, all, filter.accountId]);
  const categoryOptions = useMemo(() => {
    const used = new Set(all.map((e) => e.categoryId));
    return data.categories.filter((c) => !c.deleted || used.has(c.id)).sort((a, b) => a.order - b.order);
  }, [data.categories, all]);
  const hasUncategorized = all.some((e) => e.categoryId === null) || filter.categoryId === 'none';
  const authors = useMemo(() => authorOptions(data, all), [data, all]);
  const showAuthors = data.settings.kind === 'shared' || authors.length > 1;

  function onDone(expense: Expense, action: 'added' | 'updated' | 'deleted') {
    if (action === 'deleted') return;
    const m = monthOf(expense.date);
    if (m !== month) setMonth(m);
  }

  const splitKeys = SPLIT_KEYS.filter((k) => k !== 'other' || totals.other > 0);
  const label = monthLabel(month);

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.monthBar}>
          <Button
            variant="ghost"
            plain
            iconOnly
            icon="chevron-left"
            aria-label="이전 달"
            onClick={() => setMonth(addMonths(month, -1))}
            disabled={compareMonth(month, min) <= 0}
          />
          <h2 className={styles.monthTitle} aria-live="polite">
            {label}
          </h2>
          <Button
            variant="ghost"
            plain
            iconOnly
            icon="chevron-right"
            aria-label="다음 달"
            onClick={() => setMonth(addMonths(month, 1))}
            disabled={compareMonth(month, max) >= 0}
          />
          {month !== thisMonth ? (
            <Button variant="ghost" onClick={() => setMonth(thisMonth)}>
              이번 달
            </Button>
          ) : null}
        </div>
        <Button
          variant={filterCount > 0 ? 'secondary' : 'outline'}
          icon="sliders"
          iconRight="chevron-down"
          className={styles.filterToggle}
          aria-expanded={filtersOpen}
          aria-controls={filtersOpen ? panelId : undefined}
          onClick={() => setFiltersOpen((v) => !v)}
        >
          {filterCount > 0 ? `필터 ${filterCount}` : '필터'}
        </Button>
      </div>

      {filtersOpen ? (
        <Card as="section" padding="sm" id={panelId} className={styles.filters} aria-label="필터">
          <FilterGroup
            label="통장"
            value={filter.accountId}
            onChange={(v) => setFilter({ ...filter, accountId: v })}
            options={accountOptions.map((a) => ({ value: a.id, label: ownerLabel(a) ? `${a.name} · ${ownerLabel(a)}` : a.name }))}
          />
          <FilterGroup
            label="카테고리"
            value={filter.categoryId}
            onChange={(v) => setFilter({ ...filter, categoryId: v })}
            options={[
              ...categoryOptions.map((c) => ({ value: c.id, label: c.name, icon: categoryIcon(c) })),
              ...(hasUncategorized ? [{ value: 'none', label: '카테고리 없음' }] : []),
            ]}
          />
          {showAuthors ? (
            <FilterGroup
              label="작성자"
              value={filter.author}
              onChange={(v) => setFilter({ ...filter, author: v })}
              options={authors.map((a) => ({ value: a.email, label: ledger.displayName(a.email) || a.name }))}
            />
          ) : null}
          {filterCount > 0 ? (
            <div className={styles.filterFoot}>
              <Button variant="ghost" icon="x" onClick={() => setFilter(EMPTY_FILTER)}>
                필터 모두 지우기
              </Button>
            </div>
          ) : null}
        </Card>
      ) : filterCount > 0 ? (
        <ChipGroup label="적용한 필터">
          {filter.accountId ? (
            <Chip selected onRemove={() => setFilter({ ...filter, accountId: null })} removeLabel="통장 필터 지우기">
              {accountsById.get(filter.accountId)?.name ?? '지운 통장'}
            </Chip>
          ) : null}
          {filter.categoryId ? (
            <Chip selected onRemove={() => setFilter({ ...filter, categoryId: null })} removeLabel="카테고리 필터 지우기">
              {filter.categoryId === 'none' ? '카테고리 없음' : (categoriesById.get(filter.categoryId)?.name ?? '지운 카테고리')}
            </Chip>
          ) : null}
          {filter.author ? (
            <Chip selected onRemove={() => setFilter({ ...filter, author: null })} removeLabel="작성자 필터 지우기">
              {ledger.displayName(filter.author)}
            </Chip>
          ) : null}
        </ChipGroup>
      ) : null}

      <Card as="section" className={styles.totalCard} aria-label={`${label} 지출 합계`}>
        <div className={styles.totalMain}>
          <span className={styles.totalLabel}>{filterCount > 0 ? `${label} 지출 (필터 적용)` : `${label} 지출`}</span>
          <div className={styles.totalLine}>
            <Money amount={totals.total} className={styles.totalValue} />
            <span className={styles.count}>{totals.count}건</span>
          </div>
          <div
            className={styles.splitBar}
            role="img"
            aria-label={totals.total > 0 ? splitAria(totals, splitKeys) : '지출 없음'}
          >
            {splitKeys
              .filter((k) => totals[k] > 0)
              .map((k) => (
                <span key={k} className={styles[`s_${k}`]} style={{ width: `${(totals[k] / totals.total) * 100}%` }} />
              ))}
          </div>
        </div>
        <ul className={styles.legend}>
          {splitKeys.map((k) => (
            <li key={k}>
              <span className={cx(styles.swatch, styles[`s_${k}`])} aria-hidden />
              <span className={styles.legendName}>{SPLIT_LABEL[k]}</span>
              <span className={styles.legendPct}>
                {totals.total > 0 ? `${Math.round((totals[k] / totals.total) * 100)}%` : '0%'}
              </span>
              <Money amount={totals[k]} className={styles.legendAmt} />
            </li>
          ))}
        </ul>
      </Card>

      <Card padding="none" className={styles.listCard} aria-label={`${label} 지출 목록`} role="region">
        {groups.length === 0 ? (
          <div className={styles.empty}>
            {all.length === 0 ? (
              <EmptyState
                icon="receipt"
                headingLevel={3}
                title={`${label}에 기록한 지출이 없어요`}
                description="쓴 돈을 기록하면 날짜별로 모아 보여 드려요."
                action={
                  <Button icon="plus" onClick={() => setDialog({ mode: 'add' })}>
                    지출 추가
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon="search"
                headingLevel={3}
                title="조건에 맞는 지출이 없어요"
                description="필터를 바꾸거나 지워 보세요."
                action={
                  <Button variant="outline" onClick={() => setFilter(EMPTY_FILTER)}>
                    필터 지우기
                  </Button>
                }
              />
            )}
          </div>
        ) : (
          <>
            <div className={styles.colHead} aria-hidden>
              <span />
              <span>카테고리</span>
              <span>내용</span>
              <span>통장</span>
              <span>기록한 사람</span>
              <span>금액</span>
            </div>
            {groups.map((g) => {
              const headId = `${panelId}-${g.date}`;
              return (
                <section key={g.date} className={styles.day} aria-labelledby={headId}>
                  <div className={styles.dayHead}>
                    <h3 id={headId}>
                      {formatDateKo(g.date)}
                      {g.date === today ? (
                        <Badge size="sm" tone="brand" dot={false}>
                          오늘
                        </Badge>
                      ) : null}
                    </h3>
                    <span className={styles.dayTotal}>
                      <span className="sr-only">하루 합계 </span>
                      {formatWon(g.total)}
                    </span>
                  </div>
                  <PresenceRows className={styles.rows} items={g.items}>
                    {(e) => (
                        <ExpenseRow
                          expense={e}
                          category={e.categoryId ? categoriesById.get(e.categoryId) : undefined}
                          account={accountsById.get(e.accountId)}
                          authorName={ledger.displayName(e.author)}
                          authorAlt={(memberIndex.get(e.author.toLowerCase()) ?? 0) % 2 === 1}
                          claim={isClaimExpense(e) ? (settledClaimIds.has(claimTransferId(e.id)) ? 'settled' : 'pending') : null}
                          onOpen={() => setDialog({ mode: 'edit', expense: e })}
                        />
                    )}
                  </PresenceRows>
                </section>
              );
            })}
          </>
        )}
      </Card>

      {dialog ? (
        <ExpenseDialog
          expense={dialog.mode === 'edit' ? dialog.expense : null}
          initial={dialog.mode === 'add' && filter.accountId ? { accountId: filter.accountId } : undefined}
          onClose={() => setDialog(null)}
          onDone={onDone}
          returnFocus={dialog.mode === 'edit' ? () => neighborRow(visibleIds, dialog.expense.id) : undefined}
        />
      ) : null}
    </>
  );
}

function splitAria(totals: Record<SplitKey, number> & { total: number }, keys: SplitKey[]): string {
  return keys
    .filter((k) => totals[k] > 0)
    .map((k) => `${SPLIT_LABEL[k]} ${Math.round((totals[k] / totals.total) * 100)}%`)
    .join(', ');
}

interface FilterOption {
  value: string;
  label: string;
  icon?: ReturnType<typeof categoryIcon>;
}

function FilterGroup({
  label, value, options, onChange,
}: { label: string; value: string | null; options: FilterOption[]; onChange: (v: string | null) => void }) {
  const id = `fg${useId().replace(/:/g, '')}`;
  return (
    <div className={styles.filterGroup} role="group" aria-labelledby={id}>
      <span id={id} className={styles.filterLabel}>
        {label}
      </span>
      <ChipGroup>
        <Chip selected={value === null} onClick={() => onChange(null)}>
          전체
        </Chip>
        {options.map((o) => (
          <Chip key={o.value} icon={o.icon} selected={value === o.value} onClick={() => onChange(value === o.value ? null : o.value)}>
            {o.label}
          </Chip>
        ))}
      </ChipGroup>
    </div>
  );
}

interface RowProps {
  expense: Expense;
  category: Category | undefined;
  account: Account | undefined;
  authorName: string;
  authorAlt: boolean;
  /** 개인 돈으로 낸 지출: 아직 돌려주지 않음(pending) · 돌려줌(settled) */
  claim?: 'pending' | 'settled' | null;
  onOpen: () => void;
}

/** 하루 목록: 새 지출은 옆에서 들어오고, 지운 지출은 접히며 빠져요 */
function PresenceRows({ items, className, children }: { items: Expense[]; className?: string; children: (e: Expense) => ReactNode }) {
  const presence = usePresence(items, (e) => e.id);
  return (
    <ul className={className}>
      {presence.map(({ item, key, state }) => (
        <li key={key} className={presenceClass(state)} inert={state === 'leave' || undefined}>
          {children(item)}
        </li>
      ))}
    </ul>
  );
}

function ExpenseRow({ expense, category, account, authorName, authorAlt, claim, onOpen }: RowProps) {
  // 돌려받기 전 → 돌려받음으로 바뀌면 배지가 제자리에 놓이듯 나타나요
  const claimChanged = useChanged(claim);
  const memo = expense.memo.trim();
  const catName = category?.name ?? null;
  const accName = account ? account.name : '지운 통장';
  const title = memo || catName || '지출';
  const sub = [memo ? catName : null, accName].filter(Boolean).join(' · ');
  const badges: ReactNode = (
    <>
      {isAutoFixedRecord(expense) ? (
        <Badge size="sm" dot={false}>
          자동
        </Badge>
      ) : null}
      {expense.eventId ? (
        <Badge size="sm" tone="info" dot={false}>
          일정
        </Badge>
      ) : null}
      {claim ? (
        <Badge size="sm" tone={claim === 'pending' ? 'warning' : undefined} dot={false} className={claimChanged ? 'mo-settle' : undefined} key={claim}>
          {claim === 'pending' ? `${expense.paidBy?.trim() ?? ''} 돌려받기 전` : `${expense.paidBy?.trim() ?? ''} 돌려받음`}
        </Badge>
      ) : null}
    </>
  );
  return (
    <button type="button" className={styles.row} onClick={onOpen} data-expense-id={expense.id}>
      <CategoryIcon category={category} className={styles.rowIcon} />
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>{title}</span>
        <span className={styles.rowSub}>
          <span className={styles.ellipsis}>{sub}</span>
          {badges}
        </span>
      </span>
      <span className={styles.cCat}>
        <span className={styles.ellipsis}>{catName ?? (expense.fixedExpenseId ? '고정 지출' : '카테고리 없음')}</span>
      </span>
      <span className={styles.cMemo}>
        {memo ? <span className={styles.ellipsis}>{memo}</span> : <span className="muted" aria-hidden>-</span>}
        {badges}
      </span>
      <span className={styles.cAcc}>
        <span className={styles.ellipsis}>{accName}</span>
      </span>
      <span className={styles.cWho}>
        <Avatar name={authorName} size="sm" alt={authorAlt} />
        <span className={styles.whoName} aria-hidden>
          {authorName}
        </span>
      </span>
      <span className={styles.cAmt}>
        <Money amount={expense.amount} />
      </span>
      <Icon name="chevron-right" size={20} className={styles.chev} />
    </button>
  );
}

function ExpensesSkeleton() {
  return (
    <div className={styles.skel} role="status" aria-live="polite">
      <span className="sr-only">지출을 불러오는 중이에요</span>
      <Skeleton width={240} height={44} />
      <Skeleton height={168} radius="lg" />
      <div className={styles.skelRows}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} height={56} radius="md" />
        ))}
      </div>
    </div>
  );
}

/** 지운 행 대신 포커스할 행: 바로 아래 행, 없으면 바로 위 행 (목록이 비면 null → 본문) */
function neighborRow(ids: string[], removedId: string): HTMLElement | null {
  const i = ids.indexOf(removedId);
  const order = i < 0 ? [] : [...ids.slice(i + 1), ...ids.slice(0, i).reverse()];
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-expense-id]'));
  for (const id of order) {
    const el = rows.find((r) => r.dataset.expenseId === id);
    if (el) return el;
  }
  return null;
}
