'use client';

import { useState } from 'react';
import type { AccountRole, Category } from '@/domain/types';
import { Button, Card, ConfirmDialog, Dialog, EmptyState, Field, ListRow, Select, TextInput, focusFirstInvalid } from '@/ui';
import type { ReadyLedger } from '../../_components/RequireLedger';
import { ROLE_TEXT, categoryRoleOptions } from '../helpers';
import { useRunner } from '../useRunner';
import { IconPicker } from './IconPicker';

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

  async function remove(c: Category) {
    const ok = await run('delete', () => ledger.saveCategory({ ...c, deleted: true }), '카테고리를 지웠어요');
    if (ok) setConfirmDelete(null);
  }

  return (
    <Card id="st-categories" title="카테고리" aside={<span className="muted">{categories.length}개</span>}>
      <p className="st-desc">지출을 기록할 때 카테고리를 고르면 정해 둔 통장이 자동으로 골라져요.</p>
      {categories.length === 0 ? (
        <EmptyState icon="tag" headingLevel={3} title="카테고리가 없어요" description="식비·카페처럼 지출을 나눌 카테고리를 추가해 주세요." />
      ) : (
        <ul className="list st-cats">
          {categories.map((c) => (
            <li key={c.id}>
              <ListRow icon={c.icon} title={c.name} subtitle={roleText(c.defaultAccountRole)} onClick={() => openEdit(c)} />
            </li>
          ))}
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
