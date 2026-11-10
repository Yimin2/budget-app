import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '../../_components/PageSkeleton';
import { StatsScreen } from './StatsScreen';

export const metadata: Metadata = { title: '통계' };

/** '/history/stats' 통계 — 내역 안 [내역 · 통계]의 통계 (?month=YYYY-MM 으로 볼 달) */
export default function StatsPage() {
  return (
    <Suspense fallback={<PageSkeleton label="통계를 불러오는 중이에요" />}>
      <StatsScreen />
    </Suspense>
  );
}
