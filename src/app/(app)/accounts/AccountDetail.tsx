'use client';

import { useMemo, useState } from 'react';
import { accountBalance, formatDateKo, formatShortDate, formatWon } from '@/domain';
import type { Expense, Id, Transfer } from '@/domain/types';
import { Badge, Button, Card, EmptyState, Money, PageHeader, cx } from '@/ui';
import type { ReadyLedger } from '../_components/RequireLedger';
import { ExpenseDialog } from '../expenses/ExpenseDialog';
import { AdjustDialog } from './AdjustDialog';
import { accountHistory, groupByMonth, monthFlows, monthTitle, ROLE_LABEL, type HistoryEntry } from './selectors';
import { TransferDialog, type RecordMode } from './TransferDialog';
import { TransferInfoDialog } from './TransferInfoDialog';
import styles from './accounts.module.css';

const PAGE = 40;

type DialogState =
  | { type: 'adjust' }
  | { type: 'record'; mode: RecordMode }
  | { type: 'transfer'; transfer: Transfer }
  | { type: 'expense'; expense: Expense }
  | null;

/** 통장 상세: 잔액 · 이번 달 들어온/나간 돈 · 실제 잔액 맞추기 · 이체/수입 기록 · 기록(최신순, 기록마다 잔액) */
export function AccountDetail({ ledger, accountId }: { ledger: ReadyLedger; accountId: Id }) {
  const { data, today } = ledger;
  const account = data.accounts.find((a) => a.id === accountId);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [shown, setShown] = useState(PAGE);
  const history = useMemo(() => (account ? accountHistory(data, account.id, today) : []), [data, account, today]);

  if (!account) {
    return (
      <>
        <PageHeader title="통장" backHref="/accounts" backLabel="통장 목록" />
        <Card>
          <EmptyState
            icon="wallet"
            title="통장을 찾을 수 없어요"
            description="지운 통장이거나 주소가 바뀌었어요."
            action={<Button href="/accounts">통장 목록 보기</Button>}
          />
        </Card>
      </>
    );
  }

  const balance = ledger.balances[account.id] ?? accountBalance(data, account.id, today);
  const flow = monthFlows(data, today)[account.id] ?? { in: 0, out: 0 };
  const living = ledger.living?.livingAccountId === account.id;
  const thisYear = Number(today.slice(0, 4));
  const visible = history.slice(0, shown);
  const rest = history.length - visible.length;
  const recordCount = history.filter((h) => h.kind !== 'opening').length;

  return (
    <>
      <PageHeader
        title={account.name}
        subtitle={`${ROLE_LABEL[account.role]} 통장${living ? ' · 생활비가 나가요' : ''}${account.deleted ? ' · 지운 통장' : ''}`}
        backHref="/accounts"
        backLabel="통장 목록"
      />
      <div className={styles.detail}>
        <div className={styles.detailSide}>
          <Card variant="brand" className={styles.balanceCard}>
            <span className={styles.label}>지금 잔액</span>
            <Money amount={balance} className={cx(styles.balanceValue, balance < 0 && styles.negative)} />
            <span className={styles.sub}>
              {formatDateKo(account.openingDate, false)} 시작 잔액 {formatWon(account.openingBalance)}부터 계산했어요
            </span>
            <dl className={styles.flowStats}>
              <div>
                <dt>이번 달 들어온 돈</dt>
                <dd>{formatWon(flow.in)}</dd>
              </div>
              <div>
                <dt>이번 달 나간 돈</dt>
                <dd>{formatWon(flow.out)}</dd>
              </div>
            </dl>
          </Card>
          {account.deleted ? null : (
            <div className={styles.actions}>
              <Button icon="check-circle" block onClick={() => setDialog({ type: 'adjust' })}>
                실제 잔액 맞추기
              </Button>
              <div className={styles.actionPair}>
                <Button variant="outline" icon="arrow-left-right" block onClick={() => setDialog({ type: 'record', mode: 'transfer' })}>
                  이체 기록
                </Button>
                <Button variant="outline" icon="plus" block onClick={() => setDialog({ type: 'record', mode: 'income' })}>
                  수입 기록
                </Button>
              </div>
              <Button href={`/expenses?account=${encodeURIComponent(account.id)}`} variant="ghost" iconRight="chevron-right" block>
                이 통장 지출 보기
              </Button>
            </div>
          )}
        </div>

        <Card title="기록" aside={<span className={styles.sub}>{recordCount}건</span>} className={styles.historyCard}>
          {recordCount === 0 ? (
            <p className={styles.note}>아직 들어오고 나간 기록이 없어요. 이체나 수입을 기록하면 여기에 쌓여요.</p>
          ) : null}
          {groupByMonth(visible).map((g) => (
            <section key={g.month} className={styles.hGroup} aria-labelledby={`h-${g.month}`}>
              <h3 id={`h-${g.month}`} className={styles.hMonth}>
                {monthTitle(g.month, thisYear)}
              </h3>
              <ul className={styles.hList}>
                {g.items.map((e) => (
                  <li key={e.key}>
                    <HistoryRow
                      entry={e}
                      onOpen={
                        e.transfer
                          ? () => setDialog({ type: 'transfer', transfer: e.transfer! })
                          : e.expense
                            ? () => setDialog({ type: 'expense', expense: e.expense! })
                            : undefined
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {rest > 0 ? (
            <Button variant="outline" block onClick={() => setShown((n) => n + PAGE)}>
              더 보기 ({rest}건 남음)
            </Button>
          ) : null}
        </Card>
      </div>

      {dialog?.type === 'adjust' ? <AdjustDialog account={account} balance={balance} onClose={() => setDialog(null)} /> : null}
      {dialog?.type === 'record' ? <TransferDialog mode={dialog.mode} accountId={account.id} onClose={() => setDialog(null)} /> : null}
      {dialog?.type === 'transfer' ? <TransferInfoDialog transfer={dialog.transfer} onClose={() => setDialog(null)} /> : null}
      {dialog?.type === 'expense' ? <ExpenseDialog expense={dialog.expense} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

function HistoryRow({ entry: e, onOpen }: { entry: HistoryEntry; onOpen?: () => void }) {
  const counted = e.status === 'counted';
  const content = (
    <>
      <span className={styles.hDate}>{formatShortDate(e.date)}</span>
      <span className={styles.hMain}>
        <span className={styles.hTitle}>{e.title}</span>
        <span className={styles.hSub}>
          <span className={styles.ellipsis}>{e.detail}</span>
          {e.status === 'pending' ? (
            <Badge size="sm" tone="info">
              예정
            </Badge>
          ) : null}
          {e.status === 'beforeOpening' ? (
            <Badge size="sm" dot={false}>
              시작 전
            </Badge>
          ) : null}
          {e.auto ? (
            <Badge size="sm" dot={false}>
              자동
            </Badge>
          ) : null}
        </span>
      </span>
      <span className={styles.hTrail}>
        {e.kind === 'opening' ? (
          <Money amount={e.amount} />
        ) : (
          <Money amount={e.amount} signed className={cx(counted && e.amount > 0 && styles.plus, !counted && styles.dim)} />
        )}
        <span className={styles.hBal}>
          {e.balance !== null
            ? `잔액 ${formatWon(e.balance)}`
            : e.status === 'pending'
              ? '잔액에 아직 안 들어가요'
              : '잔액에 넣지 않아요'}
        </span>
      </span>
    </>
  );
  if (!onOpen) return <div className={styles.hRow}>{content}</div>;
  return (
    <button type="button" className={cx(styles.hRow, styles.hBtn)} onClick={onOpen}>
      {content}
    </button>
  );
}
