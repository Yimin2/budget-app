'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { hasBatchim } from '@/domain';
import type { AccountRole, Category } from '@/domain/types';
import { Button, Card, ConfirmDialog, Dialog, EmptyState, Field, ListRow, Select, TextInput, cx, focusFirstInvalid, useToast } from '@/ui';
import type { ReadyLedger } from '../../_components/RequireLedger';
import { ROLE_TEXT, categoryRoleOptions } from '../helpers';
import { useRunner } from '../useRunner';
import { IconPicker } from './IconPicker';

/** 끌기 상태 (손가락 · 마우스 · 펜) */
interface PointerDrag {
  id: string;
  from: number;
  over: number;
  /** 집은 줄이 움직인 거리 (px, 화면 스크롤 포함) */
  dy: number;
  /** 줄 높이 (다른 줄을 밀어낼 거리) */
  rowH: number;
}

/** 키보드로 집은 상태 */
interface KeyDrag {
  id: string;
  from: number;
  over: number;
}

/** 화면 끝에서 이만큼(px) 안으로 오면 저절로 스크롤해요 */
const EDGE = 64;

/** 손잡이 (점 여섯 개) */
function Grip() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden focusable="false" className="icon">
      {[6, 12, 18].map((y) => (
        <g key={y} fill="currentColor">
          <circle cx={9} cy={y} r={1.6} />
          <circle cx={15} cy={y} r={1.6} />
        </g>
      ))}
    </svg>
  );
}

interface Draft {
  id: string | null;
  name: string;
  icon: string;
  role: AccountRole;
}

