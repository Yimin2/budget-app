'use client';

import { useId, useMemo, useState } from 'react';
import {
  eventRecords, formatMan, formatNumber, formatShortDate, formatWon, livingDayNote, livingItemExpenses, livingItemKey, recordPhase, scheduleLabel,
} from '@/domain';
import type { EventMonthBudget, Expense, LivingItem, LivingStatus } from '@/domain';
import { useLedger } from '@/state';
import { Badge, Button, Card, Icon, ListRow, Money, ProgressBar, cx, isIconName } from '@/ui';
import { ExpenseDialog } from '../history/_expenses/ExpenseDialog';
import { expenseTitle, livingHistoryHref } from './selectors';
import styles from './home.module.css';
import { DailyLine } from './TodayCard';
import { useCardTitle } from './useCardTitle';

function itemTone(i: LivingItem): 'primary' | 'warning' | 'danger' {
  if (i.remaining < 0) return 'danger';
  if (i.monthBudget > 0 && i.spent / i.monthBudget >= 0.8) return 'warning';
  return 'primary';
}

/**
 * 항목별 생활비: 항목을 누르면 창 없이 그 아래로 이번 달 그 항목 지출(새것부터)이 펼쳐져요. 여러 항목을 함께 펼칠 수 있고, 다시 누르면 접혀요.
 * 지출을 누르면 내역과 같은 고치기 창. 머리 링크는 이 사람 생활비 통장의 이번 달 내역 (예산 바꾸기는 예산 탭에서)
 * 맨 아래 '이벤트' 한 줄: 이번 달 이벤트통장에서 쓴 돈 / 이번 달 적립액 (두 사람이 함께 써요). 누르면 이벤트 화면
 */
export function LivingItemsCard({ living, owner = null, event = null }: { living: LivingStatus; owner?: string | null; event?: EventMonthBudget | null }) {
  const { today, data } = useLedger();
  const heading = useCardTitle(owner ? `항목별 생활비 · ${owner}` : '항목별 생활비');
  const uid = useId().replace(/:/g, '');
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [editing, setEditing] = useState<{ expense: Expense; toggleId: string } | null>(null);

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Card
      as="section"
      {...heading}
      aside={
        <Button
          href={livingHistoryHref(living.month, living.livingAccountId)}
          variant="ghost"
          iconRight="chevron-right"
          className={styles.asideLink}
        >
          내역 보기
        </Button>
      }
      className={cx(styles.cardGap, styles.oItems)}
    >
      <ul className={styles.items}>
        {living.items.map((i) => {
          const key = livingItemKey(i.categoryId);
          const isOpen = open.has(key);
          const toggleId = `li${uid}-${key || 'etc'}`;
          const panelId = `${toggleId}-panel`;
          return (
            <li key={key} className={styles.item}>
              <button
                type="button"
                id={toggleId}
                className={styles.itemToggle}
                aria-expanded={isOpen}
                aria-controls={isOpen ? panelId : undefined}
                onClick={() => toggle(key)}
              >
                <span className={styles.itemHead}>
                  <span className={styles.itemName}>
                    <Icon name={isIconName(i.icon) ? i.icon : 'dots'} size={20} />
                    <span className={styles.itemText}>{i.name}</span>
                    {i.spread === 'daily' || i.noDaysLeft ? (
                      <Badge size="sm" tone="brand" dot={false}>
                        {(i.schedule && scheduleLabel(i.schedule)) || '하루씩'}
                      </Badge>
                    ) : null}
                  </span>
                  <span className={styles.itemLeft}>
                    {i.remaining < 0 ? (
                      <span className={styles.bad}>{formatWon(-i.remaining)} 넘음</span>
                    ) : (
                      <>
                        <span className={styles.itemCap}>남은 돈</span> <Money amount={i.remaining} animate className={styles.amountCell} />
                      </>
                    )}
                    <Icon name="chevron-down" size={20} className={cx(styles.itemChevron, isOpen && styles.itemChevronOpen)} />
                  </span>
                </span>
                <ProgressBar
                  value={i.spent}
                  max={i.monthBudget}
                  label={`${i.name} 사용`}
                  valueText={`${formatWon(i.monthBudget)} 중 ${formatWon(i.spent)} 썼어요`}
                  tone={itemTone(i)}
                  track="subtle"
                  decorative
                />
                <span className={styles.itemMeta}>
                  <span>
                    {formatNumber(i.spent)} / {formatWon(i.monthBudget)}
                    {i.carryIn !== 0 ? ` · 이월 ${formatWon(i.carryIn)}` : ''}
                  </span>
                  {livingDayNote(i, today) && !(i.weekly?.usedToday) ? (
                    <span>{livingDayNote(i, today)}</span>
                  ) : i.todayAvailable !== null ? (
                    <DailyLine spent={i.spentToday} available={i.todayAvailable} />
                  ) : (
                    <span>{i.unbudgeted ? '예산 없음' : '한 달 한도'}</span>
                  )}
                </span>
              </button>
              {isOpen && data ? (
                <LivingItemPanel
                  id={panelId}
                  living={living}
                  item={i}
                  onEdit={(expense) => setEditing({ expense, toggleId })}
                />
              ) : null}
            </li>
          );
        })}
        {event ? (
          <EventItemRow
            event={event}
            uid={uid}
            open={open.has('event:')}
            onToggle={() => toggle('event:')}
            onEdit={(expense, toggleId) => setEditing({ expense, toggleId })}
          />
        ) : null}
      </ul>
      {editing ? (
        <ExpenseDialog
          expense={editing.expense}
          onClose={() => setEditing(null)}
          returnFocus={() => document.getElementById(editing.toggleId)}
        />
      ) : null}
    </Card>
  );
}

