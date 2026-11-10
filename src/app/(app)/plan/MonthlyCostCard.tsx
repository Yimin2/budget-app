'use client';

import { useId, useMemo, useState } from 'react';
import { eventMonthlyCosts, eventMonthTopItems, formatShortDate, formatWon, shortMan } from '@/domain';
import type { EventMonthCost, EventMonthItem, Expense, ISODate, LedgerData } from '@/domain';
import { Badge, Card, Icon, cx } from '@/ui';
import { ExpandButton } from '../_components/ExpandButton';
import { monthLabel } from './selectors';
import shared from './events.module.css';
import styles from './MonthlyCostCard.module.css';

/** 접혀 있을 때 보이는 달 수 (이번 달 + 다음 2개월) */
export const MONTHLY_COST_COLLAPSED = 3;

const PHASE_BADGE: Record<EventMonthCost['phase'], { text: string; tone: 'neutral' | 'brand' | 'info' }> = {
  past: { text: '썼어요', tone: 'neutral' },
  current: { text: '이번 달', tone: 'brand' },
  future: { text: '예정', tone: 'info' },
};

/**
 * '월별 이벤트 비용' (PLAN 4-2): 지난 12개월은 실제로 쓴 돈, 이번 달부터 12개월은 예정을 달마다 한 줄로.
 * 처음에는 이번 달과 다음 2개월만, [더 보기]로 같은 자리에서 지난 달 · 더 먼 달까지 펼쳐요.
 * 달을 누르면 그 자리에서 모든 줄과 금액이 펼쳐지고, 쓴 지출은 눌러서 고칠 수 있어요
 */
export function MonthlyCostCard({
  data,
  today,
  onEditExpense,
}: {
  data: LedgerData;
  today: ISODate;
  onEditExpense?: (expense: Expense) => void;
}) {
  const titleId = useId();
  const ids = useId().replace(/:/g, '');
  const months = useMemo(() => eventMonthlyCosts(data, today), [data, today]);
  const [all, setAll] = useState(false);
  const [openMonths, setOpenMonths] = useState<Set<string>>(() => new Set());
  const expenses = useMemo(() => new Map(data.expenses.map((e) => [e.id, e])), [data.expenses]);

  if (months.length === 0) return null;
  const currentIndex = Math.max(0, months.findIndex((m) => m.phase === 'current'));
  const shown = all ? months : months.slice(currentIndex, currentIndex + MONTHLY_COST_COLLAPSED);
  const pastCount = months.filter((m) => m.phase === 'past').length;
  const futureCount = months.length - currentIndex - 1;

  const toggleMonth = (month: string) =>
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });

  return (
    <Card as="section" className={styles.monthCost} aria-labelledby={titleId}>
      <div className={shared.insightHead}>
        <Icon name="calendar" size={20} />
        <div className={shared.txt}>
          <h2 id={titleId} className={shared.insightTitle}>
            월별 이벤트 비용
          </h2>
          <p className={shared.recurringSub}>
            {all
              ? `지난 ${pastCount}개월은 쓴 돈, 이번 달부터 ${futureCount}개월 뒤까지는 예정이에요`
              : '이번 달과 다음 2개월이에요. 지난 달 쓴 돈은 더 보기에서 볼 수 있어요'}
          </p>
        </div>
      </div>

      <ul id={`${ids}-list`} className={styles.monthCostList}>
        {shown.map((m) => (
          <MonthRow
            key={m.month}
            cost={m}
            today={today}
            open={openMonths.has(m.month)}
            onToggle={() => toggleMonth(m.month)}
            panelId={`${ids}-${m.month}`}
            expenses={expenses}
            onEditExpense={onEditExpense}
          />
        ))}
      </ul>

      <div className={styles.monthCostMore}>
        <ExpandButton
          open={all}
          onToggle={() => setAll((v) => !v)}
          controls={`${ids}-list`}
          openLabel="더 보기"
          label="월별 이벤트 비용"
        />
      </div>
      <p className={shared.foot}>
        청구는 돌려준 날이 아니라 쓴 날의 달에 넣었어요. 통장끼리 옮긴 돈 · 저수지에서 빌리거나 갚은 돈은 쓴 돈이 아니라 빼요. 평소 쓰는
        돈은 지난 기록으로 셈한 예상이에요
      </p>
    </Card>
  );
}

