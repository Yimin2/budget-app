'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { formatDateKo, formatNumber, formatShortDate, formatWon, hasLivingBudget } from '@/domain';
import type { Account, Favorite, LivingItem, LivingStatus } from '@/domain';
import { useLedger, useSession } from '@/state';
import {
  AvatarGroup, Avatar, Badge, Banner, Button, Card, Chip, ChipGroup, Icon, ListRow, Money, PageHeader, ProgressBar,
  useToast, cx, ACCOUNT_ROLE_ICON, useMediaQuery, WIDE_QUERY, isIconName,
} from '@/ui';
import { LedgerSwitcher } from '../_components';
import { HomeSkeleton, useLedgerFallback } from './LedgerGate';
import { ProjectionChart } from './ProjectionChart';
import { errorMessage, expenseTitle, recentExpenses, shortageBannerText, upcomingEvents } from './selectors';
import styles from './home.module.css';

/** 홈 '/' — 오늘 써도 되는 돈 · 사도 돼? · 자주 쓰는 지출 · 생활비 항목 · 이벤트통장 · 최근 지출 */
export function HomeView() {
  const ledger = useLedger();
  const session = useSession();
  const fallback = useLedgerFallback(<HomeSkeleton />);
  const data = ledger.data;
  const name = data?.settings.name ?? session.activeLedger?.name ?? '가계부';

  return (
    <div className={styles.home}>
      <PageHeader
        className={styles.oHeader}
        eyebrow={formatDateKo(ledger.today)}
        titleAs="div"
        title={
          data ? (
            <>
              {/* 1280px 이상은 사이드바에 가계부 전환이 있어서 이름만 보여요 */}
              <LedgerSwitcher variant="title" className="hide-wide" />
              <span className="show-wide">{name}</span>
            </>
          ) : (
            name
          )
        }
        actions={
          data && data.members.length > 1 ? (
            <AvatarGroup
              people={data.members.map((m) => ({ name: m.displayName || m.email }))}
              label={`함께 쓰는 사람 ${data.members.length}명`}
            />
          ) : undefined
        }
      />
      {fallback ?? <HomeBody />}
    </div>
  );
}

function HomeBody() {
  const ledger = useLedger();
  const data = ledger.data!;
  const living = ledger.living;
  const banner = shortageBannerText(ledger.eventProjection, ledger.today);
  // 1280px 이상은 최근 지출이 왼쪽 칸, 그보다 좁으면 부족 알림 · 이벤트통장 뒤 (읽는 순서 = 보이는 순서)
  const wide = useMediaQuery(WIDE_QUERY);

  return (
    <>
      <div className={styles.col}>
        {living && hasLivingBudget(living) ? <TodayCard living={living} /> : <LivingSetupCard />}
        <Button href="/check" size="lg" block icon="cart" className={styles.oCta}>
          사도 돼? 확인하기
        </Button>
        <FavoriteChips favorites={data.favorites} />
        {living && living.items.length > 0 ? <LivingItemsCard living={living} /> : null}
        {wide ? <RecentExpenses /> : null}
      </div>
      <div className={styles.col}>
        {banner ? (
          <Banner tone="warning" title={banner.title} action={{ label: '대처하기', href: '/events' }} className={styles.oBanner}>
            {banner.description}
          </Banner>
        ) : null}
        <EventAccountCard />
        {wide ? null : <RecentExpenses />}
        <BalancesCard />
      </div>
    </>
  );
}

/** Card 제목을 영역 이름으로 이어 줘요 (화면 읽기 프로그램의 영역 목록) */
function useCardTitle(text: string) {
  const id = useId();
  return { title: <span id={id}>{text}</span>, 'aria-labelledby': id } as const;
}

/* ───────── 오늘 써도 되는 돈 ───────── */

