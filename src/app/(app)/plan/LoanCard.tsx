'use client';

import { useId, useState } from 'react';
import { formatMan, formatShortDate, formatWon, settledReservoirEventClaims } from '@/domain';
import type { Expense, LedgerData } from '@/domain';
import { useLedger } from '@/state';
import { Badge, Button, Card, Icon, cx, useToast } from '@/ui';
import styles from '../_components/claims.module.css';

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function expenseTitle(data: LedgerData, e: Expense): string {
  const memo = e.memo.trim();
  if (memo) return memo;
  const cat = e.categoryId ? data.categories.find((x) => x.id === e.categoryId)?.name : undefined;
  return cat ?? '지출';
}

/**
 * 저수지에 갚을 돈 (PLAN 4-9). 저수지에 '줄' 돈은 없고, 빌린 돈을 '갚을' 돈만 있어요.
 * 한 줄: '저수지에 갚을 돈 385만 · 이번 달 갚기 제안 10만 [갚았어요]'. 누르면 자세히: 갚은 기록 되돌리기 ·
 * 저수지에서 이미 지급한 이벤트 청구를 한 번에 갚을 돈으로 바꾸기 · 저수지에서 쓴 이벤트 지출을 하나씩 바꾸기 · 빌리고 갚은 기록.
 * 자동으로 옮기지 않아요
 */
