'use client';

import { useState } from 'react';
import { nextEventDate, nextOccurrenceId } from '@/domain';
import type { Id, PlannedEvent } from '@/domain';
import { useLedger } from '@/state';
import { Button, ConfirmDialog, PageHeader, useToast } from '@/ui';
import { RequireLedger } from '../_components';
import { CompleteDialog } from './CompleteDialog';
import { EventDialog, type EventPreset } from './EventDialog';
import { EventsBody } from './EventsBody';
import { EventsSkeleton } from './EventsSkeleton';
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
            onAddTrip={() => setOverlay({ kind: 'addTrip' })}
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
