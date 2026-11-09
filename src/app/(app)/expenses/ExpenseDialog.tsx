'use client';

import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { formatDateKo, formatShortDate, formatWon } from '@/domain';
import type { Category, Expense, Id, ISODate } from '@/domain/types';
import { useLedger } from '@/state';
import {
  Badge, Banner, Button, Chip, ChipGroup, DateInput, Dialog, Field, Icon, isIconName, MoneyInput, Select, TextInput, useToast, focusFirstInvalid,
} from '@/ui';
import { accountForCategory, errorText, expenseTitle, isISODate, linkableEvents } from './selectors';
import styles from './expenses.module.css';

export interface ExpenseDialogProps {
  /** 고칠 지출. 없으면 새로 기록해요 */
  expense?: Expense | null;
  /** 새로 기록할 때 미리 채울 값 */
  initial?: { date?: ISODate; accountId?: Id | null; categoryId?: Id | null };
  onClose: () => void;
  /** 기록 · 고치기 · 지우기가 끝나면 (창은 스스로 닫혀요) */
  onDone?: (expense: Expense, action: 'added' | 'updated' | 'deleted') => void;
  /** 닫을 때 연 행이 사라졌으면(지움) 포커스할 곳 */
  returnFocus?: () => HTMLElement | null | undefined;
}

type Errors = Partial<Record<'amount' | 'date' | 'account', string>>;

/** 카테고리 아이콘 이름 (모르는 이름이면 dots) */
export function categoryIcon(category: Pick<Category, 'icon'> | null | undefined) {
  return category && isIconName(category.icon) ? category.icon : 'dots';
}

/**
 * 지출 기록 · 고치기 창. 금액 → 카테고리(통장 자동 선택) → 날짜 · 통장 · 내용 · 일정 연결.
 * 고칠 때는 아래에 지우기가 있고, 같은 창 안에서 한 번 더 확인해요.
 * 열 때마다 새로 그려서 값이 초기화되도록 {open ? <ExpenseDialog/> : null} 로 쓰세요.
 */
