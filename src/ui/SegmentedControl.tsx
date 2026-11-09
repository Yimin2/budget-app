'use client';

import { useRef, type KeyboardEvent } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 무엇을 고르는지 (예: '어느 돈으로 살까요') */
  ariaLabel: string;
  /** 너비 100%로 칸을 똑같이 나눠요 */
  block?: boolean;
  className?: string;
}

/** 알약 모양 선택 (라디오 그룹). 화살표 키로 옮겨요 */
export function SegmentedControl<T extends string>({ options, value, onChange, ariaLabel, block, className }: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const pos = enabled.indexOf(index);
    let nextPos = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextPos = (pos + 1) % enabled.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextPos = (pos - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') nextPos = 0;
    else if (e.key === 'End') nextPos = enabled.length - 1;
    if (nextPos < 0) return;
    e.preventDefault();
    const next = enabled[nextPos]!;
    refs.current[next]?.focus();
    onChange(options[next]!.value);
  }

  const selectedIndex = options.findIndex((o) => o.value === value);
  const focusIndex = selectedIndex >= 0 ? selectedIndex : (enabled[0] ?? 0);

  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cx('pill', block && 'block', className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={i === focusIndex ? 0 : -1}
            disabled={o.disabled}
            className={cx(on && 'on')}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {o.icon ? <Icon name={o.icon} size={16} /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
