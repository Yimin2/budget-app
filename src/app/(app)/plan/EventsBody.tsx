'use client';

import { useMemo, useState } from 'react';
import {
  effectiveExclusions,
  findExceptionCandidates,
  projectWithExclusions,
  recommendCompromise,
  usualSpendingInsight,
} from '@/domain';
import type { ExclusionDraft, Id, PlannedEvent, RepayMonths } from '@/domain';
import type { ReadyLedger } from '../_components';
import { HashTarget } from '../_components/HashTarget';
import { AnnualCard } from './AnnualCard';
import { readRepayMonths, writeRepayMonths } from './CompromisePanel';
import type { EventPreset } from './EventDialog';
import { EventLists } from './EventLists';
import { EmptyEvents } from './EmptyEvents';
import { ExceptionCard } from './ExceptionCard';
import { NoEventAccount } from './NoEventAccount';
import { AheadCard } from './AheadCard';
import { RecurringCard } from './RecurringCard';
import { eventCategories, sectionEvents, spentByEvent } from './selectors';
import { ThisMonthCard } from './ThisMonthCard';
import { TripsCard } from './trips/TripsCard';
import { UsualInsightCard } from './UsualInsightCard';
import styles from './EventsBody.module.css';

export interface EventsBodyProps {
  ledger: ReadyLedger;
  busyId: Id | null;
  onAdd: (preset?: EventPreset) => void;
  onEdit: (event: PlannedEvent) => void;
  onComplete: (event: PlannedEvent) => void;
  onCancel: (event: PlannedEvent) => void;
  onAddTrip: () => void;
}

export function EventsBody({ ledger, busyId, onAdd, onEdit, onComplete, onCancel, onAddTrip }: EventsBodyProps) {
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
  // 예외 지출 빼기: 체크한 대로 저장하지 않고 덮어씌운 예측 (바꾼 것이 없으면 null). 화면을 떠나면 사라져요
  const candidates = useMemo(() => findExceptionCandidates(data, today), [data, today]);
  const [draft, setDraft] = useState<ExclusionDraft>({});
  const tried = useMemo(
    () => (effectiveExclusions(data, draft).length > 0 ? projectWithExclusions(data, today, draft) : null),
    [data, today, draft],
  );
  const shown = tried ?? projection;

  return (
    <div className={styles.grid}>
      {projection && hasEventAccount ? (
        <>
          <ThisMonthCard projection={projection} repayMonths={repayMonths} className={styles.half} />
          {insight ? (
            <div className={styles.half}>
              <UsualInsightCard
                data={data}
                projection={projection}
                insight={insight}
                today={today}
                compromise={compromise}
                repayMonths={repayMonths}
                onRepayMonths={chooseMonths}
              />
            </div>
          ) : null}
          <HashTarget />
          <AheadCard
            projection={shown ?? projection}
            data={data}
            today={today}
            badge={tried ? '미리 보는 중' : undefined}
            fix={ledger.shortageFix}
            showShortage={!tried}
          />
          <ExceptionCard
            data={data}
            today={today}
            candidates={candidates}
            before={projection}
            after={tried}
            draft={draft}
            onChange={setDraft}
          />
          <AnnualCard data={data} today={today} onEdit={onEdit} />
          <RecurringCard data={data} today={today} categories={data.categories} />
        </>
      ) : (
        <NoEventAccount ledger={ledger} />
      )}
      {hasEventAccount ? <TripsCard trips={ledger.trips} onAdd={onAddTrip} /> : null}
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
    </div>
  );
}
