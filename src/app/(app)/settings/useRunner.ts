'use client';

import { useCallback, useState } from 'react';
import { useToast } from '@/ui';

/**
 * 저장 동작 실행기: 어떤 버튼이 저장 중인지(busy) 기억하고, 실패하면 오류 알림을 띄워요.
 * run 은 성공하면 true.
 */
export function useRunner() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async (key: string, fn: () => Promise<unknown>, success?: string): Promise<boolean> => {
      setBusy(key);
      try {
        await fn();
        if (success) toast.success(success);
        return true;
      } catch (e) {
        toast.error(e instanceof Error && e.message ? e.message : '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요');
        return false;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { busy, run };
}
