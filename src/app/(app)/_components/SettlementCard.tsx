'use client';

import { useId, useState } from 'react';
import { formatDateKo, formatMonthKo, formatWon } from '@/domain';
import type { LedgerData, PendingClaim, PersonClaims, Settlement } from '@/domain';
import { useLedger } from '@/state';
import { Badge, Button, Card, cx, useToast } from '@/ui';
import styles from './claims.module.css';

function claimTitle(data: LedgerData, c: PendingClaim): string {
  const memo = c.expense.memo.trim();
  if (memo) return memo;
  const cat = c.expense.categoryId ? data.categories.find((x) => x.id === c.expense.categoryId)?.name : undefined;
  return cat ?? '지출';
}

/** '제주 항공권 외 1건' */
function itemsText(data: LedgerData, g: PersonClaims): string {
  const first = g.claims[0] ? claimTitle(data, g.claims[0]) : '';
  return g.claims.length > 1 ? `${first} 외 ${g.claims.length - 1}건` : first;
}

/** '기쁜 120,000원 · 민구 300,000원' */
export function peopleText(groups: PersonClaims[]): string {
  return groups.map((g) => `${g.name} ${formatWon(g.amount)}`).join(' · ');
}

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** 지급 · 빌려 지급 버튼이 함께 쓰는 동작 (되돌리기 알림 포함) */
function useSettleActions() {
  const ledger = useLedger();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, ids: string[], message: string, borrow = false) {
    if (busy || ids.length === 0) return;
    setBusy(key);
    try {
      if (borrow) await ledger.borrowAndSettleClaims(ids);
      else await ledger.settleClaims(ids);
      toast.success(message, {
        action: {
          label: '되돌리기',
          onClick: () => {
            ledger.unsettleClaims(ids).then(
              () => toast.show('지급한 기록을 되돌렸어요'),
              (e: unknown) => toast.error(errorText(e, '되돌리지 못했어요')),
            );
          },
        },
      });
    } catch (e) {
      toast.error(errorText(e, '지급한 기록을 저장하지 못했어요'));
    } finally {
      setBusy(null);
    }
  }
  return { busy, run };
}

const idsOf = (groups: PersonClaims[]) => groups.flatMap((g) => g.claims.map((c) => c.expense.id));

/**
 * 이번 달 정산 (PLAN 4-9). 이벤트 화면에 늘, 홈에는 지금 돌려줄 돈이 있을 때 compact 로 보여요.
 * 지급할 수 있는 돈 안에서 오래된 청구부터 사람별로 나누고, 안 들어간 돈은 다음 달로 넘겨요.
 * 저수지통장 청구는 '저수지에서 돌려받을 돈'으로 따로 보여요
 */
