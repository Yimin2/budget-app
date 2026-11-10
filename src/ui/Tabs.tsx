'use client';

import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
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
  const listRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLElement>(null);
  const activeIndex = items.findIndex((t) => t.value === value);

  // 밑줄이 눌린 탭으로 미끄러져요. 처음 자리 잡을 때는 움직이지 않아요 (ink-ready 는 다음 프레임에)
  useLayoutEffect(() => {
    const list = listRef.current;
    const ink = inkRef.current;
    if (!list || !ink) return;
    const place = () => {
      const tab = refs.current[activeIndex];
      if (!tab) {
        list.classList.remove('has-ink');
        return;
      }
      ink.style.setProperty('--x', `${tab.offsetLeft}px`);
      ink.style.width = `${tab.offsetWidth}px`;
      list.classList.add('has-ink');
    };
    place();
    let raf = 0;
    if (!list.classList.contains('ink-ready') && typeof requestAnimationFrame === 'function') {
      raf = requestAnimationFrame(() => list.classList.add('ink-ready'));
    }
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    ro?.observe(list);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [activeIndex, items.length]);

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
      <div role="tablist" aria-label={ariaLabel} className="tabs" ref={listRef}>
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
        <i className="tab-ink" aria-hidden ref={inkRef} />
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