export function LoanCard() {
  const ledger = useLedger();
  const toast = useToast();
  const titleId = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const s = ledger.settlement;
  const data = ledger.data;
  if (!s || !data || !s.reservoirAccountId) return null;
  const { loan, repay } = s;
  const candidates = ledger.loanCandidates;
  const settled = settledReservoirEventClaims(data);
  if (loan.borrowed === 0 && loan.repaid === 0 && candidates.length === 0 && settled.length === 0) return null;
  const expenseById = new Map(data.expenses.map((e) => [e.id, e]));

  async function act(key: string, work: () => Promise<void>, message: string, undo?: () => Promise<void>) {
    if (busy) return;
    setBusy(key);
    try {
      await work();
      toast.success(
        message,
        undo
          ? {
              action: {
                label: '되돌리기',
                onClick: () => {
                  undo().then(
                    () => toast.show('되돌렸어요'),
                    (e: unknown) => toast.error(errorText(e, '되돌리지 못했어요')),
                  );
                },
              },
            }
          : undefined,
      );
    } catch (e) {
      toast.error(errorText(e, '저장하지 못했어요'));
    } finally {
      setBusy(null);
    }
  }

  const settledIds = settled.map((e) => e.id);
  const settledTotal = settled.reduce((t, e) => t + e.amount, 0);
  const extra = candidates.length + settled.length;

  return (
    <Card as="section" aria-label="저수지에 갚을 돈" className={styles.lineCard}>
      <p className={styles.oneLine}>
        저수지에 갚을 돈 <strong>{formatMan(loan.balance)}</strong>
        {repay ? <span className={styles.oneLineSub}> · 이번 달 갚기 제안 {formatMan(repay.amount)}</span> : null}
        {!repay && loan.repaidThisMonth ? (
          <span className={styles.oneLineSub}> · 이번 달 {formatMan(loan.repaidThisMonth.amount)} 갚았어요</span>
        ) : null}
      </p>
      {repay ? (
        <Button
          icon="check"
          className={styles.lineBtn}
          loading={busy === 'repay'}
          disabled={busy !== null && busy !== 'repay'}
          onClick={() =>
            void act('repay', () => ledger.repayLoan(repay.amount), `저수지에 ${formatWon(repay.amount)} 갚았다고 기록했어요`, () =>
              ledger.undoRepayLoan(),
            )
          }
          aria-label={`저수지에 ${formatWon(repay.amount)} 갚았어요`}
        >
          갚았어요
        </Button>
      ) : null}

      <details className={styles.lineDetails}>
        <summary>
          <span>{extra > 0 ? `자세히 · 바꿀 수 있는 기록 ${extra}건` : '자세히'}</span>
          <Icon name="chevron-down" size={20} className={styles.moreChev} />
        </summary>
        <p className={styles.note}>
          이벤트통장이 모자라 저수지에서 빌린 돈이에요. 저수지에 줘야 할 돈은 없고, 빌린 만큼만 남는 달에 갚아요
        </p>
        {repay ? <p className={styles.note}>{formatWon(repay.amount)}을 갚아도 3개월 동안 이벤트통장이 모자라지 않아요</p> : null}

        {loan.repaidThisMonth ? (
          <div className={styles.suggest}>
            <span className={styles.dueText}>
              <strong>이번 달 {formatWon(loan.repaidThisMonth.amount)} 갚았어요</strong>
            </span>
            <Button
              variant="ghost"
              loading={busy === 'undoRepay'}
              disabled={busy !== null && busy !== 'undoRepay'}
              onClick={() => void act('undoRepay', () => ledger.undoRepayLoan(), '갚은 기록을 되돌렸어요')}
            >
              되돌리기
            </Button>
          </div>
        ) : null}

        {settled.length > 0 ? (
          <div className={cx(styles.borrow, styles.convertBox)}>
            <p>
              저수지에서 이미 지급한 이벤트 지출이 <strong>{settled.length}건</strong> 있어요 (
              {[...new Set(settled.map((e) => e.paidBy ?? ''))].filter(Boolean).join(' · ')}). 이벤트통장이 저수지에서 빌린 돈이에요
            </p>
            <Button
              icon="arrow-right"
              loading={busy === 'convert'}
              disabled={busy !== null && busy !== 'convert'}
              onClick={() =>
                void act(
                  'convert',
                  () => ledger.convertSettledReservoirClaims(settledIds),
                  `${settledIds.length}건 ${formatWon(settledTotal)}을 저수지에 갚을 돈으로 바꿨어요`,
                  () => ledger.undoReservoirClaims(settledIds, 'converted'),
                )
              }
            >
              {settled.length}건 {formatWon(settledTotal)}을 저수지에 갚을 돈으로 바꿔요
            </Button>
          </div>
        ) : null}

      {candidates.length > 0 ? (
        <details className={styles.more}>
          <summary>
            <span>저수지에서 쓴 이벤트 지출 {candidates.length}건</span>
            <Icon name="chevron-down" size={20} className={styles.moreChev} />
          </summary>
          <p className={styles.note}>
            이벤트통장에 돈이 없어 저수지에서 냈다면 바꿔 주세요. 잔액은 그대로이고, 그만큼 저수지에 갚을 돈이 돼요
          </p>
          <ul className={styles.moreList}>
            {candidates.map((e) => (
              <li key={e.id}>
                <span className={styles.moreTitle}>
                  {expenseTitle(data, e)}
                  <span className={styles.moreMeta}>
                    {formatShortDate(e.date)} · {formatWon(e.amount)}
                  </span>
                </span>
                <Button
                  variant="outline"
                  className={styles.moreBtn}
                  loading={busy === `conv:${e.id}`}
                  disabled={busy !== null && busy !== `conv:${e.id}`}
                  onClick={() =>
                    void act(
                      `conv:${e.id}`,
                      () => ledger.convertToLoan([e.id]),
                      `${formatWon(e.amount)}을 이벤트통장이 갚을 돈으로 바꿨어요`,
                      () => ledger.unconvertLoan([e.id]),
                    )
                  }
                  aria-label={`${expenseTitle(data, e)} ${formatWon(e.amount)} 이벤트통장이 갚을 돈으로 바꾸기`}
                >
                  이벤트통장이 갚을 돈으로 바꾸기
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {loan.entries.length > 0 || loan.repayments.length > 0 ? (
        <details className={styles.more}>
          <summary>
            <span>빌리고 갚은 기록 {loan.entries.length + loan.repayments.length}건</span>
            <Icon name="chevron-down" size={20} className={styles.moreChev} />
          </summary>
          <ul className={styles.moreList}>
            {loan.entries.map(({ transfer: t, kind, expenseId }) => {
              const e = expenseById.get(expenseId);
              const name = e ? expenseTitle(data, e) : t.memo;
              return (
                <li key={t.id}>
                  <span className={styles.moreTitle}>
                    {kind === 'claim' && e?.paidBy ? `${e.paidBy}에게 지급 · ${name}` : name}{' '}
                    <Badge tone="info" size="sm" dot={false}>
                      저수지에서 지급
                    </Badge>
                    <span className={styles.moreMeta}>{formatShortDate(t.date)} · 빌림</span>
                  </span>
                  <span className={styles.moreAmount}>{formatWon(t.amount)}</span>
                  {kind === 'expense' ? (
                    <Button
                      variant="ghost"
                      className={styles.moreBtn}
                      loading={busy === `unconv:${expenseId}`}
                      disabled={busy !== null && busy !== `unconv:${expenseId}`}
                      onClick={() => void act(`unconv:${expenseId}`, () => ledger.unconvertLoan([expenseId]), '저수지 지출로 되돌렸어요')}
                      aria-label={`${name} 저수지 지출로 되돌리기`}
                    >
                      되돌리기
                    </Button>
                  ) : null}
                </li>
              );
            })}
            {loan.repayments.map((t) => (
              <li key={t.id}>
                <span className={styles.moreTitle}>
                  저수지에 갚음
                  <span className={styles.moreMeta}>{formatShortDate(t.date)}</span>
                </span>
                <span className={styles.moreAmount}>−{formatWon(t.amount)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      </details>
    </Card>
  );
}
