'use client';

import { useMemo, useState } from 'react';
import { effectiveExclusions, findExceptionCandidates, projectWithExclusions } from '@/domain';
import type { ExclusionDraft } from '@/domain';
import { Button, Card, EmptyState } from '@/ui';
import { PageSkeleton, RequireLedger, type ReadyLedger } from '../../_components';
import { ExceptionPanel } from '../ExceptionPanel';
import styles from './usual.module.css';

/**
 * '/plan/usual' 한 번뿐이었던 큰 지출 빼기 (PLAN 4-2 예외 지출 빼기). 이벤트 화면 '평소 쓰는 돈' 카드의 링크로 와요.
 * 체크하면 평소 쓰는 돈 · 예측이 어떻게 바뀌는지 한 줄로 견주고, [저장]을 눌러야 지출의 '예외' 칸을 고쳐요
 */
export function UsualScreen() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Button href="/plan" variant="ghost" icon="chevron-left" className={styles.back}>
          이벤트
        </Button>
        <h1 className={styles.title}>한 번뿐이었던 큰 지출 빼기</h1>
        <p className={styles.lead}>결혼식 축의금처럼 다시 없을 큰 지출을 빼면, 평소 쓰는 돈 예상이 실제에 가까워져요. 잔액에는 그대로 들어가요.</p>
      </header>
      <RequireLedger skeleton={<PageSkeleton withHeader={false} label="큰 지출을 불러오는 중이에요" />}>{(ledger) => <UsualBody ledger={ledger} />}</RequireLedger>
    </div>
  );
}

function UsualBody({ ledger }: { ledger: ReadyLedger }) {
  const { data, today } = ledger;
  const projection = ledger.eventProjection;
  const candidates = useMemo(() => findExceptionCandidates(data, today), [data, today]);
  const [draft, setDraft] = useState<ExclusionDraft>({});
  const tried = useMemo(
    () => (effectiveExclusions(data, draft).length > 0 ? projectWithExclusions(data, today, draft) : null),
    [data, today, draft],
  );
  if (!projection?.accountId || candidates.length === 0) {
    return (
      <Card as="section" aria-label="큰 지출 빼기">
        <EmptyState icon="check-circle" title="뺄 만한 큰 지출이 없어요" description="평소보다 훨씬 큰 이벤트통장 지출이 생기면 여기에 보여요." />
      </Card>
    );
  }
  return (
    <Card as="section" aria-label="큰 지출 빼기" className={styles.card}>
      <ExceptionPanel data={data} today={today} candidates={candidates} before={projection} after={tried} draft={draft} onChange={setDraft} />
    </Card>
  );
}
