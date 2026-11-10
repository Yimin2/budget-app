'use client';

import { useEffect, useState } from 'react';

/**
 * 주소의 # 가 ids 중 하나면 접힌 칸을 펼치고 그 칸으로 스크롤 · 포커스해요 ('/budget#st-fixed' · '#st-rules').
 * 같은 화면에서 # 만 바뀌어도 따라가요. enabled 가 false 면 아무것도 하지 않아요
 */
export function useHashOpen(ids: readonly string[], enabled = true): [boolean, (open: boolean | ((o: boolean) => boolean)) => void] {
  const [open, setOpen] = useState(false);
  const key = ids.join('|');
  useEffect(() => {
    if (!enabled) return;
    const list = key.split('|');
    function go() {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id || !list.includes(id)) return;
      setOpen(true);
      // 펼친 다음 그 칸으로 (HashTarget 은 펼치기 전에 돌 수 있어요)
      requestAnimationFrame(() => {
        const el = document.getElementById(id);
        if (!el) return;
        el.scrollIntoView?.({ block: 'start' });
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
        el.focus({ preventScroll: true });
      });
    }
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, [key, enabled]);
  return [open, setOpen];
}
