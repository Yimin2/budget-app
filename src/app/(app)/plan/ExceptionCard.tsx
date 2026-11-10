'use client';

import { useId, useMemo, useState } from 'react';
import { effectiveExclusions, exclusionPreviewMessage, formatWon } from '@/domain';
import type { EventProjection, ExceptionCandidate, ExclusionDraft, ISODate, LedgerData } from '@/domain';
import { useLedger } from '@/state';
import { Button, Card, Icon, cx, useToast } from '@/ui';
import { ExpandButton } from '../_components/ExpandButton';
import { dateLabel, errorText, monthLabel } from './selectors';
import shared from './events.module.css';
import styles from './ExceptionCard.module.css';

export interface ExceptionCardProps {
  data: LedgerData;
  today: ISODate;
  candidates: ExceptionCandidate[];
  /** 지금 예측 (저장된 예외 표시 그대로) */
  before: EventProjection;
  /** 체크한 대로 뺀 예측 (바꾼 것이 있을 때만) */
  after: EventProjection | null;
  /** 체크 초안 (지출 id → 예외인지). 비어 있으면 저장된 그대로 */
  draft: ExclusionDraft;
  onChange: (draft: ExclusionDraft) => void;
}

function reasonText(c: ExceptionCandidate): string {
  if (c.reason === 'median' && c.ratio !== null) return `평소의 ${(Math.round(c.ratio * 10) / 10).toLocaleString('en-US')}배`;
  if (c.reason === 'p90') return '이 카테고리에서 큰 지출';
  return '예외로 표시함';
}

/**
 * '예외 지출 빼기' (PLAN 4-2): 지난 이벤트통장 지출 중 한 번뿐인 큰 지출을 체크하면 평소 쓰는 돈과 12개월 예측이 바로 다시 그려져요.
 * [저장]을 누르면 그때 지출의 '예외' 칸을 고쳐요. [되돌리기]나 화면을 떠나면 그대로예요.
 * 처음에는 접힌 요약 한 줄("예외 3건 · 후보 5건")과 [펼치기]만. 같은 자리에서 펼치고 [접기]로 접어요. 미리 보는 중에는 펼친 채로 있어요
 */
export function ExceptionCard({ data, today, candidates, before, after, draft, onChange }: ExceptionCardProps) {
  const ledger = useLedger();
  const toast = useToast();
  const titleId = useId();
  const ids = useId().replace(/:/g, '');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const changes = useMemo(() => effectiveExclusions(data, draft), [data, draft]);
  const message = after && changes.length > 0 ? exclusionPreviewMessage(before, after, today) : '';

  if (candidates.length === 0) return null;

  const checkedOf = (c: ExceptionCandidate) => draft[c.expense.id] ?? c.marked;
  const toggle = (c: ExceptionCandidate, on: boolean) => {
    const next: Record<string, boolean> = { ...draft };
    if (on === c.marked) delete next[c.expense.id];
    else next[c.expense.id] = on;
    onChange(next);
  };

  async function save() {
    if (busy || changes.length === 0) return;
    setBusy(true);
    try {
      const n = await ledger.setExpenseExclusions(changes);
      toast.success(n > 0 ? `예외 표시 ${n}건을 저장했어요` : '바꿀 것이 없었어요');
      onChange({});
    } catch (e) {
      toast.error(errorText(e, '저장하지 못했어요. 잠시 뒤 다시 해 주세요'));
    } finally {
      setBusy(false);
    }
  }

  const previewing = changes.length > 0;
  const open = expanded || previewing;
  const markedCount = candidates.filter((c) => checkedOf(c)).length;
  const shortages = (after ?? before).shortages;
  return (
    <Card as="section" className={cx(shared.exception, previewing && styles.exceptionOn)} aria-labelledby={titleId}>
      <div className={shared.insightHead}>
        <Icon name="sliders" size={20} />
        <div className={shared.txt}>
          <h2 id={titleId} className={shared.insightTitle}>
            예외 지출 빼기
          </h2>
          <p className={shared.recurringSub} data-testid="exception-summary">
            예외 {markedCount}건 · 후보 {candidates.length - markedCount}건
          </p>
        </div>
        <ExpandButton
          open={open}
          onToggle={() => setExpanded(!open)}
          controls={bodyId}
          openLabel="펼치기"
          label="예외 지출 빼기"
          disabled={previewing}
        />
      </div>

      {open ? (
        <div id={bodyId} className={styles.expandBody}>
          <p className={shared.recurringSub}>
            결혼식 축의금처럼 한 번뿐이었던 큰 지출을 빼면 ‘평소 쓰는 돈’과 예상 잔액을 다시 계산해요. 잔액에는 그대로 쓴 돈으로 들어가요
          </p>

          <ul className={shared.exceptionList}>
            {candidates.map((c) => {
              const checked = checkedOf(c);
              const id = `${ids}-${c.expense.id}`;
              const changed = draft[c.expense.id] !== undefined;
              return (
                <li key={c.expense.id} className={cx(shared.exceptionRow, checked && styles.exceptionChecked, changed && styles.exceptionChanged)}>
                  <input
                    id={id}
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    aria-label={`‘${c.name}’ 예외로 빼기`}
                    onChange={(e) => toggle(c, e.target.checked)}
                  />
                  <label htmlFor={id} className={styles.exceptionText}>
                    <span className={styles.exceptionName}>{c.name}</span>
                    <span className={styles.exceptionMeta}>
                      {dateLabel(c.expense.date, today, false)}
                      <span className={styles.exceptionTag}>{reasonText(c)}</span>
                      {c.marked && c.reason !== 'marked' ? <span className={styles.exceptionTag}>예외로 표시함</span> : null}
                    </span>
                  </label>
                  <span className={styles.exceptionAmount}>{formatWon(c.expense.amount)}</span>
                </li>
              );
            })}
          </ul>

          <div className={styles.exceptionPreview} aria-live="polite">
            {previewing ? (
              <>
                <p className={styles.exceptionMsg}>{message}</p>
                <p className={shared.recurringSub}>
                  모자라는 달:{' '}
                  {shortages.length === 0
                    ? '없어요'
                    : shortages.map((s) => `${monthLabel(s.month, today, '이번 달')} ${formatWon(s.amount)}`).join(' · ')}
                </p>
              </>
            ) : (
              <p className={shared.recurringSub}>체크하면 위 예측이 바로 바뀌어요. 저장하기 전까지는 그대로예요</p>
            )}
          </div>

          <div className={shared.applyRow}>
            <div className={styles.applyBtns}>
              <Button variant="outline" onClick={() => onChange({})} disabled={busy || !previewing}>
                되돌리기
              </Button>
              <Button icon="check" onClick={() => void save()} loading={busy} disabled={!previewing}>
                저장
              </Button>
            </div>
            <p className={shared.applyNote}>
              {previewing ? `${changes.length}건을 바꿔 봤어요. 누르기 전에는 저장하지 않아요` : '아직 바꾼 것이 없어요'}
            </p>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
