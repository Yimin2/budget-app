'use client';

import { useMemo, useState } from 'react';
import { ledgerPeople, formatDateKo, hasLivingBudget } from '@/domain';
import { useLedger, useSession } from '@/state';
import { AvatarGroup, Banner, Button, PageHeader, useMediaQuery, WIDE_QUERY } from '@/ui';
import { ClaimsCard, LedgerSwitcher, SettlementCard } from '../_components';
import { HomeSkeleton, useLedgerFallback } from './LedgerGate';
import { shortageBannerText } from './selectors';
import styles from './home.module.css';
import { MeChooser, TodayCard } from './TodayCard';
import { LivingItemsCard, MonthSpentCard, LivingSetupCard } from './LivingItemsCard';
import { QuickSuggestions } from './QuickSuggestions';
import { EventAccountCard, RecentExpenses } from './HomeCards';

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
        <QuickSuggestions />
        {/* 모두 합친 화면(나를 고르기 전)에서는 항목이 사람마다 겹쳐 보여서 빼요 */}
        {living && living.items.length > 0 && (!multi || selected) ? <LivingItemsCard key={selected?.accountId ?? ''} living={living} owner={selected?.name ?? null} /> : null}
        {wide ? null : spentCard}
      </div>
      <div className={styles.col}>
        {banner ? (
          <Banner tone="warning" title={banner.title} action={{ label: '대처하기', href: '/plan#fix' }} className={styles.oBanner}>
            {banner.description}
          </Banner>
        ) : null}
        {/* 이번 달 정산 한 줄 (이번 달 이벤트통장 쓴 돈 + 예정, 줄 돈이 없으면 '… 이번 달 정산할 돈은 없어요 · 다음 정산 …', 청구가 없으면 숨김). 이벤트통장이 없을 때만 사람별 목록 */}
        {ledger.settlement ? <SettlementCard home className={styles.oClaims} /> : <ClaimsCard className={styles.oClaims} />}
        <EventAccountCard />
        {wide ? spentCard : null}
        <RecentExpenses />
      </div>
    </>
  );
}

/* ───────── 누가 나인지 ───────── */
