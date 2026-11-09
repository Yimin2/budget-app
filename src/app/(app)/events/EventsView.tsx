'use client';

import { useId, useMemo, useState } from 'react';
import { formatWon, nextOccurrenceDate, nextOccurrenceId, seriesAnchorDay } from '@/domain';
import type { Category, EventProjection, Id, PlannedEvent } from '@/domain';
import { useLedger } from '@/state';
import {
  Button,
  Card,
  Chip,
  ChipGroup,
  ConfirmDialog,
  EmptyState,
  Icon,
  PageHeader,
  Skeleton,
  cx,
  isIconName,
  useToast,
} from '@/ui';
import { RequireLedger, type ReadyLedger } from '../_components';
import { CompleteDialog } from './CompleteDialog';
import { EventDialog, type EventPreset } from './EventDialog';
import { EventLists } from './EventLists';
import { ProjectionCard } from './ProjectionCard';
import {
  errorText,
  eventCategories,
  nextContribution,
  projectionTotals,
  sectionEvents,
  spentByEvent,
} from './selectors';
import { ShortagePanel } from './ShortagePanel';
import styles from './events.module.css';

type Overlay =
  | { kind: 'add'; preset?: EventPreset }
  | { kind: 'edit'; event: PlannedEvent }
  | { kind: 'complete'; event: PlannedEvent }
  | { kind: 'delete'; event: PlannedEvent }
  | null;

/**
 * '/events' 이벤트통장 — 잔액 · 매달 적립 → 12개월 예상 잔액 막대 → 부족 알림(두 가지 방법) → 일정 목록.
 * 일정 추가 · 고치기 · 썼어요(실제 금액) · 취소됐어요 · 지우기를 여기서 해요.
 */
