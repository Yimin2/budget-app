'use client';

import { useState } from 'react';
import { eventMonthUsage, eventUsageNoteText, formatMan, formatManShort, formatMonthKo, formatShortDate, settlementSummary, shortfallText } from '@/domain';
import type { EventMonthUsage, Settlement, SettlementSummary } from '@/domain';
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
 * 머리말은 이번 달 이벤트통장 돈: '이번 달 이벤트통장 쓴 돈 12만 + 예정 38만 · 들어올 돈 50만'
 * (쓴 돈 = 이번 달 오늘까지 쓴 이벤트통장 지출(청구 포함, 쓴 날 기준), 예정 = 남은 일정 · 여행 · 할부 + 미리 기록한 이번 달 지출 — eventMonthUsage).
 * 옆(모바일은 둘째 줄)에 '11/21 정산 15만 · 못 준 돈 55만은 다음 달로 (민구)'. 이벤트통장이 줄 수 있는 돈보다 큰 '줄 돈'은 보이지 않아요.
 * 예정이 0이면 '+ 예정'은 빼요. 줄 돈이 없으면 '… · 이번 달 정산할 돈은 없어요 · 다음 정산 12/1 2.4만'.
 * 이벤트통장이 음수면 '이벤트통장이 ○원 모자라요'를 함께 보여요.
 * 항목 고르기 · 지급은 정산 화면(/plan/settle)에서 해요. 아직 안 돌려준 청구가 하나도 없으면 그리지 않아요.
 * compact: 지금 돌려줄 돈이 있을 때만. home: 홈은 이번 달 이벤트통장 쓴 돈(지금까지 + 예정)만 보여요
 */
export function SettlementCard({ compact = false, home = false, className }: { compact?: boolean; home?: boolean; className?: string }) {
  const ledger = useLedger();
  const s = ledger.settlement;
  if (!s || !ledger.data) return null;
  if (compact && !s.dueNow) return null;
  const id = compact || home ? undefined : 'settlement';
  const usage = eventMonthUsage(ledger.data, s, ledger.today);
  if (home) return <HomeEventLine usage={usage} className={className} />;
  return <SettlementLine s={s} usage={usage} baseYear={Number(ledger.today.slice(0, 4))} className={className} id={id} />;
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

function SettlementLine({ s, usage, baseYear, className, id }: { s: Settlement; usage: EventMonthUsage; baseYear: number; className?: string; id?: string }) {
  const sum = settlementSummary(s);
  if (!sum.hasClaims) return null;
  const next = sum.total > 0 ? null : nextText(sum, baseYear);
  const short = shortfallText(s);
  const note = [eventUsageNoteText(usage, sum), next].filter(Boolean).join(' · ');
  return (
    <Card as="section" id={id} aria-label="이번 달 정산" className={cx(styles.lineCard, className)}>
      <p className={styles.oneLine} data-testid="settlement-line">
        이번 달 이벤트통장 쓴 돈 <strong>{formatManShort(usage.spent + usage.tripSpent)}</strong>
        {usage.planned + usage.tripPlanned > 0 ? (
          <>
            {' '}
            + 예정 <strong>{formatManShort(usage.planned + usage.tripPlanned)}</strong>
          </>
        ) : null}
        {usage.incoming > 0 ? <span className={styles.oneLineSub}> · 들어올 돈 {formatManShort(usage.incoming)}</span> : null}
        {note ? (
          <span className={styles.oneLineSplit} data-testid="settlement-split">
            <span className={styles.oneLineSep}> · </span>
            {note}
          </span>
        ) : null}
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
