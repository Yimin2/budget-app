import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '../../_components/PageSkeleton';
import { StatsScreen } from './StatsScreen';

export const metadata: Metadata = { title: '통계' };

/** '/history/stats' 통계 — 하단 메뉴 · 사이드바의 통계 칸 (?month=YYYY-MM 으로 볼 달) */
export default function StatsPage() {
  return (
    <Suspense fallback={<PageSkeleton label="통계를 불러오는 중이에요" />}>
      <StatsScreen />
    </Suspense>
  );
}
