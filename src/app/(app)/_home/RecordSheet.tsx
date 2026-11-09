'use client';

import { useId, useState, type FormEvent } from 'react';
import { formatWon } from '@/domain';
import type { Expense, Id } from '@/domain';
import { useLedger } from '@/state';
import { Badge, Button, DateInput, Dialog, Field, Select, TextInput, useToast, focusFirstInvalid } from '@/ui';
import { accountIdForCategory, accountIdForSource, errorMessage, expenseTitle, type Source } from './selectors';
import styles from './home.module.css';

export interface RecordSheetProps {
  amount: number;
  source: Source;
  categoryId: Id | null;
  onClose: () => void;
  /** 기록이 끝나면 (label: 알림에 쓸 이름) */
  onRecorded: (expense: Expense, label: string) => void;
}

const SOURCE_LABEL: Record<Source, string> = { living: '생활비로', event: '이벤트통장으로' };

/**
 * [샀어요] 확인 시트. 날짜(기본 오늘) · 카테고리 · 내용 · 통장(어느 돈인지에 따라 자동, 바꿀 수 있음).
 * 열 때마다 새로 그려서 값이 초기화되도록 {open ? <RecordSheet/> : null} 로 쓰세요.
 */
export function RecordSheet({ amount, source, categoryId, onClose, onRecorded }: RecordSheetProps) {
  const ledger = useLedger();
  const toast = useToast();
  const formId = `record-${useId().replace(/:/g, '')}`;
  const livingAccountId = ledger.living?.livingAccountId ?? null;

  const [date, setDate] = useState(ledger.today);
  const [category, setCategory] = useState<string>(categoryId ?? '');
  const [memo, setMemo] = useState('');
  const [accountId, setAccountId] = useState<string>(
    () => accountIdForSource(source, livingAccountId, ledger.accountByRole) ?? ledger.activeAccounts[0]?.id ?? '',
  );
  const [accountTouched, setAccountTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

  const categories = ledger.activeCategories;

  function changeCategory(id: string) {
    setCategory(id);
    if (accountTouched) return;
    const cat = categories.find((c) => c.id === id);
    const next = cat ? accountIdForCategory(cat, livingAccountId, ledger.accountByRole) : null;
    if (next) setAccountId(next);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const badDate = !/^\d{4}-\d{2}-\d{2}$/.test(date);
    setDateError(badDate ? '날짜를 골라 주세요' : null);
    setAccountError(accountId ? null : '기록할 통장을 골라 주세요');
    if (badDate || !accountId) {
      focusFirstInvalid();
      return;
    }

    setSaving(true);
    try {
      const expense = await ledger.addExpense({
        date,
        amount,
        accountId,
        categoryId: category || null,
        memo: memo.trim(),
      });
      onRecorded(expense, expenseTitle(expense, categories));
    } catch (err) {
      toast.error(errorMessage(err, '지출을 기록하지 못했어요'));
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!saving) onClose();
      }}
      dismissible={!saving}
      title="지출로 기록할게요"
      actions={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            취소
          </Button>
          <Button type="submit" form={formId} loading={saving} icon="check">
            기록하기
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.sheetForm} onSubmit={submit} noValidate>
        <div className={styles.sheetSummary}>
          <span>
            <Badge tone={source === 'event' ? 'info' : 'brand'} size="sm">
              {SOURCE_LABEL[source]}
            </Badge>
          </span>
          <strong>{formatWon(amount)}</strong>
        </div>
        <Field label="날짜" error={dateError} required>
          <DateInput value={date} onChange={setDate} />
        </Field>
        <Field label="카테고리" optional>
          <Select
            value={category}
            onChange={changeCategory}
            options={[{ value: '', label: '고르지 않기' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
          />
        </Field>
        <Field label="내용" optional>
          <TextInput value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 운동화" maxLength={100} enterKeyHint="done" />
        </Field>
        <Field label="통장" error={accountError} hint="어느 돈으로 사는지에 따라 골라 뒀어요" required>
          <Select
            value={accountId}
            onChange={(v) => {
              setAccountId(v);
              setAccountTouched(true);
            }}
            placeholder={ledger.activeAccounts.length === 0 ? '통장이 없어요' : undefined}
            options={ledger.activeAccounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>
      </form>
    </Dialog>
  );
}
