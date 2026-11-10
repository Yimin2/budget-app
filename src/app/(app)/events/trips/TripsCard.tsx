'use client';

import Link from 'next/link';
import { useId } from 'react';
import { formatWon, tripPeriodText } from '@/domain';
import type { TripStatus } from '@/domain';
import { Button, Card, Icon, ProgressBar, cx } from '@/ui';
import { remainingText, spendTone, tripHref, tripPhaseText } from './selectors';
import styles from './trips.module.css';

export interface TripsCardProps {
  trips: TripStatus[];
  onAdd: () => void;
  /** 이 개수까지 보여 주고 나머지는 '여행 모두 보기'로 (기본: 지난 여행을 뺀 전부, 최대 3개) */
  limit?: number;
  className?: string;
}

/**
 * 이벤트 화면의 여행 카드 (PLAN 4-11): 다가오는 · 여행 중인 여행마다 쓴 돈 / 예산 막대와 남은 예산.
 * 누르면 '/events/trips?id=…' 여행 화면으로 가요. 여행이 없으면 짧은 안내와 [여행 추가]
 */
export function TripsCard({ trips, onAdd, limit = 3, className }: TripsCardProps) {
  const titleId = useId();
  const active = trips.filter((t) => t.phase !== 'past');
  const shown = active.slice(0, limit);
  const pastCount = trips.length - active.length;
  return (
    <Card as="section" className={cx(styles.card, className)} aria-labelledby={titleId}>
      <div className={styles.cardHead}>
        <h2 id={titleId} className="card-title">
          여행
        </h2>
        <Button variant="ghost" icon="plus" onClick={onAdd}>
          여행 추가
        </Button>
      </div>
      {shown.length === 0 ? (
        <p className={styles.muted}>
          {pastCount > 0
            ? '다가오는 여행이 없어요.'
            : '여행 예산을 잡아 두면 미리 낸 항공권 · 숙소비까지 한눈에 보고, 남은 예산을 12개월 예측에 넣어 드려요.'}
        </p>
      ) : (
        <ul className={styles.tripList}>
          {shown.map((s) => (
            <li key={s.trip.id}>
              <TripRow status={s} />
            </li>
          ))}
        </ul>
      )}
      {trips.length > shown.length ? (
        <Link href="/events/trips" className={styles.moreLink}>
          여행 모두 보기 ({trips.length}개)
          <Icon name="chevron-right" size={16} />
        </Link>
      ) : null}
    </Card>
  );
}

/** 여행 한 줄: 이름 · 기간 · 남은 날 / 막대 / 쓴 돈 · 남은 예산 */
export function TripRow({ status: s }: { status: TripStatus }) {
  const tone = spendTone(s.spent, s.budget);
  return (
    <Link
      href={tripHref(s.trip.id)}
      className={styles.tripRow}
      // 막대 · 숫자를 한 번씩만 읽도록 짧은 이름을 준다
      aria-label={`${s.trip.name}, ${tripPhaseText(s)}, ${tripPeriodText(s.trip)}, ${formatWon(s.budget)} 중 ${formatWon(s.spent)} 썼어요, ${remainingText(s.remaining)}`}
    >
      <span className={styles.tripIcon} aria-hidden>
        <Icon name="plane" size={20} />
      </span>
      <span className={styles.tripMain}>
        <span className={styles.tripTop}>
          <span className={styles.tripName}>{s.trip.name}</span>
          <span className={styles.tripPhase}>{tripPhaseText(s)}</span>
        </span>
        <span className={styles.tripPeriod}>{tripPeriodText(s.trip)}</span>
        <ProgressBar
          value={s.spent}
          max={s.budget}
          tone={tone}
          track="subtle"
          label={`${s.trip.name} 예산 사용`}
          valueText={`${formatWon(s.budget)} 중 ${formatWon(s.spent)}`}
          className={styles.tripBar}
          decorative
        />
        <span className={styles.tripNums}>
          <span>
            {formatWon(s.spent)} / {formatWon(s.budget)}
          </span>
          <span className={cx(s.remaining < 0 && styles.over)}>
            {s.remaining < 0 ? <Icon name="alert-triangle" size={16} /> : null}
            {remainingText(s.remaining)}
          </span>
        </span>
      </span>
      <Icon name="chevron-right" size={20} className={styles.chev} />
    </Link>
  );
}
