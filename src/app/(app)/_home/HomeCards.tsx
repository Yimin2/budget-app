'use client';

import { formatShortDate, formatWon, isAutoFixedRecord } from '@/domain';
import { useLedger } from '@/state';
import { Avatar, Button, Card, Icon, ListRow, Money, cx, usePresence, presenceClass } from '@/ui';
import { ProjectionChart } from './ProjectionChart';
import { expenseTitle, recentExpenses, upcomingEvents } from './selectors';
import styles from './home.module.css';
import { useCardTitle } from './useCardTitle';

export function EventAccountCard() {
  const ledger = useLedger();
  const projection = ledger.eventProjection;
  const events = upcomingEvents(projection, ledger.today, 3, ledger.trips);
  const heading = useCardTitle('이벤트통장');

  if (!projection || projection.accountId === null) {
    return (
      <Card as="section" {...heading} className={cx(styles.cardGap, styles.oEvent, styles.half)}>
        <p className={styles.hintText}>이벤트통장을 만들면 경조사·여행 같은 큰돈을 미리 챙겨 드려요.</p>
        <div className={styles.cardFoot}>
          <Button href="/settings#st-accounts" variant="ghost" iconRight="chevron-right">
            통장 만들기
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card
      as="section"
      {...heading}
      aside={<Money amount={projection.currentBalance} className={styles.balanceAside} />}
      className={cx(styles.cardGap, styles.oEvent, styles.half)}
    >
      {projection.monthlyContribution > 0 ? (
        <p className={styles.hintText}>매달 {formatWon(projection.monthlyContribution)}씩 모아요</p>
      ) : null}
      <div className="show-wide">
        <ProjectionChart months={projection.months} title="앞으로 12개월 예상 잔액" today={ledger.today} height={72} />
      </div>
      {events.length > 0 ? (
        <ul className={cx('list', styles.listTop)} aria-label="다가오는 일정">
          {events.map((e) => (
            <li key={`${e.id}@${e.date}`}>
              <ListRow
                leadText={formatShortDate(e.date)}
                title={e.name}
                href={e.tripId ? `/plan/trips?id=${encodeURIComponent(e.tripId)}` : undefined}
                subtitle={
                  e.tripId ? (
                    '여행 · 남은 예산'
                  ) : e.overdue ? (
                    <span className={styles.overdue}>
                      <Icon name="alert-triangle" size={16} />
                      날짜가 지났어요
                    </span>
                  ) : undefined
                }
                trailing={<Money amount={e.amount} className={styles.amountCell} />}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.emptyLine}>다가오는 일정이 없어요.</p>
      )}
      <div className={styles.cardFoot}>
        <Button href="/plan" variant="ghost" iconRight="chevron-right">
          {events.length > 0 ? '일정 모두 보기' : '일정 추가하기'}
        </Button>
      </div>
    </Card>
  );
}

/* ───────── 최근 지출 ───────── */

export function RecentExpenses() {
  const ledger = useLedger();
  const data = ledger.data!;
  const rows = recentExpenses(data, 5);
  const accountById = new Map(data.accounts.map((a) => [a.id, a]));
  const categoryById = new Map(data.categories.map((c) => [c.id, c]));
  const heading = useCardTitle('최근 지출');
  const memberIndex = (email: string) => data.members.findIndex((m) => m.email.toLowerCase() === email.toLowerCase());
  // 새 기록은 옆에서 들어오고, 밀려나거나 지운 기록은 접히며 빠져요
  const presence = usePresence(rows, (e) => e.id);

  return (
    <Card
      as="section"
      {...heading}
      aside={
        <Button href="/history" variant="ghost" iconRight="chevron-right" className={styles.asideLink}>
          모두 보기
        </Button>
      }
      className={cx(styles.cardGap, styles.oRecent, styles.half)}
    >
      {rows.length === 0 ? (
        <p className={styles.emptyLine}>아직 기록한 지출이 없어요. 사도 돼? 화면에서 기록해 보세요.</p>
      ) : (
        <ul className={cx('list', styles.listTop)}>
          {presence.map(({ item: e, key, state }) => {
            const who = ledger.displayName(e.author);
            const account = accountById.get(e.accountId);
            const category = e.categoryId ? categoryById.get(e.categoryId) : undefined;
            const sub = [
              formatShortDate(e.date),
              category?.name,
              account && account.role !== 'fixed' && account.role !== 'allowance' ? account.name : undefined,
              isAutoFixedRecord(e) ? '자동 기록' : undefined,
            ].filter(Boolean);
            return (
              <li key={key} className={presenceClass(state)} inert={state === 'leave' || undefined}>
                <ListRow
                  leading={<Avatar name={who} size="sm" alt={memberIndex(e.author) !== 0} />}
                  title={expenseTitle(e, data.categories)}
                  subtitle={sub.join(' · ')}
                  trailing={<Money amount={e.amount} className={styles.amountCell} />}
                />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
