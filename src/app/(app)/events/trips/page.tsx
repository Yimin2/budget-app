import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '../../_components/PageSkeleton';
import { TripScreen } from './TripScreen';

export const metadata: Metadata = { title: '여행' };

/** '/events/trips' 여행 — ?id=<여행 id> 로 여행 하나를 자세히 봐요 */
export default function TripsPage() {
  return (
    <Suspense fallback={<PageSkeleton label="여행을 불러오는 중이에요" />}>
      <TripScreen />
    </Suspense>
  );
}
