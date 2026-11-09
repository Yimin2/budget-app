'use client';

import { useId, useState, type FormEvent } from 'react';
import { formatWon } from '@/domain';
import type { Account, Won } from '@/domain/types';
import { useLedger } from '@/state';
import { Button, Dialog, Field, Money, MoneyInput, useToast } from '@/ui';
import { errorText } from './selectors';
import styles from './accounts.module.css';

export interface AdjustDialogProps {
  account: Account;
  /** 오늘 기준 기록된 잔액 */
  balance: Won;
  onClose: () => void;
}

/** 실제 잔액 맞추기: 통장 앱 잔액을 적으면 차이를 미리 보여 주고, 차이만큼 '조정' 기록을 남겨요 */
export function AdjustDialog({ account, balance, onClose }: AdjustDialogProps) {
  const ledger = useLedger();
  const toast = useToast();
  const formId = `adjust-${useId().replace(/:/g, '')}`;
  const [actual, setActual] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const diff = actual === null ? null : actual - balance;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving || actual === null || diff === null || diff === 0) return;
    setSaving(true);
    try {
      await ledger.adjustBalance(account.id, actual);
      toast.success(`${account.name} 잔액을 ${formatWon(actual)}으로 맞췄어요`);
      onClose();
    } catch (err) {
      toast.error(errorText(err, '잔액을 맞추지 못했어요'));
      setSaving(false);
    }
  }

  const message =
    diff === null
      ? '실제 잔액을 적으면 차이를 보여 드려요.'
      : diff === 0
        ? '기록과 같아요. 맞출 게 없어요.'
        : diff > 0
          ? `${formatWon(diff)} 늘리는 '조정' 기록을 남겨요.`
          : `${formatWon(-diff)} 줄이는 '조정' 기록을 남겨요.`;

  return (
    <Dialog
      open
      onClose={() => {
        if (!saving) onClose();
      }}
      dismissible={!saving}
      title="실제 잔액 맞추기"
      description={`${account.name}의 은행 앱 잔액을 적어 주세요.`}
      actions={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            취소
          </Button>
          <Button type="submit" form={formId} icon="check" loading={saving} disabled={diff === null || diff === 0}>
            잔액 맞추기
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={submit} noValidate>
        <Field label="실제 잔액" hint="은행 앱에 보이는 지금 잔액이에요.">
          <MoneyInput size="lg" value={actual} onChange={setActual} allowNegative data-autofocus="" />
        </Field>
        <dl className={styles.preview}>
          <div>
            <dt>기록된 잔액</dt>
            <dd>
              <Money amount={balance} />
            </dd>
          </div>
          <div>
            <dt>실제 잔액</dt>
            <dd>{actual === null ? <span className="muted">-</span> : <Money amount={actual} />}</dd>
          </div>
          <div className={styles.previewDiff}>
            <dt>차이</dt>
            <dd>{diff === null ? <span className="muted">-</span> : <Money amount={diff} signed colored />}</dd>
          </div>
        </dl>
        <p className={styles.note} role="status" aria-live="polite">
          {message}
        </p>
      </form>
    </Dialog>
  );
}
