'use client';

import { useRouter } from 'next/navigation';
import { SegmentedControl } from '@/ui';
import { STATS_HREF } from '../_components/nav';

export type HistoryView = 'list' | 'stats';

const VIEWS: { value: HistoryView; label: string }[] = [
  { value: 'list', label: '내역' },
  { value: 'stats', label: '통계' },
];

/** 내역 맨 위 [내역 · 통계]: 내역(/history: 지출 · 이체 · 통장 잔액) ↔ 통계(/history/stats) */
export function HistoryViewSwitch({ value }: { value: HistoryView }) {
  const router = useRouter();
  return (
    <SegmentedControl
      ariaLabel="내역 · 통계"
      block
      options={VIEWS}
      value={value}
      onChange={(v) => {
        if (v !== value) router.push(v === 'stats' ? STATS_HREF : '/history', { scroll: false });
      }}
    />
  );
}
