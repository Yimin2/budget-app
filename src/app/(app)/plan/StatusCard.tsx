'use client';

import { useId, useState } from 'react';
import { formatManShort, formatMonthKo, formatWon } from '@/domain';
import type { CompromisePlan, RepayMonths, ShortageFix, SpentBasisView } from '@/domain';
import { useLedger } from '@/state';
import { Button, Dialog, Icon, cx } from '@/ui';
import { CompromisePanel } from './CompromisePanel';
import { monthLabel, summarizeEventNames } from './selectors';
import styles from './eventsHome.module.css';

/** 홈 '대처하기' 링크가 여는 주소 조각 (이벤트 화면에 오면 대처 창을 바로 열어요) */
export const FIX_HASH = 'fix';

export interface StatusCardProps {
  view: SpentBasisView;
  today: string;
  compromise: CompromisePlan | null;
  repayMonths: RepayMonths;
  onRepayMonths: (m: RepayMonths) => void;
}

/**
 * 이벤트 화면 맨 위 상태 카드 (PLAN 4-2, 쓴 날 기준).
 * 모자라는 달이 있으면 '2027년 4월에 30만 모자라요' + 그달 일정 이름 + [대처하기](추천 타협안 창),
 * 없으면 '앞으로 12개월 동안 모자라지 않아요'. 아래 두 칸: 지금 쓸 수 있는 돈(통장 − 돌려줄 돈) · 다음 적립
 */
export function StatusCard({ view, today, compromise, repayMonths, onRepayMonths }: StatusCardProps) {
  const ledger = useLedger();
  const titleId = useId();
  // 홈의 [대처하기](/plan#fix)로 들어오면 바로 열어요 (화면은 가계부를 읽은 뒤에 그려져서 처음 값으로 충분해요)
  const [fixOpen, setFixOpen] = useState(() => typeof window !== 'undefined' && window.location.hash === `#${FIX_HASH}`);
  const first = view.shortages[0] ?? null;
  const fix = ledger.shortageFix;
  const canFix = Boolean(compromise || fix?.increaseMonthly || fix?.fromReservoir);
  const s = ledger.settlement;
  const ahead = view.months.filter((m) => m.kind !== 'past');

  const names = first?.projection ? summarizeEventNames(first.projection.events.map((e) => e.name)) : '';
  const more = view.shortages.length > 1 ? `모자라는 달 ${view.shortages.length}개 중 처음이에요` : '';
  const sub = [names, more].filter(Boolean).join(' · ');

  const next =
    s && s.incoming > 0 && s.incomingOn
      ? { value: `+${formatManShort(s.incoming)}`, note: `${Number(s.incomingOn.slice(5, 7))}월 ${Number(s.incomingOn.slice(8))}일` }
      : { value: `+${formatManShort(ahead[0]?.projection?.contributions || ahead[1]?.inflow || 0)}`, note: '매달 적립' };

  return (
    <section
      className={cx(styles.status, first ? styles.statusWarn : styles.statusOk)}
      aria-labelledby={titleId}
      data-testid="events-status"
    >
      <div className={styles.statusHead}>
        <Icon name={first ? 'alert-triangle' : 'check-circle'} size={22} />
        <div>
          <h2 id={titleId} className={styles.statusTitle}>
            {first
              ? `${monthLabel(first.month, today)}에 ${formatManShort(-first.end)} 모자라요`
              : `앞으로 ${ahead.length}개월 동안 모자라지 않아요`}
            {first ? <span className="sr-only"> ({formatWon(-first.end)})</span> : null}
          </h2>
          {first && sub ? <p className={styles.statusSub}>{sub}</p> : null}
        </div>
      </div>
      {first && canFix ? (
        <Button variant="primary" iconRight="chevron-right" className={styles.fixButton} onClick={() => setFixOpen(true)}>
          대처하기
        </Button>
      ) : null}
      <dl className={styles.facts}>
        <div data-testid="status-usable">
          <dt>지금 쓸 수 있는 돈</dt>
          <dd>
            <span className={styles.factValue}>{formatManShort(view.usable)}</span>
            <span className={styles.factNote}>
              {view.owedNow > 0 ? `통장 ${formatManShort(view.balance)} − 돌려줄 돈 ${formatManShort(view.owedNow)}` : '이벤트통장 잔액'}
            </span>
          </dd>
        </div>
        <div data-testid="status-next">
          <dt>다음 적립</dt>
          <dd>
            <span className={styles.factValue}>{next.value}</span>
            <span className={styles.factNote}>{next.note}</span>
          </dd>
        </div>
      </dl>
      {canFix ? (
        <Dialog open={fixOpen && first !== null} onClose={() => setFixOpen(false)} title="모자라는 달 대처하기" wide>
          {compromise ? (
            <CompromisePanel plan={compromise} months={repayMonths} onMonths={onRepayMonths} />
          ) : fix ? (
            <FixWays fix={fix} today={today} />
          ) : null}
        </Dialog>
      ) : null}
    </section>
  );
}

/**
 * 평소 쓰는 돈 기록이 없어 추천 타협안을 만들 수 없을 때: 두 가지 방법만 알려 줘요 (정보만, 바로 바꾸는 버튼 없음).
 * 적립액은 예산의 매달 배분에서, 옮기기는 이체 기록으로 직접 해요
 */
function FixWays({ fix, today }: { fix: ShortageFix; today: string }) {
  const year = Number(today.slice(0, 4));
  return (
    <ul className={styles.fixWays} data-testid="fix-ways">
      {fix.increaseMonthly ? (
        <li>
          지금부터 {formatMonthKo(fix.increaseMonthly.toMonth, year)}까지 매달 적립을 <strong>{formatManShort(fix.increaseMonthly.amount)}</strong> 늘리면
          괜찮아요. 예산 화면의 매달 배분에서 바꿔요.
        </li>
      ) : null}
      {fix.fromReservoir ? (
        <li>
          {formatMonthKo(fix.fromReservoir.month, year)}에 저수지에서 <strong>{formatManShort(fix.fromReservoir.amount)}</strong> 옮기면 괜찮아요.
        </li>
      ) : null}
    </ul>
  );
}
