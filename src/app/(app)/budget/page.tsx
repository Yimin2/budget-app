'use client';

import type { ReactNode } from 'react';
import { PageHeader } from '@/ui';
import { HashTarget } from '../_components/HashTarget';
import { PageSkeleton } from '../_components/PageSkeleton';
import { RequireLedger } from '../_components/RequireLedger';
import { AccountCards } from './AccountCards';
import { MoneyFlow } from './MoneyFlow';

/** 예산 화면의 묶음 (차례와 같은 순서) */
const BUDGET_SECTIONS = [
  {
    id: 'bd-flow',
    title: '월급날 돈 흐름',
    desc: '월급이 들어오는 날마다 월급통장에서 어느 통장으로 얼마가 가는지 보여요. 막대가 길고 굵을수록 큰 금액이에요.',
  },
  {
    id: 'bd-accounts',
    title: '통장별 들어오는 돈 · 나가는 돈',
    desc: '통장마다 배분으로 들어오는 돈과 고정비 · 할부 · 생활비 예산으로 나가는 돈이에요. 펼쳐서 그 자리에서 고쳐요.',
  },
] as const;

/**
 * '/budget' 예산 (작업정리 8-3): ① 월급날 돈 흐름(월급통장 → 각 통장 막대, [배분 고치기]로 수입 계획 · 매달 배분)
 * ② 통장별 카드(사람 탭, 들어오는 돈 ↔ 나가는 돈, 고정비 · 할부 · 생활비 예산은 펼쳐서 그 통장 안에서 고치기)
 */
export default function BudgetPage() {
  return (
    <>
      <PageHeader title="예산" subtitle="돈이 어디로 얼마나 가고 나가는지 한눈에 보고 여기서 고쳐요" />
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
              <MoneyFlow ledger={ledger} />
            </BudgetSection>
            <BudgetSection index={1}>
              <AccountCards ledger={ledger} />
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
