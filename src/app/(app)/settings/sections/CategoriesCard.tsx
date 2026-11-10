'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { directionParticle, hasBatchim, mergeCountsText, objectParticle, planCategoryMerge, unusedCategories } from '@/domain';
import type { AccountRole, Category } from '@/domain/types';
import { Button, Card, Chip, ChipGroup, ConfirmDialog, Dialog, EmptyState, Field, Icon, ListRow, Select, TextInput, cx, focusFirstInvalid, isIconName, useToast } from '@/ui';
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

const withTopicName = (name: string) => `'${name}'${hasBatchim(name) ? '은' : '는'}`;

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

/** 줄 아래 정리 칸: 고르기 · 합칠 카테고리 고르기(targetId 가 있으면 미리 보기) */
interface Tidy {
  id: string;
  mode: 'menu' | 'merge';
  targetId: string | null;
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
  // 순서 목록은 보이는 카테고리만 (숨긴 카테고리는 아래 '숨긴 카테고리 보기'에서)
  const categories = ledger.pickableCategories;
  const hidden = ledger.activeCategories.filter((c) => c.hidden === true);
  const unused = unusedCategories(ledger.data, ledger.today);
  const unusedIds = new Set(unused.map((c) => c.id));
  const [tidy, setTidy] = useState<Tidy | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [working, setWorking] = useState<'hide' | 'merge' | null>(null);
  const tidyBase = useId().replace(/:/g, '');
  const hiddenListId = `${tidyBase}-hidden`;
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
    // 보이는 목록의 자리 → 숨긴 카테고리까지 든 전체 순서의 자리
    const full = ledger.activeCategories;
    const fullFrom = full.findIndex((x) => x.id === c.id);
    const fullTo = full.findIndex((x) => x.id === categories[to]?.id);
    if (fullFrom < 0 || fullTo < 0) return;
    setMoving(true);
    try {
      const moved = await ledger.moveCategoryTo(c.id, fullTo);
      if (!moved) return;
      setAnnounce(`${nameWithObject(c.name)} ${to + 1}번째로 옮겼어요`);
      toast.show(`${c.name} 순서를 바꿨어요`, {
        action: { label: '되돌리기', onClick: () => void ledger.moveCategoryTo(c.id, fullFrom).catch(() => toast.error('되돌리지 못했어요')) },
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
    setTidy(null);
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
      setTidy(null);
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

  /** 숨기기 · 다시 보기 (여럿 한 번에). 알림에서 되돌리기 */
  async function setHidden(list: Category[], hide: boolean) {
    if (list.length === 0 || working) return;
    setWorking('hide');
    try {
      const n = await ledger.setCategoriesHidden(list.map((c) => c.id), hide);
      if (n === 0) return;
      setTidy(null);
      const what = list.length === 1 ? `${list[0]!.name}${objectParticle(list[0]!.name)}` : `카테고리 ${list.length}개를`;
      toast.success(hide ? `${what} 숨겼어요. 예전 기록과 예산은 그대로예요` : `${what} 다시 보이게 했어요`, {
        action: {
          label: '되돌리기',
          onClick: () => void ledger.setCategoriesHidden(list.map((c) => c.id), !hide).catch(() => toast.error('되돌리지 못했어요')),
        },
      });
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : '카테고리를 바꾸지 못했어요');
    } finally {
      setWorking(null);
    }
  }

  async function merge(sourceId: string, targetId: string) {
    if (working) return;
    setWorking('merge');
    try {
      const plan = await ledger.mergeCategory(sourceId, targetId);
      setTidy(null);
      setAnnounce(`${plan.source.name}${objectParticle(plan.source.name)} ${plan.target.name}${directionParticle(plan.target.name)} 합쳤어요`);
      toast.success(`${plan.source.name}${objectParticle(plan.source.name)} '${plan.target.name}'${directionParticle(plan.target.name)} 합쳤어요`, {
        action: {
          label: '되돌리기',
          onClick: () =>
            void ledger.undoCategoryMerge(plan).then(
              () => toast.show('합치기를 되돌렸어요'),
              () => toast.error('되돌리지 못했어요'),
            ),
        },
      });
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : '카테고리를 합치지 못했어요');
    } finally {
      setWorking(null);
    }
  }

  /** 줄 아래 정리 칸 (같은 자리에서 펼침) */
  function tidyPanel(c: Category) {
    if (!tidy || tidy.id !== c.id) return null;
    const panelId = `${tidyBase}-${c.id}`;
    const targets = ledger.activeCategories.filter((x) => x.id !== c.id);
    let body;
    if (tidy.mode === 'menu') {
      body = (
        <div className="st-tidy-actions">
          <Button variant="outline" icon="arrow-right" onClick={() => setTidy({ ...tidy, mode: 'merge', targetId: null })} disabled={targets.length === 0 || !!working}>
            다른 카테고리로 합치기
          </Button>
          <Button variant="outline" onClick={() => void setHidden([c], true)} loading={working === 'hide'} disabled={!!working}>
            숨기기
          </Button>
        </div>
      );
    } else {
      const target = tidy.targetId ? targets.find((x) => x.id === tidy.targetId) : undefined;
      let preview: string | null = null;
      if (target) {
        try {
          const counts = mergeCountsText(planCategoryMerge(ledger.data, c.id, target.id).counts);
          preview = `${counts}${objectParticle(counts)} '${target.name}'${directionParticle(target.name)} 옮겨요`;
        } catch (e) {
          preview = e instanceof Error ? e.message : null;
        }
      }
      body = (
        <>
          <p className="st-tidy-q">
            {c.name}
            {objectParticle(c.name)} 어느 카테고리로 합칠까요?
          </p>
          <ChipGroup label="합칠 카테고리">
            {targets.map((x) => (
              <Chip
                key={x.id}
                icon={isIconName(x.icon) ? x.icon : 'dots'}
                selected={tidy.targetId === x.id}
                disabled={!!working}
                onClick={() => setTidy({ ...tidy, targetId: x.id })}
              >
                {x.name}
                {x.hidden ? ' (숨김)' : ''}
              </Chip>
            ))}
          </ChipGroup>
          {target && preview ? (
            <div className="st-tidy-preview" role="status">
              <p>{preview}</p>
              <p className="muted">
                {withTopicName(c.name)} 목록에서 빠져요. 합친 뒤 알림에서 되돌릴 수 있어요.
              </p>
            </div>
          ) : null}
          <div className="st-tidy-actions">
            <Button icon="check" onClick={() => target && void merge(c.id, target.id)} disabled={!target || (!!working && working !== 'merge')} loading={working === 'merge'}>
              합치기
            </Button>
            <Button variant="ghost" onClick={() => setTidy(null)} disabled={!!working}>
              취소
            </Button>
          </div>
        </>
      );
    }
    return (
      <li id={panelId} className="st-tidy" key={`${c.id}-tidy`}>
        {body}
      </li>
    );
  }

  async function remove(c: Category) {
    const ok = await run('delete', () => ledger.saveCategory({ ...c, deleted: true }), '카테고리를 지웠어요');
    if (ok) setConfirmDelete(null);
  }

  return (
    <Card id="st-categories" title="카테고리" aside={<span className="muted">{categories.length}개{hidden.length > 0 ? ` · 숨김 ${hidden.length}개` : ''}</span>}>
      <p className="st-desc">
        지출을 기록할 때 카테고리를 고르면 정해 둔 통장이 자동으로 골라져요. 손잡이를 끌어 정한 순서를 기록 · 사도 돼? · 내역 · 생활비 항목이 모두 따라요.
      </p>
      <p id={hintId} className="st-cat-hint">
        순서 바꾸기: 손잡이를 끌어 놓아요. 키보드는 손잡이에서 스페이스로 집고 위아래 화살표로 옮긴 뒤 스페이스로 놓아요
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {unused.length > 0 ? (
        <div className="st-cat-suggest">
          <p>
            <strong>최근 3개월 동안 안 쓴 카테고리 {unused.length}개</strong>
            <span className="muted"> · {unused.map((c) => c.name).join(' · ')}</span>
          </p>
          <Button variant="outline" onClick={() => void setHidden(unused, true)} loading={working === 'hide' && !tidy} disabled={!!working}>
            모두 숨기기
          </Button>
        </div>
      ) : null}
      {categories.length === 0 ? (
        <EmptyState icon="tag" headingLevel={3} title="카테고리가 없어요" description="식비·카페처럼 지출을 나눌 카테고리를 추가해 주세요." />
      ) : (
        <ul className={cx('list st-cats', drag && 'is-dragging')}>
          {shown.map((c, i) => {
            const lifted = drag?.id === c.id || keyDrag?.id === c.id;
            const style: CSSProperties | undefined = drag
              ? { transform: `translateY(${drag.id === c.id ? drag.dy : shiftOf(i)}px)` }
              : undefined;
            const open = tidy?.id === c.id;
            return [
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
                <ListRow
                  icon={c.icon}
                  title={c.name}
                  subtitle={unusedIds.has(c.id) ? `${roleText(c.defaultAccountRole)} · 3개월 동안 안 썼어요` : roleText(c.defaultAccountRole)}
                  onClick={() => (drag || keyDrag ? undefined : openEdit(c))}
                />
                <button
                  type="button"
                  className="st-cat-more"
                  aria-label={`${c.name} 정리하기 (합치기 · 숨기기)`}
                  aria-expanded={open}
                  aria-controls={open ? `${tidyBase}-${c.id}` : undefined}
                  disabled={!!drag || !!keyDrag}
                  onClick={() => setTidy(open ? null : { id: c.id, mode: 'menu', targetId: null })}
                >
                  <Icon name={open ? 'x' : 'dots'} size={20} />
                </button>
              </li>,
              tidyPanel(c),
            ];
          })}
        </ul>
      )}
      <div className="st-foot">
        <Button variant="outline" icon="plus" onClick={openNew}>
          카테고리 추가
        </Button>
        {hidden.length > 0 ? (
          <Button
            variant="ghost"
            iconRight={showHidden ? 'chevron-up' : 'chevron-down'}
            aria-expanded={showHidden}
            aria-controls={hiddenListId}
            onClick={() => setShowHidden((v) => !v)}
          >
            {showHidden ? '숨긴 카테고리 접기' : `숨긴 카테고리 보기 (${hidden.length})`}
          </Button>
        ) : null}
      </div>
      {hidden.length > 0 ? (
        <div id={hiddenListId} hidden={!showHidden}>
          {showHidden ? (
            <>
              <p className="st-cat-hint">숨긴 카테고리는 기록 창 · 사도 돼?에 안 보여요. 예전 기록의 이름과 예산은 그대로예요.</p>
              <ul className="list st-cats-hidden">
                {hidden.map((c) => (
                  <li key={c.id} className="st-cat-row">
                    <ListRow icon={c.icon} title={c.name} subtitle={`${roleText(c.defaultAccountRole)} · 숨김`} chevron={false} />
                    <Button variant="outline" icon="eye" onClick={() => void setHidden([c], false)} disabled={!!working} aria-label={`${c.name} 다시 보기`}>
                      다시 보기
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

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
