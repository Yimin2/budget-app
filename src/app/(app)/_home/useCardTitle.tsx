'use client';

import { useId } from 'react';

/** Card 제목을 영역 이름으로 이어 줘요 (화면 읽기 프로그램의 영역 목록) */
export function useCardTitle(text: string) {
  const id = useId();
  return { title: <span id={id}>{text}</span>, 'aria-labelledby': id } as const;
}

/* ───────── 오늘 써도 되는 돈 ───────── */
