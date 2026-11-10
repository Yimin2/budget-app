'use client';

import { useId } from 'react';
import { hasSpenderChoice, type Spender } from '@/domain';
import { useLedger } from '@/state';
import { Chip, ChipGroup } from '@/ui';

export interface SpenderFieldProps {
  /** 고른 사람 (spenders 의 key) */
  value: string | null;
  onChange: (key: string, spender: Spender) => void;
  disabled?: boolean;
  /** 아래 안내 문구 (없으면 기본 문구) */
  hint?: string;
}

/**
 * '누가 썼나요?' (PLAN 4-14). 사람마다 생활비 통장이 있을 때만 보여요 (고르면 예산이 달라질 때).
 * 고른 사람의 생활비 통장 예산으로 들어가요. 이벤트통장 지출은 함께 쓰는 돈이라 그대로예요
 */
export function SpenderField({ value, onChange, disabled, hint }: SpenderFieldProps) {
  const ledger = useLedger();
  const labelId = useId();
  const spenders = ledger.spenders ?? [];
  if (!hasSpenderChoice(spenders)) return null;
  return (
    <div className="stack gap-2" role="group" aria-labelledby={labelId}>
      <span className="label" id={labelId}>
        누가 썼나요?
      </span>
      <ChipGroup label="누가 썼나요">
        {spenders.map((s) => (
          <Chip key={s.key} selected={value === s.key} onClick={() => onChange(s.key, s)} disabled={disabled}>
            {s.key === ledger.mySpenderKey ? `${s.name} (나)` : s.name}
          </Chip>
        ))}
      </ChipGroup>
      <span className="hint">{hint ?? '고른 사람의 생활비 예산으로 계산해요. 이벤트통장 지출은 함께 쓰는 돈이에요.'}</span>
    </div>
  );
}
