'use client';

import { useState } from 'react';
import type { Account, LedgerData } from '@/domain/types';
import { SegmentedControl } from '@/ui';
import { peopleOptions } from '../../_components/PersonPicker';

/** 사람 탭 하나 ('' = 함께 쓰는 통장) */
export interface OwnerGroup {
  value: string;
  label: string;
}

const ALL = 'all';

/** 통장 주인 키: 주인 이메일(소문자) → 'name:주인 이름' → '' (함께) */
export function ownerKeyOf(account: Pick<Account, 'ownerEmail' | 'ownerName'> | null | undefined): string {
  if (!account) return '';
  const email = account.ownerEmail?.trim().toLowerCase();
  if (email) return email;
  const name = account.ownerName?.trim();
  return name ? `name:${name}` : '';
}

/** 키 목록 → 탭 (나온 순서, 함께는 맨 뒤) */
export function ownerGroups(keys: string[], data: LedgerData): OwnerGroup[] {
  const people = peopleOptions(data);
  const seen: string[] = [];
  for (const k of keys) if (!seen.includes(k)) seen.push(k);
  seen.sort((a, b) => (a === '' ? 1 : 0) - (b === '' ? 1 : 0));
  return seen.map((k) => {
    if (k === '') return { value: '__shared', label: '함께' };
    if (k.startsWith('name:')) return { value: k, label: k.slice(5) };
    const p = people.find((x) => x.email.toLowerCase() === k);
    const acc = data.accounts.find((a) => a.ownerEmail?.trim().toLowerCase() === k && a.ownerName?.trim());
    return { value: k, label: p?.name || acc?.ownerName?.trim() || k.split('@')[0] || k };
  });
}

/**
 * 사람별로 나눠 보기: 두 사람 이상이면 [모두 · 민지 · 준호 · 함께] 탭을 보여 줘요.
 * initial 을 주면 그 사람부터 (예: 내 생활비)
 */
export function useOwnerFilter(keys: string[], data: LedgerData, initial: string = ALL) {
  const groups = ownerGroups(keys, data);
  const [tab, setTab] = useState(initial === '' ? '__shared' : initial);
  const show = groups.length > 1;
  const active = show && (tab === ALL || groups.some((g) => g.value === tab)) ? tab : ALL;
  const matches = (key: string) => active === ALL || (key === '' ? active === '__shared' : key === active);
  /** 새로 만들 때 고를 사람 키 (모두면 null) */
  const selected = active === ALL ? null : active === '__shared' ? '' : active;
  return { groups, show, active, setTab, matches, selected };
}

/** 사람 탭 (useOwnerFilter 와 함께) */
export function OwnerTabs({
  filter,
  label,
  allLabel = '모두',
}: {
  filter: ReturnType<typeof useOwnerFilter>;
  label: string;
  /** false 면 '모두' 탭을 빼요 */
  allLabel?: string | false;
}) {
  if (!filter.show) return null;
  const options = [...(allLabel ? [{ value: ALL, label: allLabel }] : []), ...filter.groups];
  return <SegmentedControl ariaLabel={label} block options={options} value={filter.active} onChange={filter.setTab} />;
}
