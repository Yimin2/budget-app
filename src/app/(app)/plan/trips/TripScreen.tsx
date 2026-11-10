'use client';

import { useId, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { TRIP_ITEM_ICONS, TRIP_ITEM_LABELS, formatWon, tripItemLines, tripPeriodText, tripSpendState } from '@/domain';
import type { Expense, TripSpendState, TripStatus } from '@/domain';
import { useLedger } from '@/state';
import { Button, Card, EmptyState, Icon, PageHeader, ProgressBar, Skeleton, cx, isIconName } from '@/ui';
import { RequireLedger, type ReadyLedger } from '../../_components';
import { ExpenseDialog } from '../../history/_expenses/ExpenseDialog';
import { TripDailyCard } from './TripDailyCard';
import { TripDialog } from './TripDialog';
import { TripPayRow } from './TripPayRow';
import { TripRow } from './TripsCard';
import { itemLineText, newestFirst, projectionNote, remainingText, stateTone, tripPhaseText } from './selectors';
import styles from './trips.module.css';

type Overlay =
  | { kind: 'addTrip' }
  | { kind: 'editTrip'; status: TripStatus }
  | { kind: 'addExpense'; status: TripStatus }
  | { kind: 'editExpense'; expense: Expense }
  | null;

/**
 * '/plan/trips' 여행 (PLAN 4-11). ?id=<여행 id> 면 여행 하나: 예산 · 쓴 돈 · 남은 돈, 항목마다 막대, 날짜별 쓴 돈, 낸 돈 목록.
 * id 가 없으면 모든 여행 (다가오는 · 여행 중 · 지난 여행)
 */
export function TripScreen() {
  const params = useSearchParams();
  const id = params.get('id');
  return <TripView tripId={id} />;
}

export function TripView({ tripId }: { tripId: string | null }) {
  const ledger = useLedger();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const close = () => setOverlay(null);
  const status = tripId ? (ledger.trips.find((t) => t.trip.id === tripId) ?? null) : null;
  const ready = ledger.data !== null;

  return (
    <div className={styles.page}>
      <PageHeader
        title={tripId ? (status?.trip.name ?? '여행') : '여행'}
        subtitle={status ? `${tripPeriodText(status.trip)} · ${tripPhaseText(status)}` : tripId ? undefined : '여행 예산은 이벤트통장에서 나가요'}
        backHref={tripId ? '/plan/trips' : '/plan'}
        backLabel={tripId ? '여행 목록으로' : '이벤트로'}
        actions={
          tripId ? (
            status ? (
              <Button variant="outline" icon="edit" onClick={() => setOverlay({ kind: 'editTrip', status })}>
                고치기
              </Button>
            ) : null
          ) : (
            <Button icon="plus" onClick={() => setOverlay({ kind: 'addTrip' })} disabled={!ready}>
              여행 추가
            </Button>
          )
        }
      />
      <RequireLedger skeleton={<TripSkeleton />}>
        {(l) =>
          tripId ? (
            status ? (
              <TripDetail
                ledger={l}
                status={status}
                onAddExpense={() => setOverlay({ kind: 'addExpense', status })}
                onEditExpense={(expense) => setOverlay({ kind: 'editExpense', expense })}
              />
            ) : (
              <Card as="section" aria-label="여행">
                <EmptyState
                  icon="plane"
                  title="여행을 찾을 수 없어요"
                  description="지웠거나 다른 가계부의 여행이에요."
                  action={
                    <Button href="/plan/trips" variant="outline">
                      여행 목록 보기
                    </Button>
                  }
                />
              </Card>
            )
          ) : (
            <TripList ledger={l} onAdd={() => setOverlay({ kind: 'addTrip' })} />
          )
        }
      </RequireLedger>

      {ready && overlay?.kind === 'addTrip' ? <TripDialog onClose={close} /> : null}
      {ready && overlay?.kind === 'editTrip' ? <TripDialog trip={overlay.status.trip} onClose={close} /> : null}
      {ready && overlay?.kind === 'addExpense' ? (
        <ExpenseDialog
          initial={{
            accountId: ledger.accountByRole('event')?.id ?? null,
            categoryId: ledger.activeCategories.find((c) => c.name === '여행')?.id ?? null,
            tripId: overlay.status.trip.id,
          }}
          onClose={close}
        />
      ) : null}
      {ready && overlay?.kind === 'editExpense' ? <ExpenseDialog expense={overlay.expense} onClose={close} /> : null}
    </div>
  );
}

/* ───────── 여행 목록 ───────── */

function TripList({ ledger, onAdd }: { ledger: ReadyLedger; onAdd: () => void }) {
  const active = ledger.trips.filter((t) => t.phase !== 'past');
  const past = ledger.trips.filter((t) => t.phase === 'past');
  const activeId = useId();
  const pastId = useId();
  if (ledger.trips.length === 0) {
    return (
      <Card as="section" aria-label="여행">
        <EmptyState
          icon="plane"
          title="아직 넣은 여행이 없어요"
          description="여행 예산과 항공 · 숙박 같은 항목 예산을 잡아 두세요. 몇 달 전에 낸 항공권도 여행에 묶어 한눈에 봐요."
          action={
            <Button icon="plus" onClick={onAdd}>
              여행 추가
            </Button>
          }
        />
      </Card>
    );
  }
  return (
    <>
      <Card as="section" className={styles.card} aria-labelledby={activeId}>
        <h2 id={activeId} className="card-title">
          다가오는 여행
        </h2>
        {active.length === 0 ? (
          <p className={styles.muted}>다가오는 여행이 없어요.</p>
        ) : (
          <ul className={styles.tripList}>
            {active.map((s) => (
              <li key={s.trip.id}>
                <TripRow status={s} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      {past.length > 0 ? (
        <Card as="section" className={styles.card} aria-labelledby={pastId}>
          <h2 id={pastId} className="card-title">
            지난 여행
          </h2>
          <ul className={styles.tripList}>
            {past.map((s) => (
              <li key={s.trip.id}>
                <TripRow status={s} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

/* ───────── 여행 하나 ───────── */

function TripDetail({
  ledger,
  status: s,
  onAddExpense,
  onEditExpense,
}: {
  ledger: ReadyLedger;
  status: TripStatus;
  onAddExpense: () => void;
  onEditExpense: (e: Expense) => void;
}) {
  const summaryId = useId();
  const itemsId = useId();
  const listId = useId();
  const { today } = ledger;
  const totalState = tripSpendState(s.spent, s.budget);
  const { pool, lines } = tripItemLines(s);
  const expenses = newestFirst(s.expenses);
  const note = projectionNote(s, today);

  return (
    <div className={styles.detailGrid}>
      <Card as="section" variant="brand" className={styles.summary} aria-labelledby={summaryId}>
        <h2 id={summaryId} className="sr-only">
          여행 예산
        </h2>
        <dl className={styles.stats}>
          <div className={styles.stat}>
            <dt>예산</dt>
            <dd>{formatWon(s.budget)}</dd>
          </div>
          <div className={styles.stat}>
            <dt>쓴 돈</dt>
            <dd>{formatWon(s.spent)}</dd>
          </div>
          <div className={cx(styles.stat, stateClass(totalState))}>
            <dt>{s.remaining < 0 ? '넘은 돈' : '남은 돈'}</dt>
            <dd>{formatWon(Math.abs(s.remaining))}</dd>
          </div>
        </dl>
        <ProgressBar
          value={s.spent}
          max={s.budget}
          tone={stateTone(totalState)}
          track="brand"
          label="여행 예산 사용"
          valueText={`${formatWon(s.budget)} 중 ${formatWon(s.spent)}`}
        />
        <p className={cx(styles.statusLine, stateClass(totalState) ?? styles.onTrack)}>
          <Icon name={stateIcon(totalState)} size={16} />
          {remainingText(s.remaining)}
          {totalState === 'near' ? ' · 거의 다 썼어요' : ''}
        </p>
        {note ? (
          <p className={styles.note}>
            <Icon name="calendar" size={16} />
            {note}
          </p>
        ) : null}
        {s.spentElsewhere > 0 ? (
          <p className={styles.note}>
            <Icon name="info" size={16} />
            이벤트통장이 아닌 통장에서 낸 {formatWon(s.spentElsewhere)}도 이 여행에 함께 셌어요
          </p>
        ) : null}
        {s.itemBudgetTotal > s.budget ? (
          <p className={styles.note}>
            <Icon name="alert-circle" size={16} />
            항목 예산 합이 총예산보다 {formatWon(s.itemBudgetTotal - s.budget)} 많아요
          </p>
        ) : null}
      </Card>

      <Card as="section" className={styles.card} aria-labelledby={itemsId}>
        <h2 id={itemsId} className="card-title">
          항목별
        </h2>
        {lines.length === 0 ? (
          <p className={styles.muted}>항목 예산이 없어요. 고치기에서 항공 · 숙박처럼 나눠 잡을 수 있어요.</p>
        ) : (
          <ul className={styles.items}>
            {lines.map((it) => {
              const label = TRIP_ITEM_LABELS[it.item];
              const icon = TRIP_ITEM_ICONS[it.item];
              const text = itemLineText(it, pool);
              const tone = stateClass(it.state);
              const barMax = it.basis === 'own' ? it.budget! : it.basis === 'pool' && pool ? pool.budget : Math.max(it.spent, 1);
              const barValue = it.basis === 'pool' && pool ? pool.spent : it.spent;
              return (
                <li key={it.item} className={cx(styles.item, tone)}>
                  <span className={styles.itemIcon} aria-hidden>
                    <Icon name={isIconName(icon) ? icon : 'dots'} size={20} />
                  </span>
                  <span className={styles.itemMain}>
                    <span className={styles.itemTop}>
                      <span className={styles.itemName}>{label}</span>
                      {text.status ? (
                        <span className={styles.itemLeft}>
                          {it.state !== 'ok' ? <Icon name={stateIcon(it.state)} size={16} /> : null}
                          {text.status}
                        </span>
                      ) : null}
                    </span>
                    <ProgressBar
                      value={barValue}
                      max={barMax}
                      tone={stateTone(it.state)}
                      track="subtle"
                      label={`${label} 예산 사용`}
                      valueText={
                        it.basis === 'own'
                          ? `${formatWon(it.budget!)} 중 ${formatWon(it.spent)}`
                          : it.basis === 'pool' && pool
                            ? `나머지 예산 ${formatWon(pool.budget)} 중 ${formatWon(pool.spent)}`
                            : `예산 밖 ${formatWon(it.spent)} 씀`
                      }
                    />
                    {text.detail ? <span className={styles.itemNums}>{text.detail}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <TripDailyCard ledger={ledger} status={s} onEditExpense={onEditExpense} />

      <Card as="section" className={cx(styles.card, styles.payments)} aria-labelledby={listId}>
        <div className={styles.cardHead}>
          <h2 id={listId} className="card-title">
            낸 돈 {expenses.length > 0 ? `${expenses.length}건` : ''}
          </h2>
          <Button variant="ghost" icon="plus" onClick={onAddExpense}>
            지출 기록
          </Button>
        </div>
        {expenses.length === 0 ? (
          <p className={styles.muted}>아직 이 여행에 묶은 지출이 없어요. 항공권처럼 미리 낸 돈도 기록할 때 여행을 고르면 여기에 모여요.</p>
        ) : (
          <ul className={styles.payList} aria-label="이 여행에 낸 돈">
            {expenses.map((e) => (
              <li key={e.id}>
                <TripPayRow ledger={ledger} expense={e} onEdit={onEditExpense} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** 쓴 정도 → 글자 색 class (보통이면 없음) */
function stateClass(state: TripSpendState): string | undefined {
  return state === 'over' ? styles.toneDanger : state === 'near' ? styles.toneWarning : undefined;
}

function stateIcon(state: TripSpendState): 'alert-triangle' | 'alert-circle' | 'check-circle' {
  return state === 'over' ? 'alert-triangle' : state === 'near' ? 'alert-circle' : 'check-circle';
}

function TripSkeleton() {
  return (
    <div className={styles.page} role="status">
      <span className="sr-only">여행을 불러오는 중이에요</span>
      <Card variant="brand" className={styles.card}>
        <Skeleton width={160} height={22} />
        <Skeleton height={56} radius="md" />
      </Card>
      <Card className={styles.card}>
        <Skeleton height={48} />
        <Skeleton height={48} />
      </Card>
    </div>
  );
}
