'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { formatMan, formatShortDate, formatWon, settledReservoirEventClaims } from '@/domain';
import type { Expense, LedgerData } from '@/domain';
import { useLedger } from '@/state';
import { Badge, Button, Card, Icon, useToast } from '@/ui';
import { HashTarget } from '../_components/HashTarget';
import styles from '../_components/claims.module.css';

/** 정산 화면의 저수지 칸 (빌리고 갚은 기록 · 하나씩 바꾸기) */
export const LOAN_HREF = '/plan/settle#loan';

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function expenseTitle(data: LedgerData, e: Expense): string {
  const memo = e.memo.trim();
  if (memo) return memo;
  const cat = e.categoryId ? data.categories.find((x) => x.id === e.categoryId)?.name : undefined;
  return cat ?? '지출';
}

/** 저장 → 알림(되돌리기 버튼은 undo 가 있을 때만). 한 번에 하나만 눌려요 */
function useLoanActions() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

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
  const lock = (key: string) => ({ loading: busy === key, disabled: busy !== null && busy !== key });
  return { act, lock };
}

/**
 * 저수지에 갚을 돈 (PLAN 4-9). 저수지에 '줄' 돈은 없고, 빌린 돈을 '갚을' 돈만 있어요. 펼치기 없이 한 카드에 바로 보여요:
 * '저수지에 갚을 돈 385만' · '이번 달 10만 갚기 [갚았어요]' (갚았으면 '이번 달 10만 갚았어요 · [되돌리기]') ·
 * 저수지에서 이미 지급한 이벤트 청구를 한 번에 바꾸는 버튼 · 빌리고 갚은 기록과 하나씩 바꾸기는 정산 화면(/plan/settle#loan) 링크.
 * 자동으로 옮기지 않아요
 */
export function LoanCard() {
  const ledger = useLedger();
  const { act, lock } = useLoanActions();
  const s = ledger.settlement;
  const data = ledger.data;
  if (!s || !data || !s.reservoirAccountId) return null;
  const { loan, repay } = s;
  const candidates = ledger.loanCandidates;
  const settled = settledReservoirEventClaims(data);
  if (loan.borrowed === 0 && loan.repaid === 0 && candidates.length === 0 && settled.length === 0) return null;

  const settledIds = settled.map((e) => e.id);
  const settledTotal = settled.reduce((t, e) => t + e.amount, 0);
  const history = loan.entries.length + loan.repayments.length;
  const linkText = [history > 0 ? `빌리고 갚은 기록 ${history}건` : null, candidates.length > 0 ? `바꿀 수 있는 지출 ${candidates.length}건` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card as="section" aria-label="저수지에 갚을 돈" className={styles.loanCard}>
      <p className={styles.oneLine} data-testid="loan-line">
        저수지에 갚을 돈 <strong>{formatMan(loan.balance)}</strong>
      </p>

      {loan.repaidThisMonth ? (
        <div className={styles.lineRow}>
          <p className={styles.rowText}>이번 달 {formatMan(loan.repaidThisMonth.amount)} 갚았어요</p>
          <Button
            variant="ghost"
            className={styles.lineBtn}
            {...lock('undoRepay')}
            onClick={() => void act('undoRepay', () => ledger.undoRepayLoan(), '갚은 기록을 되돌렸어요')}
            aria-label={`이번 달 ${formatWon(loan.repaidThisMonth.amount)} 갚은 기록 되돌리기`}
          >
            되돌리기
          </Button>
        </div>
      ) : null}

      {repay ? (
        <div className={styles.lineRow}>
          <p className={styles.rowText}>이번 달 {formatMan(repay.amount)} 갚기</p>
          <Button
            icon="check"
            className={styles.lineBtn}
            {...lock('repay')}
            onClick={() =>
              void act('repay', () => ledger.repayLoan(repay.amount), `저수지에 ${formatWon(repay.amount)} 갚았다고 기록했어요`, () =>
                ledger.undoRepayLoan(),
              )
            }
            aria-label={`저수지에 ${formatWon(repay.amount)} 갚았어요`}
          >
            갚았어요
          </Button>
        </div>
      ) : null}

      {settled.length > 0 ? (
        <Button
          variant="outline"
          icon="arrow-right"
          className={styles.convertBtn}
          {...lock('convert')}
          onClick={() =>
            void act(
              'convert',
              () => ledger.convertSettledReservoirClaims(settledIds),
              `${settledIds.length}건 ${formatWon(settledTotal)}을 저수지에 갚을 돈으로 바꿨어요`,
              () => ledger.undoReservoirClaims(settledIds, 'converted'),
            )
          }
        >
          저수지에서 이미 지급한 이벤트 청구 {settled.length}건 {formatWon(settledTotal)}을 갚을 돈으로 바꾸기
        </Button>
      ) : null}

      {linkText ? (
        <Link href={LOAN_HREF} className={styles.lineLink}>
          {linkText}
          <Icon name="chevron-right" size={18} />
        </Link>
      ) : null}
    </Card>
  );
}

/**
 * 정산 화면 맨 아래 '저수지' 칸 (id="loan"). 이벤트 화면 저수지 카드의 링크로 들어와요.
 * 저수지에서 쓴 이벤트 지출을 하나씩 갚을 돈으로 바꾸기 · 빌리고 갚은 기록(바꾼 지출은 되돌리기). 펼치기 없이 그대로 보여요
 */
export function LoanSection() {
  const ledger = useLedger();
  const titleId = useId();
  const { act, lock } = useLoanActions();
  const s = ledger.settlement;
  const data = ledger.data;
  if (!s || !data || !s.reservoirAccountId) return null;
  const { loan } = s;
  const candidates = ledger.loanCandidates;
  const history = loan.entries.length + loan.repayments.length;
  if (history === 0 && candidates.length === 0) return null;
  const expenseById = new Map(data.expenses.map((e) => [e.id, e]));

  return (
    <Card as="section" id="loan" aria-labelledby={titleId}>
      <HashTarget />
      <h2 id={titleId} className="card-title">
        저수지 · 갚을 돈 {formatMan(loan.balance)}
      </h2>
      <p className={styles.note}>
        이벤트통장이 모자라 저수지에서 빌린 돈이에요. 저수지에 줘야 할 돈은 없고, 빌린 만큼만 남는 달에 갚아요
      </p>

      {candidates.length > 0 ? (
        <>
          <h3 className={styles.sectionHead}>저수지에서 쓴 이벤트 지출 {candidates.length}건</h3>
          <p className={styles.note}>
            이벤트통장에 돈이 없어 저수지에서 냈다면 바꿔 주세요. 잔액은 그대로이고, 그만큼 저수지에 갚을 돈이 돼요
          </p>
          <ul className={styles.moreList} aria-label="저수지에서 쓴 이벤트 지출">
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
                  {...lock(`conv:${e.id}`)}
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
                  갚을 돈으로 바꾸기
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {history > 0 ? (
        <>
          <h3 className={styles.sectionHead}>빌리고 갚은 기록 {history}건</h3>
          <ul className={styles.moreList} aria-label="빌리고 갚은 기록">
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
                      {...lock(`unconv:${expenseId}`)}
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
        </>
      ) : null}
    </Card>
  );
}
