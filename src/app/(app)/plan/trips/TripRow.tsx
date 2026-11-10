'use client';

import Link from 'next/link';
import { formatWon, tripPeriodText } from '@/domain';
import type { TripStatus } from '@/domain';
import { Icon, ProgressBar, cx } from '@/ui';
import { remainingText, spendTone, tripHref, tripPhaseText } from './selectors';
import styles from './trips.module.css';

/** 여행 화면 목록의 여행 한 줄: 이름 · 기간 · 남은 날 / 막대 / 쓴 돈 · 남은 예산 (이벤트 화면은 '일정' 카드에 섞어 보여요) */
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
          <span className={cx(tone === 'danger' && styles.toneDanger, tone === 'warning' && styles.toneWarning)}>
            {tone === 'danger' ? <Icon name="alert-triangle" size={16} /> : tone === 'warning' ? <Icon name="alert-circle" size={16} /> : null}
            {remainingText(s.remaining)}
          </span>
        </span>
      </span>
      <Icon name="chevron-right" size={20} className={styles.chev} />
    </Link>
  );
}
