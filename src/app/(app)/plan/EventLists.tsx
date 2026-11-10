'use client';

import { useId, useState } from 'react';
import { formatShortDate, formatWon, lunarRepeatLabel, monthOf } from '@/domain';
import type { Category, Id, ISODate, PlannedEvent, Won } from '@/domain';
import { Badge, Button, Card, Icon, cx } from '@/ui';
import { dateLabel, monthLabel, REPEAT_LABEL, weekdayShort, type EventSections } from './selectors';
import styles from './events.module.css';

export interface EventListsProps {
  sections: EventSections;
  today: ISODate;
  categories: Category[];
  /** 일정 id → 그 일정으로 기록한 지출 합 */
  spent: Map<Id, Won>;
  displayName: (email: string) => string;
  /** 지금 '취소됐어요'를 처리 중인 일정 */
  busyId: Id | null;
  onAdd: () => void;
  onEdit: (event: PlannedEvent) => void;
  onComplete: (event: PlannedEvent) => void;
  onCancel: (event: PlannedEvent) => void;
}

const PAST_PAGE = 10;

/**
 * 일정 목록. 날짜가 지난 예정 일정(썼어요 / 취소됐어요) → 다가오는 일정(달별) → 지난 일정(접힘).
 * 1280px 이상은 왼쪽 다가오는 일정, 오른쪽 날짜 지난 일정 · 지난 일정.
 */
export function EventLists(props: EventListsProps) {
  const { sections } = props;
  const hasOverdue = sections.overdue.length > 0;
  const solo = !hasOverdue && sections.past.length === 0;
  return (
    <div className={cx(styles.lists, !hasOverdue && styles.noOverdue, solo && styles.solo)}>
      {hasOverdue ? <OverdueCard {...props} /> : null}
      <UpcomingCard {...props} />
      {sections.past.length > 0 ? <PastCard {...props} /> : null}
    </div>
  );
}

function OverdueCard({ sections, ...rest }: EventListsProps) {
  const titleId = useId();
  const list = sections.overdue;
  return (
    <Card
      as="section"
      padding="sm"
      className={cx(styles.listCard, styles.attention, styles.areaOverdue)}
      aria-labelledby={titleId}
    >
      <div className={styles.cardHead}>
        <div className={styles.txt}>
          <h2 id={titleId} className={styles.cardTitle}>
            <Icon name="alert-triangle" size={20} className={styles.warn} />
            날짜가 지난 일정 {list.length}건
          </h2>
          <span className={styles.cardSub}>썼는지 알려 주세요. 알려 줄 때까지 이번 달에 나갈 돈으로 계산해요</span>
        </div>
      </div>
      <ul className={styles.rows}>
        {list.map((e) => (
          <EventRow key={e.id} event={e} variant="overdue" {...rest} />
        ))}
      </ul>
    </Card>
  );
}

