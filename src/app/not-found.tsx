import type { Metadata } from 'next';
import { Button, EmptyState } from '@/ui';

export const metadata: Metadata = { title: '찾을 수 없어요' };

export default function NotFound() {
  return (
    <main id="main" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 'var(--space-5)' }}>
      <EmptyState
        title="이 주소에는 화면이 없어요"
        description="주소가 바뀌었거나 잘못 들어왔을 수 있어요."
        action={<Button href="/">홈으로</Button>}
      />
    </main>
  );
}
