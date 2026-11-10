'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { formatWon, monthOf } from '@/domain';
import type { Account, Id, Won } from '@/domain/types';
import { useLedger } from '@/state';
import { Badge, Button, Card, EmptyState, Icon, Money, PageHeader, Skeleton, StatTile, cx } from '@/ui';
import { RequireLedger, isLedgerReady, type ReadyLedger } from '../_components/RequireLedger';
import { AccountDetail } from './AccountDetail';
import { FlowCard } from './FlowCard';
import { ownerLabel } from '../settings/helpers';
import { flowSummary, monthFlows, monthTotals, ROLE_ICON, ROLE_LABEL, type MonthFlow } from './selectors';
import { TransferDialog, type RecordMode } from './TransferDialog';
import styles from './accounts.module.css';

/** 통장 하나의 주소 (상세 보기) */
export function accountHref(id: Id): string {
  return `/accounts?id=${encodeURIComponent(id)}`;
}

/** '/accounts' 통장 목록 · '/accounts?id=<통장 id>' 통장 상세 */
export function AccountsScreen() {
  const params = useSearchParams();
  const id = params?.get('id') || null;
  if (id) {
    return (
      <RequireLedger skeleton={<DetailSkeleton />}>
        {(ledger) => <AccountDetail key={id} ledger={ledger} accountId={id} />}
      </RequireLedger>
    );
  }
  return <Overview />;
}

function Overview() {
  const ready = isLedgerReady(useLedger());
  const [record, setRecord] = useState<RecordMode | null>(null);
  return (
    <>
      <PageHeader
        title="통장"
        subtitle="통장별 잔액과 매달 배분이에요"
        actions={
          <Button variant="outline" icon="arrow-left-right" disabled={!ready} onClick={() => setRecord('transfer')}>
            이체 기록
          </Button>
        }
      />
      <RequireLedger skeleton={<OverviewSkeleton />}>{(ledger) => <OverviewBody ledger={ledger} />}</RequireLedger>
      {record && ready ? <TransferDialog mode={record} onClose={() => setRecord(null)} /> : null}
    </>
  );
}

