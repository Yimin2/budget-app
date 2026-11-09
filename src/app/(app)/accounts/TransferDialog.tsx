'use client';

import { useId, useState, type FormEvent } from 'react';
import { formatWon } from '@/domain';
import type { Account, Id } from '@/domain/types';
import { useLedger } from '@/state';
import { Button, DateInput, Dialog, Field, MoneyInput, SegmentedControl, Select, TextInput, useToast, focusFirstInvalid } from '@/ui';
import { isISODate } from '../expenses/selectors';
import { errorText, ro } from './selectors';
import styles from './accounts.module.css';

export type RecordMode = 'transfer' | 'income';

export interface TransferDialogProps {
  mode: RecordMode;
  /** 이체면 보내는 통장, 수입이면 받는 통장으로 미리 골라 둬요 */
  accountId?: Id | null;
  onClose: () => void;
}

type Errors = Partial<Record<'from' | 'to' | 'amount' | 'date', string>>;

function firstOther(accounts: Account[], id: Id | null | undefined): Id {
  return accounts.find((a) => a.id !== id)?.id ?? '';
}

/** 이체 기록(통장 → 통장) · 수입 기록(밖 → 통장). 위쪽 선택으로 둘을 오가요 */
export function TransferDialog({ mode: initialMode, accountId, onClose }: TransferDialogProps) {
  const ledger = useLedger();
  const toast = useToast();
  const formId = `transfer-${useId().replace(/:/g, '')}`;
  const accounts = ledger.activeAccounts;
  const preset = accountId && accounts.some((a) => a.id === accountId) ? accountId : null;
  const incomeAccounts = ledger.incomeAccounts;
  const incomeId = incomeAccounts[0]?.id ?? null;

  const [mode, setMode] = useState<RecordMode>(initialMode);
  const [from, setFrom] = useState<string>(() => preset ?? incomeId ?? accounts[0]?.id ?? '');
  const [to, setTo] = useState<string>(() =>
    initialMode === 'income' ? (preset ?? incomeId ?? accounts[0]?.id ?? '') : firstOther(accounts, preset ?? incomeId ?? accounts[0]?.id),
  );
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(ledger.today);
  const [memo, setMemo] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  function switchMode(next: RecordMode) {
    setMode(next);
    setErrors({});
    if (next === 'income') {
      if (preset) setTo(preset);
      else if (!to) setTo(incomeId ?? accounts[0]?.id ?? '');
    } else {
      const f = preset ?? from ?? incomeId ?? accounts[0]?.id ?? '';
      setFrom(f);
      if (!to || to === f) setTo(firstOther(accounts, f));
    }
  }

  function swap() {
    setFrom(to);
    setTo(from);
  }

  function validate(): boolean {
    const next: Errors = {};
    if (mode === 'transfer') {
      if (!from) next.from = '보내는 통장을 골라 주세요';
      if (from && from === to) next.to = '보내는 통장과 다른 통장을 골라 주세요';
    }
    if (!to) next.to = '받는 통장을 골라 주세요';
    if (amount === null || amount <= 0) next.amount = '금액을 입력해 주세요';
    if (!isISODate(date)) next.date = '날짜를 골라 주세요';
    setErrors(next);
    if (Object.keys(next).length > 0) focusFirstInvalid();
    return Object.keys(next).length === 0;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving || !validate()) return;
    setSaving(true);
    try {
      await ledger.addTransfer({
        date,
        kind: mode,
        fromAccountId: mode === 'income' ? null : from,
        toAccountId: to,
        amount: amount!,
        memo: memo.trim(),
      });
      const toName = accounts.find((a) => a.id === to)?.name ?? '';
      toast.success(
        mode === 'income'
          ? `${toName}에 ${formatWon(amount!)} 수입을 기록했어요`
          : `${toName}${ro(toName)} ${formatWon(amount!)} 옮긴 기록을 남겼어요`,
      );
      onClose();
    } catch (err) {
      toast.error(errorText(err, '기록하지 못했어요'));
      setSaving(false);
    }
  }

  const options = accounts.map((a) => ({ value: a.id, label: a.name }));
  // 수입은 사람별 수입통장을 앞에 둬요 (누구 월급인지 고르기 쉽게)
  const incomeOptions = [
    ...incomeAccounts.map((a) => ({ value: a.id, label: a.ownerName && !a.name.includes(a.ownerName) ? `${a.name} (${a.ownerName})` : a.name })),
    ...accounts.filter((a) => a.role !== 'income').map((a) => ({ value: a.id, label: a.name })),
  ];
  const future = isISODate(date) && date > ledger.today;

  return (
    <Dialog
      open
      className={styles.sheet}
      onClose={() => {
        if (!saving) onClose();
      }}
      dismissible={!saving}
      title={mode === 'income' ? '수입 기록' : '이체 기록'}
      description={mode === 'income' ? '월급처럼 밖에서 들어온 돈이에요.' : '내 통장끼리 옮긴 돈이에요.'}
      actions={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            취소
          </Button>
          <Button type="submit" form={formId} icon="check" loading={saving}>
            기록하기
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={submit} noValidate>
        <SegmentedControl
          ariaLabel="기록 종류"
          block
          value={mode}
          onChange={switchMode}
          options={[
            { value: 'transfer', label: '이체', icon: 'arrow-left-right' },
            { value: 'income', label: '수입', icon: 'coins' },
          ]}
        />

        {mode === 'transfer' ? (
          <div className={styles.fromTo}>
            <Field label="보내는 통장" error={errors.from} required>
              <Select value={from} onChange={setFrom} options={options} placeholder={options.length === 0 ? '통장이 없어요' : '통장 고르기'} />
            </Field>
            <Button
              variant="ghost"
              plain
              iconOnly
              icon="arrow-left-right"
              aria-label="보내는 통장과 받는 통장 바꾸기"
              className={styles.swap}
              onClick={swap}
            />
            <Field label="받는 통장" error={errors.to} required>
              <Select value={to} onChange={setTo} options={options} placeholder={options.length === 0 ? '통장이 없어요' : '통장 고르기'} />
            </Field>
          </div>
        ) : (
          <Field
            label={incomeAccounts.length > 1 ? '누구 수입인가요' : '받는 통장'}
            error={errors.to}
            required
            hint={incomeAccounts.length > 1 ? '월급을 받은 사람의 수입통장을 골라 주세요.' : undefined}
          >
            <Select value={to} onChange={setTo} options={incomeOptions} placeholder={options.length === 0 ? '통장이 없어요' : '통장 고르기'} />
          </Field>
        )}

        <Field label="금액" error={errors.amount} required>
          <MoneyInput
            value={amount}
            onChange={(v) => {
              setAmount(v);
              if (errors.amount) setErrors((x) => ({ ...x, amount: undefined }));
            }}
          />
        </Field>
        <Field label="날짜" error={errors.date} required hint={future ? '미래 날짜는 그날부터 잔액에 들어가요.' : undefined}>
          <DateInput value={date} onChange={setDate} />
        </Field>
        <Field label="메모" optional>
          <TextInput
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            maxLength={100}
            placeholder={mode === 'income' ? '예: 월급, 보너스' : '예: 비상금 옮기기'}
            enterKeyHint="done"
          />
        </Field>
      </form>
    </Dialog>
  );
}
