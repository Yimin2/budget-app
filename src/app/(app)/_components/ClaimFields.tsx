'use client';

import { useId } from 'react';
import { claimMessage } from '@/domain';
import type { Expense, Id, ISODate } from '@/domain/types';
import { useLedger, useSession } from '@/state';
import { Field, Icon, Select, TextInput } from '@/ui';
import styles from './claims.module.css';

export interface ClaimFieldsProps {
  /** 지출이 기록될 통장 */
  accountId: Id;
  /** 금액 (없으면 null) */
  amount: number | null;
  /** 낸 사람 (null = 통장에서 바로 나감) */
  paidBy: string | null;
  onChange: (paidBy: string | null) => void;
  /** 고치는 지출 (정산일 미리보기에서 자기 자신을 다른 청구로 세지 않게) */
  expense?: Expense | null;
  /** 이미 돌려준 청구면 true (바꿀 수 없어요) */
  settled?: boolean;
  disabled?: boolean;
  /** 낸 사람 오류 문구 */
  error?: string;
}

/**
 * '개인 돈으로 냈어요' 선택 + 낸 사람 + 언제 돌려주는지 미리보기 (PLAN 4-9).
 * 이벤트통장 · 고정지출통장 · 저수지통장에 기록할 때만 보여요. 이미 낸 사람이 있는 지출은 다른 통장이어도 보여서 끌 수 있어요
 */
export function ClaimFields({ accountId, amount, paidBy, onChange, expense, settled, disabled, error }: ClaimFieldsProps) {
  const ledger = useLedger();
  const session = useSession();
  const uid = useId().replace(/:/g, '');
  const due: ISODate | null = ledger.previewClaimDue?.(accountId, amount ?? 0, expense?.id) ?? null;
  const checked = paidBy !== null;
  if (due === null && !checked) return null;

  const payers = [...(ledger.claimPayers ?? [])];
  if (paidBy && paidBy.trim() && !payers.includes(paidBy)) payers.push(paidBy);
  const me = session.user ? ledger.displayName(session.user.email) : '';

  function toggle(on: boolean) {
    if (!on) {
      onChange(null);
      return;
    }
    onChange(payers.includes(me) ? me : (payers[0] ?? ''));
  }

  const name = paidBy?.trim() ?? '';
  return (
    <div className={styles.claim}>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled || settled}
          onChange={(e) => toggle(e.target.checked)}
          aria-describedby={`${uid}-hint`}
        />
        <span>
          <strong>개인 돈으로 냈어요</strong>
          <span id={`${uid}-hint`} className={styles.checkHint}>
            {settled ? '이미 돌려줬어요' : '나중에 정산일에 돌려받아요'}
          </span>
        </span>
      </label>
      {checked && !settled ? (
        <>
          {payers.length > 0 ? (
            <Field label="누가 냈나요?" required error={error}>
              <Select
                value={name}
                onChange={(v) => onChange(v)}
                disabled={disabled}
                placeholder="낸 사람 고르기"
                options={payers.map((p) => ({ value: p, label: p }))}
              />
            </Field>
          ) : (
            <Field label="누가 냈나요?" required error={error}>
              <TextInput value={paidBy ?? ''} maxLength={20} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder="이름" />
            </Field>
          )}
          {name && due !== null && amount !== null && amount > 0 ? (
            <p className={styles.notice} aria-live="polite">
              <Icon name="info" size={20} />
              <span>{claimMessage({ payer: name, amount, due }, ledger.today)}</span>
            </p>
          ) : null}
          {due === null ? (
            <p className={styles.notice}>
              <Icon name="info" size={20} />
              <span>개인 돈으로 낸 지출은 이벤트통장 · 고정지출통장 · 저수지통장 중에서 골라 주세요.</span>
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** 기록 직후 알림 문구에 붙일 청구 안내 (청구가 아니면 '') */
export function claimToastSuffix(expense: Expense, today: ISODate): string {
  if (!expense.paidBy || !expense.claimDue) return '';
  return ` · ${claimMessage({ payer: expense.paidBy, amount: expense.amount, due: expense.claimDue }, today)}`;
}
