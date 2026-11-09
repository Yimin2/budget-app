'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { isGoogleError } from '@/google';
import { useLedger, useSession } from '@/state';
import type { LedgerRef } from '@/storage/types';
import { Icon, Spinner, cx, useToast } from '@/ui';
import { LEDGER_KIND_TEXT, LedgerKindBadge } from './LedgerKindBadge';
import './screens.css';

export interface LedgerSwitcherProps {
  /**
   * block: 테두리 있는 상자 (사이드바 · 설정 카드)
   * title: 화면 머리의 22px 제목 자리 (모바일 홈처럼 PageHeader titleAs="div" 의 title 로)
   */
  variant?: 'block' | 'title';
  className?: string;
}

const MAX_RECENT = 8;

function sourceText(ref: LedgerRef): string {
  return ref.source === 'sheets' ? '구글 시트' : '이 브라우저';
}

/** 가계부 전환 메뉴: 최근 가계부 · 새 가계부 · 공유받은 가계부 열기 */
export function LedgerSwitcher({ variant = 'block', className }: LedgerSwitcherProps) {
  const session = useSession();
  const ledger = useLedger();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = `lsw${useId().replace(/:/g, '')}`;

  const active = session.activeLedger;
  const sameLedger = !!active && ledger.ref?.id === active.id;
  const name = (sameLedger ? ledger.data?.settings.name : null) || active?.name || '가계부';
  const kind = (sameLedger ? ledger.data?.settings.kind : null) ?? active?.kind ?? 'shared';
  const recent = session.recentLedgers.slice(0, MAX_RECENT);
  const canOpenShared = session.mode === 'google';

  // 바깥을 누르면 닫아요
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // 열리면 지금 가계부(없으면 첫 항목)에 포커스
  useEffect(() => {
    if (!open) return;
    const items = menuItems(menuRef.current);
    (items.find((el) => el.getAttribute('aria-checked') === 'true') ?? items[0])?.focus();
  }, [open]);

  function close(focusTrigger: boolean) {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    }
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const items = menuItems(menuRef.current);
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    switch (e.key) {
      case 'ArrowDown':
        next = (i + 1) % items.length;
        break;
      case 'ArrowUp':
        next = (i - 1 + items.length) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close(true);
        return;
      case 'Tab':
        setOpen(false);
        return;
      default:
        return;
    }
    e.preventDefault();
    items[next]?.focus();
  }

  function choose(ref: LedgerRef) {
    close(true);
    if (ref.id === active?.id) return;
    session.selectLedger(ref);
    toast.show('가계부를 바꿨어요');
  }

  function createNew() {
    close(false);
    router.push('/start/new');
  }

  function showAll() {
    close(false);
    router.push('/start');
  }

  async function openShared() {
    if (!canOpenShared || opening) return;
    close(false);
    setOpening(true);
    try {
      const ref = await session.openSharedLedger();
      if (ref) toast.success('공유받은 가계부를 열었어요');
    } catch (e) {
      if (!(isGoogleError(e) && e.code === 'popup_closed')) {
        toast.error(e instanceof Error && e.message ? e.message : '가계부를 열지 못했어요');
      }
    } finally {
      setOpening(false);
    }
  }

  const kindText = LEDGER_KIND_TEXT[kind];

  return (
    <div ref={rootRef} className={cx('lsw', variant, className)}>
      <button
        ref={triggerRef}
        type="button"
        className="lsw-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${name}, ${kindText} 가계부. 가계부 바꾸기`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        {variant === 'block' ? (
          <>
            <span className="txt">
              <span className="cap">지금 가계부</span>
              <span className="line">
                <span className="nm">{name}</span>
                <LedgerKindBadge kind={kind} />
              </span>
            </span>
            {opening ? <Spinner size="sm" label="가계부를 여는 중이에요" /> : null}
            <Icon name="chevron-down" size={20} className="chev" />
          </>
        ) : (
          <>
            <span className="nm">{name}</span>
            {opening ? <Spinner size="sm" label="가계부를 여는 중이에요" /> : null}
            <Icon name="chevron-down" size={20} className="chev" />
          </>
        )}
      </button>

      {open ? (
        <div ref={menuRef} id={menuId} role="menu" aria-label="가계부 바꾸기" className="lsw-menu" onKeyDown={onMenuKeyDown}>
          {recent.length > 0 ? (
            <div role="group" aria-label="최근 가계부">
              <div className="lsw-group-label" aria-hidden>
                최근 가계부
              </div>
              {recent.map((ref) => {
                const on = ref.id === active?.id;
                return (
                  <button
                    key={ref.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={on}
                    aria-label={`${ref.name || '이름 없는 가계부'}, ${LEDGER_KIND_TEXT[ref.kind]} 가계부, ${sourceText(ref)}`}
                    tabIndex={-1}
                    className="lsw-item"
                    onClick={() => choose(ref)}
                  >
                    <Icon name={ref.kind === 'shared' ? 'users' : 'user'} size={20} />
                    <span className="main">
                      <span className="t">{ref.name || '이름 없는 가계부'}</span>
                      <span className="s">{sourceText(ref)}</span>
                    </span>
                    <LedgerKindBadge kind={ref.kind} />
                    {on ? <Icon name="check" size={20} className="check" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="lsw-sep" role="separator" />
          <button type="button" role="menuitem" tabIndex={-1} className="lsw-item" onClick={createNew}>
            <Icon name="plus" size={20} />
            <span className="main">
              <span className="t">새 가계부</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="lsw-item"
            aria-disabled={canOpenShared ? undefined : true}
            onClick={openShared}
          >
            <Icon name="link" size={20} />
            <span className="main">
              <span className="t">공유받은 가계부 열기</span>
              {canOpenShared ? null : <span className="s">구글로 시작하면 쓸 수 있어요</span>}
            </span>
          </button>
          <button type="button" role="menuitem" tabIndex={-1} className="lsw-item" onClick={showAll}>
            <Icon name="list" size={20} />
            <span className="main">
              <span className="t">가계부 목록</span>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  if (!menu) return [];
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]'));
}
