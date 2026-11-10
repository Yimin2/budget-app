import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '../_components/PageSkeleton';
import { HistoryScreen } from './HistoryScreen';

export const metadata: Metadata = { title: '내역' };

/** '/history' 내역 — 지출 · 이체 · 통장 잔액 (?tab=transfers · ?tab=accounts) */
export default function HistoryPage() {
  return (
    <Suspense fallback={<PageSkeleton label="내역을 불러오는 중이에요" />}>
      <HistoryScreen />
    </Suspense>
  );
}
