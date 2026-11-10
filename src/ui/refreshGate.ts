'use client';

import { useEffect } from 'react';

/**
 * 자동 새로고침을 잠시 멈추는 문 (PLAN 7). 창 · 시트가 열려 있거나 고치던 입력이 있으면 멈추고, 닫히면 미뤄 둔 새로고침을 해요.
 * Dialog 는 열릴 때 스스로 잡아요. 창 밖에서 고치던 입력은 useRefreshHold(dirty) 로 잡아 주세요.
 */
let holds = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const l of [...listeners]) l();
}

/** 잡기. 돌려준 함수로 놓아요 (두 번 불러도 한 번만 놓여요) */
export function holdRefresh(): () => void {
  holds += 1;
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    notify();
  };
}

/** 지금 입력 칸에서 글을 쓰고 있는지 (포커스가 입력 · 고르기 · 글상자 · 편집 영역에 있음) */
function editingNow(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'].includes(type);
}

/** 자동 새로고침을 멈춰야 하는지 */
export function isRefreshHeld(): boolean {
  if (holds > 0) return true;
  if (typeof document !== 'undefined' && document.querySelector('[role="dialog"]')) return true;
  return editingNow();
}

/** 잡힘 상태가 바뀌거나 입력 칸에서 포커스가 빠질 때 불러요. 구독 해제 함수를 돌려줘요 */
export function onRefreshGateChange(listener: () => void): () => void {
  listeners.add(listener);
  const onFocusOut = () => setTimeout(listener, 0);
  if (typeof document !== 'undefined') document.addEventListener('focusout', onFocusOut);
  return () => {
    listeners.delete(listener);
    if (typeof document !== 'undefined') document.removeEventListener('focusout', onFocusOut);
  };
}

/** active 인 동안 자동 새로고침을 멈춰요 (고치던 양식 등) */
export function useRefreshHold(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return holdRefresh();
  }, [active]);
}
