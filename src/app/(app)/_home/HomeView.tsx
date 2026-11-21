'use client';

import { useMemo, useState } from 'react';
import { ledgerPeople, eventMonthBudget, formatDateKo, hasLivingBudget } from '@/domain';
import { useLedger, useSession } from '@/state';
import { AvatarGroup, PageHeader } from '@/ui';
import { LedgerSwitcher } from '../_components';
import { HomeSkeleton, useLedgerFallback } from './LedgerGate';
import styles from './home.module.css';
import { MeChooser, TodayCard } from './TodayCard';
import { LivingItemsCard, LivingSetupCard } from './LivingItemsCard';
import { QuickSuggestions } from './QuickSuggestions';
import { SendCard } from './SendCard';

/**
 * 홈 '/' (2026-11 덜어내기): 오늘 보낼 돈 · 오늘 써도 되는 돈 · 자주 쓰는 지출 · 항목별 생활비(+ 이벤트 한 줄)만.
 * 사도 돼? 는 + 버튼, 정산 · 모자라는 달 · 일정은 이벤트 탭, 최근 지출은 내역 탭에서 봐요
 */
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
  // 사람별 생활비 (PLAN 4-14): 기본은 나, 다른 사람으로 바꿔 볼 수 있어요
  const [viewId, setViewId] = useState<string | null>(null);
  const views = ledger.livingViews;
  const multi = views.length > 1;
  // 내가 어느 생활비 통장과도 이어지지 않았으면(고르기 전) 모두 합친 화면이에요. 첫 사람을 '나'로 짐작하지 않아요
  const targetId = viewId ?? ledger.myLivingAccountId;
  const selected = multi && targetId ? (views.find((v) => v.accountId === targetId) ?? views[0]!) : null;
  const living = selected ? selected.status : ledger.living;
  const person = selected ? { view: selected, isMe: selected.accountId === ledger.myLivingAccountId } : null;
  // 항목별 생활비 맨 아래 '이벤트' 줄: 이번 달 이벤트통장 쓴 돈 / 적립액
  const event = useMemo(
    () => (ledger.data && ledger.settlement ? eventMonthBudget(ledger.data, ledger.settlement, ledger.today) : null),
    [ledger.data, ledger.settlement, ledger.today],
  );

  return (
    <div className={styles.col}>
      {/* 월급을 기록해 배분이 생기면 은행에서 보낼 일 (다 보내면 사라져요) */}
      <SendCard className={styles.oSend} />
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
      <QuickSuggestions />
      {/* 모두 합친 화면(나를 고르기 전)에서는 항목이 사람마다 겹쳐 보여서 빼요 */}
      {living && living.items.length > 0 && (!multi || selected) ? (
        <LivingItemsCard key={selected?.accountId ?? ''} living={living} owner={selected?.name ?? null} event={event} />
      ) : null}
    </div>
  );
}

/* ───────── 누가 나인지 ───────── */
