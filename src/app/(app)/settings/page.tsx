'use client';

import { useEffect } from 'react';
import { PageHeader } from '@/ui';
import { PageSkeleton } from '../_components/PageSkeleton';
import { RequireLedger } from '../_components/RequireLedger';
import { AccountsCard } from './sections/AccountsCard';
import { CategoriesCard } from './sections/CategoriesCard';
import { FavoritesCard } from './sections/FavoritesCard';
import { FixedCard } from './sections/FixedCard';
import { AccountCard, DisplayCard, InfoCard, LedgerNameCard, QuickLinks } from './sections/GeneralCards';
import { RulesCard } from './sections/RulesCard';

/** 설정: 가계부 · 통장 · 매달 배분 · 고정 지출 · 카테고리 · 자주 쓰는 지출 · 화면 · 정보 (모바일 '더보기') */
export default function SettingsPage() {
  return (
    <>
      <PageHeader title="설정" />
      <QuickLinks />
      <RequireLedger skeleton={<PageSkeleton withHeader={false} cards={4} label="설정을 불러오는 중이에요" />}>
        {(ledger) => (
          <div className="st-grid">
            <HashTarget />
            <div className="st-col">
              <LedgerNameCard key={`name-${ledger.ref.id}`} ledger={ledger} />
              <AccountsCard ledger={ledger} />
              <RulesCard ledger={ledger} />
              <FixedCard ledger={ledger} />
            </div>
            <div className="st-col">
              <CategoriesCard ledger={ledger} />
              <FavoritesCard ledger={ledger} />
              <DisplayCard />
              <AccountCard />
              <InfoCard ledger={ledger} />
            </div>
          </div>
        )}
      </RequireLedger>
    </>
  );
}

/** '/settings#st-fixed' 처럼 들어오면 그 카드로 스크롤하고 포커스를 옮겨요 (긴 설정 화면 맨 위에 떨어지지 않게) */
function HashTarget() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView?.({ block: 'start' });
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  }, []);
  return null;
}
