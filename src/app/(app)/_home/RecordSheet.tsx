'use client';

import { useId, useState, type FormEvent } from 'react';
import { canClaimOnAccount, formatWon, tripItemForCategory } from '@/domain';
import type { Expense, Id } from '@/domain';
import { useLedger } from '@/state';
import { Badge, Button, DateInput, Dialog, Field, Select, TextInput, useToast, focusFirstInvalid } from '@/ui';
import { ClaimFields } from '../_components/ClaimFields';
import { SpenderField } from '../_components/SpenderField';
import { accountIdForCategory, accountIdForSource, errorMessage, expenseTitle, type Source } from './selectors';
import styles from './home.module.css';
import { accountOptions } from '../settings/helpers';

export interface RecordSheetProps {
  amount: number;
  source: Source;
  categoryId: Id | null;
  /** 사도 돼?에서 고른 여행 (여행에 묶어 기록해요) */
  tripId?: Id | null;
  /** 사도 돼?에서 고른 사람 (누가 썼나요? 기본값, spenders 키). 없으면 나 */
  spenderKey?: string | null;
  onClose: () => void;
  /** 기록이 끝나면 (label: 알림에 쓸 이름) */
  onRecorded: (expense: Expense, label: string) => void;
}

const SOURCE_LABEL: Record<Source, string> = { living: '생활비로', event: '이벤트통장으로' };

/**
 * [샀어요] 확인 시트. 날짜(기본 오늘) · 카테고리 · 내용 · 통장(어느 돈인지에 따라 자동, 바꿀 수 있음).
 * 열 때마다 새로 그려서 값이 초기화되도록 {open ? <RecordSheet/> : null} 로 쓰세요.
 */
export function RecordSheet({ amount, source, categoryId, tripId = null, spenderKey = null, onClose, onRecorded }: RecordSheetProps) {
  const ledger = useLedger();
  const toast = useToast();
  const formId = `record-${useId().replace(/:/g, '')}`;
  // 누가 썼나요? (기본: 사도 돼?에서 고른 사람 → 나). 고른 사람의 생활비 통장으로 기록해요
  const [pickedSpender, setSpender] = useState<string | null>(null);
  const spender = pickedSpender ?? spenderKey ?? ledger.mySpenderKey ?? null;
  const spenderLiving = (key: string | null) =>
    (key ? ledger.spenders.find((s) => s.key === key)?.livingAccountId : null) ??
    ledger.myLivingAccountId ??
    ledger.living?.livingAccountId ??
    null;
  const livingAccountId = spenderLiving(spender);

  const [date, setDate] = useState(ledger.today);
  const [category, setCategory] = useState<string>(categoryId ?? '');
  const [memo, setMemo] = useState('');
  const [accountId, setAccountId] = useState<string>(
    () => accountIdForSource(source, livingAccountId, ledger.accountByRole) ?? ledger.activeAccounts[0]?.id ?? '',
  );
  const [accountTouched, setAccountTouched] = useState(false);
  const [paidBy, setPaidBy] = useState<string | null>(null);
  const [payerError, setPayerError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

  const categories = ledger.activeCategories;
  const tripName = tripId ? (ledger.data?.trips.find((t) => t.id === tripId)?.name ?? null) : null;

  function changeCategory(id: string) {
    setCategory(id);
    if (accountTouched) return;
    const cat = categories.find((c) => c.id === id);
    const next = cat ? accountIdForCategory(cat, livingAccountId, ledger.accountByRole) : null;
    if (next) setAccountId(next);
  }

  function changeSpender(key: string) {
    setSpender(key);
    if (accountTouched) return;
    const living = spenderLiving(key);
    const cat = categories.find((c) => c.id === category);
    const next = cat ? accountIdForCategory(cat, living, ledger.accountByRole) : accountIdForSource(source, living, ledger.accountByRole);
    if (next) setAccountId(next);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const badDate = !/^\d{4}-\d{2}-\d{2}$/.test(date);
    setDateError(badDate ? '날짜를 골라 주세요' : null);
    // 개인 돈으로 냈다고 골랐는데 청구할 수 없는 통장이면 막아요 (조용히 보통 지출로 기록하지 않게)
    const payer = paidBy !== null ? paidBy.trim() : null;
    const wrongAccount = payer !== null && !!accountId && !!ledger.data && !canClaimOnAccount(ledger.data, accountId);
    setAccountError(
      !accountId ? '기록할 통장을 골라 주세요' : wrongAccount ? '개인 돈으로 낸 지출은 이벤트통장 · 고정지출통장 · 저수지통장 중에서 골라 주세요' : null,
    );
    setPayerError(payer === '' ? '누가 냈는지 골라 주세요' : undefined);
    if (badDate || !accountId || wrongAccount || payer === '') {
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
        paidBy: payer,
        tripId,
        tripItem: tripId ? tripItemForCategory(categories.find((c) => c.id === category)?.name) : null,
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
            {tripName ? (
              <Badge tone="neutral" size="sm" dot={false}>
                {tripName}
              </Badge>
            ) : null}
          </span>
          <strong>{formatWon(amount)}</strong>
        </div>
        <SpenderField value={spender} onChange={(key) => changeSpender(key)} disabled={saving} />
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
              setAccountError(null);
            }}
            placeholder={ledger.activeAccounts.length === 0 ? '통장이 없어요' : undefined}
            options={accountOptions(ledger.activeAccounts)}
          />
        </Field>
        <ClaimFields
          accountId={accountId}
          amount={amount}
          paidBy={paidBy}
          onChange={(v) => {
            setPaidBy(v);
            setPayerError(undefined);
            if (v === null) setAccountError(null);
          }}
          disabled={saving}
          error={payerError}
        />
      </form>
    </Dialog>
  );
}
