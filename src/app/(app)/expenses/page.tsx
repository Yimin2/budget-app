import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '../_components/PageSkeleton';
import { ExpensesScreen } from './ExpensesScreen';

export const metadata: Metadata = { title: '지출' };

/** '/expenses' 지출 — ?month=YYYY-MM · ?account=<통장 id> · ?new=1 */
export default function ExpensesPage() {
  return (
    <Suspense fallback={<PageSkeleton label="지출을 불러오는 중이에요" />}>
      <ExpensesScreen />
    </Suspense>
  );
}