/**
 * 항목별 생활비의 '이벤트' 줄: 생활비 항목과 같은 모양. 누르면 그 아래로 이번 달 이벤트통장 지출(여행 포함, 새것부터)이 펼쳐지고,
 * 지출을 누르면 고치기 창. 여행 지출은 한도와 견주지 않고 '여행' 표시만
 */
function EventItemRow({ event, open, onToggle, onEdit, uid }: { event: EventMonthBudget; open: boolean; onToggle: () => void; onEdit: (e: Expense, toggleId: string) => void; uid: string }) {
  const { data, today } = useLedger();
  const remaining = event.limit - event.spent;
  const tone = remaining < 0 ? 'danger' : event.limit > 0 && event.spent / event.limit >= 0.8 ? 'warning' : 'primary';
  const toggleId = `li${uid}-event`;
  const panelId = `${toggleId}-panel`;
  const rows = useMemo(() => {
    if (!data) return [];
    const month = today.slice(0, 7);
    return eventRecords(data, event.accountId, { reservoirClaims: false, month })
      .filter((r) => recordPhase(r.record, today) === 'spent')
      .map((r) => r.expense)
      .sort((x, y) => (x.date !== y.date ? (x.date < y.date ? 1 : -1) : y.createdAt.localeCompare(x.createdAt)));
  }, [data, today, event.accountId]);
  const trips = useMemo(() => new Map((data?.trips ?? []).filter((t) => !t.deleted).map((t) => [t.id, t.name])), [data]);
  return (
    <li className={styles.item} data-testid="living-event">
      <button
        type="button"
        id={toggleId}
        className={styles.itemToggle}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={onToggle}
      >
        <span className={styles.itemHead}>
          <span className={styles.itemName}>
            <Icon name="calendar" size={20} />
            <span className={styles.itemText}>이벤트</span>
            <Badge size="sm" tone="neutral" dot={false}>
              함께
            </Badge>
          </span>
          <span className={styles.itemLeft}>
            {remaining < 0 ? (
              <span className={styles.bad}>{formatWon(-remaining)} 넘음</span>
            ) : (
              <>
                <span className={styles.itemCap}>남은 돈</span> <Money amount={remaining} className={styles.amountCell} />
              </>
            )}
            <Icon name="chevron-down" size={20} className={cx(styles.itemChevron, open && styles.itemChevronOpen)} />
          </span>
        </span>
        <ProgressBar
          value={event.spent}
          max={Math.max(event.limit, 1)}
          label="이벤트 사용"
          valueText={`${formatWon(event.limit)} 중 ${formatWon(event.spent)} 썼어요`}
          tone={tone}
          track="subtle"
          decorative
        />
        <span className={styles.itemMeta}>
          <span>
            {formatNumber(event.spent)} / {formatWon(event.limit)}
          </span>
          <span>{event.tripSpent > 0 ? `여행 ${formatMan(event.tripSpent)} 따로` : '이번 달 적립 한도'}</span>
        </span>
      </button>
      {open && data ? (
        <div id={panelId} className={styles.itemPanel} role="group" aria-label="이번 달 이벤트통장 지출">
          {rows.length === 0 ? (
            <p className={styles.emptyLine}>이번 달 이벤트통장 지출이 없어요.</p>
          ) : (
            <ul className={styles.itemExpenses}>
              {rows.map((e) => {
                const title = expenseTitle(e, data.categories);
                const trip = e.tripId ? trips.get(e.tripId) : undefined;
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      className={styles.itemExpense}
                      onClick={() => onEdit(e, toggleId)}
                      aria-label={`${formatShortDate(e.date)} ${title}${trip ? ` (여행 ${trip})` : ''} ${formatWon(e.amount)} 고치기`}
                    >
                      <span className={styles.itemExpenseDate}>{formatShortDate(e.date)}</span>
                      <span className={styles.itemExpenseTitle}>
                        {title}
                        {trip ? (
                          <>
                            {' '}
                            <Badge size="sm" tone="brand" dot={false}>
                              여행
                            </Badge>
                          </>
                        ) : null}
                      </span>
                      <Money amount={e.amount} className={styles.amountCell} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className={cx(styles.itemPanelNote, remaining < 0 && styles.bad)}>
            {remaining < 0 ? `이번 달 적립보다 ${formatWon(-remaining)} 더 썼어요` : `이번 달 적립에서 남은 돈 ${formatWon(remaining)}`}
            {event.tripSpent > 0 ? ` · 여행 ${formatWon(event.tripSpent)}은 따로` : ''}
          </p>
          <div className={styles.itemPanelFoot}>
            <Button href="/plan" variant="ghost" iconRight="chevron-right">
              이벤트 화면 보기
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** 펼친 생활비 항목: 이번 달 그 항목 지출(날짜 · 내용 · 금액) · 남은 돈 한 줄 · 그 항목 내역 전체 보기 */
function LivingItemPanel({
  id,
  living,
  item,
  onEdit,
}: {
  id: string;
  living: LivingStatus;
  item: LivingItem;
  onEdit: (expense: Expense) => void;
}) {
  const ledger = useLedger();
  const data = ledger.data!;
  const rows = useMemo(() => livingItemExpenses(data, living, item), [data, living, item]);
  // 기타 묶음은 예산 항목이 없는 카테고리도 들어가서, 모두 카테고리가 없을 때만 '카테고리 없음'으로 걸러요
  const category = item.categoryId ?? (rows.length > 0 && rows.every((e) => e.categoryId === null) ? 'none' : null);
  const accountId = item.accountId ?? living.livingAccountId;
  const left =
    item.remaining < 0 ? `이번 달 ${formatWon(-item.remaining)} 넘었어요` : `이번 달 남은 돈 ${formatWon(item.remaining)}`;
  const daily = item.dailyBudget !== null ? `하루 ${formatWon(item.dailyBudget)}` : null;

  return (
    <div id={id} className={styles.itemPanel} role="group" aria-label={`이번 달 ${item.name} 지출`}>
      {rows.length === 0 ? (
        <p className={styles.emptyLine}>이번 달 {item.name} 지출이 없어요.</p>
      ) : (
        <ul className={styles.itemExpenses}>
          {rows.map((e) => {
            const title = expenseTitle(e, data.categories);
            return (
              <li key={e.id}>
                <button
                  type="button"
                  className={styles.itemExpense}
                  onClick={() => onEdit(e)}
                  aria-label={`${formatShortDate(e.date)} ${title} ${formatWon(e.amount)} 고치기`}
                >
                  <span className={styles.itemExpenseDate}>{formatShortDate(e.date)}</span>
                  <span className={styles.itemExpenseTitle}>{title}</span>
                  <Money amount={e.amount} className={styles.amountCell} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className={cx(styles.itemPanelNote, item.remaining < 0 && styles.bad)}>
        {[left, daily, `${living.daysLeft}일 남음`].filter(Boolean).join(' · ')}
      </p>
      <div className={styles.itemPanelFoot}>
        <Button href={livingHistoryHref(living.month, accountId, category)} variant="ghost" iconRight="chevron-right">
          {item.name} 내역 전체 보기
        </Button>
      </div>
    </div>
  );
}

/* ───────── 이번 달 쓴 돈 (고정비 · 기타 · 용돈 · 이벤트통장) ───────── */

export function LivingSetupCard() {
  const titleId = useId();
  return (
    <Card as="section" variant="brand" className={cx(styles.setup, styles.oHero)} aria-labelledby={titleId}>
      <span className={styles.setupIcon}>
        <Icon name="wallet" size={24} />
      </span>
      <h2 id={titleId} className={styles.setupTitle}>
        생활비 예산을 정해 주세요
      </h2>
      <p className={styles.setupText}>식비·카페처럼 항목마다 예산을 정하면 오늘 써도 되는 돈을 매일 계산해 드려요.</p>
      <Button href="/budget#st-living" icon="settings">
        생활비 정하기
      </Button>
    </Card>
  );
}

/* ───────── 자주 쓰는 지출 (자동 추천) ───────── */
