'use client';

import { useId, useState, type FormEvent } from 'react';
import { formatWon, seriesAnchorDay } from '@/domain';
import type { PlannedEvent } from '@/domain';
import { useLedger } from '@/state';
import { Button, DateInput, Dialog, Field, Icon, MoneyInput, useToast } from '@/ui';
import { dateLabel, defaultCompleteDate, errorText, nextOccurrence, REPEAT_LABEL } from './selectors';
import styles from './events.module.css';

export interface CompleteDialogProps {
  event: PlannedEvent;
  onClose: () => void;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * '썼어요' — 실제로 쓴 금액(기본 = 예상 금액)과 날짜를 받아 지출로 기록하고 일정을 완료로 바꿔요.
 * 반복 일정이면 다음 회차가 새로 생겨요. 0원이면 지출 없이 완료만 해요.
 */
export function CompleteDialog({ event, onClose }: CompleteDialogProps) {
  const ledger = useLedger();
  const toast = useToast();
  const ids = useId().replace(/:/g, '');
  // 이 일정에 이미 연결해 쓴 돈(예약금 등)이 있으면 남은 금액을 기본값으로 (같은 돈을 두 번 기록하지 않게)
  const paid = (ledger.data?.expenses ?? []).reduce(
    (sum, x) => (!x.deleted && x.eventId === event.id && x.id !== `event:${event.id}` ? sum + x.amount : sum),
    0,
  );
  const remaining = Math.max(0, event.amount - paid);
  const [amount, setAmount] = useState<number | null>(remaining);
  const [date, setDate] = useState(defaultCompleteDate(event, ledger.today));
  const [error, setError] = useState<{ amount?: string; date?: string }>({});
  const [saving, setSaving] = useState(false);

  const account = ledger.activeAccounts.find((a) => a.id === event.accountId) ?? null;
  const next = nextOccurrence(
    event.date,
    event.repeat,
    event.repeat === 'none' ? undefined : seriesAnchorDay(ledger.data?.events ?? [], event),
  );
  const diff = amount === null ? 0 : paid + amount - event.amount;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const found: { amount?: string; date?: string } = {};
    if (amount === null || amount < 0) found.amount = '쓴 금액을 입력해 주세요';
    if (!DATE_RE.test(date)) found.date = '쓴 날을 골라 주세요';
    setError(found);
    if (found.amount || found.date) {
      document.getElementById(`${ids}-${found.amount ? 'amount' : 'date'}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      await ledger.completeEvent(event.id, amount!, date);
      toast.success(
        amount! > 0 ? `‘${event.name}’ ${formatWon(amount!)} 기록했어요` : `‘${event.name}’ 일정을 마쳤어요`,
      );
      onClose();
    } catch (err) {
      toast.error(errorText(err, '기록하지 못했어요. 잠시 뒤 다시 해 주세요'));
      setSaving(false);
    }
  }

  const formId = `${ids}-form`;
  return (
    <Dialog
      open
      onClose={saving ? () => {} : onClose}
      dismissible={!saving}
      title={`‘${event.name}’에 얼마 썼어요?`}
      description="실제로 쓴 금액을 적으면 지출로 기록하고 일정을 마쳐요"
      actions={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            닫기
          </Button>
          <Button type="submit" form={formId} loading={saving} icon="check">
            기록하기
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.expected}>
          <span>예상 금액</span>
          <strong>{formatWon(event.amount)}</strong>
        </div>
        {paid > 0 ? (
          <div className={styles.expected}>
            <span>이미 쓴 돈</span>
            <strong>{formatWon(paid)}</strong>
          </div>
        ) : null}
        <Field label="쓴 금액" required error={error.amount} id={`${ids}-amount`}>
          <MoneyInput value={amount} onChange={setAmount} size="lg" data-autofocus="" />
        </Field>
        {amount !== null && !error.amount ? (
          <p className={styles.diff} aria-live="polite">
            <Icon name="info" size={20} />
            <span>
              {amount === 0
                ? '0원이면 지출은 기록하지 않고 일정만 마쳐요'
                : diff === 0
                  ? `예상대로 썼어요 · ${account?.name ?? '통장'}에서 나간 걸로 기록해요`
                  : `예상보다 ${formatWon(Math.abs(diff))} ${diff < 0 ? '덜' : '더'} 썼어요 · 차이는 ${account?.name ?? '통장'} 잔액에 그대로 반영돼요`}
            </span>
          </p>
        ) : null}
        <Field
          label="쓴 날"
          required
          error={error.date}
          hint={error.date ? undefined : DATE_RE.test(date) ? dateLabel(date, ledger.today) : undefined}
          id={`${ids}-date`}
        >
          <DateInput value={date} onChange={setDate} />
        </Field>
        {next ? (
          <p className={styles.diff}>
            <Icon name="repeat" size={20} />
            <span>
              {REPEAT_LABEL[event.repeat]} 반복 일정이라 다음 일정({dateLabel(next, ledger.today, false)})을 새로
              만들어요
            </span>
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
