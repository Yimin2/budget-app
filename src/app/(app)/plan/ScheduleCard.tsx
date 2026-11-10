'use client';

import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatMan, formatShortDate, formatWon, lunarRepeatLabel, monthOf, tripPeriodText } from '@/domain';
import type { Category, Id, ISODate, LedgerData, PlannedEvent, TripStatus, Won, YearMonth } from '@/domain';
import { RECURRING_HINT_KEY } from '@/state';
import { Badge, Button, Card, Icon, MenuButton, cx, type MenuItem } from '@/ui';
import { AnnualCard } from './AnnualCard';
import { EmptyEvents } from './EmptyEvents';
import type { EventPreset } from './EventDialog';
import { FoldHead, foldStyles, useMobileFold } from './FoldCard';
import { RecurringCard, recurringList } from './RecurringCard';
import { dateLabel, monthLabel, REPEAT_LABEL, weekdayShort, type EventSections } from './selectors';
import { remainingText, tripHref, tripPhaseText } from './trips/selectors';
import shared from './events.module.css';
import styles from './ScheduleCard.module.css';

export interface ScheduleCardProps {
  sections: EventSections;
  today: ISODate;
  categories: Category[];
  /** 일정 id → 그 일정으로 기록한 지출 합 */
  spent: Map<Id, Won>;
  displayName: (email: string) => string;
  /** 지금 '취소됐어요'를 처리 중인 일정 */
  busyId: Id | null;
  /** 여행 (이벤트통장이 없으면 빈 목록) */
  trips: TripStatus[];
  /** [+ 추가] 메뉴에 여행 추가 · 매년 일정 한 번에 등록 · 기록에서 찾기를 보일지 (이벤트통장이 있을 때) */
  planning: boolean;
  data: LedgerData;
  /** 일정이 하나도 없을 때 빈 상태의 예시 카테고리 */
  emptyCategories: Category[];
  onAdd: (preset?: EventPreset) => void;
  onAddTrip: () => void;
  onEdit: (event: PlannedEvent) => void;
  onComplete: (event: PlannedEvent) => void;
  onCancel: (event: PlannedEvent) => void;
}

type RowProps = Pick<ScheduleCardProps, 'today' | 'categories' | 'spent' | 'displayName' | 'busyId' | 'onEdit' | 'onComplete' | 'onCancel'>;

const PAST_PAGE = 10;

