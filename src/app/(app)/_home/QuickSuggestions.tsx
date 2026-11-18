'use client';

import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { formatNumber, formatWon, suggestExpenses } from '@/domain';
import type { ExpenseSuggestion } from '@/domain';
import { useLedger } from '@/state';
import { Button, Chip, ChipGroup, Field, MoneyInput, useToast, cx } from '@/ui';
import { errorMessage } from './selectors';
import styles from './home.module.css';

/**
 * 내가 최근 3개월 동안 자주 쓴 지출 칩 (domain/suggestions.ts). 따로 등록하지 않아요.
 * 칩을 누르면 바로 오늘 날짜 · 나(내 통장) · 가장 최근 금액으로 기록하고, 알림의 [되돌리기]로 지울 수 있어요.
 * 금액이 다르면 내역에서 고쳐요
 */
export function QuickSuggestions() {
  const ledger = useLedger();
  const toast = useToast();
  const titleId = useId();
  const data = ledger.data;
  const suggestions = useMemo(
    () => (data ? suggestExpenses(data, { today: ledger.today, meKey: ledger.mySpenderKey, myLivingId: ledger.myLivingAccountId }) : []),
    [data, ledger.today, ledger.mySpenderKey, ledger.myLivingAccountId],
  );
  const [savingKey, setSavingKey] = useState<string | null>(null);

  async function undo(expenseId: string) {
    try {
      await ledger.deleteExpense(expenseId);
      toast.show('기록을 되돌렸어요');
    } catch (e) {
      toast.error(errorMessage(e, '되돌리지 못했어요'));
    }
  }

  async function record(s: ExpenseSuggestion) {
    if (savingKey) return;
    setSavingKey(s.key);
    try {
      const expense = await ledger.addExpense({
        date: ledger.today,
        amount: s.amount,
        accountId: s.accountId,
        categoryId: s.categoryId,
        memo: s.memo,
      });
      toast.success(`${s.label} ${formatWon(s.amount)} 기록했어요`, {
        action: { label: '되돌리기', onClick: () => void undo(expense.id) },
      });
    } catch (err) {
      toast.error(errorMessage(err, '지출을 기록하지 못했어요'));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <section className={cx(styles.section, styles.oFav)} aria-labelledby={titleId}>
      <h2 id={titleId} className="section-title">
        자주 쓰는 지출
      </h2>
      {suggestions.length === 0 ? (
        <p className={styles.hintText}>지출을 기록하면 자주 쓴 것을 여기에서 한 번에 기록할 수 있어요.</p>
      ) : (
        <ChipGroup>
          {suggestions.map((s) => (
            <Chip
              key={s.key}
              onClick={() => void record(s)}
              disabled={savingKey !== null && savingKey !== s.key}
              aria-busy={savingKey === s.key || undefined}
              aria-label={`${s.label} ${formatWon(s.amount)} 기록하기`}
            >
              {s.label} {formatNumber(s.amount)}
            </Chip>
          ))}
        </ChipGroup>
      )}
    </section>
  );
}

/* ───────── 이벤트통장 ───────── */
