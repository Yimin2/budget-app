'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { SegmentedControl } from '@/ui';
import { AccountsScreen } from './_accounts/AccountsScreen';
import { ExpensesScreen } from './_expenses/ExpensesScreen';
import { TransfersScreen } from './TransfersScreen';

export type HistoryTab = 'expenses' | 'transfers' | 'accounts';

const TABS: { value: HistoryTab; label: string }[] = [
  { value: 'expenses', label: '지출' },
  { value: 'transfers', label: '이체' },
  { value: 'accounts', label: '통장 잔액' },
];

/** ?tab= 값 → 탭 (모르는 값이면 지출) */
export function parseHistoryTab(value: string | null | undefined): HistoryTab {
  return TABS.some((t) => t.value === value) ? (value as HistoryTab) : 'expenses';
}

/** 내역 탭 주소: 지출은 '/history', 나머지는 '/history?tab=…' */
export function historyHref(tab: HistoryTab): string {
  return tab === 'expenses' ? '/history' : `/history?tab=${tab}`;
}

/** 통계 화면 주소 (내역의 네 번째 탭, 2026-11 하단 메뉴에서 옮김) */
export const STATS_TAB_HREF = '/history/stats';

/** 내역 위쪽 탭: 지출 · 이체 · 통장 잔액 · 통계. 통계는 /history/stats 로 가요 */
export function HistorySwitcher({ value }: { value: HistoryTab | 'stats' }) {
  const router = useRouter();
  const options: { value: HistoryTab | 'stats'; label: string }[] = [...TABS, { value: 'stats', label: '통계' }];
  return (
    <SegmentedControl
      ariaLabel="내역 종류"
      block
      options={options}
      value={value}
      onChange={(t) => (t === 'stats' ? router.push(STATS_TAB_HREF) : router.replace(historyHref(t), { scroll: false }))}
    />
  );
}

/**
 * '/history' 내역: 지출 · 이체 · 통장 잔액 · 통계를 위쪽 탭으로 바꿔 봐요 (통계는 /history/stats).
 * ?tab=transfers · ?tab=accounts (&id=<통장 id> 면 통장 하나), 지출은 ?month= · ?account= · ?category= · ?new=1
 */
export function HistoryScreen() {
  const params = useSearchParams();
  const tab = parseHistoryTab(params?.get('tab'));
  const accountId = params?.get('id') || null;

  const switcher = <HistorySwitcher value={tab} />;

  if (tab === 'accounts') return <AccountsScreen switcher={accountId ? undefined : switcher} />;
  if (tab === 'transfers') return <TransfersScreen switcher={switcher} />;
  return <ExpensesScreen switcher={switcher} />;
}
