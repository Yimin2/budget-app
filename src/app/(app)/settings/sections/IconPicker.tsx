'use client';

import { useId, useRef, type KeyboardEvent } from 'react';
import { Icon } from '@/ui';
import { CATEGORY_ICON_CHOICES } from '../helpers';

/** 카테고리 아이콘 고르기 (라디오 그룹, 화살표 키로 옮겨요) */
export function IconPicker({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const labelId = `ip${useId().replace(/:/g, '')}`;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const list = CATEGORY_ICON_CHOICES.some((c) => c.name === value)
    ? CATEGORY_ICON_CHOICES
    : [{ name: value, label: '지금 아이콘' }, ...CATEGORY_ICON_CHOICES];
  const selected = Math.max(
    0,
    list.findIndex((c) => c.name === value),
  );

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = list.length - 1;
    if (n < 0) return;
    e.preventDefault();
    refs.current[n]?.focus();
    onChange(list[n]!.name);
  }

  return (
    <div className="stack gap-2">
      <span id={labelId} className="st-icons-label">
        아이콘
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="st-icons">
        {list.map((c, i) => (
          <button
            key={c.name}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={i === selected}
            aria-label={c.label}
            title={c.label}
            tabIndex={i === selected ? 0 : -1}
            onClick={() => onChange(c.name)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <Icon name={c.name} size={20} />
          </button>
        ))}
      </div>
    </div>
  );
}