/** '매년 반복되는 일 N건을 찾았어요' 안내를 이 기기에서 닫았는지 (못 읽으면 안 닫은 것으로) */
function readHintDismissed(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(RECURRING_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function writeHintDismissed(): void {
  try {
    window.localStorage.setItem(RECURRING_HINT_KEY, '1');
  } catch {
    // 사생활 보호 모드 등: 이번 화면에서만 닫혀요
  }
}

type Panel = 'annual' | 'recurring' | null;

/** 다가오는 줄: 일정 또는 여행 (날짜순으로 섞어요) */
type Entry = { kind: 'event'; date: ISODate; event: PlannedEvent } | { kind: 'trip'; date: ISODate; trip: TripStatus };

interface EntryGroup {
  month: YearMonth;
  entries: Entry[];
  total: Won;
}

/** 여행 줄 금액 = 남은 예산 (넘었으면 0) */
const tripAmount = (t: TripStatus) => Math.max(0, t.remaining);

/**
 * 다가오는 일정(달별)에 다가오는 · 여행 중인 여행을 떠나는 날로 섞어요. 여행 중이라 떠난 날이 지났으면 이번 달에 넣어요.
 * 같은 날이면 일정 먼저
 */
export function scheduleGroups(sections: EventSections, trips: TripStatus[], today: ISODate): EntryGroup[] {
  const thisMonth = monthOf(today);
  const map = new Map<YearMonth, Entry[]>();
  for (const g of sections.upcoming) map.set(g.month, g.events.map((event) => ({ kind: 'event' as const, date: event.date, event })));
  for (const t of trips) {
    if (t.phase === 'past') continue;
    const date = t.trip.startDate < today ? today : t.trip.startDate;
    const month = date < today ? thisMonth : monthOf(date);
    const list = map.get(month) ?? [];
    list.push({ kind: 'trip', date, trip: t });
    map.set(month, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([month, entries]) => {
      const sorted = [...entries].sort((x, y) => (x.date !== y.date ? (x.date < y.date ? -1 : 1) : x.kind === y.kind ? 0 : x.kind === 'event' ? -1 : 1));
      const total = sorted.reduce((sum, e) => sum + (e.kind === 'event' ? e.event.amount : tripAmount(e.trip)), 0);
      return { month, entries: sorted, total };
    });
}

/**
 * 이벤트 화면 카드 4 '일정 · 10건 170만' (PLAN 4-3 · 4-11).
 * 제목 줄 버튼은 [+ 추가] 하나: 버튼에 붙는 작은 메뉴(창 아님)로 새 일정 · 여행 추가 · 매년 일정 한 번에 등록 · 기록에서 찾기 N건(0건이면 없음).
 * 매년 일정 · 기록에서 찾기는 카드 안에서 펼쳐요 ([닫기]로 접음). 기록에서 찾은 게 있으면 목록 위에 '… N건을 찾았어요 [보기]' 안내(이 기기에서 닫을 수 있음).
 * 날짜가 지난 예정 일정(썼어요 / 취소됐어요) → 다가오는 일정과 여행(달별, 날짜순. 여행은 '여행' 표시 · '45만 / 90만' · '남은 45만', 누르면 여행 화면)
 * → 지난 일정(접힘). 넓은 카드는 달 묶음을 두 칸으로 흘려요. 폰에서는 첫 달만 보이고 [펼치기]로 나머지
 */
export function ScheduleCard(props: ScheduleCardProps) {
  const { sections, today, trips, planning, data, onAdd, onAddTrip, onEdit } = props;
  const titleId = useId();
  const ids = useId().replace(/:/g, '');
  const [panel, setPanel] = useState<Panel>(null);
  const [hintHidden, setHintHidden] = useState(readHintDismissed);
  const addBtn = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** 메뉴 · 안내로 칸을 펼칠 때마다 1씩 늘려 그 칸으로 포커스를 옮겨요 */
  const [focusReq, setFocusReq] = useState(0);
  const fold = useMobileFold('일정 목록');
  const groups = useMemo(() => scheduleGroups(sections, trips, today), [sections, trips, today]);
  const recurring = useMemo(() => (planning ? recurringList(data, today).length : 0), [planning, data, today]);
  const count = groups.reduce((s, g) => s + g.entries.length, 0);
  const total = groups.reduce((s, g) => s + g.total, 0);
  const pastTrips = trips.filter((t) => t.phase === 'past').length;
  const empty = sections.total === 0;
  const thisMonth = monthOf(today);
  const foldable = groups.length > 1 || sections.past.length > 0 || pastTrips > 0;

  useEffect(() => {
    if (focusReq > 0) panelRef.current?.focus();
  }, [focusReq]);

  const openPanel = (p: Exclude<Panel, null>) => {
    setPanel(p);
    setFocusReq((n) => n + 1);
  };
  const closePanel = () => {
    setPanel(null);
    addBtn.current?.focus();
  };
  const dismissHint = () => {
    setHintHidden(true);
    writeHintDismissed();
  };

  const items: MenuItem[] = [
    { id: 'event', label: '새 일정', hint: '결혼식 · 생신처럼 한 번 있는 일', icon: 'calendar', onSelect: () => onAdd() },
  ];
  if (planning) {
    items.push(
      { id: 'trip', label: '여행 추가', hint: '기간 · 예산을 정하고 지출을 묶어요', icon: 'plane', onSelect: onAddTrip },
      { id: 'annual', label: '매년 일정 한 번에 등록', hint: '설 · 추석 · 생신 · 어버이날', icon: 'repeat', onSelect: () => openPanel('annual') },
    );
    // 기록에서 찾은 게 없으면 메뉴에 두지 않아요
    if (recurring > 0) {
      items.push({
        id: 'recurring',
        label: '기록에서 찾기',
        badge: `${recurring}건`,
        hint: '지난 지출에서 매년 반복되는 일 추천',
        icon: 'search',
        onSelect: () => openPanel('recurring'),
      });
    }
  }
  const panelName = panel === 'annual' ? '매년 일정 한 번에 등록' : '매년 돌아오는 일';
  const showHint = recurring > 0 && !hintHidden && panel !== 'recurring';

  return (
    <Card as="section" className={cx(foldStyles.card, styles.card)} aria-labelledby={titleId}>
      <FoldHead
        titleId={titleId}
        title={count > 0 ? `일정 · ${count}건 ${formatMan(total)}` : '일정'}
        actions={
          <MenuButton
            label="추가"
            icon="plus"
            menuLabel="무엇을 추가할까요"
            items={items}
            buttonRef={addBtn}
          />
        }
      />

      {panel ? (
        <div id={`${ids}-panel`} ref={panelRef} tabIndex={-1} className={styles.panelWrap}>
          <div className={styles.panelBar}>
            <Button variant="ghost" plain icon="x" onClick={closePanel} aria-label={`${panelName} 닫기`}>
              닫기
            </Button>
          </div>
          {panel === 'annual' ? <AnnualCard data={data} today={today} onEdit={onEdit} /> : null}
          {panel === 'recurring' ? <RecurringCard data={data} today={today} categories={data.categories} /> : null}
        </div>
      ) : null}

      {showHint ? (
        <div className={styles.hint} role="status">
          <Icon name="sparkles" size={20} className={styles.hintIcon} />
          <p className={styles.hintText}>지난 기록에서 매년 반복되는 일 {recurring}건을 찾았어요</p>
          <div className={styles.hintActions}>
            <Button variant="ghost" onClick={() => openPanel('recurring')}>
              보기
            </Button>
            <Button variant="ghost" plain iconOnly icon="x" aria-label="매년 반복되는 일 안내 닫기" onClick={dismissHint} />
          </div>
        </div>
      ) : null}

      {empty ? <EmptyEvents categories={props.emptyCategories} onAdd={onAdd} /> : null}
      {empty && count === 0 ? null : (
        <>
          {sections.overdue.length > 0 ? <OverdueSection {...props} /> : null}
          <div id={fold.bodyId} className={cx(styles.listArea, fold.bodyClass && styles.foldedList)}>
            <section aria-label="다가오는 일정" className={styles.upcoming}>
              {groups.length === 0 ? (
                <p className={styles.emptyLine}>새 일정을 넣으면 여기에 달별로 보여요</p>
              ) : (
                <div className={styles.groupsFlow}>
                  {groups.map((g) => {
                    const headId = `${ids}-${g.month}`;
                    return (
                      <div key={g.month} className={styles.group}>
                        <div className={styles.groupHead}>
                          <h3 id={headId} className={styles.groupTitle}>
                            {monthLabel(g.month, today)}
                            {g.month === thisMonth ? ' · 이번 달' : ''}
                          </h3>
                          <span className={styles.groupTotal}>
                            {g.entries.length}건 · {formatWon(g.total)}
                          </span>
                        </div>
                        <ul className={styles.rows} aria-labelledby={headId}>
                          {g.entries.map((e) =>
                            e.kind === 'event' ? (
                              <EventRow key={e.event.id} event={e.event} variant="upcoming" {...props} />
                            ) : (
                              <TripEntryRow key={`trip:${e.trip.trip.id}`} status={e.trip} />
                            ),
                          )}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
            {sections.past.length > 0 ? <PastSection {...props} /> : null}
            {pastTrips > 0 ? (
              <Link href="/plan/trips" className={styles.moreLink}>
                지난 여행까지 모두 보기 ({trips.length}개)
                <Icon name="chevron-right" size={16} />
              </Link>
            ) : null}
          </div>
          {foldable ? fold.toggle : null}
        </>
      )}
    </Card>
  );
}

/** 여행 한 줄: 떠나는 날 · 이름 [여행] · '45만 / 90만' · 남은 예산, 누르면 여행 화면 */
function TripEntryRow({ status: s }: { status: TripStatus }) {
  const over = s.remaining < 0;
  return (
    <li className={styles.item}>
      <Link
        href={tripHref(s.trip.id)}
        className={styles.rowMain}
        // 숫자를 한 번씩만 읽도록 짧은 이름을 준다
        aria-label={`${s.trip.name}, ${tripPhaseText(s)}, ${tripPeriodText(s.trip)}, ${formatWon(s.budget)} 중 ${formatWon(s.spent)} 썼어요, ${remainingText(s.remaining)}`}
      >
        <span className={styles.date} aria-hidden>
          <span className={styles.md}>{formatShortDate(s.trip.startDate)}</span>
          <span className={styles.wd}>{s.phase === 'ongoing' ? '여행 중' : weekdayShort(s.trip.startDate)}</span>
        </span>
        <span className={styles.main}>
          <span className={styles.nameLine}>
            <span className={styles.name}>{s.trip.name}</span>
            <Badge size="sm" tone="info" variant="soft" dot={false}>
              <Icon name="plane" size={16} />
              여행
            </Badge>
          </span>
          <span className={styles.meta}>
            {formatMan(s.spent)} / {formatMan(s.budget)} · {tripPeriodText(s.trip)}
          </span>
        </span>
        <span className={cx(styles.amt, over && shared.bad)}>
          <span>{over ? `${formatMan(-s.remaining)} 넘었어요` : `남은 ${formatMan(s.remaining)}`}</span>
        </span>
      </Link>
    </li>
  );
}

function OverdueSection({ sections, ...rest }: ScheduleCardProps) {
  const titleId = useId();
  const list = sections.overdue;
  return (
    <section className={styles.attention} aria-labelledby={titleId}>
      <div className={shared.txt}>
        <h3 id={titleId} className={styles.cardTitle}>
          <Icon name="alert-triangle" size={20} className={shared.warn} />
          날짜가 지난 일정 {list.length}건
        </h3>
        <span className={styles.cardSub}>썼는지 알려 주세요. 알려 줄 때까지 이번 달에 나갈 돈으로 계산해요</span>
      </div>
      <ul className={styles.rows}>
        {list.map((e) => (
          <EventRow key={e.id} event={e} variant="overdue" {...rest} />
        ))}
      </ul>
    </section>
  );
}

function PastSection({ sections, ...rest }: ScheduleCardProps) {
  const ids = useId().replace(/:/g, '');
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(PAST_PAGE);
  const list = sections.past;
  const shown = list.slice(0, limit);
  const done = list.filter((e) => e.status === 'done').length;
  return (
    <section className={styles.pastSec} aria-labelledby={`${ids}-t`}>
      <h3 className={styles.pastHeading}>
        <button
          type="button"
          className={shared.disclosure}
          aria-expanded={open}
          aria-controls={`${ids}-list`}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={shared.txt}>
            <span id={`${ids}-t`} className={styles.cardTitle}>
              지난 일정 {list.length}건
            </span>
            <span className={styles.cardSub}>
              쓴 일정 {done}건 · 취소 {list.length - done}건
            </span>
          </span>
          <Icon name="chevron-down" size={20} />
        </button>
      </h3>
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
    </section>
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
}: RowProps & { event: PlannedEvent; variant: 'overdue' | 'upcoming' | 'past' }) {
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
