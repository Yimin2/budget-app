'use client';

import { useEffect } from 'react';

/**
 * '/budget#st-installment' 처럼 들어오면 그 칸으로 스크롤하고 포커스를 옮겨요 (긴 화면 맨 위에 떨어지지 않게).
 * 같은 화면에서 주소의 # 만 바뀌어도 따라가요
 */
export function HashTarget() {
  useEffect(() => {
    function go() {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView?.({ block: 'start' });
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    }
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, []);
  return null;
}