/** 카테고리: 이름 · 아이콘 · 고르면 자동 선택되는 통장 */
export function CategoriesCard({ ledger }: { ledger: ReadyLedger }) {
  const { busy, run } = useRunner();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null);
  const [moving, setMoving] = useState(false);
  /** 화면 읽기 프로그램에 옮긴 결과를 알려요 */
  const [announce, setAnnounce] = useState('');
  const toast = useToast();
  const categories = ledger.activeCategories;
  const accounts = ledger.activeAccounts;
  const editing = draft?.id ? ledger.data.categories.find((c) => c.id === draft.id) : undefined;

  function roleText(role: AccountRole): string {
    return ledger.accountByRole(role)?.name ?? `${ROLE_TEXT[role]} (통장 없음)`;
  }

  function openNew() {
    setNameError(undefined);
    const role: AccountRole = ledger.accountByRole('fixed') ? 'fixed' : (accounts[0]?.role ?? 'other');
    setDraft({ id: null, name: '', icon: 'dots', role });
  }
  function openEdit(c: Category) {
    setNameError(undefined);
    setDraft({ id: c.id, name: c.name, icon: c.icon, role: c.defaultAccountRole });
  }

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setNameError('카테고리 이름을 입력해 주세요');
      focusFirstInvalid();
      return;
    }
    const ok = await run(
      'save',
      async () => {
        if (!draft.id) {
          await ledger.addCategory({ name: draft.name, icon: draft.icon, defaultAccountRole: draft.role });
          return;
        }
        const prev = ledger.data.categories.find((c) => c.id === draft.id);
        if (!prev) throw new Error('카테고리를 찾을 수 없어요');
        await ledger.saveCategory({ ...prev, name: draft.name.trim(), icon: draft.icon, defaultAccountRole: draft.role });
      },
      draft.id ? '카테고리를 저장했어요' : '카테고리를 추가했어요',
    );
    if (ok) setDraft(null);
  }

  /* ───────── 순서 바꾸기: 끌어 놓기 (Pointer Events) · 키보드 ───────── */
  const hintId = useId();
  const [drag, setDrag] = useState<PointerDrag | null>(null);
  const [keyDrag, setKeyDrag] = useState<KeyDrag | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const handleRefs = useRef(new Map<string, HTMLButtonElement>());
  const start = useRef<{ y: number; scroll: number; mids: number[]; top: number; h: number; lastY: number } | null>(null);
  const scrollFrame = useRef<number | null>(null);

  const nameWithObject = (name: string) => `${name}${hasBatchim(name) ? '을' : '를'}`;

  /** from → to 로 옮겨 저장. 화면에 바로 반영되고, 저장이 실패하면 되돌려요. 옮긴 뒤 '되돌리기'로 제자리에 */
  async function commit(c: Category, from: number, to: number) {
    if (from === to) return;
    setMoving(true);
    try {
      const moved = await ledger.moveCategoryTo(c.id, to);
      if (!moved) return;
      setAnnounce(`${nameWithObject(c.name)} ${to + 1}번째로 옮겼어요`);
      toast.show(`${c.name} 순서를 바꿨어요`, {
        action: { label: '되돌리기', onClick: () => void ledger.moveCategoryTo(c.id, from).catch(() => toast.error('되돌리지 못했어요')) },
      });
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : '카테고리 순서를 바꾸지 못했어요');
    } finally {
      setMoving(false);
    }
  }

  function stopAutoScroll() {
    if (scrollFrame.current !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
  }
  useEffect(() => stopAutoScroll, []);

  /** 지금 손가락 위치로 놓일 자리: 끌기 시작 때 줄 위치 기준으로, 집은 줄 가운데에 가장 가까운 줄의 자리 */
  function overIndex(clientY: number): { over: number; dy: number } {
    const st = start.current!;
    const dy = clientY - st.y + (window.scrollY - st.scroll);
    const center = st.top + st.h / 2 + dy;
    let over = 0;
    let best = Infinity;
    st.mids.forEach((m, i) => {
      const d = Math.abs(center - m);
      if (d < best) {
        best = d;
        over = i;
      }
    });
    return { over, dy };
  }

  function updateFromPointer(clientY: number) {
    if (!start.current) return;
    start.current.lastY = clientY;
    const { over, dy } = overIndex(clientY);
    setDrag((d) => (d ? { ...d, over, dy } : d));
  }

  /** 화면 위 · 아래 끝 근처면 저절로 스크롤 (움직임 줄이기에서도 스크롤은 필요해서 그대로, 속도만 일정) */
  function autoScroll() {
    stopAutoScroll();
    if (typeof requestAnimationFrame !== 'function') return;
    const step = () => {
      const st = start.current;
      if (!st) return;
      const y = st.lastY;
      const speed = y < EDGE ? -Math.ceil((EDGE - y) / 4) : y > window.innerHeight - EDGE ? Math.ceil((y - (window.innerHeight - EDGE)) / 4) : 0;
      if (speed !== 0) {
        window.scrollBy(0, speed);
        updateFromPointer(y);
      }
      scrollFrame.current = requestAnimationFrame(step);
    };
    scrollFrame.current = requestAnimationFrame(step);
  }

  function onHandlePointerDown(e: ReactPointerEvent<HTMLButtonElement>, c: Category, index: number) {
    if (moving || keyDrag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* 포인터 잡기를 못 해도 끌기는 돼요 */
    }
    const rects = categories.map((x) => rowRefs.current.get(x.id)?.getBoundingClientRect());
    const own = rects[index];
    const h = own && own.height > 0 ? own.height : 56;
    start.current = {
      y: e.clientY,
      scroll: window.scrollY,
      mids: rects.map((r, i) => (r ? r.top + r.height / 2 : i * h + h / 2)),
      top: own ? own.top : index * h,
      h,
      lastY: e.clientY,
    };
    setDrag({ id: c.id, from: index, over: index, dy: 0, rowH: h });
    setAnnounce(`${nameWithObject(c.name)} 집었어요`);
    autoScroll();
  }

  function onHandlePointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    if (!drag) return;
    e.preventDefault();
    updateFromPointer(e.clientY);
  }

  function endPointer(cancel: boolean) {
    stopAutoScroll();
    const d = drag;
    start.current = null;
    setDrag(null);
    if (!d) return;
    const c = categories.find((x) => x.id === d.id);
    if (cancel || !c || d.over === d.from) {
      setAnnounce(c ? `${c.name} 순서를 그대로 뒀어요` : '');
      return;
    }
    void commit(c, d.from, d.over);
  }

  function onHandleKeyDown(e: KeyboardEvent<HTMLButtonElement>, c: Category, index: number) {
    const pick = e.key === ' ' || e.key === 'Enter';
    if (!keyDrag) {
      if (!pick || moving) return;
      e.preventDefault();
      setKeyDrag({ id: c.id, from: index, over: index });
      setAnnounce(`${nameWithObject(c.name)} 집었어요. 지금 ${index + 1}번째예요. 위아래 화살표로 옮기고 스페이스로 놓아요. Esc 는 그대로 두기예요`);
      return;
    }
    if (keyDrag.id !== c.id) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const over = Math.max(0, Math.min(categories.length - 1, keyDrag.over + (e.key === 'ArrowUp' ? -1 : 1)));
      setKeyDrag({ ...keyDrag, over });
      setAnnounce(`${over + 1}번째`);
    } else if (pick) {
      e.preventDefault();
      setKeyDrag(null);
      if (keyDrag.over === keyDrag.from) setAnnounce(`${c.name} 순서를 그대로 뒀어요`);
      else void commit(c, keyDrag.from, keyDrag.over);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setKeyDrag(null);
      setAnnounce(`${c.name} 순서를 그대로 뒀어요`);
    }
  }

  // 키보드로 옮기는 동안 줄이 움직여도 손잡이에 포커스를 둬요
  useEffect(() => {
    if (keyDrag) handleRefs.current.get(keyDrag.id)?.focus();
  }, [keyDrag]);

  /** 키보드로 집었으면 놓일 순서대로 보여 줘요 */
  const shown = (() => {
    if (!keyDrag) return categories;
    const list = [...categories];
    const i = list.findIndex((c) => c.id === keyDrag.id);
    if (i < 0) return categories;
    const [m] = list.splice(i, 1);
    list.splice(keyDrag.over, 0, m!);
    return list;
  })();

  /** 끄는 동안 다른 줄이 비켜나는 거리 */
  function shiftOf(i: number): number {
    if (!drag || i === drag.from) return 0;
    if (drag.from < drag.over && i > drag.from && i <= drag.over) return -drag.rowH;
    if (drag.from > drag.over && i < drag.from && i >= drag.over) return drag.rowH;
    return 0;
  }

  async function remove(c: Category) {
    const ok = await run('delete', () => ledger.saveCategory({ ...c, deleted: true }), '카테고리를 지웠어요');
    if (ok) setConfirmDelete(null);
  }

  return (
    <Card id="st-categories" title="카테고리" aside={<span className="muted">{categories.length}개</span>}>
      <p className="st-desc">
        지출을 기록할 때 카테고리를 고르면 정해 둔 통장이 자동으로 골라져요. 손잡이를 끌어 정한 순서를 기록 · 사도 돼? · 내역 · 생활비 항목이 모두 따라요.
      </p>
      <p id={hintId} className="st-cat-hint">
        순서 바꾸기: 손잡이를 끌어 놓아요. 키보드는 손잡이에서 스페이스로 집고 위아래 화살표로 옮긴 뒤 스페이스로 놓아요
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {categories.length === 0 ? (
        <EmptyState icon="tag" headingLevel={3} title="카테고리가 없어요" description="식비·카페처럼 지출을 나눌 카테고리를 추가해 주세요." />
      ) : (
        <ul className={cx('list st-cats', drag && 'is-dragging')}>
          {shown.map((c, i) => {
            const lifted = drag?.id === c.id || keyDrag?.id === c.id;
            const style: CSSProperties | undefined = drag
              ? { transform: `translateY(${drag.id === c.id ? drag.dy : shiftOf(i)}px)` }
              : undefined;
            return (
              <li
                key={c.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(c.id, el);
                  else rowRefs.current.delete(c.id);
                }}
                data-index={i}
                className={cx('st-cat-row', lifted && 'is-lifted', drag?.id === c.id && 'is-pointer')}
                style={style}
              >
                <button
                  type="button"
                  ref={(el) => {
                    if (el) handleRefs.current.set(c.id, el);
                    else handleRefs.current.delete(c.id);
                  }}
                  className="st-cat-handle"
                  aria-label={`${c.name} 순서 바꾸기`}
                  aria-describedby={hintId}
                  aria-pressed={keyDrag?.id === c.id}
                  disabled={moving && !lifted}
                  onPointerDown={(e) => onHandlePointerDown(e, c, i)}
                  onPointerMove={onHandlePointerMove}
                  onPointerUp={() => endPointer(false)}
                  onPointerCancel={() => endPointer(true)}
                  onKeyDown={(e) => onHandleKeyDown(e, c, i)}
                >
                  <Grip />
                </button>
                <ListRow icon={c.icon} title={c.name} subtitle={roleText(c.defaultAccountRole)} onClick={() => (drag || keyDrag ? undefined : openEdit(c))} />
              </li>
            );
          })}
        </ul>
      )}
      <div className="st-foot">
        <Button variant="outline" icon="plus" onClick={openNew}>
          카테고리 추가
        </Button>
      </div>

      <Dialog
        open={draft !== null}
        onClose={() => (busy ? undefined : setDraft(null))}
        title={draft?.id ? '카테고리 고치기' : '카테고리 추가'}
        actions={
          <>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={busy !== null}>
              취소
            </Button>
            <Button type="submit" form="st-category-form" loading={busy === 'save'}>
              저장
            </Button>
          </>
        }
      >
        {draft ? (
          <form
            id="st-category-form"
            className="stack"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field label="이름" error={nameError} required>
              <TextInput
                value={draft.name}
                maxLength={20}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                data-autofocus=""
              />
            </Field>
            <IconPicker value={draft.icon} onChange={(icon) => setDraft({ ...draft, icon })} />
            <Field label="기본 통장" hint="이 카테고리로 기록하면 이 통장에서 나가요. 기록할 때 바꿀 수 있어요.">
              <Select
                value={draft.role}
                onChange={(v) => setDraft({ ...draft, role: v as AccountRole })}
                options={categoryRoleOptions(accounts, draft.role)}
              />
            </Field>
            {editing ? (
              <div className="st-danger">
                <Button
                  variant="ghost"
                  icon="trash"
                  disabled={busy !== null}
                  onClick={() => {
                    setDraft(null);
                    setConfirmDelete(editing);
                  }}
                >
                  이 카테고리 지우기
                </Button>
              </div>
            ) : null}
          </form>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={confirmDelete !== null}
        tone="danger"
        title="이 카테고리를 지울까요?"
        description={`${confirmDelete?.name ?? ''}: 목록에서 빠져요. 이미 기록한 지출은 그대로 남아요.`}
        confirmLabel="지우기"
        loading={busy === 'delete'}
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </Card>
  );
}
