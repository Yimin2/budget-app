'use client';

import { useState } from 'react';
import {
  addDays, allocationNeeds, formatShortDate, formatWon, monthOf, needBreakdownText, needLineText, uncoveredText, type AllocationNeed,
} from '@/domain';
import { Button, Card, ConfirmDialog } from '@/ui';
import type { ReadyLedger } from '../../_components/RequireLedger';
import { useRunner } from '../useRunner';

/**
 * 다음 배분에 필요한 금액 (PLAN 4-15): 생활비 · 용돈 통장마다 다음 배분 기간의 고정 결제 + 생활비 항목 예산과
 * 지금 정한 금액을 비교해요. [배분 금액 맞추기]는 누를 때만 다음 배분 달부터 규칙을 나눠 바꿔요
 */
export function AllocationNeedsCard({ ledger }: { ledger: ReadyLedger }) {
  const { busy, run } = useRunner();
  const [confirm, setConfirm] = useState<AllocationNeed | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const needs = allocationNeeds(ledger.data, ledger.today);
  if (needs.length === 0) return null;

  async function adjust(n: AllocationNeed) {
    if (!n.rule || n.adjustTo === null) return;
    const ok = await run(
      'adjust',
      () => ledger.changeRuleAmount(n.rule!.id, n.adjustTo!, monthOf(n.next)),
      `${formatShortDate(n.next)} 배분부터 ${formatWon(n.adjustTo)}으로 보낼게요`,
    );
    if (ok) setConfirm(null);
  }

  return (
    <Card id="st-needs" title="다음 배분에 필요한 금액">
      <p className="st-desc">다음 배분이 채우는 기간에 나갈 고정비 · 할부와 생활비 항목 예산을 더했어요.</p>
      <ul className="st-needs">
        {needs.map((n) => {
          const note = uncoveredText(n);
          const expanded = open === n.account.id;
          return (
            <li key={n.account.id}>
              <span className={n.diff !== 0 ? 'st-warn-text' : undefined}>{needLineText(n)}</span>
              <span className="st-hint-line">
                {formatShortDate(n.next)} 배분 · {formatShortDate(n.need.date)} ~ {formatShortDate(addDays(n.need.end, -1))} 결제 · {needBreakdownText(n.need)}
              </span>
              {note ? <span className="st-hint-line">{note}</span> : null}
              {expanded ? (
                <ul className="st-timeline" aria-label={`${n.account.name} 결제 내역`}>
                  {n.need.charges.map((c, i) => (
                    <li key={i}>
                      {formatShortDate(c.date)} {c.name} {formatWon(c.amount)}
                    </li>
                  ))}
                  {n.need.living > 0 ? <li>생활비 항목 예산 {formatWon(n.need.living)}</li> : null}
                  {n.need.charges.length === 0 && n.need.living === 0 ? <li>나갈 돈이 없어요</li> : null}
                </ul>
              ) : null}
              <div className="st-foot">
                <Button variant="ghost" onClick={() => setOpen(expanded ? null : n.account.id)} aria-expanded={expanded}>
                  {expanded ? '내역 접기' : '내역 보기'}
                </Button>
                {n.adjustTo !== null ? (
                  <Button variant="outline" onClick={() => setConfirm(n)} disabled={busy !== null}>
                    배분 금액 맞추기
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={confirm !== null}
        title="배분 금액을 맞출까요?"
        description={
          confirm && confirm.adjustTo !== null
            ? `${formatShortDate(confirm.next)} 배분부터 ${confirm.account.name}으로 ${formatWon(confirm.adjustTo)}을 보내요. 지난 이체는 그대로예요.`
            : ''
        }
        confirmLabel="맞추기"
        loading={busy === 'adjust'}
        onConfirm={() => confirm && void adjust(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </Card>
  );
}