function OverviewBody({ ledger }: { ledger: ReadyLedger }) {
  const { data, today, balances } = ledger;
  const accounts = ledger.activeAccounts;
  const flows = useMemo(() => monthFlows(data, today), [data, today]);
  const totals = useMemo(() => monthTotals(data, today), [data, today]);
  const flow = useMemo(() => flowSummary(data, monthOf(today)), [data, today]);
  const total = accounts.reduce((s, a) => s + (balances[a.id] ?? 0), 0);
  const livingId = ledger.living?.livingAccountId ?? null;
  // 개인 돈으로 내고 아직 돌려받지 않은 돈 (돌려받을 통장마다)
  const owed = useMemo(() => {
    const out: Record<Id, Won> = {};
    for (const c of ledger.claims?.pending ?? []) {
      if (c.claimAccountId) out[c.claimAccountId] = (out[c.claimAccountId] ?? 0) + c.amount;
    }
    return out;
  }, [ledger.claims]);
  const thisYear = Number(today.slice(0, 4));

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <section className={styles.summary} aria-label="통장 잔액 합계">
          <Card variant="brand" className={styles.totalCard}>
            <span className={styles.label}>통장 잔액 합계</span>
            <Money amount={total} className={styles.totalValue} />
            <span className={styles.sub}>통장 {accounts.length}개 · 오늘 기준</span>
          </Card>
          <div className={styles.stats}>
            <StatTile label="이번 달 수입" icon="arrow-down" value={<Money amount={totals.income} />} />
            <StatTile label="이번 달 지출" icon="arrow-up" value={<Money amount={totals.spent} />} />
          </div>
        </section>

        <section className={styles.section} aria-labelledby="ac-list">
          <h2 id="ac-list" className="section-title">
            통장 {accounts.length}개
          </h2>
          {accounts.length === 0 ? (
            <Card>
              <EmptyState
                icon="wallet"
                headingLevel={3}
                title="통장이 없어요"
                description="설정에서 통장을 만들고 시작 잔액을 적어 주세요."
                action={
                  <Button href="/settings#st-accounts" icon="plus">
                    통장 만들기
                  </Button>
                }
              />
            </Card>
          ) : (
            <ul className={styles.cards}>
              {accounts.map((a) => (
                <li key={a.id}>
                  <AccountCard
                    account={a}
                    balance={balances[a.id] ?? 0}
                    flow={flows[a.id] ?? { in: 0, out: 0 }}
                    living={a.id === livingId || ledger.livingViews.some((v) => v.accountId === a.id)}
                    owed={owed[a.id] ?? 0}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <aside className={styles.side} aria-label="매달 배분">
        <FlowCard flow={flow} thisYear={thisYear} />
      </aside>
    </div>
  );
}

function AccountCard({
  account,
  balance,
  flow,
  living,
  owed = 0,
}: {
  account: Account;
  balance: Won;
  flow: MonthFlow;
  living: boolean;
  /** 개인 돈으로 내고 아직 돌려받지 않은 돈 */
  owed?: Won;
}) {
  return (
    <Link href={accountHref(account.id)} className={cx('card', styles.accCard)}>
      <span className={styles.accHead}>
        <span className={styles.accIcon} aria-hidden>
          <Icon name={ROLE_ICON[account.role]} size={20} />
        </span>
        <span className={styles.accTitle}>
          <span className={styles.accName}>{account.name}</span>
          <span className={styles.badges}>
            <Badge size="sm" dot={false}>
              {ROLE_LABEL[account.role]}
            </Badge>
            {living ? (
              <Badge size="sm" tone="brand" dot={false}>
                생활비
              </Badge>
            ) : null}
            {ownerLabel(account) ? (
              <Badge size="sm" tone="info" dot={false}>
                {ownerLabel(account)}
              </Badge>
            ) : null}
          </span>
        </span>
        <Icon name="chevron-right" size={20} className={styles.chev} />
      </span>
      <span className={styles.accBalance}>
        <span className="sr-only">잔액 </span>
        <Money amount={balance} />
      </span>
      {owed > 0 ? (
        <span className={styles.owedLine}>
          <Icon name="info" size={16} />
          돌려받을 돈 {formatWon(owed)}이 있어요
        </span>
      ) : null}
      {balance + owed < 0 ? (
        <span className={styles.warnLine}>
          <Icon name="alert-triangle" size={16} />
          잔액이 마이너스예요. 실제 잔액을 맞춰 주세요
        </span>
      ) : null}
      <span className={styles.accFlow}>
        <span>
          <span className={styles.accFlowLabel}>이번 달 들어온 돈</span>
          <strong>{formatWon(flow.in)}</strong>
        </span>
        <span>
          <span className={styles.accFlowLabel}>나간 돈</span>
          <strong>{formatWon(flow.out)}</strong>
        </span>
      </span>
    </Link>
  );
}

function OverviewSkeleton() {
  return (
    <div className={styles.layout} role="status" aria-live="polite">
      <span className="sr-only">통장을 불러오는 중이에요</span>
      <div className={styles.main}>
        <div className={styles.summary}>
          <Skeleton height={136} radius="lg" />
          <div className={styles.stats}>
            <Skeleton height={88} radius="lg" />
            <Skeleton height={88} radius="lg" />
          </div>
        </div>
        <div className={styles.cards}>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} height={168} radius="lg" />
          ))}
        </div>
      </div>
      <div className={styles.side}>
        <Skeleton height={360} radius="lg" />
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className={styles.skel} role="status" aria-live="polite">
      <span className="sr-only">통장을 불러오는 중이에요</span>
      <Skeleton width={200} height={30} />
      <div className={styles.detail}>
        <Skeleton height={220} radius="lg" />
        <Skeleton height={420} radius="lg" />
      </div>
    </div>
  );
}
