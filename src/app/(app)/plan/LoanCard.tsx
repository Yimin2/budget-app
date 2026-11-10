'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { formatMan, formatShortDate, formatWon, hasBatchim, loanRecords, settledReservoirEventClaims } from '@/domain';
import type { Expense, LedgerData, LoanRecord } from '@/domain';
import { useLedger, type RowSnapshot } from '@/state';
import { Badge, Button, Card, Icon, MoneyInput, useToast } from '@/ui';
import { ExpandButton } from '../_components/ExpandButton';
import styles from '../_components/claims.module.css';

/** '빌린 돈 385만 · 갚은 돈 20만 · 남은 갚을 돈 365만' */
export function loanSummaryText(loan: { borrowed: number; repaid: number; balance: number }): string {
  return `빌린 돈 ${formatMan(loan.borrowed)} · 갚은 돈 ${formatMan(loan.repaid)} · 남은 갚을 돈 ${formatMan(loan.balance)}`;
}

/** 정산 화면의 저수지 칸 (빌리고 갚은 기록 · 하나씩 바꾸기) */
export const LOAN_HREF = '/plan/settle#loan';

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function expenseTitle(data: LedgerData, e: Expense): string {
  const memo = e.memo.trim();
  if (memo) return memo;
  const cat = e.categoryId ? data.categories.find((x) => x.id === e.categoryId)?.name : undefined;
  return cat ?? '지출';
}

/**
 * 저장 → 알림(되돌리기 버튼은 undo 가 있거나, 작업이 바꾸기 전 행을 돌려줬을 때 restoreRows 로). 한 번에 하나만 눌려요.
 * 성공하면 true
 */
export function useLoanActions() {
  const ledger = useLedger();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(
    key: string,
    work: () => Promise<RowSnapshot | void>,
    message: string,
    undo?: () => Promise<void>,
  ): Promise<boolean> {
    if (busy) return false;
    setBusy(key);
    try {
      const before = await work();
      const restore =
        undo ?? (before && (before.expenses.length > 0 || before.transfers.length > 0) ? () => ledger.restoreRows(before) : undefined);
      toast.success(
        message,
        restore
          ? {
              action: {
                label: '되돌리기',
                onClick: () => {
                  restore().then(
                    () => toast.show('되돌렸어요'),
                    (e: unknown) => toast.error(errorText(e, '되돌리지 못했어요')),
                  );
                },
              },
            }
          : undefined,
      );
      return true;
    } catch (e) {
      toast.error(errorText(e, '저장하지 못했어요'));
      return false;
    } finally {
      setBusy(null);
    }
  }
  const lock = (key: string) => ({ loading: busy === key, disabled: busy !== null && busy !== key });
  return { act, lock };
}

/**
 * 저수지에 갚을 돈 (PLAN 4-9). 저수지에 '줄' 돈은 없고, 빌린 돈을 '갚을' 돈만 있어요. 처음에는 요약만:
 * '저수지에 갚을 돈 385만' · '빌린 돈 385만 · 갚은 돈 20만 · 남은 갚을 돈 365만' · '이번 달 10만 갚기 [갚았어요]'
 * (갚았으면 '이번 달 10만 갚았어요 · [되돌리기]'). [모두 보기]를 누르면 같은 자리에서 저수지에서 이미 지급한 이벤트 청구를
 * 한 번에 바꾸는 버튼 · 정산 화면(/plan/settle#loan) 링크가 펼쳐지고 [접기]로 접어요. 자동으로 옮기지 않아요
 */
export function LoanCard() {
  const ledger = useLedger();
  const { act, lock } = useLoanActions();
  const bodyId = useId();
  const [open, setOpen] = useState(false);
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
  const hasMore = settled.length > 0 || Boolean(linkText);

  return (
    <Card as="section" aria-label="저수지에 갚을 돈" className={styles.loanCard}>
      <div className={styles.summaryRow}>
        <p className={styles.oneLine} data-testid="loan-line">
          저수지에 갚을 돈 <strong>{formatMan(loan.balance)}</strong>
        </p>
        {hasMore ? (
          <ExpandButton open={open} onToggle={() => setOpen((o) => !o)} controls={bodyId} label="저수지 기록" />
        ) : null}
      </div>
      <p className={styles.summaryText} data-testid="loan-summary">
        {loanSummaryText(loan)}
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

      {open && hasMore ? (
        <div id={bodyId} className={styles.expandBody}>
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
        </div>
      ) : null}
    </Card>
  );
}

