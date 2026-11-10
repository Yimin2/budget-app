'use client';

import type { ReactNode } from 'react';
import { formatMan, formatShortDate, formatWon, monthOf, plannedIncome, addDays } from '@/domain';
import type { Account, AccountRole, FixedExpense } from '@/domain/types';
import { Badge, Card } from '@/ui';
import { ExpandButton } from '../_components/ExpandButton';
import type { ReadyLedger } from '../_components/RequireLedger';
import { incomeSummaries, type IncomeSummary } from '../settings/helpers';
import { FixedCard } from '../settings/sections/FixedCard';
import { InstallmentCard } from '../settings/sections/InstallmentCard';
import { LivingCard } from '../settings/sections/LivingCard';
import { OwnerTabs, ownerGroups, ownerKeyOf, useOwnerFilter } from '../settings/sections/OwnerTabs';
import { accountMoney, flowName, type AccountMoney } from './flow';
import { IncomePlanRows, IncomingRules, incomePlanRows, incomingRuleRows } from './IncomingRows';
import { INSTALLMENT_THIS_MONTH } from './monthLedger';
import { ReadOnly } from './ReadOnly';
import type { BudgetMonthKind } from '@/domain';
import { useHashOpen } from './useHashOpen';
import styles from './budget.module.css';

const ROLE_TEXT: Record<AccountRole, string> = {
  income: '수입',
  fixed: '생활비',
  allowance: '용돈',
  event: '이벤트',
  reservoir: '저수지',
  savings: '저축',
  other: '기타',
};

const liveIn = (f: FixedExpense, month: string) => !f.deleted && (f.endMonth === null || f.endMonth === '' || f.endMonth >= month);

/** 통장 카드에 보일 나가는 돈 줄: 생활비 통장은 셋 다, 용돈 통장은 고정비 · 할부, 다른 통장은 있는 것만 */
interface OutRows {
  bills: boolean;
  installments: boolean;
  living: boolean;
}

/**
 * 예산 '통장별 들어오는 돈 · 나가는 돈' (작업정리 8-3): 사람 탭(민구 · 기쁜 · 함께)마다 통장 카드 하나씩.
 * 들어오는 돈은 배분 줄(월급통장은 수입 계획 줄)을 바로 보여 주고, 줄을 누르면 그 자리에서 고쳐요 ([+ 들어오는 돈] · [+ 수입]).
 * 나가는 돈(고정비 · 할부 · 생활비 예산 합)은 접힌 요약으로, 펼치면 그 자리에서 항목을 고쳐요.
 * 항목 고치기는 예전 카드(FixedCard · InstallmentCard · LivingCard)를 그 통장으로 좁혀 그대로 써요 — 항목은 한 곳에만 보여요
 */