function MonthRow({
  cost,
  today,
  open,
  onToggle,
  panelId,
  expenses,
  onEditExpense,
}: {
  cost: EventMonthCost;
  today: ISODate;
  open: boolean;
  onToggle: () => void;
  panelId: string;
  expenses: Map<string, Expense>;
  onEditExpense?: (expense: Expense) => void;
}) {
  const label = monthLabel(cost.month, today);
  const badge = PHASE_BADGE[cost.phase];
  const top = eventMonthTopItems(cost);
  const topText = top.map((i) => `${i.shortLabel} ${shortMan(i.amount)}`).join(' · ');
  const emptyText = cost.phase === 'past' ? '쓴 돈이 없어요' : '예정된 돈이 없어요';
  const split = cost.phase === 'current' ? `쓴 돈 ${shortMan(cost.spent)} · 예정 ${shortMan(cost.planned)}` : null;

  return (
    <li className={cx(styles.monthCostRow, styles[`monthCost_${cost.phase}`])} data-testid={`month-cost-${cost.month}`}>
      <button type="button" className={styles.monthCostHead} aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        <span className={styles.monthCostTop}>
          <span className={styles.monthCostLabel}>
            <strong>{label}</strong> <strong className={styles.monthCostTotal}>{shortMan(cost.total)}</strong>
          </span>
          <Badge tone={badge.tone} size="sm" variant={cost.phase === 'past' ? 'outline' : 'soft'}>
            {badge.text}
          </Badge>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} className={styles.monthCostChevron} />
        </span>
        <span className={styles.monthCostItems} data-testid="month-cost-items">
          {cost.total > 0 ? topText : emptyText}
        </span>
        {split && cost.total > 0 ? <span className={styles.monthCostSplit}>{split}</span> : null}
      </button>
      {open ? (
        <div id={panelId} className={styles.monthCostPanel}>
          {cost.items.length === 0 ? (
            <p className={shared.recurringSub}>{emptyText}</p>
          ) : (
            <ul className={styles.monthCostDetail} aria-label={`${label} 항목`}>
              {cost.items.map((item) => (
                <ItemRow key={item.key} item={item} phase={cost.phase} expenses={expenses} onEditExpense={onEditExpense} />
              ))}
            </ul>
          )}
          <p className={styles.monthCostSum}>
            합계 <strong>{formatWon(cost.total)}</strong>
          </p>
        </div>
      ) : null}
    </li>
  );
}

function ItemRow({
  item,
  phase,
  expenses,
  onEditExpense,
}: {
  item: EventMonthItem;
  phase: EventMonthCost['phase'];
  expenses: Map<string, Expense>;
  onEditExpense?: (expense: Expense) => void;
}) {
  const parts =
    phase === 'current' && item.spent > 0 && item.planned > 0
      ? `쓴 돈 ${formatWon(item.spent)} · 예정 ${formatWon(item.planned)}`
      : phase === 'current'
        ? item.spent > 0
          ? '썼어요'
          : '예정'
        : null;
  const rows = onEditExpense ? item.expenseIds.map((id) => expenses.get(id)).filter((e): e is Expense => Boolean(e)) : [];
  return (
    <li className={styles.monthCostItem}>
      <div className={styles.monthCostItemHead}>
        <span className={styles.monthCostItemName}>
          {item.label}
          {parts ? <span className={styles.monthCostItemMeta}>{parts}</span> : null}
        </span>
        <span className={styles.monthCostItemAmount}>{formatWon(item.amount)}</span>
      </div>
      {rows.length > 0 ? (
        <div className={styles.monthCostExpenses}>
          {rows.map((e) => {
            const name = e.memo.trim() || item.label;
            return (
              <button
                key={e.id}
                type="button"
                className={styles.monthCostExpense}
                onClick={() => onEditExpense?.(e)}
                aria-label={`${formatShortDate(e.date)} ‘${name}’ ${formatWon(e.amount)} 지출 고치기`}
              >
                <span>
                  {formatShortDate(e.date)} {name}
                </span>
                <span>{shortMan(e.amount)}</span>
                <Icon name="edit" size={16} />
              </button>
            );
          })}
        </div>
      ) : null}
    </li>
  );
}