/**
 * 정산 화면 맨 아래 '저수지' 칸 (id="loan"). 이벤트 화면 저수지 카드의 링크로 들어와요.
 * 저수지에서 쓴 이벤트 지출을 하나씩 갚을 돈으로 바꾸기 · 빌리고 갚은 기록(최근 순). 기록마다 [금액 고치기](그 줄이 금액 칸 + [저장] / [취소]로)와
 * [취소]: 청구를 빌려 지급한 기록은 그 자리에서 "지급도 함께 취소할까요?" (지급까지 취소 / 빌린 기록만 취소), 지출을 바꾼 기록은 지출을 저수지로 되돌리고,
 * 갚은 기록은 지워요. 창은 띄우지 않아요
 */
export function LoanSection() {
  const ledger = useLedger();
  const titleId = useId();
  const { act, lock } = useLoanActions();
  const [editing, setEditing] = useState<{ id: string; amount: number | null } | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const bodyId = useId();
  // 이벤트 화면 링크 · 내역의 정산 이체(#loan)로 들어오면 펼친 채로
  const [open, setOpen] = useState(() => typeof window !== 'undefined' && window.location.hash === '#loan');
  const s = ledger.settlement;
  const data = ledger.data;
  if (!s || !data || !s.reservoirAccountId) return null;
  const { loan } = s;
  const candidates = ledger.loanCandidates;
  const records = loanRecords(loan);
  if (records.length === 0 && candidates.length === 0) return null;
  const expenseById = new Map(data.expenses.map((e) => [e.id, e]));

  const nameOf = (r: LoanRecord): string => {
    if (r.kind === 'repay') return '저수지에 갚음';
    const e = expenseById.get(r.expenseId);
    const name = e ? expenseTitle(data, e) : r.transfer.memo;
    return r.kind === 'claim' && e?.paidBy ? `${e.paidBy}에게 지급 · ${name}` : name;
  };

  const save = async (r: LoanRecord, amount: number | null) => {
    if (amount === null || !(amount > 0)) return;
    const ok = await act(`edit:${r.transfer.id}`, () => ledger.updateLoanAmount(r.transfer.id, amount), `금액을 ${formatWon(amount)}으로 고쳤어요`);
    if (ok) setEditing(null);
  };

  const cancel = (r: LoanRecord) => {
    const name = nameOf(r);
    if (r.kind === 'claim') {
      setEditing(null);
      setAsking(r.transfer.id);
      return;
    }
    void act(
      `cancel:${r.transfer.id}`,
      () => ledger.cancelLoanTransfer(r.transfer.id),
      r.kind === 'repay' ? '갚은 기록을 취소했어요' : `${name}${hasBatchim(name) ? '을' : '를'} 저수지 지출로 되돌렸어요`,
    );
  };

  return (
    <Card as="section" id="loan" aria-labelledby={titleId}>
      <h2 id={titleId} className="card-title">
        저수지 · 갚을 돈 {formatMan(loan.balance)}
      </h2>
      <div className={styles.summaryRow}>
        <p className={styles.summaryText} data-testid="loan-section-summary">
          {loanSummaryText(loan)}
          {candidates.length > 0 ? ` · 바꿀 수 있는 지출 ${candidates.length}건` : ''}
        </p>
        <ExpandButton open={open} onToggle={() => setOpen((o) => !o)} controls={bodyId} label="저수지 기록" />
      </div>
      {s.repay ? (
        <div className={styles.lineRow}>
          <p className={styles.rowText}>이번 달 {formatMan(s.repay.amount)} 갚기</p>
          <Button
            icon="check"
            className={styles.lineBtn}
            {...lock('repay')}
            onClick={() =>
              void act('repay', () => ledger.repayLoan(s.repay!.amount), `저수지에 ${formatWon(s.repay!.amount)} 갚았다고 기록했어요`, () =>
                ledger.undoRepayLoan(),
              )
            }
            aria-label={`저수지에 ${formatWon(s.repay.amount)} 갚았어요`}
          >
            갚았어요
          </Button>
        </div>
      ) : null}
      {open ? (
        <div id={bodyId} className={styles.expandBody}>
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

          {records.length > 0 ? (
            <>
              <h3 className={styles.sectionHead}>빌리고 갚은 기록 {records.length}건</h3>
              <ul className={styles.moreList} aria-label="빌리고 갚은 기록">
                {records.map((r) => {
                  const t = r.transfer;
                  const name = nameOf(r);
                  const isEditing = editing?.id === t.id;
                  const isAsking = asking === t.id;
                  return (
                    <li key={t.id} className={styles.recordItem} data-testid={`loan-row-${t.id}`}>
                      <div className={styles.recordLine}>
                        <span className={styles.moreTitle}>
                          {name}
                          {r.kind !== 'repay' ? (
                            <>
                              {' '}
                              <Badge tone="info" size="sm" dot={false}>
                                저수지에서 지급
                              </Badge>
                            </>
                          ) : null}
                          <span className={styles.moreMeta}>
                            {formatShortDate(t.date)} · {r.kind === 'repay' ? '갚음' : '빌림'}
                          </span>
                        </span>
                        {isEditing ? null : (
                          <span className={styles.moreAmount}>
                            {r.kind === 'repay' ? '−' : ''}
                            {formatWon(t.amount)}
                          </span>
                        )}
                      </div>
                      {isEditing ? (
                        <form
                          className={styles.recordEdit}
                          onSubmit={(ev) => {
                            ev.preventDefault();
                            void save(r, editing.amount);
                          }}
                        >
                          <MoneyInput
                            aria-label={`${name} 금액`}
                            value={editing.amount}
                            onChange={(v) => setEditing({ id: t.id, amount: v })}
                            autoFocus
                          />
                          <Button
                            type="submit"
                            className={styles.moreBtn}
                            {...lock(`edit:${t.id}`)}
                            disabled={editing.amount === null || !(editing.amount > 0) || lock(`edit:${t.id}`).disabled}
                          >
                            저장
                          </Button>
                          <Button type="button" variant="ghost" className={styles.moreBtn} onClick={() => setEditing(null)}>
                            취소
                          </Button>
                        </form>
                      ) : isAsking ? (
                        <div className={styles.recordAsk} role="group" aria-label={`${name} 취소`}>
                          <p className={styles.rowText}>지급도 함께 취소할까요?</p>
                          <div className={styles.recordBtns}>
                            <Button
                              variant="outline"
                              className={styles.moreBtn}
                              {...lock(`unpay:${r.expenseId}`)}
                              onClick={() =>
                                void act(`unpay:${r.expenseId}`, () => ledger.undoClaimPayments([r.expenseId!]), '지급과 빌린 기록을 함께 취소했어요').then(
                                  (ok) => ok && setAsking(null),
                                )
                              }
                            >
                              지급까지 취소
                            </Button>
                            <Button
                              variant="outline"
                              className={styles.moreBtn}
                              {...lock(`unloan:${r.expenseId}`)}
                              onClick={() =>
                                void act(`unloan:${r.expenseId}`, () => ledger.cancelClaimLoans([r.expenseId!]), '빌린 기록만 취소했어요').then(
                                  (ok) => ok && setAsking(null),
                                )
                              }
                            >
                              빌린 기록만 취소
                            </Button>
                            <Button variant="ghost" className={styles.moreBtn} onClick={() => setAsking(null)}>
                              그대로 두기
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className={styles.recordBtns}>
                          <Button
                            variant="ghost"
                            className={styles.moreBtn}
                            onClick={() => {
                              setAsking(null);
                              setEditing({ id: t.id, amount: t.amount });
                            }}
                            aria-label={`${name} 금액 고치기`}
                          >
                            금액 고치기
                          </Button>
                          <Button
                            variant="ghost"
                            className={styles.moreBtn}
                            {...lock(`cancel:${t.id}`)}
                            onClick={() => cancel(r)}
                            aria-label={`${name} 취소`}
                          >
                            취소
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
