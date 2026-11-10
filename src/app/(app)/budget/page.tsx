'use client';

import type { ReactNode } from 'react';
import { PageHeader } from '@/ui';
import { HashTarget } from '../_components/HashTarget';
import { PageSkeleton } from '../_components/PageSkeleton';
import { RequireLedger } from '../_components/RequireLedger';
import { AllocationNeedsCard } from '../settings/sections/AllocationNeedsCard';
import { FixedCard } from '../settings/sections/FixedCard';
import { IncomePlansCard } from '../settings/sections/IncomePlansCard';
import { InstallmentCard } from '../settings/sections/InstallmentCard';
import { LivingCard } from '../settings/sections/LivingCard';
import { RulesCard } from '../settings/sections/RulesCard';

/** 예산 화면의 묶음 (차례와 같은 순서) */
const BUDGET_SECTIONS = [
  { id: 'bd-income', title: '월급과 배분', desc: '누가 언제 얼마를 받는지, 월급날 어느 통장으로 얼마씩 보낼지 정해요.' },
  { id: 'bd-living', title: '생활비 항목', desc: '사람마다 식비 · 카페처럼 항목별로 한 달에 쓸 돈을 정해요.' },
  { id: 'bd-fixed', title: '고정비 · 할부', desc: '월세 · 통신비 · 용돈처럼 매달 나가는 돈과 나눠 내는 할부예요.' },
] as const;

/**
 * '/budget' 예산: 돈을 나누는 설정을 한곳에, 순서대로 모았어요.
 * ① 월급과 배분(수입 계획 · 매달 배분 · 월급날 미리보기) ② 생활비 항목(사람마다) ③ 고정비 · 할부(사람마다)
 */
export default function BudgetPage() {
  return (
    <>
      <PageHeader title="예산" subtitle="돈을 어디에 얼마나 나눌지 여기서 모두 정해요" />
      <nav aria-label="예산 차례">
        <ol className="bd-index">
          {BUDGET_SECTIONS.map((s, i) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>
                <span className="num" aria-hidden>
                  {i + 1}
                </span>
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <RequireLedger skeleton={<PageSkeleton withHeader={false} cards={3} label="예산을 불러오는 중이에요" />}>
        {(ledger) => (
          <>
            <HashTarget />
            <BudgetSection index={0}>
              <div className="st-grid">
                <IncomePlansCard ledger={ledger} />
                <RulesCard ledger={ledger} />
              </div>
              <AllocationNeedsCard ledger={ledger} />
            </BudgetSection>
            <BudgetSection index={1}>
              <LivingCard ledger={ledger} />
            </BudgetSection>
            <BudgetSection index={2}>
              <div className="st-grid">
                <FixedCard ledger={ledger} />
                <InstallmentCard ledger={ledger} />
              </div>
            </BudgetSection>
          </>
        )}
      </RequireLedger>
    </>
  );
}

function BudgetSection({ index, children }: { index: number; children: ReactNode }) {
  const s = BUDGET_SECTIONS[index]!;
  return (
    <section id={s.id} className="bd-section" aria-labelledby={`${s.id}-h`} tabIndex={-1}>
      <div className="bd-head">
        <h2 id={`${s.id}-h`}>{s.title}</h2>
        <p>{s.desc}</p>
      </div>
      {children}
    </section>
  );
}
