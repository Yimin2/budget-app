'use client';

import type { ReactNode } from 'react';
import { PageHeader } from '@/ui';
import { HashTarget } from '../_components/HashTarget';
import { PageSkeleton } from '../_components/PageSkeleton';
import { RequireLedger } from '../_components/RequireLedger';
import { AccountsCard } from './sections/AccountsCard';
import { CategoriesCard } from './sections/CategoriesCard';
import { ImportCard } from './sections/ImportCard';
import { AccountCard, DisplayCard, InfoCard, LedgerNameCard } from './sections/GeneralCards';
import { MembersCards } from './sections/MembersCard';

/**
 * 설정 (오른쪽 위 · 사이드바 아래 내 정보 버튼): 가계부 · 통장 · 멤버 · 공유 · 카테고리 · 파일에서 가져오기 ·
 * 테마 · 계정(가계부 바꾸기 · 로그아웃). 돈을 나누는 설정(수입 · 배분 · 생활비 · 고정비 · 할부)은 예산 화면에 있어요
 */
export default function SettingsPage() {
  return (
    <>
      <PageHeader title="설정" subtitle="통장 · 함께 쓰는 사람 · 기록 도우미 · 화면" />
      <RequireLedger skeleton={<PageSkeleton withHeader={false} cards={4} label="설정을 불러오는 중이에요" />}>
        {(ledger) => (
          <div className="st-grid">
            <HashTarget />
            <div className="st-col">
              <SettingsGroup id="sg-ledger" title="가계부와 통장">
                <LedgerNameCard key={`name-${ledger.ref.id}`} ledger={ledger} />
                <AccountsCard ledger={ledger} />
              </SettingsGroup>
              <SettingsGroup id="sg-members" title="멤버 · 공유">
                <MembersCards ledger={ledger} />
              </SettingsGroup>
            </div>
            <div className="st-col">
              <SettingsGroup id="sg-record" title="기록 도우미">
                <CategoriesCard ledger={ledger} />
                <ImportCard ledger={ledger} />
              </SettingsGroup>
              <SettingsGroup id="sg-app" title="화면과 계정">
                <DisplayCard />
                <AccountCard />
                <InfoCard ledger={ledger} />
              </SettingsGroup>
            </div>
          </div>
        )}
      </RequireLedger>
    </>
  );
}

/** 설정 묶음: 작은 제목 + 카드들 */
function SettingsGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="st-group" aria-labelledby={id}>
      <h2 id={id} className="st-group-head">
        {title}
      </h2>
      {children}
    </section>
  );
}
