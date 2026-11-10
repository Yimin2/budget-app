'use client';

import { useId, useMemo, useState } from 'react';
import { addDays, daysBetween, effectiveChanges, formatWon, whatIfDiff } from '@/domain';
import type { EventProjection, ISODate, LedgerData, WhatIfChange } from '@/domain';
import { useLedger } from '@/state';
import { Button, Card, DateInput, Icon, MoneyInput, cx, useToast } from '@/ui';
import { dateLabel, errorText, monthLabel, setWhatIfChange, whatIfTargets, type WhatIfTarget } from './selectors';
import styles from './events.module.css';

export interface WhatIfCardProps {
  data: LedgerData;
  today: ISODate;
  /** 지금 예측 (바꾸기 전) */
  before: EventProjection;
  /** 해 본 예측 (해 보기 중일 때) */
  after: EventProjection | null;
  /** 해 보기 중이면 변경 목록, 아니면 null */
  changes: WhatIfChange[] | null;
  onChange: (changes: WhatIfChange[] | null) => void;
}

/**
 * '해 보기' (PLAN 4-3): 예정 일정 · 여행을 잠깐 빼거나 금액 · 날짜를 바꿔 보면 위 예측이 바로 다시 그려져요.
 * 아무것도 저장하지 않다가 [이대로 바꾸기]를 누르면 그때 일정 · 여행을 고쳐요. [되돌리기]나 화면을 떠나면 그대로예요
 */
