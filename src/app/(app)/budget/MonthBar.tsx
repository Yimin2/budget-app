'use client';

import { useState } from 'react';
import { addMonths, compareMonth, earliestBudgetMonth, formatMonthKo, monthOf, nextBudgetMonth, type BudgetMonthView } from '@/domain';
import { Badge, Button, Card } from '@/ui';
import type { ReadyLedger } from '../_components/RequireLedger';
import { useRunner } from '../settings/useRunner';
import { PAST_READ_ONLY } from './monthLedger';
import styles from './budget.module.css';

const KIND_TEXT = { past: '지난 달', current: '이번 달', next: '다음 달' } as const;

/** 예산 맨 위 ◀ 2026년 11월 ▶ (작업정리 13): 지난 달 ~ 다음 달. 다음 달에서는 ▶ 이 꺼져요 */
export function MonthSwitcher({
  ledger,
  view,
  onChange,
}: {
  ledger: ReadyLedger;
  view: BudgetMonthView;
  onChange: (month: string) => void;
}) {
  const min = earliestBudgetMonth(ledger.data, ledger.today);
  const max = nextBudgetMonth(ledger.today);
  const thisMonth = monthOf(ledger.today);
  return (
    <div className={styles.monthBar} role="group" aria-label="예산 달 고르기">
      <Button
        variant="ghost"
        plain
        iconOnly
        icon="chevron-left"
        aria-label="이전 달"
        onClick={() => onChange(addMonths(view.month, -1))}
        disabled={compareMonth(view.month, min) <= 0}
      />
      <h2 className={styles.monthTitle} aria-live="polite" data-testid="budget-month">
        {formatMonthKo(view.month, 0)}
      </h2>
      <Button
        variant="ghost"
        plain
        iconOnly
        icon="chevron-right"
        aria-label="다음 달"
        onClick={() => onChange(addMonths(view.month, 1))}
        disabled={compareMonth(view.month, max) >= 0}
      />
      <Badge size="sm" tone={view.kind === 'next' ? 'info' : 'neutral'}>
        {KIND_TEXT[view.kind]}
      </Badge>
      {view.kind !== 'current' ? (
        <Button variant="ghost" onClick={() => onChange(thisMonth)}>
          이번 달
        </Button>
      ) : null}
    </div>
  );
}

/** 달마다 맨 위 안내: 지난 달 = 보기만, 다음 달 = 준비 안 함(빈 화면 + [전달 복사]) / 준비함([초기화]) */
export function MonthNotice({ ledger, view }: { ledger: ReadyLedger; view: BudgetMonthView }) {
  const { busy, run } = useRunner();
  const [confirmReset, setConfirmReset] = useState(false);
  const year = Number(ledger.today.slice(0, 4));
  const cur = formatMonthKo(monthOf(ledger.today), year);
  const next = formatMonthKo(view.month, year);

  if (view.kind === 'past') {
    return (
      <p className={styles.monthNote} role="note" data-testid="month-note">
        {PAST_READ_ONLY}
      </p>
    );
  }
  if (view.kind !== 'next') return null;

  if (view.empty) {
    return (
      <Card className={styles.monthEmpty} data-testid="next-empty">
        <h2 className={styles.monthEmptyTitle}>{next} 예산은 아직 준비하지 않았어요</h2>
        <p className={styles.monthEmptyText}>
          그대로 두면 {cur} 예산이 {next}에도 저절로 이어져요. [전달 복사]를 누르면 {cur} 예산을 {next}로 옮겨 와서, 그다음부터는 {next}만 따로 고칠 수 있어요.
        </p>
        <div className={styles.monthActions}>
          <Button loading={busy === 'copy'} onClick={() => void run('copy', () => ledger.prepareNextMonth(), `${cur} 예산을 ${next}로 복사했어요`)}>
            전달 복사
          </Button>
          <Button variant="outline" disabled>
            초기화
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className={styles.monthPrepared} data-testid="next-prepared">
      <p className={styles.monthNote} role="note">
        {next} 예산은 {cur}과 따로 고쳐요. 여기서 바꾸면 {next}부터만 적용돼요. 할부는 {cur} 화면에서 고쳐요.
      </p>
      {confirmReset ? (
        <div className={styles.monthConfirm} role="group" aria-label="초기화 확인">
          <p className={styles.monthConfirmText}>
            {next}에 고친 내용을 지우고 다시 {cur} 예산이 이어지게 할까요?
          </p>
          <div className={styles.monthActions}>
            <Button
              variant="danger"
              loading={busy === 'reset'}
              onClick={() =>
                void run('reset', () => ledger.resetNextMonth(), `${next} 예산을 비웠어요`).then((ok) => {
                  if (ok) setConfirmReset(false);
                })
              }
            >
              초기화할게요
            </Button>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              그대로 둘게요
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.monthActions}>
          <Button variant="outline" disabled>
            전달 복사
          </Button>
          <Button variant="outline" onClick={() => setConfirmReset(true)}>
            초기화
          </Button>
        </div>
      )}
    </div>
  );
}