export function ExpenseDialog({ expense, initial, onClose, onDone, returnFocus }: ExpenseDialogProps) {
  const ledger = useLedger();
  const toast = useToast();
  const uid = useId().replace(/:/g, '');
  const formId = `expense-${uid}`;
  const data = ledger.data;
  const editing = !!expense;
  const livingId = ledger.living?.livingAccountId ?? null;

  // 지운 카테고리 · 통장이라도 지금 지출이 쓰고 있으면 고를 수 있게 보여 줘요
  const categories = useMemo(() => {
    const list = [...ledger.activeCategories];
    const cur = expense?.categoryId ? data?.categories.find((c) => c.id === expense.categoryId) : undefined;
    if (cur && !list.some((c) => c.id === cur.id)) list.push(cur);
    return list;
  }, [ledger.activeCategories, data, expense]);
  const accounts = useMemo(() => {
    const list = [...ledger.activeAccounts];
    const cur = expense ? data?.accounts.find((a) => a.id === expense.accountId) : undefined;
    if (cur && !list.some((a) => a.id === cur.id)) list.push(cur);
    return list;
  }, [ledger.activeAccounts, data, expense]);
  const events = useMemo(() => (data ? linkableEvents(data, expense?.eventId ?? null) : []), [data, expense]);

  const startCategory = expense ? expense.categoryId : (initial?.categoryId ?? null);
  const [amount, setAmount] = useState<number | null>(expense?.amount ?? null);
  const [date, setDate] = useState<string>(expense?.date ?? initial?.date ?? ledger.today);
  const [categoryId, setCategoryId] = useState<Id | null>(startCategory);
  const [accountId, setAccountId] = useState<string>(
    () =>
      expense?.accountId ??
      initial?.accountId ??
      accountForCategory(categories.find((c) => c.id === startCategory), ledger.activeAccounts, livingId) ??
      '',
  );
  const [accountTouched, setAccountTouched] = useState(editing || !!initial?.accountId);
  const [memo, setMemo] = useState(expense?.memo ?? '');
  const [eventId, setEventId] = useState<string>(expense?.eventId ?? '');
  const [markDone, setMarkDone] = useState(true);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState<'save' | 'delete' | null>(null);
  const [step, setStep] = useState<'form' | 'confirm'>('form');

  // 지우기 확인으로 넘어가거나 돌아오면 포커스를 옮겨요 (같은 창이라 Dialog 가 옮겨 주지 않아요)
  const [stepChanged, setStepChanged] = useState(false);
  useEffect(() => {
    if (!stepChanged) return;
    document.getElementById(step === 'confirm' ? `${uid}-keep` : `${uid}-delete`)?.focus();
  }, [step, stepChanged, uid]);

  const selectedCategory = categories.find((c) => c.id === categoryId) ?? null;
  const autoAccount = !accountTouched && !!accountId;

  function pickCategory(id: Id | null) {
    setCategoryId(id);
    if (accountTouched) return;
    const next = accountForCategory(categories.find((c) => c.id === id), ledger.activeAccounts, livingId);
    if (next) setAccountId(next);
  }

  function pickEvent(id: string) {
    setEventId(id);
    const ev = events.find((e) => e.id === id);
    if (!ev || editing) return;
    if (amount === null) setAmount(ev.amount);
    if (!memo.trim()) setMemo(ev.name);
    if (categoryId === null && ev.categoryId) setCategoryId(ev.categoryId);
    if (!accountTouched && ev.accountId && ledger.activeAccounts.some((a) => a.id === ev.accountId)) setAccountId(ev.accountId);
  }

  function validate(): boolean {
    const next: Errors = {};
    if (amount === null || amount <= 0) next.amount = '금액을 입력해 주세요';
    if (!isISODate(date)) next.date = '날짜를 골라 주세요';
    if (!accountId) next.account = '어느 통장에서 나갔는지 골라 주세요';
    setErrors(next);
    if (Object.keys(next).length > 0) focusFirstInvalid();
    return Object.keys(next).length === 0;
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving || !validate()) return;
    const value = amount!;
    setSaving('save');
    try {
      if (expense) {
        const next: Expense = {
          ...expense,
          amount: value,
          date,
          categoryId,
          accountId,
          memo: memo.trim(),
          eventId: eventId || null,
        };
        await ledger.updateExpense(next);
        toast.success('지출을 고쳤어요');
        onDone?.(next, 'updated');
        onClose();
        return;
      }
      const created = await ledger.addExpense({
        date,
        amount: value,
        accountId,
        categoryId,
        memo: memo.trim(),
        eventId: eventId || null,
      });
      let completed = false;
      if (eventId && markDone) {
        try {
          await ledger.completeEvent(eventId, 0, date);
          completed = true;
        } catch (err) {
          toast.error(errorText(err, '일정을 완료로 바꾸지 못했어요'));
        }
      }
      const label = `${expenseTitle(created, selectedCategory)} ${formatWon(value)}`;
      if (completed) {
        toast.success(`${label} 기록하고 일정을 완료했어요`);
      } else {
        toast.success(`${label} 기록했어요`, {
          action: {
            label: '되돌리기',
            onClick: () => {
              ledger.deleteExpense(created.id).then(
                () => toast.show('기록을 되돌렸어요'),
                (err: unknown) => toast.error(errorText(err, '되돌리지 못했어요')),
              );
            },
          },
        });
      }
      onDone?.(created, 'added');
      onClose();
    } catch (err) {
      toast.error(errorText(err, expense ? '지출을 고치지 못했어요' : '지출을 기록하지 못했어요'));
      setSaving(null);
    }
  }

  async function remove() {
    if (!expense || saving) return;
    setSaving('delete');
    try {
      await ledger.deleteExpense(expense.id);
      toast.success('지출을 지웠어요', {
        action: {
          label: '되돌리기',
          onClick: () => {
            ledger.updateExpense({ ...expense, deleted: false }).then(
              () => toast.show('지출을 되살렸어요'),
              (err: unknown) => toast.error(errorText(err, '되돌리지 못했어요')),
            );
          },
        },
      });
      onDone?.(expense, 'deleted');
      onClose();
    } catch (err) {
      toast.error(errorText(err, '지출을 지우지 못했어요'));
      setSaving(null);
    }
  }

  function goStep(next: 'form' | 'confirm') {
    setStep(next);
    setStepChanged(true);
  }

  const close = () => {
    if (!saving) onClose();
  };

  if (step === 'confirm' && expense) {
    const cat = categories.find((c) => c.id === expense.categoryId);
    return (
      <Dialog
        open
        onClose={close}
        dismissible={!saving}
        showClose={false}
        returnFocus={returnFocus}
        title="이 지출을 지울까요?"
        description={`${expenseTitle(expense, cat)} ${formatWon(expense.amount)} · ${formatDateKo(expense.date)}`}
        actions={
          <>
            <Button id={`${uid}-keep`} variant="outline" onClick={() => goStep('form')} disabled={saving === 'delete'}>
              취소
            </Button>
            <Button variant="danger" icon="trash" onClick={() => void remove()} loading={saving === 'delete'}>
              지우기
            </Button>
          </>
        }
      >
        {expense.fixedExpenseId ? (
          <p className={styles.note}>매달 자동으로 기록된 고정 지출이에요. 지워도 다음 달 기록은 그대로 생겨요.</p>
        ) : (
          <p className={styles.note}>지운 기록은 잔액과 생활비 계산에서 빠져요.</p>
        )}
      </Dialog>
    );
  }

  const linkedEvent = events.find((e) => e.id === eventId) ?? null;
  const showEventField = events.length > 0;

  return (
    <Dialog
      open
      wide
      className={styles.sheet}
      returnFocus={returnFocus}
      onClose={close}
      dismissible={!saving}
      title={editing ? '지출 고치기' : '지출 기록'}
      actions={
        <>
          <Button variant="outline" onClick={close} disabled={!!saving}>
            취소
          </Button>
          <Button type="submit" form={formId} icon="check" loading={saving === 'save'} disabled={saving === 'delete'}>
            {editing ? '저장하기' : '기록하기'}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={save} noValidate>
        {expense?.fixedExpenseId ? (
          <Banner tone="info" title="매달 자동으로 기록된 고정 지출이에요">
            여기서 고쳐도 다음 달 기록은 설정의 금액으로 생겨요.
          </Banner>
        ) : null}

        <Field label="금액" error={errors.amount} required>
          <MoneyInput
            size="lg"
            value={amount}
            onChange={(v) => {
              setAmount(v);
              if (errors.amount) setErrors((x) => ({ ...x, amount: undefined }));
            }}
            data-autofocus=""
          />
        </Field>

        <fieldset className={styles.fieldset}>
          <legend className="label">
            카테고리 <span className="opt-text">(선택)</span>
          </legend>
          <ChipGroup label="카테고리">
            {categories.map((c) => (
              <Chip
                key={c.id}
                icon={categoryIcon(c)}
                selected={categoryId === c.id}
                onClick={() => pickCategory(categoryId === c.id ? null : c.id)}
              >
                {c.name}
              </Chip>
            ))}
          </ChipGroup>
        </fieldset>

        <div className={styles.formGrid}>
          <Field
            label="통장"
            error={errors.account}
            required
            hint={autoAccount ? (selectedCategory ? `${selectedCategory.name} 카테고리에 맞춰 골랐어요` : '생활비 통장으로 골라 뒀어요') : undefined}
          >
            <Select
              value={accountId}
              onChange={(v) => {
                setAccountId(v);
                setAccountTouched(true);
                if (errors.account) setErrors((x) => ({ ...x, account: undefined }));
              }}
              placeholder={accounts.length === 0 ? '통장이 없어요' : '통장 고르기'}
              options={accounts.map((a) => ({ value: a.id, label: a.deleted ? `${a.name} (지운 통장)` : a.name }))}
            />
          </Field>
          <Field label="날짜" error={errors.date} required>
            <DateInput
              value={date}
              onChange={(v) => {
                setDate(v);
                if (errors.date) setErrors((x) => ({ ...x, date: undefined }));
              }}
            />
          </Field>
        </div>

        <Field label="내용" optional>
          <TextInput value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 점심, 운동화" maxLength={100} enterKeyHint="done" />
        </Field>

        {showEventField ? (
          <Field
            label="이벤트 일정 연결"
            optional
            hint={editing ? undefined : '예정된 일정에 쓴 돈이면 골라 주세요. 금액과 내용을 채워 드려요.'}
          >
            <Select
              value={eventId}
              onChange={pickEvent}
              options={[
                { value: '', label: '연결하지 않기' },
                ...events.map((ev) => ({
                  value: ev.id,
                  label: `${formatShortDate(ev.date)} ${ev.name} · ${formatWon(ev.amount)}${ev.status === 'planned' ? '' : ' (완료)'}`,
                })),
              ]}
            />
          </Field>
        ) : null}

        {!editing && linkedEvent && linkedEvent.status === 'planned' ? (
          <label className={styles.check}>
            <input type="checkbox" checked={markDone} onChange={(e) => setMarkDone(e.target.checked)} />
            <span>
              <strong>&lsquo;{linkedEvent.name}&rsquo; 일정을 완료로 바꿔요</strong>
              <span className={styles.checkHint}>
                {linkedEvent.repeat === 'none' ? '이벤트 예정 목록에서 빠져요' : '다음 회차 일정이 새로 생겨요'}
              </span>
            </span>
          </label>
        ) : null}

        {editing ? (
          <div className={styles.dangerRow}>
            <span className={styles.meta}>
              {expense?.fixedExpenseId ? (
                <Badge size="sm" dot={false}>
                  자동
                </Badge>
              ) : null}
              <span>
                {expense ? `${ledger.displayName(expense.author)}님이 기록했어요` : null}
              </span>
            </span>
            <Button
              id={`${uid}-delete`}
              variant="ghost"
              icon="trash"
              className={styles.dangerBtn}
              onClick={() => goStep('confirm')}
              disabled={!!saving}
            >
              지우기
            </Button>
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}

/** 지출 줄 왼쪽 카테고리 아이콘 (화면 읽기에서는 숨김) */
export function CategoryIcon({ category, className }: { category: Category | null | undefined; className?: string }) {
  return (
    <span className={className} aria-hidden>
      <Icon name={categoryIcon(category)} size={20} />
    </span>
  );
}
