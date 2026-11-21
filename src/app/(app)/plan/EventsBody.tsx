'use client';

import { useMemo, useState } from 'react';
import { findExceptionCandidates, recommendCompromise, spentBasisView, usualSpendingInsight } from '@/domain';
import type { Id, PlannedEvent, RepayMonths, TripStatus, Won } from '@/domain';
import type { ReadyLedger } from '../_components';
import { HashTarget } from '../_components/HashTarget';
import { BalanceChart } from './BalanceChart';
import { EventHistory, EventHistoryBarSpace } from './settle/SettleScreen';
import { readRepayMonths, writeRepayMonths } from './CompromisePanel';
import type { EventPreset } from './EventDialog';
import { NoEventAccount } from './NoEventAccount';
import { StatusCard } from './StatusCard';
import { eventCategories, sectionEvents, spentByEvent } from './selectors';
import { ScheduleCard, type SchedulePanel } from './ScheduleCard';
import { UsualCard } from './UsualCard';
import styles from './EventsBody.module.css';

const NO_TRIPS: TripStatus[] = [];

export interface EventsBodyProps {
  ledger: ReadyLedger;
  busyId: Id | null;
  onAdd: (preset?: EventPreset) => void;
  onEdit: (event: PlannedEvent) => void;
  onComplete: (event: PlannedEvent) => void;
  onCancel: (event: PlannedEvent) => void;
  /** '일정' 카드 안에 펼친 칸 (머리 [+ 추가] 메뉴로 열어요) */
  panel: SchedulePanel;
  focusReq: number;
  /** 기록에서 찾은 매년 반복되는 일 수 */
  recurring: number;
  onOpenPanel: (p: Exclude<SchedulePanel, null>) => void;
  onClosePanel: () => void;
}

export function EventsBody({
  ledger,
  busyId,
  onAdd,
  onEdit,
  onComplete,
  onCancel,
  panel,
  focusReq,
  recurring,
  onOpenPanel,
  onClosePanel,
}: EventsBodyProps) {
  const { data, today } = ledger;
  const projection = ledger.eventProjection;
  const sections = useMemo(() => sectionEvents(data.events, today), [data.events, today]);
  const spent = useMemo(() => spentByEvent(data.expenses), [data.expenses]);
  const hasEventAccount = Boolean(projection?.accountId);
  const insight = useMemo(
    () => (projection ? usualSpendingInsight(data, today, projection) : null),
    [data, today, projection],
  );
  // 추천 타협안: 저수지 빚 갚는 개월 수는 이 기기에 저장 (localStorage, 시트에는 쓰지 않음)
  const [repayMonths, setRepayMonths] = useState<RepayMonths>(readRepayMonths);
  const loanBalance = ledger.settlement?.loan.balance ?? 0;
  const compromise = useMemo(
    () => (projection && insight ? recommendCompromise(data, today, projection, { loanBalance, repayMonths }) : null),
    [data, today, projection, insight, loanBalance, repayMonths],
  );
  const chooseMonths = (m: RepayMonths) => {
    setRepayMonths(m);
    writeRepayMonths(m);
  };
  // 쓴 날 기준 달 말 잔액 (지난 3개월 + 앞으로)
  const view = useMemo(() => spentBasisView(data, projection, today), [data, projection, today]);
  const hasCandidates = useMemo(() => findExceptionCandidates(data, today).length > 0, [data, today]);
  const monthEnds = useMemo(() => new Map<string, Won>((view?.months ?? []).map((m) => [m.month, m.end])), [view]);

  const schedule = (
    <ScheduleCard
      sections={sections}
      today={today}
      categories={data.categories}
      spent={spent}
      displayName={ledger.displayName}
      busyId={busyId}
      trips={hasEventAccount ? ledger.trips : NO_TRIPS}
      data={data}
      emptyCategories={eventCategories(ledger.activeCategories)}
      panel={panel}
      focusReq={focusReq}
      recurring={recurring}
      onOpenPanel={onOpenPanel}
      onClosePanel={onClosePanel}
      onAdd={onAdd}
      onEdit={onEdit}
      onComplete={onComplete}
      onCancel={onCancel}
      monthEnds={view ? monthEnds : undefined}
    />
  );

  // 달별 내역 → 달 말 잔액 → 연간 일정 · 평소 쓰는 돈 (넓은 화면은 나란히)
  return (
    <div className={styles.grid}>
      {projection && hasEventAccount && view ? (
        <>
          {/* 2026-11 개편: 달별 내역(정산 합침) → 달 말 잔액 → 연간 일정 · 평소 쓰는 돈. 모자라는 달은 차트 위 한 줄로 */}
          <EventHistory ledger={ledger} />
          <HashTarget />
          <BalanceChart
            view={view}
            data={data}
            today={today}
            accountId={projection.accountId!}
            notice={<StatusCard compact view={view} today={today} compromise={compromise} repayMonths={repayMonths} onRepayMonths={chooseMonths} />}
          />
          <div className={styles.lower}>
            {schedule}
            <UsualCard data={data} accountId={projection.accountId!} insight={insight} today={today} hasCandidates={hasCandidates} />
          </div>
          <EventHistoryBarSpace ledger={ledger} />
        </>
      ) : (
        <>
          <NoEventAccount ledger={ledger} />
          {schedule}
        </>
      )}
    </div>
  );
}
