'use client';

import { useId, useMemo, useState } from 'react';
import { findRecurringCandidates, recurringMessage } from '@/domain';
import type { Category, ISODate, LedgerData, RecurringCandidate } from '@/domain';
import { useLedger } from '@/state';
import { Button, Card, Icon, isIconName, useToast } from '@/ui';
import { dateLabel, errorText } from './selectors';
import styles from './events.module.css';

/** 카드에 보여 줄 제안 수 */
export const RECURRING_SHOWN = 5;

/**
 * '매년 돌아오는 일' (PLAN 4-3): 지난 지출에서 해마다 다시 나올 만한 일을 찾아 일정으로 넣자고 해요.
 * [넣기]는 같은 날(지났으면 내년) · 마지막 금액으로 예정 일정을 만들고, [괜찮아요]는 가계부 설정에 숨겨 다시 보이지 않아요.
 * 넣은 일정은 그달 같은 카테고리의 '평소 쓰는 돈'에서 빠져 두 번 세지 않아요
 */
export function RecurringCard({ data, today, categories }: { data: LedgerData; today: ISODate; categories: Category[] }) {
  const ledger = useLedger();
  const toast = useToast();
  const titleId = useId();
  const repeatId = useId();
  const [yearly, setYearly] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const list = useMemo(() => findRecurringCandidates(data, today).slice(0, RECURRING_SHOWN), [data, today]);
  if (list.length === 0) return null;

  async function add(c: RecurringCandidate) {
    if (busy) return;
    setBusy(c.key);
    try {
      const ev = await ledger.addEvent({
        date: c.suggestDate,
        name: c.name,
        amount: c.amount,
        categoryId: c.categoryId,
        repeat: yearly ? 'yearly' : 'none',
      });
      toast.success(`‘${c.name}’을 ${dateLabel(c.suggestDate, today, false)} 일정으로 넣었어요`, {
        action: {
          label: '되돌리기',
          onClick: () => {
            ledger.updateEvent({ ...ev, deleted: true }).catch((e: unknown) => toast.error(errorText(e, '되돌리지 못했어요')));
          },
        },
      });
    } catch (e) {
      toast.error(errorText(e, '일정을 넣지 못했어요'));
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(c: RecurringCandidate) {
    if (busy) return;
    setBusy(c.key);
    const before = data.settings.dismissedRecurring ?? [];
    try {
      await ledger.saveDismissedRecurring([...before, c.key]);
      toast.show(`‘${c.name}’ 제안은 다시 보이지 않아요`, {
        action: {
          label: '되돌리기',
          onClick: () => {
            ledger.saveDismissedRecurring(before).catch((e: unknown) => toast.error(errorText(e, '되돌리지 못했어요')));
          },
        },
      });
    } catch (e) {
      toast.error(errorText(e, '저장하지 못했어요'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card as="section" className={styles.recurring} aria-labelledby={titleId}>
      <div className={styles.insightHead}>
        <Icon name="calendar" size={20} />
        <div className={styles.txt}>
          <h2 id={titleId} className={styles.insightTitle}>
            매년 돌아오는 일
          </h2>
          <p className={styles.recurringSub}>지난 기록에서 해마다 나올 만한 지출을 찾았어요</p>
        </div>
      </div>
      <ul className={styles.recurringList}>
        {list.map((c) => {
          const cat = c.categoryId ? categories.find((x) => x.id === c.categoryId) : undefined;
          return (
            <li key={c.key} className={styles.recurringRow}>
              <span className={styles.recurringIcon} aria-hidden>
                <Icon name={cat && isIconName(cat.icon) ? cat.icon : 'calendar'} size={20} />
              </span>
              <div className={styles.recurringText}>
                <p>{recurringMessage(c, today)}</p>
                <span className={styles.recurringMeta}>
                  {dateLabel(c.suggestDate, today, false)}
                  {c.years > 1 ? ` · ${c.years}년 동안 있었어요` : ''}
                </span>
              </div>
              <div className={styles.recurringActions}>
                <Button
                  icon="plus"
                  loading={busy === c.key}
                  disabled={busy !== null && busy !== c.key}
                  onClick={() => void add(c)}
                  aria-label={`‘${c.name}’ 일정으로 넣기`}
                >
                  넣기
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => void dismiss(c)}
                  aria-label={`‘${c.name}’ 괜찮아요`}
                >
                  괜찮아요
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <label htmlFor={repeatId} className={styles.recurringRepeat}>
        <input id={repeatId} type="checkbox" checked={yearly} onChange={(e) => setYearly(e.target.checked)} />
        넣을 때 매년 반복으로
      </label>
      <p className={styles.foot}>넣은 일정은 그달 같은 카테고리의 ‘평소 쓰는 돈’에서 빠져 두 번 세지 않아요</p>
    </Card>
  );
}
