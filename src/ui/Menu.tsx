'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Button, type ButtonVariant } from './Button';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';
import styles from './Menu.module.css';

export interface MenuItem {
  id: string;
  label: string;
  /** 이름 아래 한 줄 설명 (화면 읽기에서는 설명으로 읽어요) */
  hint?: string;
  icon?: IconName;
  /** 이름 옆 작은 개수 표시 (예: '3건') */
  badge?: string;
  disabled?: boolean;
  onSelect: () => void;
}

export interface MenuButtonProps {
  /** 버튼 글자 */
  label: string;
  icon?: IconName;
  variant?: ButtonVariant;
  items: MenuItem[];
  /** 메뉴 이름 (없으면 버튼 글자) */
  menuLabel?: string;
  className?: string;
  /** 버튼 요소 (메뉴로 연 칸을 닫을 때 버튼으로 포커스를 돌려줄 수 있게) */
  buttonRef?: RefObject<HTMLButtonElement | null>;
}

type Place = 'down' | 'up';

/**
 * 버튼에 붙는 작은 메뉴 (창 아님). WAI-ARIA 메뉴 버튼 패턴:
 * 버튼 aria-haspopup="menu" · aria-expanded, 메뉴 role="menu" · 항목 role="menuitem".
 * ↑ · ↓ (돌아가요) · Home · End 로 옮기고 Enter · Space 로 고르고 Esc 로 닫아 버튼으로 돌아가요. Tab · 바깥 누르기도 닫아요.
 * 항목을 고르면 메뉴를 닫고 버튼으로 포커스를 돌린 뒤 onSelect 를 불러요 (onSelect 가 포커스를 옮겨도 돼요).
 * 버튼 오른쪽 끝에 맞춰 아래로 열고, 아래 자리가 모자라면 위로 열어요
 */
export function MenuButton({ label, icon, variant = 'primary', items, menuLabel, className, buttonRef }: MenuButtonProps) {
  const ids = useId().replace(/:/g, '');
  const buttonId = `${ids}-btn`;
  const menuId = `${ids}-menu`;
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place>('down');
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** 열 때 처음 포커스할 항목 */
  const startRef = useRef<'first' | 'last'>('first');

  // Button 은 ref 를 받지 않아서 감싼 div 에서 찾아요
  useLayoutEffect(() => {
    btnRef.current = wrapRef.current?.querySelector<HTMLButtonElement>(':scope > button') ?? null;
    if (buttonRef) buttonRef.current = btnRef.current;
  }, [buttonRef]);

  const itemEls = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) btnRef.current?.focus();
  }, []);

  // 열리면 자리를 정하고 첫(또는 마지막) 항목으로 포커스
  useLayoutEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    const menu = menuRef.current;
    if (btn && menu && typeof window !== 'undefined') {
      const r = btn.getBoundingClientRect();
      const h = menu.offsetHeight;
      const below = window.innerHeight - r.bottom;
      setPlace(h > 0 && below < h + 16 && r.top > below ? 'up' : 'down');
    }
    const list = itemEls();
    (startRef.current === 'last' ? list[list.length - 1] : list[0])?.focus();
  }, [open]);

  // 바깥을 누르면 닫아요 (포커스는 누른 곳으로)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      if (wrapRef.current && e.target instanceof Node && !wrapRef.current.contains(e.target)) close(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, close]);

  const openWith = (start: 'first' | 'last') => {
    startRef.current = start;
    setOpen(true);
  };

  function onButtonKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openWith(e.key === 'ArrowDown' ? 'first' : 'last');
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      close(true);
    }
  }

  function select(item: MenuItem) {
    if (item.disabled) return;
    close(true);
    item.onSelect();
  }

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const list = itemEls();
    if (list.length === 0) return;
    const at = list.indexOf(document.activeElement as HTMLElement);
    const move = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    switch (e.key) {
      case 'ArrowDown':
        return move(at + 1);
      case 'ArrowUp':
        return move(at < 0 ? list.length - 1 : at - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(list.length - 1);
      case 'Escape':
        e.preventDefault();
        return close(true);
      case 'Tab':
        // 포커스는 원래대로 다음 칸으로 가고 메뉴만 닫아요
        return close(false);
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const item = items.find((x) => x.id === (document.activeElement as HTMLElement | null)?.dataset.itemId);
        if (item) select(item);
        return;
      }
    }
  }

  return (
    <div ref={wrapRef} className={cx(styles.wrap, className)}>
      <Button
        id={buttonId}
        variant={variant}
        icon={icon}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openWith('first'))}
        onKeyDown={onButtonKey}
      >
        {label}
      </Button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={menuLabel ? undefined : buttonId}
          aria-label={menuLabel}
          aria-orientation="vertical"
          className={cx(styles.menu, place === 'up' && styles.up)}
          onKeyDown={onMenuKey}
        >
          {items.map((item) => (
            <MenuRow key={item.id} ids={ids} item={item} onSelect={() => select(item)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MenuRow({ ids, item, onSelect }: { ids: string; item: MenuItem; onSelect: () => void }) {
  const labelId = `${ids}-${item.id}-label`;
  const hintId = item.hint ? `${ids}-${item.id}-hint` : undefined;
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      data-item-id={item.id}
      aria-labelledby={labelId}
      aria-describedby={hintId}
      aria-disabled={item.disabled || undefined}
      className={styles.item}
      onClick={onSelect}
    >
      {item.icon ? (
        <span className={styles.icon} aria-hidden>
          <Icon name={item.icon} size={20} />
        </span>
      ) : null}
      <span className={styles.text}>
        <span id={labelId} className={styles.label}>
          {item.label}
          {item.badge ? (
            <>
              <span className="sr-only">, </span>
              <span className={styles.badge}>{item.badge}</span>
            </>
          ) : null}
        </span>
        {item.hint ? (
          <span id={hintId} className={styles.hint}>
            {item.hint}
          </span>
        ) : null}
      </span>
    </button>
  );
}
