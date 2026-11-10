'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { formatShortDate, formatWon, settleEditHref } from '@/domain';
import type { Account, Transfer } from '@/domain/types';
import { useLedger } from '@/state';
import { Badge, Button, Card, EmptyState, ListRow, Money, PageHeader, Skeleton } from '@/ui';
import { RequireLedger, isLedgerReady, type ReadyLedger } from '../_components/RequireLedger';
import { accountNameWithOwner } from '../settings/helpers';
import { groupByMonth, monthTitle } from './_accounts/selectors';
import { TransferDialog, type RecordMode } from './_accounts/TransferDialog';
import { TransferInfoDialog } from './_accounts/TransferInfoDialog';

const PAGE = 40;

/** 이체 한 줄의 제목: '월급통장 → 이벤트통장' · '수입 · 월급통장' · '잔액 맞추기 · 저수지통장' */
export function transferTitle(t: Transfer, accounts: Account[]): string {
  const name = (id: string | null) => accountNameWithOwner(accounts, id);
  if (t.kind === 'income') return `수입 · ${name(t.toAccountId)}`;
  if (t.kind === 'adjustment') return `잔액 맞추기 · ${name(t.toAccountId ?? t.fromAccountId)}`;
  return `${name(t.fromAccountId)} → ${name(t.toAccountId)}`;
}

/** '/history?tab=transfers' 내역의 이체: 수입 · 이체 · 잔액 맞추기 기록 (최신순, 달마다) · 이체 기록 */
export function TransfersScreen({ switcher }: { switcher?: ReactNode }) {
  const ready = isLedgerReady(useLedger());
  const [record, setRecord] = useState<RecordMode | null>(null);
  return (
    <>
      <PageHeader
        title="내역"
        subtitle="통장 사이에 옮긴 돈과 들어온 돈이에요"
        actions={
          <>
            <Button variant="outline" icon="arrow-down" disabled={!ready} onClick={() => setRecord('income')}>
              수입 기록
            </Button>
            <Button icon="arrow-left-right" disabled={!ready} onClick={() => setRecord('transfer')}>
              이체 기록
            </Button>
          </>
        }
      />
      {switcher}
      <RequireLedger skeleton={<TransfersSkeleton />}>{(ledger) => <TransfersBody ledger={ledger} />}</RequireLedger>
      {record && ready ? <TransferDialog mode={record} onClose={() => setRecord(null)} /> : null}
    </>
  );
}

function TransfersBody({ ledger }: { ledger: ReadyLedger }) {
  const { data, today } = ledger;
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<Transfer | null>(null);
  // 정산 이체(claim: · loan: · loanpay:)는 창 대신 그 줄 아래에 '정산 화면에서 고칠 수 있어요 →'
  const [noteId, setNoteId] = useState<string | null>(null);
  const list = useMemo(
    () =>
      data.transfers
        .filter((t) => !t.deleted)
        .sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date))),
    [data.transfers],
  );
  const groups = groupByMonth(list.slice(0, shown));
  const thisYear = Number(today.slice(0, 4));
  const rest = list.length - Math.min(shown, list.length);

  if (list.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="arrow-left-right"
          headingLevel={2}
          title="이체 기록이 없어요"
          description="통장 사이에 돈을 옮기면 기록해 두세요. 잔액이 맞게 계산돼요."
        />
      </Card>
    );
  }

  return (
    <>
      {groups.map((g) => {
        const headId = `tr-${g.month}`;
        const total = g.items.filter((t) => t.kind === 'transfer').reduce((s, t) => s + t.amount, 0);
        return (
          <Card as="section" key={g.month} padding="sm" aria-labelledby={headId}>
            <div className="row between" style={{ alignItems: 'baseline' }}>
              <h2 id={headId} className="card-title">
                {monthTitle(g.month, thisYear)}
              </h2>
              <span className="muted">이체 {formatWon(total)}</span>
            </div>
            <ul className="list">
              {g.items.map((t) => (
                <li key={t.id}>
                  <ListRow
                    leadText={formatShortDate(t.date)}
                    title={transferTitle(t, data.accounts)}
                    subtitle={
                      t.status === 'planned' || t.date > today || t.ruleId || t.memo.trim() ? (
                        <span className="st-sub">
                          {t.status === 'planned' || t.date > today ? (
                            <Badge size="sm" tone="info">
                              예정
                            </Badge>
                          ) : null}
                          {t.ruleId ? (
                            <Badge size="sm" dot={false}>
                              자동
                            </Badge>
                          ) : null}
                          {t.memo.trim() ? <span>{t.memo.trim()}</span> : null}
                        </span>
                      ) : undefined
                    }
                    trailing={<Money amount={t.amount} />}
                    onClick={() => {
                      if (settleEditHref(t.id)) setNoteId((cur) => (cur === t.id ? null : t.id));
                      else setOpen(t);
                    }}
                  />
                  {noteId === t.id ? <SettleNote href={settleEditHref(t.id)!} /> : null}
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
      {rest > 0 ? (
        <div>
          <Button variant="outline" block onClick={() => setShown((n) => n + PAGE)}>
            {Math.min(rest, PAGE)}개 더 보기
          </Button>
        </div>
      ) : null}
      {open ? <TransferInfoDialog transfer={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

/** 정산 이체를 누르면 그 줄 아래에: '정산 화면에서 고칠 수 있어요 →' (지급한 기록 #paid · 저수지 #loan) */
function SettleNote({ href }: { href: string }) {
  return (
    <p className="muted" role="note" style={{ margin: '0 0 var(--space-2)', padding: '0 var(--space-3)', fontSize: 14, lineHeight: '22px' }}>
      <Link href={href} style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none', display: 'inline-block', padding: '11px 0' }}>
        정산 화면에서 고칠 수 있어요 →
      </Link>
    </p>
  );
}

function TransfersSkeleton() {
  return (
    <div className="stack" role="status" aria-live="polite">
      <span className="sr-only">이체 기록을 불러오는 중이에요</span>
      <Skeleton height={320} radius="lg" />
    </div>
  );
}