export function AccountCards({
  ledger,
  readOnly = false,
  kind = 'current',
}: {
  ledger: ReadyLedger;
  /** 지난 달 · 준비하지 않은 다음 달: 펼쳐도 보기만 (작업정리 13) */
  readOnly?: boolean;
  kind?: BudgetMonthKind;
}) {
  const month = monthOf(ledger.today);
  const data = ledger.data;
  const fixed = data.fixedExpenses;
  const has = (id: string): OutRows => ({
    bills: fixed.some((f) => liveIn(f, month) && (f.kind === 'bill' || f.kind === 'allowance') && f.accountId === id),
    installments: ledger.installments.some((p) => !p.ended && p.accountId === id),
    living: fixed.some((f) => liveIn(f, month) && f.kind === 'living' && f.accountId === id),
  });
  // 지우지 않은 통장 모두(월급통장은 수입 계획 · 보내는 돈) + 항목이 있는 지운 통장 (항목은 한 번씩 보이게)
  const accounts: Account[] = data.accounts
    .filter((a) => {
      const h = has(a.id);
      return h.bills || h.installments || h.living || !a.deleted;
    })
    .sort((a, b) => Number(a.deleted) - Number(b.deleted) || a.order - b.order);

  const keys = accounts.map((a) => ownerKeyOf(a));
  const meKey = ledger.myLivingAccountId ? ownerKeyOf(data.accounts.find((a) => a.id === ledger.myLivingAccountId)) : null;
  const groups = ownerGroups(keys, data, meKey);
  // 처음 탭: 내 생활비 통장이 있는 탭 (함께 쓰는 생활비 통장이면 '함께'), 없으면 첫 탭
  const initial = meKey === '' && keys.includes('') ? '__shared' : meKey && keys.includes(meKey) ? meKey : (groups[0]?.value ?? 'all');
  const owners = useOwnerFilter(keys, data, initial, meKey);
  const shown = accounts.filter((a) => owners.matches(ownerKeyOf(a)));
  // '/budget#st-fixed' 처럼 들어오면 처음 탭의 첫 생활비 통장(없으면 첫 통장)에서 그 칸을 펼쳐요
  const firstTab = accounts.filter((a) => ownerKeyOf(a) === (initial === '__shared' ? '' : initial));
  const anchorId = (firstTab.find((a) => a.role === 'fixed' && !a.deleted) ?? firstTab[0] ?? accounts[0])?.id ?? null;
  // '#st-income' 은 보이는 첫 월급통장의 수입 계획 줄로
  const incomeAnchorId = shown.find((a) => a.role === 'income' && !a.deleted)?.id ?? null;
  const summaries = new Map(incomeSummaries(data, month).map((x) => [x.account.id, x]));

  if (accounts.length === 0) {
    return <p className="st-desc">통장이 아직 없어요. 설정에서 통장을 추가해 주세요.</p>;
  }

  return (
    <div className="stack gap-4">
      <OwnerTabs filter={owners} label="누구 통장" allLabel={false} />
      <div className={styles.accountGrid}>
        {shown.map((a) => {
          const h = has(a.id);
          const rows: OutRows = {
            bills: h.bills || a.role === 'fixed' || a.role === 'allowance',
            installments: h.installments || a.role === 'fixed' || a.role === 'allowance',
            living: h.living || a.role === 'fixed',
          };
          return (
            <AccountCard
              key={a.id}
              ledger={ledger}
              account={a}
              money={accountMoney(data, a.id, month, ledger.today)}
              rows={rows}
              anchor={a.id === anchorId}
              incomeAnchor={a.id === incomeAnchorId}
              summary={summaries.get(a.id) ?? null}
              readOnly={readOnly}
              installmentsReadOnly={readOnly || kind !== 'current'}
            />
          );
        })}
      </div>
      {kind === 'current' ? <LivingCard ledger={ledger} extras /> : null}
    </div>
  );
}

