'use client';

import { useEffect } from 'react';

/** 맨 바깥 틀(layout)에서 오류가 났을 때. 앱 스타일을 못 쓸 수 있어 글자와 버튼만 둬요 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="ko">
      <body style={{ margin: 0, minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
        <main>
          <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>앱을 열지 못했어요</h1>
          <p style={{ margin: '0 0 16px', lineHeight: 1.6 }}>가계부에 저장된 내용은 그대로예요. 다시 시도해 주세요.</p>
          <button type="button" onClick={reset} style={{ minHeight: 44, padding: '0 20px', fontSize: 16, fontWeight: 700, borderRadius: 12, border: '1px solid currentColor', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>
            다시 시도
          </button>
        </main>
      </body>
    </html>
  );
}
