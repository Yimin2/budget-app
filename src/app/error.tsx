'use client';

import { useEffect } from 'react';
import { Button, EmptyState } from '@/ui';

/** 화면을 그리다 오류가 나면 빈 화면 대신 보여요. 가계부 데이터는 그대로예요 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 'var(--space-5)' }}>
      <EmptyState
        icon="alert-triangle"
        title="화면을 보여 주지 못했어요"
        description="가계부에 저장된 내용은 그대로예요. 다시 시도해도 안 되면 홈으로 가서 다시 열어 주세요."
        action={
          <>
            <Button onClick={reset}>다시 시도</Button>
            <Button href="/" variant="secondary">
              홈으로
            </Button>
          </>
        }
      />
    </main>
  );
}
