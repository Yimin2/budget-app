'use client';

import { useId, useMemo, useState } from 'react';
import { formatNumber, formatWon, hasSendWork, monthOf, sendList, type SendItem } from '@/domain';
import { useLedger } from '@/state';
import { Badge, Button, Card, Icon, useToast, cx } from '@/ui';
import { errorMessage } from './selectors';
import styles from './sendCard.module.css';

/** 글을 클립보드로. 막혀 있으면 false (안내만) */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 홈 맨 위 '오늘 보낼 돈' (PLAN 4-13): 월급을 기록해 이번 달 배분이 생기면, 은행에서 실제로 보낼 줄을 보여 줘요.
 * 줄마다 받는 통장 · 은행 · 계좌번호 · 금액, [계좌번호 복사] · [금액 복사], [보냈어요] (두 사람 폰에서 같이 보여요).
 * 자동이체 배분은 '자동이체'로 따로 보낼 게 없고, 지난달과 금액이 다르면 '○ → ○로 바꿔 주세요' + [바꿨어요].
 * 월급통장에 돈이 남아 있으면 '덜 보낸 돈'. 할 일이 다 끝나면 카드가 사라져요
 */
export function SendCard({ className }: { className?: string }) {
  const ledger = useLedger();
  const toast = useToast();
  const titleId = useId();
  const data = ledger.data;
  const list = useMemo(() => (data ? sendList(data, ledger.today) : null), [data, ledger.today]);
  const [busy, setBusy] = useState<string | null>(null);
  if (!list || !hasSendWork(list)) return null;
  const month = Number(monthOf(ledger.today).slice(5));

  async function copy(text: string, what: string) {
    if (await copyText(text)) toast.success(`${what}를 복사했어요`);
    else toast.error(`${what}를 복사하지 못했어요. 길게 눌러 복사해 주세요`);
  }

  async function mark(items: SendItem[], sent: boolean, done: string) {
    const ids = items.map((i) => i.transfer.id);
    setBusy(ids.join(','));
    try {
      await ledger.markSent(ids, sent);
      toast.success(done, sent ? { action: { label: '되돌리기', onClick: () => void ledger.markSent(ids, false) } } : undefined);
    } catch (e) {
      toast.error(errorMessage(e, '표시하지 못했어요'));
    } finally {
      setBusy(null);
    }
  }

  const pending = list.sources.flatMap((s) => s.items.filter((i) => i.pending && !i.autoDebit));

  return (
    <Card as="section" className={cx(styles.card, className)} aria-labelledby={titleId} data-testid="send-card">
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          오늘 보낼 돈
        </h2>
        {list.pendingCount > 0 ? <span className={styles.count}>{list.pendingCount}건 남음</span> : null}
      </div>
      <p className={styles.lead}>{month}월 배분이에요. 은행에서 보낸 뒤 [보냈어요]를 눌러 주세요.</p>
      {list.sources.map((s) => (
        <div key={s.account.id} className={styles.source}>
          {list.sources.length > 1 ? <h3 className={styles.sourceName}>{s.account.name}에서</h3> : null}
          <ul className={styles.rows}>
            {s.items.map((i) => {
              const to = i.to;
              const acct = to?.accountNumber ?? '';
              const bankLine = [to?.bank, acct].filter(Boolean).join(' ');
              const rowBusy = busy === i.transfer.id;
              return (
                <li key={i.transfer.id} className={cx(styles.row, !i.pending && styles.rowDone)} data-testid={`send-${i.transfer.id}`}>
                  <div className={styles.rowMain}>
                    <span className={styles.toName}>
                      {to?.name ?? '받는 통장'}
                      {i.autoDebit ? (
                        <Badge tone="info" dot={false} className={styles.badge}>
                          자동이체
                        </Badge>
                      ) : null}
                    </span>
                    {bankLine ? (
                      <span className={styles.bank}>{bankLine}</span>
                    ) : !i.autoDebit ? (
                      <span className={styles.bankMissing}>설정 › 통장에서 계좌번호를 넣으면 복사할 수 있어요</span>
                    ) : null}
                    {i.changedFrom !== null && i.pending ? (
                      <span className={styles.change} data-testid="send-change">
                        <Icon name="alert-triangle" size={14} />
                        자동이체를 {formatWon(i.changedFrom)} → {formatWon(i.transfer.amount)}로 바꿔 주세요
                      </span>
                    ) : null}
                  </div>
                  <strong className={styles.amount}>{formatWon(i.transfer.amount)}</strong>
                  <div className={styles.actions}>
                    {acct && i.pending ? (
                      <Button variant="outline" icon="copy" onClick={() => void copy(acct, '계좌번호')} aria-label={`${to?.name ?? ''} 계좌번호 복사`}>
                        계좌
                      </Button>
                    ) : null}
                    {i.pending ? (
                      <Button
                        variant="outline"
                       
                        icon="copy"
                        onClick={() => void copy(String(i.transfer.amount), '금액')}
                        aria-label={`${formatNumber(i.transfer.amount)}원 금액 복사`}
                      >
                        금액
                      </Button>
                    ) : null}
                    {i.pending ? (
                      <Button
                       
                        icon="check"
                        loading={rowBusy}
                        disabled={busy !== null && !rowBusy}
                        onClick={() => void mark([i], true, i.autoDebit ? `${to?.name ?? ''} 자동이체를 바꿨다고 표시했어요` : `${to?.name ?? ''}에 보냈다고 표시했어요`)}
                      >
                        {i.autoDebit ? '바꿨어요' : '보냈어요'}
                      </Button>
                    ) : (
                      <span className={styles.done}>
                        <Icon name="check-circle" size={16} />
                        {i.autoDebit && !i.sent ? '자동이체' : i.autoDebit ? '바꿨어요' : '보냈어요'}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {s.leftover > 0 ? (
            <p className={styles.leftover} data-testid="send-leftover">
              <Icon name="info" size={16} />
              {s.account.name}에 {formatWon(s.leftover)}이 남아 있어요. 덜 보낸 돈이 있는지 확인해 주세요.
            </p>
          ) : null}
        </div>
      ))}
      {pending.length > 1 ? (
        <Button variant="ghost" className={styles.all} disabled={busy !== null} onClick={() => void mark(pending, true, `${pending.length}건을 보냈다고 표시했어요`)}>
          모두 보냈어요
        </Button>
      ) : null}
    </Card>
  );
}
