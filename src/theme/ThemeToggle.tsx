'use client';

import { useRef, type KeyboardEvent } from 'react';
import { Icon, type IconName } from '@/ui/Icon';
import { cx } from '@/ui/cx';
import type { ThemeMode } from './script';
import { useTheme } from './ThemeProvider';

const OPTIONS: { value: ThemeMode; label: string; icon: IconName }[] = [
  { value: 'system', label: '시스템', icon: 'monitor' },
  { value: 'light', label: '라이트', icon: 'sun' },
  { value: 'dark', label: '다크', icon: 'moon' },
];

export interface ThemeToggleProps {
  /** 글자도 함께 보여요 (설정 화면). 기본은 아이콘만 (사이드바) */
  showLabels?: boolean;
  className?: string;
}

/** 시스템 / 라이트 / 다크 고르기 */
export function ThemeToggle({ showLabels = false, className }: ThemeToggleProps) {
  const { mode, setMode } = useTheme();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent, i: number) {
    let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % OPTIONS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + OPTIONS.length) % OPTIONS.length;
    if (n < 0) return;
    e.preventDefault();
    refs.current[n]?.focus();
    setMode(OPTIONS[n]!.value);
  }

  return (
    <div role="radiogroup" aria-label="화면 테마" className={cx('theme', showLabels && 'labeled', className)}>
      {OPTIONS.map((o, i) => {
        const on = mode === o.value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={showLabels ? undefined : o.label}
            title={showLabels ? undefined : o.label}
            tabIndex={on ? 0 : -1}
            onClick={() => setMode(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <Icon name={o.icon} size={20} />
            {showLabels ? o.label : null}
          </button>
        );
      })}
    </div>
  );
}