export function SettlementCard({ compact = false, className }: { compact?: boolean; className?: string }) {
  const ledger = useLedger();
  const titleId = useId();
  const { busy, run } = useSettleActions();
  const s = ledger.settlement;
  const data = ledger.data;
  if (!s || !data) return null;
  if (compact && !s.dueNow) return null;
  const empty = s.pay.length === 0 && s.carry.length === 0 && s.reservoir.length === 0;
  if (compact && empty) return null;

  const payAll = () => run('all', idsOf(s.pay), `${peopleText(s.pay)} 지급했다고 기록했어요`);

  if (compact) {
    return (
      <Card
        as="section"
        aria-labelledby={titleId}
        title={<span id={titleId}>이번 달 정산</span>}
        aside={<span className={styles.asideDate}>{formatDateKo(s.date, false)}</span>}
        className={className}
      >
        <dl className={styles.compactList}>
          {s.pay.length > 0 ? (
            <div>
              <dt>이번 달 지급</dt>
              <dd>{peopleText(s.pay)}</dd>
            </div>
          ) : null}
          {s.carry.length > 0 ? (
            <div>
              <dt>다음 달로 넘어가요</dt>
              <dd>{peopleText(s.carry)}</dd>
            </div>
          ) : null}
          {s.reservoir.length > 0 ? (
            <div>
              <dt>저수지에서 돌려받을 돈</dt>
              <dd>{peopleText(s.reservoir)}</dd>
            </div>
          ) : null}
        </dl>
        <div className={styles.actions}>
          {s.pay.length > 0 ? (
            <Button icon="check" loading={busy === 'all'} disabled={busy !== null && busy !== 'all'} onClick={() => void payAll()}>
              모두 지급했어요
            </Button>
          ) : null}
          <Button href="/plan#settlement" variant="outline">
            정산 자세히 보기
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card
      as="section"
      id="settlement"
      aria-labelledby={titleId}
      title={<span id={titleId}>이번 달 정산</span>}
      aside={<span className={styles.asideDate}>{formatDateKo(s.date, false)}</span>}
      className={cx(className)}
    >
      <PayableLine s={s} />

      {empty ? <p className={styles.summaryLine}>이번 달 돌려줄 돈이 없어요</p> : null}

      {s.pay.length > 0 ? (
        <>
          <h3 className={styles.dueTitle}>이번 달 지급 · {formatWon(s.payTotal)}</h3>
          <ul className={styles.dueList}>
            {s.pay.map((g) => (
              <li key={g.name} className={styles.dueRow}>
                <span className={styles.dueText}>
                  <strong>
                    {g.name} {formatWon(g.amount)}
                  </strong>
                  <span>{itemsText(data, g)}</span>
                </span>
                <Button
                  variant="outline"
                  icon="check"
                  loading={busy === `pay:${g.name}`}
                  disabled={busy !== null && busy !== `pay:${g.name}`}
                  onClick={() => void run(`pay:${g.name}`, idsOf([g]), `${g.name}에게 ${formatWon(g.amount)} 지급했다고 기록했어요`)}
                  aria-label={`${g.name}에게 ${formatWon(g.amount)} 지급했어요`}
                >
                  지급했어요
                </Button>
              </li>
            ))}
          </ul>
          {s.pay.length > 1 ? (
            <div className={styles.actions}>
              <Button icon="check" loading={busy === 'all'} disabled={busy !== null && busy !== 'all'} onClick={() => void payAll()}>
                모두 지급했어요
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {s.carry.length > 0 ? (
        <>
          <h3 className={styles.dueTitle}>다음 달로 넘어가요 · {formatWon(s.carryTotal)}</h3>
          <ul className={styles.dueList}>
            {s.carry.map((g) => (
              <li key={g.name} className={styles.dueRow}>
                <span className={styles.dueText}>
                  <strong>
                    {g.name} {formatWon(g.amount)}
                  </strong>
                  <span>
                    {g.estimate
                      ? `${formatMonthKo(g.estimate, Number(ledger.today.slice(0, 4)))}쯤 지급할 수 있어요`
                      : '12개월 안에는 어려워요'}{' '}
                    · {itemsText(data, g)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {s.reservoirAccountId ? (
            <div className={styles.borrow}>
              <p>
                지금 주려면 저수지에서 빌려요. 빌린 돈은 <strong>저수지에 갚을 돈</strong>으로 남고, 남는 달에 갚아요
              </p>
              <Button
                variant="outline"
                icon="arrow-right"
                loading={busy === 'borrow'}
                disabled={busy !== null && busy !== 'borrow'}
                onClick={() =>
                  void run('borrow', idsOf(s.carry), `저수지에서 ${formatWon(s.carryTotal)} 빌려 지급했다고 기록했어요`, true)
                }
              >
                저수지에서 빌려 지급
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {s.reservoir.length > 0 ? (
        <>
          <h3 className={styles.dueTitle}>
            저수지에서 돌려받을 돈 · {formatWon(s.reservoirTotal)}{' '}
            <Badge tone="info" size="sm">
              저수지
            </Badge>
          </h3>
          <ul className={styles.dueList}>
            {s.reservoir.map((g) => (
              <li key={g.name} className={styles.dueRow}>
                <span className={styles.dueText}>
                  <strong>
                    {g.name} {formatWon(g.amount)}
                  </strong>
                  <span>
                    저수지에서 지급 · {g.claims.length}건 · {itemsText(data, g)}
                  </span>
                </span>
                <Button
                  variant="outline"
                  icon="check"
                  loading={busy === `res:${g.name}`}
                  disabled={busy !== null && busy !== `res:${g.name}`}
                  onClick={() =>
                    void run(`res:${g.name}`, idsOf([g]), `저수지에서 ${g.name}에게 ${formatWon(g.amount)} 지급했다고 기록했어요`)
                  }
                  aria-label={`저수지에서 ${g.name}에게 ${formatWon(g.amount)} 지급했어요`}
                >
                  지급했어요
                </Button>
              </li>
            ))}
          </ul>
          <p className={styles.note}>저수지에 쓸 돈이라 저수지에서 줘요. 빌린 돈이 아니에요</p>
        </>
      ) : null}

      {s.upcoming.length > 0 ? (
        <p className={styles.note}>
          정산일이 아직 안 된 돈:{' '}
          {s.upcoming.map((g) => `${g.name} ${formatWon(g.amount)} (${formatDateKo(g.due, false)})`).join(' · ')}
        </p>
      ) : null}
    </Card>
  );
}

/** 지급할 수 있는 돈 한 줄 + 어떻게 셌는지 */
function PayableLine({ s }: { s: Settlement }) {
  const when = s.asOf === s.date ? `${formatDateKo(s.date, false)} 이벤트통장` : '오늘 이벤트통장';
  return (
    <p className={styles.summaryLine}>
      지급할 수 있는 돈 <strong>{formatWon(s.payable)}</strong>
      <span className={styles.subLine}>
        {when} {formatWon(s.balance)}
        {s.asOf === s.date ? '(적립 포함)' : ''}
        {s.reserved > 0 ? ` − 이번 달 남은 일정 ${formatWon(s.reserved)}` : ''}
      </span>
    </p>
  );
}
