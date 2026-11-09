import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '../_components/PageSkeleton';
import { AccountsScreen } from './AccountsScreen';

export const metadata: Metadata = { title: '통장' };

/** '/accounts' 통장 — ?id=<통장 id> 로 통장 하나를 자세히 봐요 */
export default function AccountsPage() {
  return (
    <Suspense fallback={<PageSkeleton label="통장을 불러오는 중이에요" />}>
      <AccountsScreen />
    </Suspense>
  );
}
