'use client';

import { useState } from 'react';
import { formatMan, formatMonthKo, formatShortDate, settlementSummary, shortfallText } from '@/domain';
import type { Settlement, SettlementSummary } from '@/domain';
import { useLedger } from '@/state';
import { Button, Card, cx, useToast } from '@/ui';
import styles from './claims.module.css';

export const SETTLE_HREF = '/plan/settle';

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** 지급 · 빌려 지급 · 바꾸기 버튼이 함께 쓰는 동작 (되돌리기 알림 포함) */
export function useSettleActions() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<void>, undo: () => Promise<void>, message: string) {
    if (busy) return;
    setBusy(key);
    try {
      await action();
      toast.success(message, {
        action: {
          label: '되돌리기',
          onClick: () => {
            undo().then(
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

/** '민구 30만 · 기쁜 2.4만' */
export function peopleManText(people: { name: string; amount: number }[]): string {
  return people.map((p) => `${p.name} ${formatMan(p.amount)}`).join(' · ');
}

/** 줄 돈이 없을 때 덧붙일 다음 정보: '다음 정산 12/1 2.4만' · '넘어간 돈 35만 · 12월쯤' */
function nextText(sum: SettlementSummary, baseYear: number): string | null {
  if (sum.next) return `다음 정산 ${formatShortDate(sum.next.date)} ${formatMan(sum.next.amount)}`;
  if (sum.carry) {
    const when = sum.carry.estimate ? `${formatMonthKo(sum.carry.estimate, baseYear)}쯤` : '12개월 안에는 어려워요';
    return `넘어간 돈 ${formatMan(sum.carry.amount)} · ${when}`;
  }
  return null;
}

/**
 * 이번 달 정산 한 줄 요약 (PLAN 4-9). 이벤트 화면과 홈에 보여요.
 * '이번 달 줄 돈 32.4만 (민구 30만 · 기쁜 2.4만) · 11/21 [정산하기]', 줄 돈이 없으면 '이번 달 줄 돈이 없어요 · 다음 정산 12/21 2.4만'.
 * 이벤트통장이 음수면 '이벤트통장이 ○원 모자라요'를 함께 보여요.
 * 항목 고르기 · 지급은 정산 화면(/plan/settle)에서 해요. 아직 안 돌려준 청구가 하나도 없으면 그리지 않아요.
 * compact: 지금 돌려줄 돈이 있을 때만. home: 홈 (늘 같은 한 줄, 사람별 목록 카드 대신)
 */
export function SettlementCard({ compact = false, home = false, className }: { compact?: boolean; home?: boolean; className?: string }) {
  const ledger = useLedger();
  const s = ledger.settlement;
  if (!s || !ledger.data) return null;
  if (compact && !s.dueNow) return null;
  const id = compact || home ? undefined : 'settlement';
  return <SettlementLine s={s} baseYear={Number(ledger.today.slice(0, 4))} className={className} id={id} />;
}

function SettlementLine({ s, baseYear, className, id }: { s: Settlement; baseYear: number; className?: string; id?: string }) {
  const sum = settlementSummary(s);
  if (!sum.hasClaims) return null;
  const next = sum.total > 0 ? null : nextText(sum, baseYear);
  const short = shortfallText(s);
  return (
    <Card as="section" id={id} aria-label="이번 달 정산" className={cx(styles.lineCard, className)}>
      <p className={styles.oneLine} data-testid="settlement-line">
        {sum.total > 0 ? (
          <>
            이번 달 줄 돈 <strong>{formatMan(sum.total)}</strong>{' '}
            <span className={styles.oneLineSub}>({peopleManText(sum.people)})</span> · {formatShortDate(sum.date)}
          </>
        ) : (
          <>
            <strong>이번 달 줄 돈이 없어요</strong>
            {next ? <span className={styles.oneLineSub}> · {next}</span> : null}
          </>
        )}
        {short ? (
          <span className={styles.oneLineWarn} data-testid="settlement-short">
            {' '}
            · {short}
          </span>
        ) : null}
      </p>
      <Button href={SETTLE_HREF} variant={sum.total > 0 ? 'primary' : 'outline'} iconRight="chevron-right" className={styles.lineBtn}>
        정산하기
      </Button>
    </Card>
  );
}
