'use client';

import { useState } from 'react';
import type { Favorite } from '@/domain/types';
import { Button, Card, ConfirmDialog, Dialog, EmptyState, Field, ListRow, Money, MoneyInput, Select, TextInput, focusFirstInvalid } from '@/ui';
import type { ReadyLedger } from '../../_components/RequireLedger';
import { accountName } from '../helpers';
import { useRunner } from '../useRunner';

interface Draft {
  id: string | null;
  name: string;
  amount: number | null;
  categoryId: string;
  accountId: string;
}

type Errors = Partial<Record<'name' | 'amount', string>>;

/** 자주 쓰는 지출: 홈에서 한 번에 기록하는 버튼 (이름 · 금액 · 카테고리 · 통장) */
export function FavoritesCard({ ledger }: { ledger: ReadyLedger }) {
  const { busy, run } = useRunner();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmDelete, setConfirmDelete] = useState<Favorite | null>(null);
  const favorites = ledger.data.favorites.filter((f) => !f.deleted).sort((a, b) => a.order - b.order);
  const accounts = ledger.activeAccounts;
  const categories = ledger.activeCategories;
  const editing = draft?.id ? ledger.data.favorites.find((f) => f.id === draft.id) : undefined;

  const categoryOptions = [{ value: '', label: '없음' }, ...categories.map((c) => ({ value: c.id, label: c.name }))];
  const accountOptions = [{ value: '', label: '카테고리에 맞춰 자동으로' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))];

  function openNew() {
    setErrors({});
    setDraft({ id: null, name: '', amount: null, categoryId: '', accountId: '' });
  }
  function openEdit(f: Favorite) {
    setErrors({});
    setDraft({ id: f.id, name: f.name, amount: f.amount, categoryId: f.categoryId ?? '', accountId: f.accountId ?? '' });
  }

  function describe(f: Favorite): string {
    const cat = f.categoryId ? categories.find((c) => c.id === f.categoryId)?.name : null;
    const acc = f.accountId ? accountName(accounts, f.accountId) : null;
    return [cat ?? '카테고리 없음', acc].filter(Boolean).join(' · ');
  }

  async function save() {
    if (!draft) return;
    const next: Errors = {};
    if (!draft.name.trim()) next.name = '이름을 입력해 주세요';
    if (draft.amount === null || draft.amount <= 0) next.amount = '금액을 입력해 주세요';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusFirstInvalid();
      return;
    }
    const fields = {
      name: draft.name.trim(),
      amount: draft.amount!,
      categoryId: draft.categoryId || null,
      accountId: draft.accountId || null,
    };
    const ok = await run(
      'save',
      async () => {
        if (!draft.id) {
          await ledger.addFavorite(fields);
          return;
        }
        const prev = ledger.data.favorites.find((f) => f.id === draft.id);
        if (!prev) throw new Error('자주 쓰는 지출을 찾을 수 없어요');
        await ledger.saveFavorite({ ...prev, ...fields });
      },
      draft.id ? '저장했어요' : '자주 쓰는 지출을 추가했어요',
    );
    if (ok) setDraft(null);
  }

  async function remove(f: Favorite) {
    const ok = await run('delete', () => ledger.saveFavorite({ ...f, deleted: true }), '자주 쓰는 지출을 지웠어요');
    if (ok) setConfirmDelete(null);
  }

  return (
    <Card id="st-favorites" title="자주 쓰는 지출" aside={<span className="muted">{favorites.length}개</span>}>
      <p className="st-desc">홈에서 한 번 눌러 바로 기록해요.</p>
      {favorites.length === 0 ? (
        <EmptyState
          icon="sparkles"
          headingLevel={3}
          title="자주 쓰는 지출이 없어요"
          description="커피·점심처럼 자주 쓰는 지출을 등록해 두면 금액을 입력하지 않아도 돼요."
        />
      ) : (
        <ul className="list">
          {favorites.map((f) => {
            const cat = f.categoryId ? categories.find((c) => c.id === f.categoryId) : undefined;
            return (
              <li key={f.id}>
                <ListRow
                  icon={cat?.icon ?? 'sparkles'}
                  title={f.name}
                  subtitle={describe(f)}
                  trailing={<Money amount={f.amount} />}
                  onClick={() => openEdit(f)}
                />
              </li>
            );
          })}
        </ul>
      )}
      <div className="st-foot">
        <Button variant="outline" icon="plus" onClick={openNew}>
          자주 쓰는 지출 추가
        </Button>
      </div>

      <Dialog
        open={draft !== null}
        onClose={() => (busy ? undefined : setDraft(null))}
        title={draft?.id ? '자주 쓰는 지출 고치기' : '자주 쓰는 지출 추가'}
        actions={
          <>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={busy !== null}>
              취소
            </Button>
            <Button type="submit" form="st-favorite-form" loading={busy === 'save'}>
              저장
            </Button>
          </>
        }
      >
        {draft ? (
          <form
            id="st-favorite-form"
            className="stack"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field label="이름" error={errors.name} required>
              <TextInput
                value={draft.name}
                maxLength={20}
                placeholder="예: 커피"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                data-autofocus=""
              />
            </Field>
            <Field label="금액" error={errors.amount} required>
              <MoneyInput value={draft.amount} onChange={(v) => setDraft({ ...draft, amount: v })} />
            </Field>
            <Field label="카테고리" optional>
              <Select value={draft.categoryId} onChange={(v) => setDraft({ ...draft, categoryId: v })} options={categoryOptions} />
            </Field>
            <Field label="통장" optional hint="비워 두면 카테고리의 기본 통장에서 나가요.">
              <Select value={draft.accountId} onChange={(v) => setDraft({ ...draft, accountId: v })} options={accountOptions} />
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
                  지우기
                </Button>
              </div>
            ) : null}
          </form>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={confirmDelete !== null}
        tone="danger"
        title="자주 쓰는 지출을 지울까요?"
        description={`${confirmDelete?.name ?? ''}: 홈 버튼에서 빠져요. 이미 기록한 지출은 그대로 남아요.`}
        confirmLabel="지우기"
        loading={busy === 'delete'}
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </Card>
  );
}
