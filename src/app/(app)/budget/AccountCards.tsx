'use client';

import { useState, type ReactNode } from 'react';
import { formatMan, formatShortDate, monthOf, needBreakdownText, ruleChangeText, ruleNext, addDays } from '@/domain';
import type { Account, AccountRole, FixedExpense } from '@/domain/types';
import { Badge, Card } from '@/ui';
import { ExpandButton } from '../_components/ExpandButton';
import type { ReadyLedger } from '../_components/RequireLedger';
import { accountName } from '../settings/helpers';
import { FixedCard } from '../settings/sections/FixedCard';
import { InstallmentCard } from '../settings/sections/InstallmentCard';
import { LivingCard } from '../settings/sections/LivingCard';
import { OwnerTabs, ownerGroups, ownerKeyOf, useOwnerFilter } from '../settings/sections/OwnerTabs';
import { accountMoney, type AccountMoney, type FlowKind } from './flow';
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

const KIND_SHORT: Record<FlowKind, string> = { fixed: '', auto: ' (자동)', remainder: ' (남는 돈 전부)', left: '' };

const liveIn = (f: FixedExpense, month: string) => !f.deleted && (f.endMonth === null || f.endMonth === '' || f.endMonth >= month);

/** 통장 카드에 보일 나가는 돈 줄: 생활비 통장은 셋 다, 용돈 통장은 고정비 · 할부, 다른 통장은 있는 것만 */
interface OutRows {
  bills: boolean;
  installments: boolean;
  living: boolean;
}

/**
 * 예산 '통장별 들어오는 돈 · 나가는 돈' (작업정리 8-3): 사람 탭(민구 · 기쁜 · 함께)마다 통장 카드 하나씩.
 * 들어오는 돈(배분 금액 · 날짜)과 나가는 돈(고정비 · 할부 · 생활비 예산 합)을 접힌 요약으로, 펼치면 그 자리에서 항목을 고쳐요.
 * 항목 고치기는 예전 카드(FixedCard · InstallmentCard · LivingCard)를 그 통장으로 좁혀 그대로 써요 — 항목은 한 곳에만 보여요
 */
export function AccountCards({ ledger }: { ledger: ReadyLedger }) {
  const month = monthOf(ledger.today);
  const data = ledger.data;
  const fixed = data.fixedExpenses;
  const has = (id: string): OutRows => ({
    bills: fixed.some((f) => liveIn(f, month) && (f.kind === 'bill' || f.kind === 'allowance') && f.accountId === id),
    installments: ledger.installments.some((p) => !p.ended && p.accountId === id),
    living: fixed.some((f) => liveIn(f, month) && f.kind === 'living' && f.accountId === id),
  });
  // 수입통장이 아닌 통장 모두 + 항목이 있는 통장 (수입통장 · 지운 통장이라도 항목은 한 번씩 보이게)
  const accounts: Account[] = data.accounts
    .filter((a) => {
      const h = has(a.id);
      const any = h.bills || h.installments || h.living;
      return any || (!a.deleted && a.role !== 'income');
    })
    .sort((a, b) => Number(a.deleted) - Number(b.deleted) || a.order - b.order);

  const keys = accounts.map((a) => ownerKeyOf(a));
  const meKey = ledger.myLivingAccountId ? ownerKeyOf(data.accounts.find((a) => a.id === ledger.myLivingAccountId)) : null;
  const groups = ownerGroups(keys, data, meKey);
  const initial = groups[0]?.value ?? 'all';
  const owners = useOwnerFilter(keys, data, initial, meKey);
  const shown = accounts.filter((a) => owners.matches(ownerKeyOf(a)));
  // '/budget#st-fixed' 처럼 들어오면 처음 탭의 첫 생활비 통장(없으면 첫 통장)에서 그 칸을 펼쳐요
  const firstTab = accounts.filter((a) => ownerKeyOf(a) === (initial === '__shared' ? '' : initial));
  const anchorId = (firstTab.find((a) => a.role === 'fixed' && !a.deleted) ?? firstTab[0] ?? accounts[0])?.id ?? null;

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
            />
          );
        })}
      </div>
      <LivingCard ledger={ledger} extras />
    </div>
  );
}

function AccountCard({
  ledger,
  account,
  money,
  rows,
  anchor,
}: {
  ledger: ReadyLedger;
  account: Account;
  money: AccountMoney;
  rows: OutRows;
  anchor: boolean;
}) {
  const [inOpen, setInOpen] = useState(false);
  const headId = `bd-acc-${account.id}`;
  const inId = `${headId}-in`;
  const name = account.name;
  const incomingSummary =
    money.incoming.length === 0
      ? '들어오는 배분이 없어요'
      : money.incoming.map((l) => `${l.day}일 ${formatMan(l.amount)}${KIND_SHORT[l.kind]}`).join(' · ');
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

      {/* 들어오는 돈 */}
      <div className={styles.block} role="group" aria-label={`${name} 들어오는 돈`}>
        <div className={styles.blockRow}>
          <div className={styles.blockText}>
            <span className={styles.blockLabel}>들어오는 돈</span>
            <span className={styles.blockValue} data-testid="incoming-summary">
              {incomingSummary}
            </span>
          </div>
          {money.incoming.length > 0 ? (
            <ExpandButton open={inOpen} onToggle={() => setInOpen((o) => !o)} controls={inId} openLabel="펼치기" label={`${name} 들어오는 돈`} />
          ) : null}
        </div>
        {inOpen ? (
          <ul id={inId} className={styles.inList}>
            {money.incoming.map((l) => {
              const next = l.kind === 'remainder' ? null : ruleNext(ledger.data, l.rule, ledger.today);
              const change = next ? ruleChangeText(next) : null;
              return (
                <li key={l.rule.id}>
                  <span>
                    {l.day}일 · {accountName(ledger.data.accounts, l.fromAccountId)}에서 · <strong>{formatMan(l.amount)}</strong>
                    {KIND_SHORT[l.kind]}
                  </span>
                  {l.kind === 'auto' && next?.need ? <span className="st-hint-line">{needBreakdownText(next.need)}</span> : null}
                  {change ? <span className="st-change">{change}</span> : null}
                </li>
              );
            })}
            <li>
              <a className={styles.inlineLink} href="#st-rules">
                배분 고치기
              </a>
            </li>
          </ul>
        ) : (
          <div id={inId} hidden />
        )}
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
                <FixedCard ledger={ledger} accountId={account.id} />
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
                <InstallmentCard ledger={ledger} accountId={account.id} />
              </OutRow>
            ) : null}
            {rows.living ? (
              <OutRow id={anchor ? 'st-living' : undefined} baseId={`${headId}-living`} name={name} label="생활비 예산" amount={money.living}>
                <LivingCard ledger={ledger} accountId={account.id} />
              </OutRow>
            ) : null}
          </div>
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
