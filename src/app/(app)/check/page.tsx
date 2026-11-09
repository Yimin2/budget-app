import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CheckScreen } from '../_home/CheckScreen';
import { CheckLoading } from '../_home/CheckView';

export const metadata: Metadata = { title: '사도 돼?' };

/** '/check' 사도 돼? — ?amount=12000 (또는 '2만'), ?source=event 로 미리 채울 수 있어요 */
export default function CheckPage() {
  return (
    <Suspense fallback={<CheckLoading />}>
      <CheckScreen />
    </Suspense>
  );
}
