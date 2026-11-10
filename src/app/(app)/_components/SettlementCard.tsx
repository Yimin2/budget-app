'use client';

import { useState } from 'react';
import { eventMonthUsage, formatMan, formatManShort } from '@/domain';
import type { EventMonthUsage } from '@/domain';
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

/**
 * 홈의 이번 달 이벤트통장 한 줄 (PLAN 4-9). 이벤트 화면의 정산 한 줄은 '이번 달' 카드(plan/ThisMonthCard)에 있어요.
 * 쓴 돈 = 이번 달 오늘까지 쓴 이벤트통장 지출(청구 포함, 쓴 날 기준), 예정 = 남은 일정 · 할부 + 미리 기록한 이번 달 지출 (eventMonthUsage)
 */
export function SettlementCard({ className }: { home?: boolean; className?: string }) {
  const ledger = useLedger();
  const s = ledger.settlement;
  if (!s || !ledger.data) return null;
  return <HomeEventLine usage={eventMonthUsage(ledger.data, s, ledger.today)} className={className} />;
}

/**
 * 홈: 이번 달 이벤트통장 쓴 돈 — '이번 달 이벤트 쓴 돈 10만 (지금까지 8만 + 예정 2만) · 여행 320만'.
 * 여행(묶은 지출 + 남은 예산)은 합치지 않고 옆에 따로
 */
function HomeEventLine({ usage, className }: { usage: EventMonthUsage; className?: string }) {
  const total = usage.spent + usage.planned;
  const trip = usage.tripSpent + usage.tripPlanned;
  return (
    <Card as="section" aria-label="이번 달 정산" className={cx(styles.lineCard, className)}>
      <p className={styles.oneLine} data-testid="settlement-line">
        이번 달 이벤트 쓴 돈 <strong>{formatManShort(total)}</strong>
        {usage.planned > 0 ? (
          <span className={styles.oneLineSub}>
            {' '}
            (지금까지 {formatManShort(usage.spent)} + 예정 {formatManShort(usage.planned)})
          </span>
        ) : null}
        {trip > 0 ? (
          <span className={styles.oneLineSub} data-testid="settlement-trip">
            {' '}
            · 여행 {formatManShort(trip)}
            {usage.tripPlanned > 0 && usage.tripSpent > 0 ? ` (예정 ${formatManShort(usage.tripPlanned)} 포함)` : usage.tripSpent === 0 ? ' 예정' : ''}
          </span>
        ) : null}
      </p>
      <Button href={SETTLE_HREF} variant="outline" iconRight="chevron-right" className={styles.lineBtn}>
        정산하기
      </Button>
    </Card>
  );
}