function UpcomingCard({ sections, today, onAdd, ...rest }: EventListsProps) {
  const titleId = useId();
  const groups = sections.upcoming;
  const count = groups.reduce((s, g) => s + g.events.length, 0);
  const total = groups.reduce((s, g) => s + g.total, 0);
  const thisMonth = monthOf(today);
  return (
    <Card as="section" padding="sm" className={cx(styles.listCard, styles.areaUpcoming)} aria-labelledby={titleId}>
      <div className={styles.cardHead}>
        <div className={styles.txt}>
          <h2 id={titleId} className={styles.cardTitle}>
            다가오는 일정
          </h2>
          <span className={styles.cardSub}>
            {count > 0 ? `${count}건 · ${formatWon(total)}` : '예정된 일정이 없어요'}
          </span>
        </div>
        <Button variant="ghost" icon="plus" onClick={onAdd}>
          추가
        </Button>
      </div>
      {groups.length === 0 ? (
        <p className={styles.emptyLine}>새 일정을 넣으면 여기에 달별로 보여요</p>
      ) : (
        <div className={styles.groupsFlow}>
          {groups.map((g) => {
            const headId = `${titleId}-${g.month}`;
            return (
              <div key={g.month} className={styles.group}>
                <div className={styles.groupHead}>
                  <h3 id={headId} className={styles.groupTitle}>
                    {monthLabel(g.month, today)}
                    {g.month === thisMonth ? ' · 이번 달' : ''}
                  </h3>
                  <span className={styles.groupTotal}>
                    {g.events.length}건 · {formatWon(g.total)}
                  </span>
                </div>
                <ul className={styles.rows} aria-labelledby={headId}>
                  {g.events.map((e) => (
                    <EventRow key={e.id} event={e} variant="upcoming" today={today} onAdd={onAdd} {...rest} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function PastCard({ sections, ...rest }: EventListsProps) {
  const ids = useId().replace(/:/g, '');
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(PAST_PAGE);
  const list = sections.past;
  const shown = list.slice(0, limit);
  const done = list.filter((e) => e.status === 'done').length;
  return (
    <Card as="section" padding="sm" className={cx(styles.listCard, styles.areaPast)} aria-labelledby={`${ids}-t`}>
      <h2 className={styles.pastHeading}>
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={open}
          aria-controls={`${ids}-list`}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={styles.txt}>
            <span id={`${ids}-t`} className={styles.cardTitle}>
              지난 일정 {list.length}건
            </span>
            <span className={styles.cardSub}>
              쓴 일정 {done}건 · 취소 {list.length - done}건
            </span>
          </span>
          <Icon name="chevron-down" size={20} />
        </button>
      </h2>
      {open ? (
        <div id={`${ids}-list`}>
          <ul className={styles.rows}>
            {shown.map((e) => (
              <EventRow key={e.id} event={e} variant="past" {...rest} />
            ))}
          </ul>
          {list.length > shown.length ? (
            <Button variant="ghost" block onClick={() => setLimit((n) => n + PAST_PAGE * 2)}>
              {list.length - shown.length}건 더 보기
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function EventRow({
  event,
  variant,
  today,
  categories,
  spent,
  displayName,
  busyId,
  onEdit,
  onComplete,
  onCancel,
}: Omit<EventListsProps, 'sections'> & { event: PlannedEvent; variant: 'overdue' | 'upcoming' | 'past' }) {
  const category = event.categoryId ? categories.find((c) => c.id === event.categoryId) : undefined;
  const author = event.author ? displayName(event.author) : '';
  const meta = [author, category?.name, event.memo.trim()].filter(Boolean).join(' · ');
  const done = event.status === 'done';
  const canceled = event.status === 'canceled';
  const actual = done ? (spent.get(event.id) ?? 0) : null;
  const shownAmount = actual ?? event.amount;
  const busy = busyId === event.id;

  return (
    <li className={cx(styles.item, variant === 'overdue' && styles.overdue, variant === 'past' && styles.past)}>
      <button type="button" className={styles.rowMain} onClick={() => onEdit(event)}>
        <span className={styles.date} aria-hidden>
          <span className={styles.md}>{formatShortDate(event.date)}</span>
          <span className={styles.wd}>{weekdayShort(event.date)}</span>
        </span>
        <span className={styles.main}>
          <span className={styles.nameLine}>
            <span className="sr-only">{dateLabel(event.date, today)}, </span>
            <span className={styles.name}>{event.name}</span>
            {event.date === today && event.status === 'planned' ? <span className={styles.todayTag}>오늘</span> : null}
            {event.repeat !== 'none' ? (
              <Badge size="sm" dot={false}>
                <Icon name="repeat" size={16} />
                {REPEAT_LABEL[event.repeat]}
                {event.repeat === 'yearly' && event.lunar ? ` ${lunarRepeatLabel(event.lunar, event.date, today)}` : ''}
              </Badge>
            ) : null}
            {done ? (
              <Badge size="sm" tone="success">
                썼어요
              </Badge>
            ) : null}
            {canceled ? <Badge size="sm">취소됐어요</Badge> : null}
          </span>
          {meta ? <span className={styles.meta}>{meta}</span> : null}
        </span>
        <span className={styles.amt}>
          <span>
            {canceled ? <span className="sr-only">예상 </span> : null}
            {formatWon(shownAmount)}
          </span>
          {done && actual !== event.amount ? <span className={styles.was}>예상 {formatWon(event.amount)}</span> : null}
        </span>
        <span className="sr-only">, 고치기</span>
      </button>
      {variant === 'overdue' ? (
        <>
          <p className={styles.overdueNote}>
            <Icon name="clock" size={16} />
            날짜가 지났어요. 이 일정에 돈을 썼나요?
          </p>
          <div className={styles.rowActions}>
            <Button icon="check" onClick={() => onComplete(event)} disabled={busy} aria-label={`${event.name} 썼어요`}>
              썼어요
            </Button>
            <Button
              variant="outline"
              icon="x"
              onClick={() => onCancel(event)}
              loading={busy}
              aria-label={`${event.name} 취소됐어요`}
            >
              취소됐어요
            </Button>
          </div>
        </>
      ) : null}
    </li>
  );
}
