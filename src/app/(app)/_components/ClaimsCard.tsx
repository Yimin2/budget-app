'use client';

import { useId, useState } from 'react';
import { formatDateKo, formatShortDate, formatWon } from '@/domain';
import type { LedgerData, PendingClaim } from '@/domain/types';
import { useLedger } from '@/state';
import { Button, Card, Money, cx, useToast } from '@/ui';
import styles from './claims.module.css';

interface PayerGroup {
  payer: string;
  amount: number;
  claims: PendingClaim[];
}

/** 오늘 돌려줄 청구를 사람마다 묶어요 (처음 나온 순서) */
function groupByPayer(claims: PendingClaim[]): PayerGroup[] {
  const out: PayerGroup[] = [];
  for (const c of claims) {
    const g = out.find((x) => x.payer === c.payer);
    if (g) {
      g.amount += c.amount;
      g.claims.push(c);
    } else out.push({ payer: c.payer, amount: c.amount, claims: [c] });
  }
  return out;
}

function claimTitle(data: LedgerData, c: PendingClaim): string {
  const memo = c.expense.memo.trim();
  if (memo) return memo;
  const cat = c.expense.categoryId ? data.categories.find((x) => x.id === c.expense.categoryId)?.name : undefined;
  return cat ?? '지출';
}

function accountName(data: LedgerData, id: string | null): string | null {
  if (!id) return null;
  return data.accounts.find((a) => a.id === id)?.name ?? null;
}

/** 묶음 설명: '이벤트통장 → 민지 수입통장 · 제주 항공권 외 1건' */
function groupDetail(data: LedgerData, g: PayerGroup): string {
  const from = [...new Set(g.claims.map((c) => accountName(data, c.accountId) ?? '지운 통장'))].join(' · ');
  const to = accountName(data, g.claims[0]?.claimAccountId ?? null);
  const first = g.claims[0] ? claimTitle(data, g.claims[0]) : '';
  const items = g.claims.length > 1 ? `${first} 외 ${g.claims.length - 1}건` : first;
  return `${from} → ${to ?? `${g.payer}님`} · ${items}`;
}

/**
 * 돌려받을 돈 (PLAN 4-9). 홈과 이벤트 화면에 보여요. 아직 돌려주지 않은 청구가 없으면 그리지 않아요.
 * "돌려받을 돈 ○원 (민지 ○ · 준호 ○) · 다음 정산일", 정산일이 된 청구는 사람마다 [보냈어요]
 */
export function ClaimsCard({ className }: { className?: string }) {
  const ledger = useLedger();
  const toast = useToast();
  const titleId = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const claims = ledger.claims;
  const data = ledger.data;
  if (!claims || !data || claims.total <= 0) return null;

  const groups = groupByPayer(claims.dueNow);
  const people = claims.byPayer.map((p) => `${p.name} ${formatWon(p.amount)}`).join(' · ');
  const later = claims.pending.filter((c) => !c.dueNow);
  const nextLater = later[0]?.due ?? null;

  async function settle(g: PayerGroup) {
    if (busy) return;
    setBusy(g.payer);
    const ids = g.claims.map((c) => c.expense.id);
    try {
      await ledger.settleClaims(ids);
      toast.success(`${g.payer}에게 ${formatWon(g.amount)} 돌려줬다고 기록했어요`, {
        action: {
          label: '되돌리기',
          onClick: () => {
            ledger.unsettleClaims(ids).then(
              () => toast.show('돌려준 기록을 되돌렸어요'),
              (e: unknown) => toast.error(e instanceof Error && e.message ? e.message : '되돌리지 못했어요'),
            );
          },
        },
      });
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : '돌려준 기록을 저장하지 못했어요');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      as="section"
      aria-labelledby={titleId}
      title={<span id={titleId}>돌려받을 돈</span>}
      aside={<Money amount={claims.total} />}
      className={cx(className)}
    >
      <p className={styles.summaryLine}>
        {people}
        {nextLater ? (
          <>
            {' '}
            · 다음 정산일 <strong>{formatDateKo(nextLater, false)}</strong>
          </>
        ) : null}
      </p>

      {groups.length > 0 ? (
        <>
          <h3 className={styles.dueTitle}>오늘 돌려줄 돈</h3>
          <ul className={styles.dueList}>
            {groups.map((g) => (
              <li key={g.payer} className={styles.dueRow}>
                <span className={styles.dueText}>
                  <strong>
                    {g.payer}에게 {formatWon(g.amount)}
                  </strong>
                  <span>{groupDetail(data, g)}</span>
                </span>
                <Button
                  variant="outline"
                  icon="check"
                  loading={busy === g.payer}
                  disabled={busy !== null && busy !== g.payer}
                  onClick={() => void settle(g)}
                  aria-label={`${g.payer}에게 ${formatWon(g.amount)} 보냈어요`}
                >
                  보냈어요
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {later.length > 0 ? (
        <details className={styles.more}>
          <summary>정산일을 기다리는 {later.length}건 보기</summary>
          <ul className={styles.moreList}>
            {later.map((c) => (
              <li key={c.expense.id}>
                <span>
                  {claimTitle(data, c)}
                  <span className={styles.moreMeta}>
                    {formatShortDate(c.expense.date)} · {c.payer} · {formatDateKo(c.due, false)}에 돌려줘요
                  </span>
                </span>
                <span>{formatWon(c.amount)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}
