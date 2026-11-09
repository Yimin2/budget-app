'use client';

import { useEffect, useId, useState } from 'react';
import { formatDateKo, formatWon } from '@/domain';
import type { Transfer, TransferKind } from '@/domain/types';
import { useLedger } from '@/state';
import { Badge, Button, Dialog, useToast } from '@/ui';
import { errorText } from './selectors';
import styles from './accounts.module.css';

const KIND_TITLE: Record<TransferKind, string> = {
  income: '수입',
  transfer: '이체',
  adjustment: '잔액 조정',
};

export interface TransferInfoDialogProps {
  transfer: Transfer;
  onClose: () => void;
}

/** 수입 · 이체 · 조정 기록 자세히 보기. 지우기는 같은 창에서 한 번 더 확인해요 */
export function TransferInfoDialog({ transfer: t, onClose }: TransferInfoDialogProps) {
  const ledger = useLedger();
  const toast = useToast();
  const uid = useId().replace(/:/g, '');
  const [step, setStep] = useState<'view' | 'confirm'>('view');
  const [moved, setMoved] = useState(false);
  const [saving, setSaving] = useState<'delete' | 'done' | null>(null);

  // 확인 단계로 넘어가거나 돌아오면 포커스를 옮겨요
  useEffect(() => {
    if (!moved) return;
    document.getElementById(step === 'confirm' ? `${uid}-keep` : `${uid}-delete`)?.focus();
  }, [moved, step, uid]);

  const accounts = ledger.data?.accounts ?? [];
  const name = (id: string | null) => (id ? (accounts.find((a) => a.id === id)?.name ?? '지운 통장') : null);
  const planned = t.status === 'planned';
  const pending = planned || t.date > ledger.today;
  const auto = t.ruleId !== null;
  const monthEnd = t.id.startsWith('monthend:');

  async function remove() {
    if (saving) return;
    setSaving('delete');
    try {
      await ledger.deleteTransfer(t.id);
      toast.success('기록을 지웠어요');
      onClose();
    } catch (err) {
      toast.error(errorText(err, '기록을 지우지 못했어요'));
      setSaving(null);
    }
  }

  /** 예정 이체를 실제로 옮겼으면: 완료 기록을 새로 남기고 예정 기록은 지워요 (날짜가 아직이면 오늘로) */
  async function markDone() {
    if (saving) return;
    setSaving('done');
    try {
      await ledger.addTransfer({
        date: t.date <= ledger.today ? t.date : ledger.today,
        kind: t.kind,
        fromAccountId: t.fromAccountId,
        toAccountId: t.toAccountId,
        amount: t.amount,
        memo: t.memo,
      });
    } catch (err) {
      toast.error(errorText(err, '기록하지 못했어요'));
      setSaving(null);
      return;
    }
    try {
      await ledger.deleteTransfer(t.id);
    } catch {
      toast.error('완료로 기록했지만 예정 기록을 지우지 못했어요. 예정 기록을 직접 지워 주세요');
      setSaving(null);
      return;
    }
    toast.success('옮긴 기록을 남겼어요. 이제 잔액에 들어가요');
    onClose();
  }

  const close = () => {
    if (!saving) onClose();
  };
  const summary = `${formatWon(t.amount)} · ${formatDateKo(t.date)}`;

  if (step === 'confirm') {
    return (
      <Dialog
        open
        onClose={close}
        dismissible={!saving}
        showClose={false}
        title="이 기록을 지울까요?"
        description={`${KIND_TITLE[t.kind]} ${summary}`}
        actions={
          <>
            <Button
              id={`${uid}-keep`}
              variant="outline"
              disabled={!!saving}
              onClick={() => {
                setStep('view');
                setMoved(true);
              }}
            >
              취소
            </Button>
            <Button variant="danger" icon="trash" loading={saving === 'delete'} onClick={() => void remove()}>
              지우기
            </Button>
          </>
        }
      >
        <p className={styles.note}>
          {auto
            ? '매달 배분으로 자동 기록된 이체예요. 지우면 이달 배분은 다시 만들지 않아요.'
            : pending
              ? '예정 기록을 지우면 이벤트통장 예측에서도 빠져요.'
              : '지우면 통장 잔액이 그만큼 바뀌어요.'}
        </p>
      </Dialog>
    );
  }

  const rows: { label: string; value: string }[] = [];
  const fromName = name(t.fromAccountId);
  const toName = name(t.toAccountId);
  if (fromName) rows.push({ label: t.kind === 'adjustment' ? '줄인 통장' : '보낸 통장', value: fromName });
  if (toName) rows.push({ label: t.kind === 'adjustment' ? '늘린 통장' : t.kind === 'income' ? '들어온 통장' : '받은 통장', value: toName });
  if (t.memo.trim()) rows.push({ label: '메모', value: t.memo.trim() });
  rows.push({ label: '기록한 사람', value: ledger.displayName(t.author) });

  return (
    <Dialog
      open
      onClose={close}
      dismissible={!saving}
      title={`${KIND_TITLE[t.kind]} 기록`}
      description={summary}
      actions={
        <>
          <Button variant="outline" onClick={close} disabled={!!saving}>
            닫기
          </Button>
          <Button
            id={`${uid}-delete`}
            variant="outline"
            icon="trash"
            className={styles.dangerOutline}
            disabled={!!saving}
            onClick={() => {
              setStep('confirm');
              setMoved(true);
            }}
          >
            지우기
          </Button>
          {planned ? (
            <Button icon="check" loading={saving === 'done'} onClick={() => void markDone()}>
              옮겼어요
            </Button>
          ) : null}
        </>
      }
    >
      <div className={styles.infoBadges}>
        {pending ? (
          <Badge size="sm" tone="info">
            예정
          </Badge>
        ) : (
          <Badge size="sm" tone="success">
            완료
          </Badge>
        )}
        {auto ? (
          <Badge size="sm" dot={false}>
            자동
          </Badge>
        ) : null}
      </div>
      <dl className={styles.preview}>
        {rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      {planned ? (
        <p className={styles.note}>아직 잔액에 들어가지 않은 예정 이체예요. 실제로 옮겼으면 &lsquo;옮겼어요&rsquo;를 눌러 주세요.</p>
      ) : pending ? (
        <p className={styles.note}>미래 날짜 기록이라 그날부터 잔액에 들어가요.</p>
      ) : null}
      {auto ? <p className={styles.note}>매달 배분 규칙으로 자동 기록됐어요. 금액은 설정의 매달 배분에서 바꿔요.</p> : null}
      {monthEnd ? <p className={styles.note}>월말 처리에서 남은 생활비를 저수지로 보낸 기록이에요.</p> : null}
    </Dialog>
  );
}
