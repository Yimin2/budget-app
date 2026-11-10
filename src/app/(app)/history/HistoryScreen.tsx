'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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

/**
 * '/history' 내역: 지출 · 이체 · 통장 잔액을 한 화면에서 탭으로 바꿔 봐요. 통계(/history/stats)는 하단 메뉴 · 사이드바의 통계 칸으로 가요.
 * ?tab=transfers · ?tab=accounts (&id=<통장 id> 면 통장 하나), 지출은 ?month= · ?account= · ?new=1
 */
export function HistoryScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? '/history';
  const tab = parseHistoryTab(params?.get('tab'));
  const accountId = params?.get('id') || null;

  const switcher = (
    <SegmentedControl
      ariaLabel="내역 종류"
      block
      options={TABS}
      value={tab}
      onChange={(t) => router.replace(t === 'expenses' ? pathname : `${pathname}?tab=${t}`, { scroll: false })}
    />
  );

  if (tab === 'accounts') return <AccountsScreen switcher={accountId ? undefined : switcher} />;
  if (tab === 'transfers') return <TransfersScreen switcher={switcher} />;
  return <ExpensesScreen switcher={switcher} />;
}
