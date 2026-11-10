'use client';

import { useId, useMemo, useState } from 'react';
import { categoryGroupForAccount, livingAccountIds, monthOf, rankCategories } from '@/domain';
import type { Category, Id } from '@/domain/types';
import { useLedger } from '@/state';
import { Chip, ChipGroup, isIconName } from '@/ui';

export interface CategoryPickerProps {
  value: Id | null;
  onChange: (id: Id | null) => void;
  /** 고른 통장: 그 통장의 묶음(생활비 / 이벤트) 카테고리만 먼저 보여요 */
  accountId?: Id | null;
  /** 이 카테고리도 고를 수 있게 (지운 · 숨긴 카테고리를 지금 지출이 쓰고 있을 때) */
  extra?: Category | null;
  /** 다시 누르면 고른 것을 풀어요 (기본 true) */
  allowClear?: boolean;
  disabled?: boolean;
  label?: string;
}

const iconOf = (c: Category) => (isIconName(c.icon) ? c.icon : 'dots');

/**
 * 기록 창 카테고리 칩: 최근 90일 자주 쓴 6개(가까운 기록일수록 무겁게, 같으면 정한 순서)를 먼저,
 * 고른 통장의 묶음만. [더 보기]를 누르면 같은 자리에서 나머지를 펼쳐요. 숨긴 카테고리는 빠지고, 고른 카테고리는 늘 보여요
 */
export function CategoryPicker({ value, onChange, accountId = null, extra = null, allowClear = true, disabled, label = '카테고리' }: CategoryPickerProps) {
  const ledger = useLedger();
  const restId = `cat-rest-${useId().replace(/:/g, '')}`;
  const [open, setOpen] = useState(false);
  const data = ledger.data;
  const group = useMemo(() => {
    if (!data || !accountId) return null;
    const acc = data.accounts.find((a) => a.id === accountId);
    return categoryGroupForAccount(acc, livingAccountIds(data, monthOf(ledger.today)), accountId);
  }, [data, accountId, ledger.today]);
  const { top, rest } = useMemo(() => {
    const all = data?.categories ?? [];
    const list = extra && !all.some((c) => c.id === extra.id) ? [...all, extra] : all;
    return rankCategories(list, ledger.categoryScores, { group, selectedId: value });
  }, [data, extra, ledger.categoryScores, group, value]);

  const chip = (c: Category) => (
    <Chip
      key={c.id}
      icon={iconOf(c)}
      selected={value === c.id}
      disabled={disabled}
      onClick={() => onChange(value === c.id && allowClear ? null : c.id)}
    >
      {c.name}
    </Chip>
  );

  return (
    <>
      <ChipGroup label={label}>
        {top.map(chip)}
        {rest.length > 0 ? (
          <Chip
            icon={open ? 'chevron-up' : 'chevron-down'}
            aria-expanded={open}
            aria-controls={restId}
            disabled={disabled}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? '접기' : `더 보기 (${rest.length})`}
          </Chip>
        ) : null}
      </ChipGroup>
      {rest.length > 0 ? (
        <div id={restId} hidden={!open}>
          {open ? <ChipGroup label={`${label} 더 보기`}>{rest.map(chip)}</ChipGroup> : null}
        </div>
      ) : null}
    </>
  );
}
