'use client';

import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { formatNumber, formatWon, suggestExpenses } from '@/domain';
import type { ExpenseSuggestion } from '@/domain';
import { useLedger } from '@/state';
import { Button, Chip, ChipGroup, Dialog, Field, MoneyInput, useToast, cx } from '@/ui';
import { errorMessage } from './selectors';
import styles from './home.module.css';

/**
 * 내가 최근 3개월 동안 자주 쓴 지출 칩 (domain/suggestions.ts). 따로 등록하지 않아요.
 * 칩을 누르면 금액 팝업이 떠요(가장 최근 금액). [기록하기]로 오늘 날짜 · 나(내 통장)로 기록해요.
 * 휴대폰은 키보드가 올라오면 팝업이 키보드 위로 올라가요 (Dialog)
 */
export function QuickSuggestions() {
  const ledger = useLedger();
  const toast = useToast();
  const titleId = useId();
  const editId = useId();
  const amountId = `quick-amount-${useId().replace(/:/g, '')}`;
  const data = ledger.data;
  const suggestions = useMemo(
    () => (data ? suggestExpenses(data, { today: ledger.today, meKey: ledger.mySpenderKey, myLivingId: ledger.myLivingAccountId }) : []),
    [data, ledger.today, ledger.mySpenderKey, ledger.myLivingAccountId],
  );
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const open = suggestions.find((s) => s.key === openKey) ?? null;

  // 펼치면 금액 칸으로 (휴대폰은 숫자 키패드가 바로 떠요)
  useEffect(() => {
    if (!openKey) return;
    const el = document.getElementById(amountId);
    if (el instanceof HTMLInputElement) {
      el.focus();
      el.select();
    }
  }, [openKey, amountId]);

  function toggle(s: ExpenseSuggestion) {
    if (saving) return;
    if (openKey === s.key) {
      setOpenKey(null);
      return;
    }
    setOpenKey(s.key);
    setAmount(s.amount);
    setError(null);
  }

  function close() {
    if (saving) return;
    setOpenKey(null);
    setError(null);
  }

  async function undo(expenseId: string) {
    try {
      await ledger.deleteExpense(expenseId);
      toast.show('기록을 되돌렸어요');
    } catch (e) {
      toast.error(errorMessage(e, '되돌리지 못했어요'));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!open || saving) return;
    if (!amount || amount <= 0) {
      setError('금액을 입력해 주세요');
      return;
    }
    setSaving(true);
    try {
      const expense = await ledger.addExpense({
        date: ledger.today,
        amount,
        accountId: open.accountId,
        categoryId: open.categoryId,
        memo: open.memo,
      });
      toast.success(`${open.label} ${formatWon(amount)} 기록했어요`, {
        action: { label: '되돌리기', onClick: () => void undo(expense.id) },
      });
      setOpenKey(null);
      setError(null);
    } catch (err) {
      toast.error(errorMessage(err, '지출을 기록하지 못했어요'));
    } finally {
      setSaving(false);
    }
  }

  const category = open?.categoryId ? data?.categories.find((c) => c.id === open.categoryId) : undefined;
  const account = open ? data?.accounts.find((a) => a.id === open.accountId) : undefined;

  return (
    <section className={cx(styles.section, styles.oFav)} aria-labelledby={titleId}>
      <h2 id={titleId} className="section-title">
        자주 쓰는 지출
      </h2>
      {suggestions.length === 0 ? (
        <p className={styles.hintText}>지출을 기록하면 자주 쓴 것을 여기에서 한 번에 기록할 수 있어요.</p>
      ) : (
        <>
          <ChipGroup>
            {suggestions.map((s) => {
              const on = s.key === openKey;
              return (
                <Chip
                  key={s.key}
                  className={on ? 'on' : undefined}
                  onClick={() => toggle(s)}
                  disabled={saving && !on}
                  aria-haspopup="dialog"
                  aria-label={`${s.label} ${formatWon(s.amount)} 기록하기`}
                >
                  {s.label} {formatNumber(s.amount)}
                </Chip>
              );
            })}
          </ChipGroup>
          <Dialog
            open={open !== null}
            onClose={close}
            title={open ? `${open.label} 기록` : ''}
            description={open ? [category?.name, account?.name, '오늘'].filter(Boolean).join(' · ') : undefined}
            actions={
              <>
                <Button type="button" variant="ghost" onClick={close} disabled={saving}>
                  취소
                </Button>
                <Button type="submit" form={editId} icon="check" loading={saving}>
                  기록하기
                </Button>
              </>
            }
          >
            {open ? (
              <form id={editId} aria-label={`${open.label} 기록`} onSubmit={(e) => void submit(e)}>
                <Field id={amountId} label="금액" error={error ?? undefined}>
                  <MoneyInput
                    value={amount}
                    onChange={(v) => {
                      setAmount(v);
                      if (error) setError(null);
                    }}
                    size="lg"
                    enterKeyHint="done"
                    disabled={saving}
                  />
                </Field>
              </form>
            ) : null}
          </Dialog>
        </>
      )}
    </section>
  );
}

/* ───────── 이벤트통장 ───────── */
