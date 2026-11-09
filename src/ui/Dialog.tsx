'use client';

import { useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { cx } from './cx';

export interface DialogProps {
  open: boolean;
  /** Esc · 막 누름 · 닫기 버튼 */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** 아래 버튼 줄. 모바일에서는 세로로 쌓이고, 첫 번째 요소가 맨 아래에 와요 (닫기 → 확인 순서로 넣으세요) */
  actions?: ReactNode;
  /** 막을 눌러 닫을지 (기본 true) */
  dismissible?: boolean;
  /** 오른쪽 위 닫기 버튼 (기본 true) */
  showClose?: boolean;
  /** 640px 넓은 창 (데스크톱) */
  wide?: boolean;
  /** 열릴 때 먼저 포커스할 요소 (없으면 첫 입력·버튼) */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /**
   * 닫을 때 원래 자리(연 버튼)가 사라졌으면(예: 지운 행) 대신 포커스할 요소. 없으면 본문(#main)으로 옮겨요
   * (포커스가 <body> 로 떨어져 키보드 사용자가 맨 위로 돌아가지 않게)
   */
  returnFocus?: () => HTMLElement | null | undefined;
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('inert'));
}

let openCount = 0;

const noopSubscribe = () => () => {};
/** 서버에서는 false, 브라우저에서는 true (포털은 브라우저에서만) */
function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/** 모달 창. 모바일은 아래에서 올라오는 시트, 768px 이상은 가운데 창. 포커스 가두기 · Esc · 닫으면 원래 자리로 포커스 */
export function Dialog({
  open, onClose, title, description, children, actions, dismissible = true, showClose = true, wide, initialFocusRef, returnFocus, className,
}: DialogProps) {
  const mounted = useIsClient();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const returnFocusRef = useRef(returnFocus);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    returnFocusRef.current = returnFocus;
  });
  const ids = useId().replace(/:/g, '');
  const titleId = `${ids}-title`;
  const descId = description ? `${ids}-desc` : undefined;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    openCount += 1;
    document.body.setAttribute('data-scroll-lock', '');

    const panel = panelRef.current;
    const first = initialFocusRef?.current ?? (panel ? panel.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(panel).find((el) => !el.classList.contains('close')) ?? focusables(panel)[0] : null);
    (first ?? panel)?.focus();

    function onKey(e: KeyboardEvent) {
      if (!panelRef.current) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables(panelRef.current);
      if (list.length === 0) {
        e.preventDefault();
        panelRef.current.focus();
        return;
      }
      const firstEl = list[0]!;
      const lastEl = list[list.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === firstEl || active === panelRef.current)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      } else if (!panelRef.current.contains(active)) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      openCount -= 1;
      if (openCount <= 0) {
        openCount = 0;
        document.body.removeAttribute('data-scroll-lock');
      }
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
        previous.focus();
      } else {
        // 연 버튼이 사라졌으면 (지운 행 등) 대신할 곳 → 본문
        const fallback = returnFocusRef.current?.() ?? document.getElementById('main');
        fallback?.focus?.();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="dialog-root">
      <div className="scrim" aria-hidden onClick={dismissible ? () => onCloseRef.current() : undefined} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className={cx('dialog', wide && 'wide', className)}
      >
        <div className="hd">
          <div className="txt">
            <h2 id={titleId}>{title}</h2>
            {description ? (
              <p id={descId} className="desc">
                {description}
              </p>
            ) : null}
          </div>
          {showClose ? (
            <Button variant="ghost" plain iconOnly icon="x" aria-label="닫기" className="close" onClick={() => onCloseRef.current()} />
          ) : null}
        </div>
        {children ? <div className="bd">{children}</div> : null}
        {actions ? <div className="actions">{actions}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 지우기처럼 되돌릴 수 없는 동작이면 danger */
  tone?: 'primary' | 'danger';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 확인 / 취소 두 버튼짜리 간단한 창 */
export function ConfirmDialog({
  open, title, description, confirmLabel = '확인', cancelLabel = '취소', tone = 'primary', loading, onConfirm, onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      showClose={false}
      actions={
        <>
          <Button variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading} data-autofocus={tone === 'primary' ? '' : undefined}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
