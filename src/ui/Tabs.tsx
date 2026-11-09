'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  /** 주면 선택된 탭 아래에 패널로 그려요 */
  content?: ReactNode;
}

export interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

/** 밑줄 탭. 패널(content)을 주면 tabpanel 까지 연결해요 */
export function Tabs<T extends string>({ items, value, onChange, ariaLabel, className }: TabsProps<T>) {
  const base = useId().replace(/:/g, '');
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const hasPanels = items.some((t) => t.content !== undefined);
  const current = items.find((t) => t.value === value);

  function onKeyDown(e: KeyboardEvent, index: number) {
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(items[next]!.value);
  }

  return (
    <div className={className}>
      <div role="tablist" aria-label={ariaLabel} className="tabs">
        {items.map((t, i) => {
          const on = t.value === value;
          return (
            <button
              key={t.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${t.value}`}
              aria-selected={on}
              aria-controls={hasPanels ? `${base}-panel-${t.value}` : undefined}
              tabIndex={on ? 0 : -1}
              className={cx('tab', on && 'on')}
              onClick={() => onChange(t.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {hasPanels && current ? (
        <div
          role="tabpanel"
          id={`${base}-panel-${current.value}`}
          aria-labelledby={`${base}-tab-${current.value}`}
          tabIndex={0}
          style={{ paddingTop: 'var(--space-4)' }}
        >
          {current.content}
        </div>
      ) : null}
    </div>
  );
}
