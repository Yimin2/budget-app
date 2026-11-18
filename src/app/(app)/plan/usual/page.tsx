import type { Metadata } from 'next';
import { UsualScreen } from './UsualScreen';

export const metadata: Metadata = { title: '큰 지출 빼기' };

/** '/plan/usual' 한 번뿐이었던 큰 지출 빼기 (이벤트 화면 '평소 쓰는 돈' 카드의 링크) */
export default function UsualPage() {
  return <UsualScreen />;
}