export function WhatIfCard({ data, today, before, after, changes, onChange }: WhatIfCardProps) {
  const ledger = useLedger();
  const toast = useToast();
  const titleId = useId();
  const ids = useId().replace(/:/g, '');
  const [busy, setBusy] = useState(false);
  const targets = useMemo(
    () => whatIfTargets(data, today, before.accountId, before.months.length || 12),
    [data, today, before.accountId, before.months.length],
  );
  const active = changes !== null;
  const effective = useMemo(() => (changes ? effectiveChanges(data, changes) : []), [data, changes]);
  const diff = useMemo(
    () => (changes && after ? whatIfDiff(data, today, changes, before, after) : null),
    [data, today, changes, before, after],
  );

  if (targets.length === 0 && !active) return null;

  const changeOf = (t: WhatIfTarget) => changes?.find((c) => c.kind === t.kind && c.id === t.id);
  const update = (t: WhatIfTarget, patch: Partial<WhatIfChange>) => {
    const cur = changeOf(t) ?? { kind: t.kind, id: t.id };
    onChange(setWhatIfChange(changes ?? [], { ...cur, ...patch }));
  };

  async function apply() {
    if (busy || effective.length === 0) return;
    setBusy(true);
    try {
      for (const c of effective) {
        if (c.kind === 'event') {
          const e = data.events.find((x) => x.id === c.id);
          if (!e) continue;
          if (c.exclude) await ledger.deleteEvent(c.id);
          else await ledger.updateEvent({ ...e, ...(c.amount !== undefined ? { amount: c.amount } : {}), ...(c.date ? { date: c.date } : {}) });
        } else {
          const t = data.trips.find((x) => x.id === c.id);
          if (!t) continue;
          if (c.exclude) await ledger.deleteTrip(c.id);
          else {
            const start = c.date ?? t.startDate;
            const end = addDays(start, Math.max(0, daysBetween(t.startDate, t.endDate)));
            await ledger.updateTrip(c.id, {
              name: t.name,
              startDate: start,
              endDate: end,
              budget: c.amount ?? t.budget,
              items: t.items,
              memo: t.memo,
            });
          }
        }
      }
      toast.success(`바꾼 ${effective.length}건을 저장했어요`);
      onChange(null);
    } catch (e) {
      toast.error(errorText(e, '바꾸지 못했어요. 잠시 뒤 다시 해 주세요'));
    } finally {
      setBusy(false);
    }
  }

  if (!active) {
    return (
      <Card as="section" className={styles.whatIf} aria-labelledby={titleId}>
        <div className={styles.insightHead}>
          <Icon name="refresh" size={20} />
          <div className={styles.txt}>
            <h2 id={titleId} className={styles.insightTitle}>
              해 보기
            </h2>
            <p className={styles.recurringSub}>일정을 빼거나 금액 · 날짜를 바꾸면 예측이 어떻게 달라지는지 바로 보여요. 저장하기 전까지는 그대로예요</p>
          </div>
        </div>
        <div className={styles.applyRow}>
          <Button variant="outline" icon="edit" onClick={() => onChange([])}>
            해 보기
          </Button>
        </div>
      </Card>
    );
  }

  const shortages = after?.shortages ?? [];
  return (
    <Card as="section" className={cx(styles.whatIf, styles.whatIfOn)} aria-labelledby={titleId}>
      <div className={styles.insightHead}>
        <Icon name="refresh" size={20} />
        <div className={styles.txt}>
          <h2 id={titleId} className={styles.insightTitle}>
            해 보기
          </h2>
          <p className={styles.whatIfMsg} aria-live="polite">
            {diff && diff.message ? diff.message : '빼 보거나 금액 · 날짜를 바꿔 보세요. 위 예측이 바로 바뀌어요'}
          </p>
          <p className={styles.recurringSub}>
            모자라는 달:{' '}
            {shortages.length === 0
              ? '없어요'
              : shortages.map((s) => `${monthLabel(s.month, today, '이번 달')} ${formatWon(s.amount)}`).join(' · ')}
          </p>
        </div>
      </div>

      <ul className={styles.whatIfList}>
        {targets.map((t) => {
          const c = changeOf(t);
          const excluded = Boolean(c?.exclude);
          const rowId = `${ids}-${t.kind}-${t.id}`;
          const changed = Boolean(c && (c.exclude || c.amount !== undefined || c.date !== undefined));
          return (
            <li key={`${t.kind}:${t.id}`} className={cx(styles.whatIfRow, excluded && styles.whatIfOut, changed && styles.whatIfChanged)}>
              <div className={styles.whatIfHead}>
                <span className={styles.whatIfName}>
                  {t.kind === 'trip' ? <span className={styles.whatIfTag}>여행</span> : null}
                  {t.name}
                  {t.repeat !== 'none' ? <span className={styles.whatIfTag}>{t.repeat === 'yearly' ? '매년' : '매월'}</span> : null}
                </span>
                <span className={styles.whatIfWas}>
                  {dateLabel(t.date, today, false)} · {formatWon(t.amount)}
                </span>
              </div>
              <div className={styles.whatIfControls}>
                <label htmlFor={`${rowId}-x`} className={styles.whatIfExclude}>
                  <input
                    id={`${rowId}-x`}
                    type="checkbox"
                    checked={excluded}
                    onChange={(e) => update(t, { exclude: e.target.checked || undefined })}
                  />
                  빼 보기
                </label>
                <MoneyInput
                  aria-label={`‘${t.name}’ ${t.kind === 'trip' ? '예산' : '금액'}`}
                  value={c?.amount ?? t.amount}
                  disabled={excluded}
                  onChange={(v) => update(t, { amount: v === null || v === t.amount ? undefined : v })}
                />
                <DateInput
                  aria-label={`‘${t.name}’ ${t.kind === 'trip' ? '떠나는 날' : '날짜'}`}
                  value={c?.date ?? t.date}
                  disabled={excluded}
                  onChange={(v) => update(t, { date: !v || v === t.date ? undefined : v })}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {targets.some((t) => t.repeat !== 'none') ? (
        <p className={styles.foot}>반복 일정은 바꾸면 앞으로의 회차가 모두 함께 바뀌어요</p>
      ) : null}

      <div className={styles.applyRow}>
        <Button icon="check" onClick={() => void apply()} loading={busy} disabled={effective.length === 0}>
          이대로 바꾸기
        </Button>
        <Button variant="outline" onClick={() => onChange(null)} disabled={busy}>
          되돌리기
        </Button>
        <p className={styles.applyNote}>
          {effective.length === 0 ? '아직 바꾼 것이 없어요' : `${effective.length}건을 바꿔 봤어요. 누르기 전에는 저장하지 않아요`}
        </p>
      </div>
    </Card>
  );
}