export function EventsView() {
  const ledger = useLedger();
  const toast = useToast();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [busyId, setBusyId] = useState<Id | null>(null);
  const [deleting, setDeleting] = useState(false);
  const ready = ledger.data !== null;

  const openAdd = (preset?: EventPreset) => setOverlay({ kind: 'add', preset });
  const close = () => setOverlay(null);

  async function cancelEvent(event: PlannedEvent) {
    setOverlay(null);
    setBusyId(event.id);
    // 반복 일정은 이번 회차만 취소되고 다음 회차가 생겨요. 되돌리면 그 다음 회차도 지워요
    const events = ledger.data?.events ?? [];
    const nextDate =
      event.repeat === 'none' ? null : nextOccurrenceDate(event.date, event.repeat, seriesAnchorDay(events, event));
    const nextExisted = nextDate ? events.some((e) => e.id === nextOccurrenceId(event, nextDate) && !e.deleted) : false;
    try {
      await ledger.cancelEvent(event.id);
      toast.success(
        event.repeat === 'none' ? `‘${event.name}’ 일정을 취소로 바꿨어요` : `‘${event.name}’ 이번 회차를 취소로 바꿨어요`,
        {
          action: {
            label: '되돌리기',
            onClick: () => {
              const undo = async () => {
                await ledger.updateEvent({ ...event, status: 'planned' });
                if (nextDate && !nextExisted) {
                  const id = nextOccurrenceId(event, nextDate);
                  await ledger.updateEvent({ ...event, id, date: nextDate, status: 'planned', deleted: true });
                }
              };
              undo().catch((e: unknown) => {
                toast.error(errorText(e, '일정을 되돌리지 못했어요'));
              });
            },
          },
        },
      );
    } catch (e) {
      toast.error(errorText(e, '일정을 취소하지 못했어요'));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete(event: PlannedEvent) {
    setDeleting(true);
    try {
      await ledger.deleteEvent(event.id);
      setOverlay(null);
      toast.success(`‘${event.name}’ 일정을 지웠어요`, {
        action: {
          label: '되돌리기',
          onClick: () => {
            ledger.updateEvent({ ...event, deleted: false }).catch((e: unknown) => {
              toast.error(errorText(e, '일정을 되살리지 못했어요'));
            });
          },
        },
      });
    } catch (e) {
      toast.error(errorText(e, '일정을 지우지 못했어요'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="이벤트"
        actions={
          <Button icon="plus" onClick={() => openAdd()} disabled={!ready} className={styles.headerAdd}>
            일정 추가
          </Button>
        }
      />
      <RequireLedger skeleton={<EventsSkeleton />}>
        {(l) => (
          <EventsBody
            ledger={l}
            busyId={busyId}
            onAdd={openAdd}
            onEdit={(event) => setOverlay({ kind: 'edit', event })}
            onComplete={(event) => setOverlay({ kind: 'complete', event })}
            onCancel={cancelEvent}
          />
        )}
      </RequireLedger>

      {ready && overlay?.kind === 'add' ? <EventDialog preset={overlay.preset} onClose={close} /> : null}
      {ready && overlay?.kind === 'edit' ? (
        <EventDialog
          event={overlay.event}
          onClose={close}
          onComplete={(event) => setOverlay({ kind: 'complete', event })}
          onCancelEvent={cancelEvent}
          onDelete={(event) => setOverlay({ kind: 'delete', event })}
        />
      ) : null}
      {ready && overlay?.kind === 'complete' ? <CompleteDialog event={overlay.event} onClose={close} /> : null}
      <ConfirmDialog
        open={overlay?.kind === 'delete'}
        title="일정을 지울까요?"
        description={
          overlay?.kind === 'delete'
            ? `‘${overlay.event.name}’ 일정을 지우면 예측에서도 빠져요. 이미 기록한 지출은 그대로 남아요.`
            : undefined
        }
        confirmLabel="지우기"
        tone="danger"
        loading={deleting}
        onConfirm={() => {
          if (overlay?.kind === 'delete') void confirmDelete(overlay.event);
        }}
        onCancel={() => (deleting ? undefined : close())}
      />
    </div>
  );
}

interface BodyProps {
  ledger: ReadyLedger;
  busyId: Id | null;
  onAdd: (preset?: EventPreset) => void;
  onEdit: (event: PlannedEvent) => void;
  onComplete: (event: PlannedEvent) => void;
  onCancel: (event: PlannedEvent) => void;
}

function EventsBody({ ledger, busyId, onAdd, onEdit, onComplete, onCancel }: BodyProps) {
  const { data, today } = ledger;
  const projection = ledger.eventProjection;
  const sections = useMemo(() => sectionEvents(data.events, today), [data.events, today]);
  const spent = useMemo(() => spentByEvent(data.expenses), [data.expenses]);
  const hasEventAccount = Boolean(projection?.accountId);

  return (
    <>
      {projection && hasEventAccount ? (
        <>
          <SummaryCard projection={projection} />
          <ProjectionCard projection={projection} today={today} />
          {projection.shortages.length > 0 ? (
            <ShortagePanel projection={projection} fix={ledger.shortageFix} today={today} />
          ) : null}
        </>
      ) : (
        <NoEventAccount ledger={ledger} />
      )}
      {sections.total === 0 ? (
        <EmptyEvents categories={eventCategories(ledger.activeCategories)} onAdd={onAdd} />
      ) : (
        <EventLists
          sections={sections}
          today={today}
          categories={data.categories}
          spent={spent}
          displayName={ledger.displayName}
          busyId={busyId}
          onAdd={() => onAdd()}
          onEdit={onEdit}
          onComplete={onComplete}
          onCancel={onCancel}
        />
      )}
    </>
  );
}

/* ───────── 잔액 · 매달 적립 ───────── */

function SummaryCard({ projection }: { projection: EventProjection }) {
  const titleId = useId();
  const totals = projectionTotals(projection);
  const next = nextContribution(projection);
  const short = projection.shortages.length;
  return (
    <Card as="section" variant="brand" className={styles.summary} aria-labelledby={titleId}>
      <div className={styles.sumMain}>
        <h2 id={titleId} className={styles.sumLabel}>
          이벤트통장 잔액
        </h2>
        <p className={styles.sumValue}>{formatWon(projection.currentBalance)}</p>
      </div>
      <dl className={styles.sumStats}>
        <div className={styles.sumStat}>
          <dt>매달 적립</dt>
          <dd>
            {formatWon(projection.monthlyContribution)}
            {next !== null ? <span className={styles.subNote}>다음 달부터 {formatWon(next)}</span> : null}
          </dd>
        </div>
        <div className={styles.sumStat}>
          <dt>{projection.months.length}개월 예정 일정</dt>
          <dd>
            {totals.count}건<span className={styles.subNote}>{formatWon(totals.amount)}</span>
          </dd>
        </div>
        <div className={cx(styles.sumStat, styles.sumStatWide)}>
          <dt>모자라는 달</dt>
          <dd>
            <span className={cx(styles.statusLine, short > 0 ? styles.bad : styles.ok)}>
              <Icon name={short > 0 ? 'alert-triangle' : 'check-circle'} size={20} />
              {short > 0 ? `${short}개월` : '없어요'}
            </span>
          </dd>
        </div>
      </dl>
    </Card>
  );
}

/* ───────── 이벤트통장이 없을 때 (개인 가계부 등) ───────── */

function NoEventAccount({ ledger }: { ledger: ReadyLedger }) {
  const titleId = useId();
  const fallback = ledger.accountByRole('allowance') ?? ledger.activeAccounts[0] ?? null;
  return (
    <Card as="section" className={styles.noAccount} aria-labelledby={titleId}>
      <Icon name="info" size={20} />
      <div className={styles.txt}>
        <h2 id={titleId}>이 가계부에는 이벤트통장이 없어요</h2>
        <p>
          {fallback ? `일정은 ${fallback.name}에서 나가는 걸로 기록해요. ` : ''}
          이벤트통장을 만들면 12개월 예상 잔액과 모자라는 달을 알려 드려요.
        </p>
        <Button href="/settings#st-accounts" variant="outline" icon="plus" className={styles.act}>
          통장 추가하기
        </Button>
      </div>
    </Card>
  );
}

/* ───────── 빈 상태 ───────── */

const EXAMPLES: { label: string; name: string; category: string; repeat?: EventPreset['repeat'] }[] = [
  { label: '결혼식', name: '결혼식', category: '경조사' },
  { label: '명절', name: '설날', category: '명절', repeat: 'yearly' },
  { label: '여행', name: '여름휴가', category: '여행' },
  { label: '생일 선물', name: '생일 선물', category: '선물', repeat: 'yearly' },
];

function EmptyEvents({ categories, onAdd }: { categories: Category[]; onAdd: (preset?: EventPreset) => void }) {
  return (
    <Card as="section" aria-label="일정">
      <EmptyState
        icon="calendar"
        title="아직 넣은 일정이 없어요"
        description="결혼식, 명절, 여행처럼 고정비가 아닌 큰 지출을 미리 넣어 두세요. 모자라는 달이 생기면 미리 알려 드려요."
        action={
          <div className={styles.examples}>
            <Button icon="plus" onClick={() => onAdd()}>
              일정 추가
            </Button>
            <span className={styles.examplesLabel}>예시로 시작하기</span>
            <ChipGroup label="예시로 시작하기">
              {EXAMPLES.map((ex) => {
                const cat = categories.find((c) => c.name === ex.category) ?? null;
                return (
                  <Chip
                    key={ex.label}
                    icon={cat && isIconName(cat.icon) ? cat.icon : 'calendar'}
                    onClick={() => onAdd({ name: ex.name, categoryId: cat?.id ?? null, repeat: ex.repeat })}
                  >
                    {ex.label}
                  </Chip>
                );
              })}
            </ChipGroup>
          </div>
        }
      />
    </Card>
  );
}

/* ───────── 불러오는 중 ───────── */

const SKEL_BARS = [72, 64, 48, 88, 40, 20, 56, 80, 96, 104, 112, 120];

export function EventsSkeleton() {
  return (
    <div className={styles.page} role="status">
      <span className="sr-only">일정을 불러오는 중이에요</span>
      <Card variant="brand" className={styles.skelCard}>
        <Skeleton width={120} height={22} />
        <Skeleton width={200} height={44} radius="md" />
        <div className="grid-2">
          <Skeleton height={72} radius="md" />
          <Skeleton height={72} radius="md" />
        </div>
      </Card>
      <Card className={styles.skelCard}>
        <Skeleton width={180} height={22} />
        <div className={styles.skelBars}>
          {SKEL_BARS.map((h, i) => (
            <Skeleton key={i} height={h} radius="sm" />
          ))}
        </div>
      </Card>
      <Card className={styles.skelCard}>
        <Skeleton width={120} height={22} />
        <Skeleton height={56} />
        <Skeleton height={56} />
        <Skeleton height={56} />
      </Card>
    </div>
  );
}
