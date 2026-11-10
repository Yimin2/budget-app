'use client';

import Link from 'next/link';
import { useId, useMemo, useState } from 'react';
import {
  ledgerPeople, formatDateKo, formatMan, formatNumber, formatShortDate, formatWon, hasLivingBudget, isAutoFixedRecord, livingDayNote, scheduleLabel,
  withSubject,
} from '@/domain';
import type { Favorite, LivingItem, LivingStatus, LivingView } from '@/domain';
import { useLedger, useSession } from '@/state';
import {
  AvatarGroup, Avatar, Badge, Banner, Button, Card, Chip, ChipGroup, Icon, ListRow, Money, PageHeader, ProgressBar,
  SegmentedControl, useToast, cx, useMediaQuery, WIDE_QUERY, isIconName, usePresence, presenceClass,
} from '@/ui';
import { ClaimsCard, LedgerSwitcher, SettlementCard } from '../_components';
import { HomeSkeleton, useLedgerFallback } from './LedgerGate';
import { ProjectionChart } from './ProjectionChart';
import { hasMonthSpent, monthSpent } from './monthSpent';
import { errorMessage, expenseTitle, recentExpenses, shortageBannerText, upcomingEvents } from './selectors';
import styles from './home.module.css';

/** 홈 '/' — 오늘 써도 되는 돈 · 사도 돼? · 자주 쓰는 지출 · 생활비 항목 · 돌려받을 돈 · 부족 알림 · 이벤트통장 · 최근 지출 (통장 잔액은 내역) */
export function HomeView() {
  const ledger = useLedger();
  const session = useSession();
  const fallback = useLedgerFallback(<HomeSkeleton />);
  const data = ledger.data;
  const name = data?.settings.name ?? session.activeLedger?.name ?? '가계부';
  // 함께 쓰는 사람 = 지금 공유돼 있는 멤버 (공유 목록에서 저절로 맞춰져요)
  const people = useMemo(() => (data ? ledgerPeople(data) : []), [data]);

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
          people.length > 1 ? (
            <AvatarGroup people={people.map((p) => ({ name: p.name }))} label={`함께 쓰는 사람 ${people.length}명`} />
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
  const banner = shortageBannerText(ledger.eventProjection, ledger.today);
  // 1280px 이상(두 칸)은 이번 달 쓴 돈 · 최근 지출이 오른쪽 칸 이벤트통장 아래(두 칸 길이를 맞춰요).
  // 그보다 좁으면(한 줄 · 태블릿) 이번 달 쓴 돈은 항목별 생활비 바로 아래, 최근 지출은 이벤트통장 뒤. 읽는 순서 = 보이는 순서
  const wide = useMediaQuery(WIDE_QUERY);
  // 사람별 생활비 (PLAN 4-14): 기본은 나, 다른 사람으로 바꿔 볼 수 있어요
  const [viewId, setViewId] = useState<string | null>(null);
  const views = ledger.livingViews;
  const multi = views.length > 1;
  // 내가 어느 생활비 통장과도 이어지지 않았으면(고르기 전) 모두 합친 화면이에요. 첫 사람을 '나'로 짐작하지 않아요
  const targetId = viewId ?? ledger.myLivingAccountId;
  const selected = multi && targetId ? (views.find((v) => v.accountId === targetId) ?? views[0]!) : null;
  const living = selected ? selected.status : ledger.living;
  const person = selected ? { view: selected, isMe: selected.accountId === ledger.myLivingAccountId } : null;
  const spentCard = (
    <MonthSpentCard
      statuses={selected ? [selected.status] : multi ? views.map((v) => v.status) : ledger.living ? [ledger.living] : []}
      livingAccountId={selected?.accountId ?? null}
      owner={selected?.name ?? null}
    />
  );

  return (
    <>
      <div className={styles.col}>
        {ledger.meChoices.length > 0 ? <MeChooser names={ledger.meChoices} /> : null}
        {living && hasLivingBudget(living) ? (
          <TodayCard
            living={living}
            person={person}
            views={multi ? views : []}
            myAccountId={ledger.myLivingAccountId}
            household={multi ? ledger.living : null}
            onPick={setViewId}
          />
        ) : (
          <LivingSetupCard />
        )}
        <Button href="/check" size="lg" block icon="cart" className={styles.oCta}>
          사도 돼? 확인하기
        </Button>
        <FavoriteChips favorites={data.favorites} />
        {/* 모두 합친 화면(나를 고르기 전)에서는 항목이 사람마다 겹쳐 보여서 빼요 */}
        {living && living.items.length > 0 && (!multi || selected) ? <LivingItemsCard living={living} owner={selected?.name ?? null} /> : null}
        {wide ? null : spentCard}
      </div>
      <div className={styles.col}>
        {banner ? (
          <Banner tone="warning" title={banner.title} action={{ label: '대처하기', href: '/plan' }} className={styles.oBanner}>
            {banner.description}
          </Banner>
        ) : null}
        {/* 이번 달 정산 한 줄 (줄 돈이 없으면 '이번 달 줄 돈이 없어요 · 다음 정산 …', 청구가 없으면 숨김). 이벤트통장이 없을 때만 사람별 목록 */}
        {ledger.settlement ? <SettlementCard home className={styles.oClaims} /> : <ClaimsCard className={styles.oClaims} />}
        <EventAccountCard />
        {wide ? spentCard : null}
        <RecentExpenses />
      </div>
    </>
  );
}

/* ───────── 누가 나인지 ───────── */

/**
 * 로그인한 계정이 어느 생활비 통장과도 이어지지 않았을 때: 통장 주인 이름 칩으로 나를 골라요.
 * 고르면 그 이름의 통장(주인 이메일이 빈 것)을 모두 내 이메일과 이어 시트에 써 둬요 (다음부터 묻지 않아요)
 */
function MeChooser({ names }: { names: string[] }) {
  const ledger = useLedger();
  const toast = useToast();
  const titleId = useId();
  const [busy, setBusy] = useState<string | null>(null);

  async function choose(name: string) {
    if (busy) return;
    setBusy(name);
    try {
      await ledger.claimOwner(name);
      toast.success(`${name} 님으로 이었어요`);
    } catch (e) {
      toast.error(errorMessage(e, '나를 정하지 못했어요'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={cx(styles.section, styles.meChooser)} aria-labelledby={titleId}>
      <h2 id={titleId} className="section-title">
        누가 나인지 골라 주세요
      </h2>
      <p className={styles.meHint}>고른 사람의 통장이 이 계정과 이어져요. 그전까지는 모두 합친 생활비를 보여 줘요</p>
      <ChipGroup label="나는 누구인가요">
        {names.map((n) => (
          <Chip key={n} disabled={busy !== null} aria-busy={busy === n || undefined} onClick={() => void choose(n)}>
            {n}
          </Chip>
        ))}
      </ChipGroup>
    </section>
  );
}

/** Card 제목을 영역 이름으로 이어 줘요 (화면 읽기 프로그램의 영역 목록) */
function useCardTitle(text: string) {
  const id = useId();
  return { title: <span id={id}>{text}</span>, 'aria-labelledby': id } as const;
}

/* ───────── 오늘 써도 되는 돈 ───────── */

/** 한 사람(생활비 통장)의 큰 숫자: 하루 항목이 있으면 오늘 써도 되는 돈, 없으면 이번 달 남은 생활비 */
function headline(living: LivingStatus): number {
  return living.items.some((i) => i.spread === 'daily') ? living.todayAvailable : living.remaining;
}

/** 하루에 나눠 쓰는 항목에 오늘 쓴 돈 합 (한 달 한도 항목은 빼요) */
function dailySpentToday(living: LivingStatus): number {
  return living.items.reduce((sum, i) => (i.spread === 'daily' ? sum + i.spentToday : sum), 0);
}

/**
 * 하루 예산 한 줄: 오늘 쓴 돈이 있으면 '오늘 쓴 돈 ○원 · 써도 되는 돈 ○원', 없으면 '오늘 써도 되는 돈 ○원'.
 * 써도 되는 돈을 넘었으면 '오늘 ○원 넘었어요'(경고 색)
 */
function DailyLine({ spent, available }: { spent: number; available: number }) {
  const over = available < 0;
  const left = over ? (
    <strong className={styles.warn}>오늘 {formatWon(-available)} 넘었어요</strong>
  ) : spent > 0 ? (
    <>
      써도 되는 돈 <strong>{formatWon(available)}</strong>
    </>
  ) : (
    <>
      오늘 써도 되는 돈 <strong>{formatWon(available)}</strong>
    </>
  );
  return (
    <span className={styles.dailyLine}>
      {spent > 0 ? (
        <>
          <span>
            오늘 쓴 돈 <strong>{formatWon(spent)}</strong>
          </span>
          <span aria-hidden="true">·</span>
        </>
      ) : null}
      <span>{left}</span>
    </span>
  );
}

function TodayCard({
  living,
  person = null,
  views = [],
  myAccountId = null,
  household = null,
  onPick,
}: {
  living: LivingStatus;
  /** 사람별 생활비일 때 지금 보는 사람 */
  person?: { view: LivingView; isMe: boolean } | null;
  views?: LivingView[];
  myAccountId?: string | null;
  /** 사람별 생활비일 때 모두 합친 생활비 */
  household?: LivingStatus | null;
  onPick?: (accountId: string) => void;
}) {
  const titleId = useId();
  const daily = living.items.filter((i) => i.spread === 'daily');
  const hasDaily = daily.length > 0;
  const over = hasDaily && living.todayAvailable < 0;
  const spentToday = dailySpentToday(living);
  const ratio = living.monthBudget > 0 ? living.spent / living.monthBudget : 0;
  const tone = living.remaining < 0 ? 'danger' : ratio >= 0.8 ? 'warning' : 'primary';
  const dailyNames = daily.map((i) => i.name).join(' · ');
  const who = person ? (person.isMe ? '내가' : withSubject(person.view.name)) : null;
  const title = hasDaily
    ? who
      ? `오늘 ${who} 써도 되는 돈`
      : '오늘 써도 되는 돈'
    : person
      ? `${person.isMe ? '내' : `${person.view.name}의`} 이번 달 남은 생활비`
      : '이번 달 남은 생활비';
  const others = person ? views.filter((v) => v.accountId !== person.view.accountId) : [];

  return (
    <Card as="section" variant="brand" className={cx(styles.hero, styles.oHero)} aria-labelledby={titleId}>
      {person && views.length > 1 && onPick ? (
        <SegmentedControl<string>
          ariaLabel="누구 생활비를 볼까요"
          block
          value={person.view.accountId}
          onChange={onPick}
          options={views.map((v) => ({ value: v.accountId, label: v.accountId === myAccountId ? `${v.name} (나)` : v.name }))}
        />
      ) : null}
      <h2 id={titleId} className={styles.heroLabel}>
        {title}
      </h2>
      <Money amount={Math.max(0, hasDaily ? living.todayAvailable : living.remaining)} hero animate as="p" style={{ margin: 0 }} />
      {hasDaily && living.items.length > 1 ? <p className={styles.heroNote}>{dailyNames} 합계</p> : null}
      {hasDaily && spentToday > 0 ? (
        // 큰 숫자가 '오늘 써도 되는 돈'(오늘 쓴 돈을 뺀 값)이라 오늘 쓴 돈만 더해요. 안 썼으면 '0원' 줄은 없어요
        <p className={styles.heroToday}>
          오늘 쓴 돈 <strong>{formatWon(spentToday)}</strong>
        </p>
      ) : null}
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
      {person && household ? (
        <ul className={styles.heroOthers} aria-label="다른 사람과 합계">
          {others.map((v) => (
            <li key={v.accountId}>
              <span>{v.name}</span>
              <OtherAmount living={v.status} />
            </li>
          ))}
          <li>
            <span>{views.length === 2 ? '둘이 합쳐' : '모두 합쳐'}</span>
            <OtherAmount living={household} />
          </li>
        </ul>
      ) : null}
    </Card>
  );
}

/** 다른 사람 · 합계 한 줄의 금액: 하루 항목에 오늘 쓴 돈이 있거나 넘었으면 하루 예산 한 줄, 아니면 큰 숫자와 같은 금액 */
function OtherAmount({ living }: { living: LivingStatus }) {
  const daily = living.items.some((i) => i.spread === 'daily');
  const spent = daily ? dailySpentToday(living) : 0;
  if (daily && (spent > 0 || living.todayAvailable < 0)) return <DailyLine spent={spent} available={living.todayAvailable} />;
  return <strong>{formatWon(Math.max(0, headline(living)))}</strong>;
}

/* ───────── 생활비 항목 ───────── */

function itemTone(i: LivingItem): 'primary' | 'warning' | 'danger' {
  if (i.remaining < 0) return 'danger';
  if (i.monthBudget > 0 && i.spent / i.monthBudget >= 0.8) return 'warning';
  return 'primary';
}

function LivingItemsCard({ living, owner = null }: { living: LivingStatus; owner?: string | null }) {
  const { today } = useLedger();
  const heading = useCardTitle(owner ? `항목별 생활비 · ${owner}` : '항목별 생활비');
  return (
    <Card
      as="section"
      {...heading}
      aside={
        <Button href="/budget#st-living" variant="ghost" iconRight="chevron-right" className={styles.asideLink}>
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
                {i.spread === 'daily' || i.noDaysLeft ? (
                  <Badge size="sm" tone="brand" dot={false}>
                    {(i.schedule && scheduleLabel(i.schedule)) || '하루씩'}
                  </Badge>
                ) : null}
              </span>
              <span className={styles.itemLeft}>
                {i.remaining < 0 ? (
                  <span className={styles.bad}>{formatWon(-i.remaining)} 넘음</span>
                ) : (
                  <>
                    <span className={styles.itemCap}>남은 돈</span> <Money amount={i.remaining} animate className={styles.amountCell} />
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
              {livingDayNote(i, today) && !(i.weekly?.usedToday) ? (
                <span>{livingDayNote(i, today)}</span>
              ) : i.todayAvailable !== null ? (
                <DailyLine spent={i.spentToday} available={i.todayAvailable} />
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

/* ───────── 이번 달 쓴 돈 (기타 · 용돈 · 이벤트통장) ───────── */

/** 보이는 사람(사람 선택을 따라가요, 선택이 없으면 모두 합쳐)의 기타(예산 없음) · 용돈과 이벤트통장. 보일 줄이 없으면 카드도 없어요 */
function MonthSpentCard({
  statuses,
  livingAccountId,
  owner,
}: {
  statuses: LivingStatus[];
  livingAccountId: string | null;
  owner: string | null;
}) {
  const ledger = useLedger();
  const heading = useCardTitle(owner ? `이번 달 쓴 돈 · ${owner}` : '이번 달 쓴 돈');
  const summary = monthSpent(ledger.data!, ledger.today, {
    statuses,
    livingAccountId,
    balances: ledger.balances,
    eventProjection: ledger.eventProjection,
  });
  if (!hasMonthSpent(summary)) return null;
  const { etc, allowance, event } = summary;
  return (
    <Card as="section" {...heading} className={cx(styles.cardGap, styles.oSpent)}>
      <ul className={cx('list', styles.listTop)}>
        {etc ? (
          <li>
            <ListRow
              icon="dots"
              href={etc.href}
              title="기타 (예산 없음)"
              subtitle={`${formatWon(etc.amount)} · ${etc.count}건`}
            />
          </li>
        ) : null}
        {allowance ? (
          <li>
            <ListRow
              icon="wallet"
              href={allowance.href}
              title="용돈"
              subtitle={`${formatMan(allowance.spent)} 썼어요 · 남은 돈 ${formatMan(allowance.balance)}`}
            />
          </li>
        ) : null}
        {event ? (
          <li>
            <ListRow
              icon="calendar"
              href={event.href}
              title="이벤트통장"
              subtitle={`${formatMan(event.spent)} 썼어요 · 적립 ${formatMan(event.contribution)} · 잔액 ${formatMan(event.balance)}`}
            />
          </li>
        ) : null}
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
      <Button href="/budget#st-living" icon="settings">
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

function RecentExpenses() {
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
        <p className={styles.emptyLine}>아직 기록한 지출이 없어요. 사도 돼? 화면이나 자주 쓰는 지출로 기록해 보세요.</p>
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