function AccountCard({
  ledger,
  account,
  money,
  rows,
  anchor,
  incomeAnchor,
  summary,
  readOnly,
  installmentsReadOnly,
}: {
  ledger: ReadyLedger;
  account: Account;
  money: AccountMoney;
  rows: OutRows;
  /** '#st-fixed' · '#st-rules' 같은 주소로 들어올 통장 */
  anchor: boolean;
  incomeAnchor: boolean;
  /** 월급통장: 보내는 배분 합 · 수입과 비교 */
  summary: IncomeSummary | null;
  readOnly: boolean;
  installmentsReadOnly: boolean;
}) {
  const headId = `bd-acc-${account.id}`;
  const name = account.name;
  const isIncome = account.role === 'income' && !account.deleted;
  const month = monthOf(ledger.today);
  const planned = isIncome ? plannedIncome(ledger.data, month, account.id) : 0;
  const ruleCount = incomingRuleRows(ledger, account.id, money.incoming).length;
  const incomingSummary = isIncome
    ? planned > 0
      ? `한 달 ${formatMan(planned)}`
      : incomePlanRows(ledger, account.id).length > 0
        ? '다음 달부터 들어와요'
        : '수입 계획이 없어요'
    : money.incoming.length > 0
      ? `한 달 ${formatMan(money.incomingTotal)}`
      : ruleCount > 0
        ? '다음 달부터 들어와요'
        : '들어오는 배분이 없어요';
  const anyOut = rows.bills || rows.installments || rows.living;
  const diff = money.incomingTotal - money.outgoingTotal;
  const period = `${formatShortDate(money.from)} ~ ${formatShortDate(addDays(money.to, -1))}`;

  return (
    <Card as="article" aria-labelledby={headId} className={styles.accountCard} data-testid="account-card">
      <div className={styles.accHead}>
        <h3 id={headId} className={styles.accTitle}>
          {name}
        </h3>
        <Badge size="sm" tone={account.deleted ? 'warning' : 'neutral'}>
          {account.deleted ? '지운 통장' : ROLE_TEXT[account.role]}
        </Badge>
      </div>

      {/* 들어오는 돈: 줄을 누르면 그 자리에서 고쳐요 */}
      <div
        id={anchor ? 'st-rules' : incomeAnchor ? 'st-income' : undefined}
        className={styles.block}
        role="group"
        aria-label={`${name} 들어오는 돈`}
      >
        <div className={styles.blockRow}>
          <div className={styles.blockText}>
            <span className={styles.blockLabel}>들어오는 돈</span>
            <span className={styles.blockValue} data-testid="incoming-summary">
              {incomingSummary}
            </span>
          </div>
        </div>
        {isIncome ? <IncomePlanRows ledger={ledger} account={account} readOnly={readOnly} /> : null}
        <IncomingRules ledger={ledger} account={account} incoming={money.incoming} readOnly={readOnly || account.deleted} addable={!isIncome} />
      </div>

      {/* 나가는 돈 */}
      <div className={styles.block} role="group" aria-label={`${name} 나가는 돈`}>
        <div className={styles.blockRow}>
          <div className={styles.blockText}>
            <span className={styles.blockLabel}>나가는 돈</span>
            <span className={styles.blockValue} data-testid="outgoing-total">
              {anyOut ? `${formatMan(money.outgoingTotal)} · ${period}` : '나가는 고정 지출이 없어요'}
            </span>
          </div>
        </div>
        {anyOut ? (
          <div className={styles.outList}>
            {rows.bills ? (
              <OutRow
                id={anchor ? 'st-fixed' : undefined}
                baseId={`${headId}-bills`}
                name={name}
                label="고정비"
                count={money.billCount}
                amount={money.bills}
              >
                <ReadOnly on={readOnly}>
                  <FixedCard ledger={ledger} accountId={account.id} />
                </ReadOnly>
              </OutRow>
            ) : null}
            {rows.installments ? (
              <OutRow
                id={anchor ? 'st-installment' : undefined}
                baseId={`${headId}-inst`}
                name={name}
                label="할부"
                count={money.installmentCount}
                amount={money.installments}
              >
                <ReadOnly on={installmentsReadOnly} note={readOnly ? undefined : INSTALLMENT_THIS_MONTH}>
                  <InstallmentCard ledger={ledger} accountId={account.id} />
                </ReadOnly>
              </OutRow>
            ) : null}
            {rows.living ? (
              <OutRow id={anchor ? 'st-living' : undefined} baseId={`${headId}-living`} name={name} label="생활비 예산" amount={money.living}>
                <ReadOnly on={readOnly}>
                  <LivingCard ledger={ledger} accountId={account.id} />
                </ReadOnly>
              </OutRow>
            ) : null}
          </div>
        ) : null}
        {isIncome && summary && summary.total > 0 ? (
          <p className={styles.note} data-testid="income-sent">
            매달 배분으로 보내는 돈 {formatMan(summary.total)}
            {summary.remainder ? ` · 남는 돈 전부 → ${flowName(ledger.data, ledger.data.accounts.find((a) => a.id === summary.remainder!.toAccountId))}` : ''}
          </p>
        ) : null}
        {isIncome && summary && summary.over > 0 ? (
          <p className={styles.warn} role="note">
            {name}에서 보내는 돈이 수입보다 {formatWon(summary.over)} 많아요
          </p>
        ) : null}
        {anyOut && money.incomingTotal > 0 && diff !== 0 ? (
          <p className={diff < 0 ? styles.warn : styles.note} data-testid="account-diff">
            {diff < 0 ? `들어오는 돈보다 나가는 돈이 ${formatMan(-diff)} 많아요` : `나가는 돈을 빼고 ${formatMan(diff)} 남아요`}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/** 나가는 돈 한 줄: '고정비 · 3건 · 26만' + [펼치기] → 그 자리에서 그 통장 항목 목록 · 고치기 */
function OutRow({
  id,
  baseId,
  name,
  label,
  count,
  amount,
  children,
}: {
  /** 주소 # 로 펼칠 칸 id (st-fixed · st-installment · st-living, 한 통장에만) */
  id?: string;
  baseId: string;
  name: string;
  label: string;
  count?: number;
  amount: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useHashOpen(id ? [id] : [], !!id);
  const bodyId = `${baseId}-body`;
  return (
    <div id={id} className={styles.outRow} data-testid="out-row">
      <div className={styles.blockRow}>
        <p className={styles.outText}>
          <span>{label}</span>
          {count !== undefined && count > 0 ? <span className="muted"> · {count}건</span> : null}
          <strong className={styles.outAmount}>{formatMan(amount)}</strong>
        </p>
        <ExpandButton open={open} onToggle={() => setOpen((o) => !o)} controls={bodyId} openLabel="펼치기" label={`${name} ${label}`} />
      </div>
      {open ? (
        <div id={bodyId} className={styles.outBody}>
          {children}
        </div>
      ) : (
        <div id={bodyId} hidden />
      )}
    </div>
  );
}
