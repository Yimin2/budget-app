'use client';

import { useMemo, useRef, useState } from 'react';
import { nextEventDate, nextOccurrenceId } from '@/domain';
import type { Id, PlannedEvent } from '@/domain';
import { useLedger } from '@/state';
import { ConfirmDialog, MenuButton, PageHeader, useToast, type MenuItem } from '@/ui';
import { RequireLedger } from '../_components';
import { CompleteDialog } from './CompleteDialog';
import { EventDialog, type EventPreset } from './EventDialog';
import { EventsBody } from './EventsBody';
import { EventsSkeleton } from './EventsSkeleton';
import { recurringList } from './RecurringCard';
import type { SchedulePanel } from './ScheduleCard';
import { errorText } from './selectors';
import { TripDialog } from './trips/TripDialog';
import shared from './events.module.css';
import styles from './EventsView.module.css';

type Overlay =
  | { kind: 'add'; preset?: EventPreset }
  | { kind: 'edit'; event: PlannedEvent }
  | { kind: 'complete'; event: PlannedEvent }
  | { kind: 'delete'; event: PlannedEvent }
  | { kind: 'addTrip' }
  | null;

/**
 * '/plan' 이벤트통장 — 카드 넷 (이번 달 · 평소 쓰는 돈 · 앞으로 12개월 · 일정, 배치는 EventsBody).
 * 머리의 [+ 추가 ▾] 하나가 화면의 유일한 추가 버튼이에요: 새 일정 · 여행 추가 · 매년 일정 한 번에 등록 · 기록에서 찾기 N건(0건이면 없음).
 * 매년 일정 · 기록에서 찾기는 '일정' 카드 안에서 펼쳐요 (펼친 칸 상태는 여기서 들고 있어요).
 * 일정 추가 · 고치기 · 썼어요(실제 금액) · 취소됐어요 · 지우기를 여기서 해요.
 */
export function EventsView() {
  const ledger = useLedger();
  const toast = useToast();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [busyId, setBusyId] = useState<Id | null>(null);
  const [deleting, setDeleting] = useState(false);
  const ready = ledger.data !== null;
  const [panel, setPanel] = useState<SchedulePanel>(null);
  /** 메뉴 · 안내로 칸을 펼칠 때마다 1씩 늘려 그 칸으로 포커스를 옮겨요 */
  const [focusReq, setFocusReq] = useState(0);
  const addBtn = useRef<HTMLButtonElement | null>(null);

  const openAdd = (preset?: EventPreset) => setOverlay({ kind: 'add', preset });
  const close = () => setOverlay(null);
  const openPanel = (p: Exclude<SchedulePanel, null>) => {
    setPanel(p);
    setFocusReq((n) => n + 1);
  };
  const closePanel = () => {
    setPanel(null);
    addBtn.current?.focus();
  };

  // 여행 · 매년 일정 · 기록에서 찾기는 이벤트통장이 있을 때만
  const planning = Boolean(ledger.eventProjection?.accountId);
  const data = ledger.data;
  const today = ledger.today;
  const recurring = useMemo(() => (planning && data ? recurringList(data, today).length : 0), [planning, data, today]);
  // 이벤트통장이 없으면 펼친 칸도 보이지 않아요
  const shownPanel: SchedulePanel = planning ? panel : null;

  const items: MenuItem[] = [
    { id: 'event', label: '새 일정', hint: '결혼식 · 생신처럼 한 번 있는 일', icon: 'calendar', onSelect: () => openAdd() },
  ];
  if (planning) {
    items.push(
      { id: 'trip', label: '여행 추가', hint: '기간 · 예산을 정하고 지출을 묶어요', icon: 'plane', onSelect: () => setOverlay({ kind: 'addTrip' }) },
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

  async function cancelEvent(event: PlannedEvent) {
    setOverlay(null);
    setBusyId(event.id);
    // 반복 일정은 이번 회차만 취소되고 다음 회차가 생겨요. 되돌리면 그 다음 회차도 지워요
    const events = ledger.data?.events ?? [];
    const nextDate = nextEventDate(events, event);
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
    <div className={shared.page}>
      <PageHeader
        title="이벤트"
        subtitle="이벤트통장 일정 · 12개월 예측 · 여행이에요"
        actions={
          <MenuButton
            label="추가"
            icon="plus"
            iconRight="chevron-down"
            menuLabel="무엇을 추가할까요"
            items={items}
            buttonRef={addBtn}
            disabled={!ready}
            className={styles.headerAdd}
          />
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
            panel={shownPanel}
            focusReq={focusReq}
            recurring={recurring}
            onOpenPanel={openPanel}
            onClosePanel={closePanel}
          />
        )}
      </RequireLedger>

      {ready && overlay?.kind === 'addTrip' ? <TripDialog onClose={close} /> : null}

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

export { EventsSkeleton } from './EventsSkeleton';
