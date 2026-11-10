'use client';

import { useId, useState } from 'react';
import { formatWon } from '@/domain';
import type { EventProjection, ISODate, ShortageFix } from '@/domain';
import { useLedger } from '@/state';
import { Button, Card, Icon, cx, useToast } from '@/ui';
import {
  errorText,
  increaseChoiceText,
  monthLabel,
  nextContribution,
  reservoirChoiceText,
  shortageSummary,
  type FixChoiceText,
} from './selectors';
import shared from './events.module.css';
import styles from './ShortagePanel.module.css';

type Choice = 'increase' | 'reservoir';

export interface ShortagePanelProps {
  projection: EventProjection;
  fix: ShortageFix | null;
  today: ISODate;
}

/**
 * 부족 알림: "4월에 300,000원 모자라요 (결혼식 4건 · 어버이날)" + 두 가지 방법 중 하나를 골라 반영해요.
 * ① 지금부터 매달 적립액 늘리기 ② 그달에 저수지에서 옮기기. 반영하면 예측이 바로 다시 계산돼요.
 */
export function ShortagePanel({ projection, fix, today }: ShortagePanelProps) {
  const ledger = useLedger();
  const toast = useToast();
  const ids = useId().replace(/:/g, '');
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);

  const summary = shortageSummary(projection, today);
  if (!summary) return null;

  const increase = fix?.increaseMonthly ?? null;
  const reservoir = fix?.fromReservoir ?? null;
  const contribution = nextContribution(projection) ?? projection.monthlyContribution;
  const incText = increase ? increaseChoiceText(increase, today, contribution) : null;
  const resText = reservoir ? reservoirChoiceText(reservoir, today) : null;

  const options: { key: Choice; num: string; text: FixChoiceText }[] = [];
  if (incText) options.push({ key: 'increase', num: '1', text: incText });
  if (resText) options.push({ key: 'reservoir', num: '2', text: resText });
  const usable = options.filter((o) => !o.text.blocked);
  // 고를 수 있는 방법이 하나뿐이면 미리 골라 둬요
  const effective: Choice | null =
    choice && usable.some((o) => o.key === choice) ? choice : usable.length === 1 ? usable[0]!.key : null;

  const titleId = `${ids}-title`;
  const month = projection.months.find((m) => m.month === summary.month);
  const desc = [
    month && month.events.length > 0 ? `그달 일정 ${month.events.length}건 · ${formatWon(month.planned)} 예정` : '',
    month && month.usual > 0 ? `평소 쓰는 돈 ${formatWon(month.usual)}` : '',
    summary.others > 0 ? `그 뒤로 ${summary.others}개월 더 모자라요` : '',
    (projection.range?.highShortages.length ?? 0) > projection.shortages.length
      ? `많이 쓰면 ${projection.range!.highShortages.length}개월 모자라요`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');

  async function apply() {
    if (!effective || busy) return;
    setBusy(true);
    try {
      if (effective === 'increase' && increase) {
        await ledger.applyIncreaseMonthly(increase);
        toast.success(`매달 적립액을 ${formatWon(increase.amount)} 늘렸어요`);
      } else if (effective === 'reservoir' && reservoir) {
        await ledger.applyFromReservoir(reservoir);
        toast.success(
          `${monthLabel(reservoir.month, today, '이번 달')}에 저수지에서 ${formatWon(reservoir.amount)} 옮기도록 넣어 뒀어요`,
        );
      }
      setChoice(null);
    } catch (e) {
      toast.error(errorText(e, '반영하지 못했어요. 잠시 뒤 다시 해 주세요'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="section" className={styles.panel} aria-labelledby={titleId}>
      <div className={shared.panelHead}>
        <span className={styles.panelIcon} aria-hidden>
          <Icon name="alert-triangle" size={20} />
        </span>
        <div className={shared.txt}>
          <h2 id={titleId} className={styles.panelTitle}>
            <span className="sr-only">이벤트통장 부족 알림: </span>
            {summary.title}
            {summary.names ? ` (${summary.names})` : ''}
          </h2>
          {desc ? <p className={styles.panelDesc}>{desc}</p> : null}
        </div>
      </div>

      {options.length > 0 ? (
        <>
          <fieldset className={styles.choices} disabled={busy}>
            <legend className={styles.choicesLegend}>어떻게 채울까요?</legend>
            <div className={styles.choiceList}>
              {options.map((o) => {
                const on = effective === o.key;
                const disabled = Boolean(o.text.blocked);
                const id = `${ids}-${o.key}`;
                return (
                  <label
                    key={o.key}
                    htmlFor={id}
                    className={cx(styles.choice, on && styles.on, disabled && styles.disabled)}
                  >
                    <input
                      id={id}
                      type="radio"
                      name={`${ids}-fix`}
                      value={o.key}
                      className={styles.radio}
                      checked={on}
                      disabled={disabled}
                      onChange={() => setChoice(o.key)}
                      aria-describedby={`${id}-desc`}
                    />
                    <span className={styles.choiceText}>
                      <span className={styles.choiceTitle}>
                        <span className="sr-only">{o.num}번, </span>
                        {o.text.title}
                      </span>
                      <span id={`${id}-desc`} className={styles.choiceDesc}>
                        {o.text.description}
                        {o.text.note ? (
                          <>
                            <br />
                            <span className={styles.choiceNote}>{o.text.note}</span>
                          </>
                        ) : null}
                      </span>
                      {o.text.blocked ? (
                        <span className={styles.choiceBlocked}>
                          <Icon name="alert-circle" size={16} />
                          {o.text.blocked}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className={shared.applyRow}>
            <Button onClick={apply} loading={busy} disabled={!effective} icon="check">
              이 방법으로 반영하기
            </Button>
            <p className={shared.applyNote}>
              {effective === 'increase'
                ? '매달 배분 규칙의 이벤트통장 적립액을 바꿔요'
                : effective === 'reservoir'
                  ? '저수지 → 이벤트통장 예정 이체를 만들어 예측에 넣어요'
                  : usable.length === 0
                    ? '지금은 고를 수 있는 방법이 없어요. 예산에서 매달 배분을 고쳐 주세요'
                    : '방법을 하나 고르면 반영할 수 있어요'}
            </p>
          </div>
        </>
      ) : (
        <div className={shared.applyRow}>
          <Button href="/budget#st-rules" variant="outline" icon="sliders">
            매달 배분 고치기
          </Button>
          <p className={shared.applyNote}>
            {summary.isThisMonth
              ? '이번 달 부족은 적립으로 채울 수 없어요. 저수지통장이 있으면 옮겨 채울 수 있어요'
              : '적립액을 늘리거나 저수지통장을 만들면 채울 수 있어요'}
          </p>
        </div>
      )}
    </Card>
  );
}