function TodayCard({ living }: { living: LivingStatus }) {
  const titleId = useId();
  const daily = living.items.filter((i) => i.spread === 'daily');
  const hasDaily = daily.length > 0;
  const over = hasDaily && living.todayAvailable < 0;
  const ratio = living.monthBudget > 0 ? living.spent / living.monthBudget : 0;
  const tone = living.remaining < 0 ? 'danger' : ratio >= 0.8 ? 'warning' : 'primary';
  const dailyNames = daily.map((i) => i.name).join(' · ');

  return (
    <Card as="section" variant="brand" className={cx(styles.hero, styles.oHero)} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.heroLabel}>
        {hasDaily ? '오늘 써도 되는 돈' : '이번 달 남은 생활비'}
      </h2>
      <Money amount={Math.max(0, hasDaily ? living.todayAvailable : living.remaining)} hero as="p" style={{ margin: 0 }} />
      {hasDaily && living.items.length > 1 ? <p className={styles.heroNote}>{dailyNames} 합계</p> : null}
      {over ? (
        <p className={styles.over}>
          <Icon name="alert-triangle" size={20} />
          오늘 {formatWon(-living.todayAvailable)} 넘었어요
        </p>
      ) : null}
      <div className={styles.heroBar}>
        <ProgressBar
          value={living.spent}
          max={living.monthBudget}
          label="이번 달 생활비 사용"
          valueText={`${formatWon(living.monthBudget)} 중 ${formatWon(living.spent)} 썼어요`}
          tone={tone}
          track="brand"
        />
        <div className={styles.heroMeta}>
          {living.remaining >= 0 ? (
            <span>
              이번 달 남은 생활비 <strong>{formatWon(living.remaining)}</strong>
            </span>
          ) : (
            <span className={styles.bad}>
              이번 달 생활비를 <strong className={styles.bad}>{formatWon(-living.remaining)}</strong> 넘었어요
            </span>
          )}
          <span>{living.daysLeft}일 남음</span>
        </div>
        <div className={styles.heroMeta}>
          <span>
            {formatNumber(living.spent)} / {formatWon(living.monthBudget)} 썼어요
            {living.carryIn !== 0 ? ` · 지난달 이월 ${formatWon(living.carryIn)} 포함` : ''}
          </span>
        </div>
      </div>
    </Card>
  );
}

/* ───────── 생활비 항목 ───────── */

function itemTone(i: LivingItem): 'primary' | 'warning' | 'danger' {
  if (i.remaining < 0) return 'danger';
  if (i.monthBudget > 0 && i.spent / i.monthBudget >= 0.8) return 'warning';
  return 'primary';
}

