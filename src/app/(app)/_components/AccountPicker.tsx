'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Account, Id } from '@/domain/types';
import { useLedger, useSession } from '@/state';
import { ACCOUNT_ROLE_ICON, Icon, Money, cx, useFieldControl } from '@/ui';
import {
  accountOwner, accountShortLabel, baseAccountName, groupAccounts, meKeyOf, pushRecentAccount, readRecentAccounts,
} from './accountGroups';
import './screens.css';

export interface AccountPickerProps {
  value: string;
  onChange: (id: Id) => void;
  /** 고를 수 있는 통장 (화면마다 거른 목록 그대로) */
  accounts: Account[];
  /** 고르지 않았을 때 문구 (기본 '통장 고르기') */
  placeholder?: string;
  /** 묶음 안에서 앞에 둘 통장 (예: 수입 기록 → 수입통장) */
  prefer?: (a: Account) => boolean;
  disabled?: boolean;
  id?: string;
}

/**
 * 통장 고르기: 닫히면 '아이콘 + 생활비 · 민지' 단추, 누르면 그 자리에 펼쳐지는 목록(창 없음).
 * 나 → 다른 사람 → 함께로 묶고, 줄마다 역할 아이콘 · 이름 · 지금 잔액(이메일 없음). 최근 고른 통장이 묶음 안에서 위로.
 * 키보드: ↑↓ · Home/End 로 옮기고 Enter/Space 로 고르기, Esc 로 닫기. Field 안에 두면 라벨 · 오류가 이어져요.
 * 단추의 value 는 고른 통장 id 예요
 */
export function AccountPicker({ value, onChange, accounts, placeholder = '통장 고르기', prefer, disabled, id }: AccountPickerProps) {
  const ledger = useLedger();
  const session = useSession();
  const f = useFieldControl({ id });
  const auto = useId().replace(/:/g, '');
  const baseId = f.id ?? `ap${auto}`;
  const listId = `${baseId}-list`;
  const valueId = `${baseId}-value`;
  const labelId = `${baseId}-label`;
  const data = ledger.data;
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<Id[]>([]);
  const [active, setActive] = useState<Id | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const meKey = useMemo(
    () => meKeyOf(data, session.user?.email ?? null, ledger.myLivingAccountId),
    [data, session.user?.email, ledger.myLivingAccountId],
  );
  const groups = useMemo(() => groupAccounts(data, accounts, { meKey, recent, prefer }), [data, accounts, meKey, recent, prefer]);
  const flat = useMemo(() => groups.flatMap((g) => g.accounts), [groups]);
  const selected = accounts.find((a) => a.id === value) ?? (value ? data?.accounts.find((a) => a.id === value) : undefined);

  function openList() {
    if (disabled) return;
    // 열 때마다 최근 고른 순서를 다시 읽어요 (다른 창에서 고른 것도 반영)
    const r = readRecentAccounts();
    setRecent(r);
    const first = groupAccounts(data, accounts, { meKey, recent: r, prefer })[0]?.accounts[0]?.id ?? null;
    setActive(value && accounts.some((a) => a.id === value) ? value : first);
    setOpen(true);
  }
  function close(focusTrigger: boolean) {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }
  function pick(accountId: Id) {
    setRecent(pushRecentAccount(accountId));
    close(true);
    if (accountId !== value) onChange(accountId);
  }

  // 열리면 목록으로 포커스 (처음 줄은 고른 통장, 없으면 맨 위)
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  // 바깥을 누르면 닫혀요
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent | MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  // 고른 줄이 보이게
  useEffect(() => {
    if (!open || !active) return;
    const el = document.getElementById(`${baseId}-opt-${active}`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, baseId]);

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openList();
    }
  }

  function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = active ? flat.findIndex((a) => a.id === active) : -1;
    const move = (to: number) => {
      const next = flat[Math.max(0, Math.min(flat.length - 1, to))];
      if (next) setActive(next.id);
    };
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(i < 0 ? 0 : i + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(i < 0 ? flat.length - 1 : i - 1);
        break;
      case 'Home':
        e.preventDefault();
        move(0);
        break;
      case 'End':
        e.preventDefault();
        move(flat.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (active) pick(active);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
    }
  }

  const triggerText = selected ? accountShortLabel(data, selected) : accounts.length === 0 ? '통장이 없어요' : placeholder;

  return (
    <div ref={rootRef} className={cx('acp', open && 'open')}>
      <button
        ref={triggerRef}
        type="button"
        id={baseId}
        value={value}
        className={cx('acp-trigger', !selected && 'empty')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${valueId}`}
        aria-describedby={f['aria-describedby']}
        data-invalid={f['aria-invalid'] ? 'true' : undefined}
        disabled={disabled || accounts.length === 0}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="acp-ico" aria-hidden>
          <Icon name={selected ? ACCOUNT_ROLE_ICON[selected.role] : 'wallet'} size={20} />
        </span>
        <span id={valueId} className="acp-nm">
          {triggerText}
        </span>
        <Icon name="chevron-down" size={20} className="acp-chev" />
      </button>
      {open ? (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={labelId}
          aria-activedescendant={active ? `${baseId}-opt-${active}` : undefined}
          className="acp-list"
          onKeyDown={onListKeyDown}
        >
          {groups.map((g) => (
            <div key={g.key || '__shared'} role="group" aria-label={g.label} className="acp-group">
              {groups.length > 1 ? (
                <div className="acp-group-label" aria-hidden>
                  {g.label}
                </div>
              ) : null}
              {g.accounts.map((a) => {
                const owner = accountOwner(data, a);
                const name = baseAccountName(a.name, owner?.name ?? null);
                const balance = ledger.balances[a.id] ?? 0;
                const isSel = a.id === value;
                return (
                  <div
                    key={a.id}
                    id={`${baseId}-opt-${a.id}`}
                    role="option"
                    aria-selected={isSel}
                    data-value={a.id}
                    className={cx('acp-opt', a.id === active && 'active')}
                    onClick={() => pick(a.id)}
                    onMouseMove={() => {
                      if (active !== a.id) setActive(a.id);
                    }}
                  >
                    <span className="acp-ico" aria-hidden>
                      <Icon name={ACCOUNT_ROLE_ICON[a.role]} size={20} />
                    </span>
                    <span className="acp-nm">
                      {name}
                      {a.deleted ? <span className="acp-cap"> (지운 통장)</span> : null}
                    </span>
                    <span className="acp-bal">
                      <span className="sr-only">잔액 </span>
                      <Money amount={balance} />
                    </span>
                    <span className="acp-check" aria-hidden>
                      {isSel ? <Icon name="check" size={20} /> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