function LivingItemsCard({ living }: { living: LivingStatus }) {
  const heading = useCardTitle('항목별 생활비');
  return (
    <Card
      as="section"
      {...heading}
      aside={
        <Button href="/settings#st-living" variant="ghost" iconRight="chevron-right" className={styles.asideLink}>
          예산 바꾸기
        </Button>
      }
      className={cx(styles.cardGap, styles.oItems)}
    >
      <ul className={styles.items}>
        {living.items.map((i) => (
          <li key={i.categoryId ?? ''} className={styles.item}>
            <div className={styles.itemHead}>
              <span className={styles.itemName}>
                <Icon name={isIconName(i.icon) ? i.icon : 'dots'} size={20} />
                <span className={styles.itemText}>{i.name}</span>
                {i.spread === 'daily' ? (
                  <Badge size="sm" tone="brand" dot={false}>
                    하루씩
                  </Badge>
                ) : null}
              </span>
              <span className={styles.itemLeft}>
                {i.remaining < 0 ? (
                  <span className={styles.bad}>{formatWon(-i.remaining)} 넘음</span>
                ) : (
                  <>
                    <span className={styles.itemCap}>남은 돈</span> <Money amount={i.remaining} className={styles.amountCell} />
                  </>
                )}
              </span>
            </div>
            <ProgressBar
              value={i.spent}
              max={i.monthBudget}
              label={`${i.name} 사용`}
              valueText={`${formatWon(i.monthBudget)} 중 ${formatWon(i.spent)} 썼어요`}
              tone={itemTone(i)}
              track="subtle"
            />
            <div className={styles.itemMeta}>
              <span>
                {formatNumber(i.spent)} / {formatWon(i.monthBudget)}
                {i.carryIn !== 0 ? ` · 이월 ${formatWon(i.carryIn)}` : ''}
              </span>
              {i.todayAvailable !== null ? (
                <span>
                  오늘 써도 되는 돈 <strong className={i.todayAvailable < 0 ? styles.bad : undefined}>{formatWon(i.todayAvailable)}</strong>
                </span>
              ) : (
                <span>{i.unbudgeted ? '예산 없음' : '한 달 한도'}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function LivingSetupCard() {
  const titleId = useId();
  return (
    <Card as="section" variant="brand" className={cx(styles.setup, styles.oHero)} aria-labelledby={titleId}>
      <span className={styles.setupIcon}>
        <Icon name="wallet" size={24} />
      </span>
      <h2 id={titleId} className={styles.setupTitle}>
        생활비 예산을 정해 주세요
      </h2>
      <p className={styles.setupText}>식비·카페처럼 항목마다 예산을 정하면 오늘 써도 되는 돈을 매일 계산해 드려요.</p>
      <Button href="/settings#st-living" icon="settings">
        생활비 정하기
      </Button>
    </Card>
  );
}

/* ───────── 자주 쓰는 지출 ───────── */

function FavoriteChips({ favorites }: { favorites: Favorite[] }) {
  const ledger = useLedger();
  const toast = useToast();
  const titleId = useId();
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const list = favorites.filter((f) => !f.deleted).sort((a, b) => a.order - b.order);

  async function undo(expenseId: string) {
    try {
      await ledger.deleteExpense(expenseId);
      toast.show('기록을 되돌렸어요');
    } catch (e) {
      toast.error(errorMessage(e, '되돌리지 못했어요'));
    }
  }

  async function record(fav: Favorite) {
    if (pending.has(fav.id)) return;
    setPending((s) => new Set(s).add(fav.id));
    try {
      const expense = await ledger.recordFavorite(fav.id);
      toast.success(`${fav.name} ${formatWon(fav.amount)} 기록했어요`, {
        action: { label: '되돌리기', onClick: () => void undo(expense.id) },
      });
    } catch (e) {
      toast.error(errorMessage(e, '지출을 기록하지 못했어요'));
    } finally {
      setPending((s) => {
        const next = new Set(s);
        next.delete(fav.id);
        return next;
      });
    }
  }

  return (
    <section className={cx(styles.section, styles.oFav)} aria-labelledby={titleId}>
      <h2 id={titleId} className="section-title">
        자주 쓰는 지출
      </h2>
      <ChipGroup>
        {list.map((fav) => {
          const busy = pending.has(fav.id);
          return (
            <Chip
              key={fav.id}
              onClick={() => void record(fav)}
              disabled={busy}
              aria-busy={busy || undefined}
              aria-label={`${fav.name} ${formatWon(fav.amount)} 바로 기록하기`}
            >
              {fav.name} {formatNumber(fav.amount)}
            </Chip>
          );
        })}
        <Link href="/settings#st-favorites" className={cx('chip', styles.chipLink)} aria-label="자주 쓰는 지출 추가">
          <Icon name="plus" size={16} strokeWidth={2.4} />
          {list.length === 0 ? '추가하기' : null}
        </Link>
      </ChipGroup>
      {list.length === 0 ? <p className={styles.hintText}>자주 사는 걸 등록해 두면 한 번 눌러 기록해요.</p> : null}
    </section>
  );
}

/* ───────── 이벤트통장 ───────── */

function EventAccountCard() {
  const ledger = useLedger();
  const projection = ledger.eventProjection;
  const events = upcomingEvents(projection, ledger.today, 3);
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
                subtitle={
                  e.overdue ? (
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
        <Button href="/events" variant="ghost" iconRight="chevron-right">
          {events.length > 0 ? '일정 모두 보기' : '일정 추가하기'}
        </Button>
      </div>
    </Card>
  );
}

/* ───────── 최근 지출 ───────── */

function RecentExpenses() {
  const ledger = useLedger();
  const data = ledger.data!;
  const rows = recentExpenses(data, 5);
  const accountById = new Map(data.accounts.map((a) => [a.id, a]));
  const categoryById = new Map(data.categories.map((c) => [c.id, c]));
  const heading = useCardTitle('최근 지출');
  const memberIndex = (email: string) => data.members.findIndex((m) => m.email.toLowerCase() === email.toLowerCase());

  return (
    <Card
      as="section"
      {...heading}
      aside={
        <Button href="/expenses" variant="ghost" iconRight="chevron-right" className={styles.asideLink}>
          모두 보기
        </Button>
      }
      className={cx(styles.cardGap, styles.oRecent, styles.half)}
    >
      {rows.length === 0 ? (
        <p className={styles.emptyLine}>아직 기록한 지출이 없어요. 사도 돼? 화면이나 자주 쓰는 지출로 기록해 보세요.</p>
      ) : (
        <ul className={cx('list', styles.listTop)}>
          {rows.map((e) => {
            const who = ledger.displayName(e.author);
            const account = accountById.get(e.accountId);
            const category = e.categoryId ? categoryById.get(e.categoryId) : undefined;
            const sub = [
              formatShortDate(e.date),
              category?.name,
              account && account.role !== 'fixed' && account.role !== 'allowance' ? account.name : undefined,
              e.fixedExpenseId ? '자동 기록' : undefined,
            ].filter(Boolean);
            return (
              <li key={e.id}>
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

/* ───────── 통장 잔액 (데스크톱) ───────── */

function BalancesCard() {
  const ledger = useLedger();
  const heading = useCardTitle('통장 잔액');
  const accounts: Account[] = ledger.activeAccounts;
  if (accounts.length === 0) return null;
  const total = accounts.reduce((s, a) => s + (ledger.balances[a.id] ?? 0), 0);

  return (
    <Card
      as="section"
      {...heading}
      aside={
        <span className={styles.totalAside}>
          <span className={styles.totalLabel}>합계</span>
          <Money amount={total} className={styles.balanceAside} />
        </span>
      }
      className={cx(styles.cardGap, styles.oBalances, 'show-wide')}
    >
      <ul className={cx('list', styles.listTop)}>
        {accounts.map((a) => (
          <li key={a.id}>
            <ListRow icon={ACCOUNT_ROLE_ICON[a.role]} title={a.name} trailing={<Money amount={ledger.balances[a.id] ?? 0} className={styles.amountCell} />} />
          </li>
        ))}
      </ul>
      <div className={styles.cardFoot}>
        <Button href="/accounts" variant="ghost" iconRight="chevron-right">
          통장 보기
        </Button>
      </div>
    </Card>
  );
}
