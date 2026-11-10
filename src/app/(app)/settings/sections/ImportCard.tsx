'use client';

import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { formatDateKo, formatWon, MAX_IMPORT_BYTES, parseImportFile, type ImportFile, type ImportPlan } from '@/domain';
import { Banner, Button, Card, Dialog, Money, useToast } from '@/ui';
import type { ReadyLedger } from '../../_components/RequireLedger';
import { useRunner } from '../useRunner';

/** 파일 내용 읽기 (File.text 가 없는 브라우저는 FileReader) */
function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(new Error('파일을 읽지 못했어요'));
    r.readAsText(file);
  });
}

/**
 * 파일에서 가져오기 (PLAN 4-12): 가져오기용 JSON 파일을 골라 미리보기(표마다 개수 · 금액, 합칠 통장 · 카테고리,
 * 돌려받을 돈)를 보고 [가져오기]를 눌러야 저장해요. 같은 파일을 다시 가져와도 두 번 생기지 않아요
 */
export function ImportCard({ ledger }: { ledger: ReadyLedger }) {
  const toast = useToast();
  const { busy, run } = useRunner();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [errors, setErrors] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<ImportFile | null>(null);
  const preview = ledger.previewImport;
  const plan: ImportPlan | null = useMemo(() => (picked ? preview(picked) : null), [picked, preview]);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFileName(file.name);
    setPicked(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setErrors(['파일이 너무 커요. 5MB 까지 가져올 수 있어요']);
      return;
    }
    let text: string;
    try {
      text = await readText(file);
    } catch {
      setErrors(['파일을 읽지 못했어요. 다시 골라 주세요']);
      return;
    }
    const parsed = parseImportFile(text);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors(null);
    setPicked(parsed.file);
  }

  async function doImport() {
    if (!picked) return;
    const file = picked;
    let written = 0;
    const ok = await run('import', async () => {
      written = (await ledger.importFile(file)).total;
    });
    if (!ok) return;
    setPicked(null);
    toast.success(written > 0 ? `${written}개를 가져왔어요` : '이미 모두 가져온 파일이에요');
  }

  const blocked = !plan || plan.errors.length > 0 || plan.total === 0;

  return (
    <Card id="st-import" title="파일에서 가져오기">
      <p className="st-desc">
        다른 곳에서 옮긴 가져오기 파일(JSON)을 더해요. 무엇이 더해지는지 먼저 보여 드리고, 가져오기를 눌러야 저장해요. 같은 파일을 다시
        가져와도 두 번 생기지 않아요.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        tabIndex={-1}
        aria-label="가져올 파일"
        onChange={(e) => void onPick(e)}
      />
      {errors ? (
        <Banner tone="danger" title="이 파일은 가져올 수 없어요">
          <ul className="st-import-list">
            {errors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Banner>
      ) : null}
      <div className="st-foot">
        <Button variant="outline" icon="upload" onClick={() => inputRef.current?.click()}>
          파일 고르기
        </Button>
      </div>

      <Dialog
        open={plan !== null}
        onClose={() => (busy ? undefined : setPicked(null))}
        title="가져오기 미리보기"
        description={plan?.name || fileName || undefined}
        wide
        actions={
          <>
            <Button variant="outline" onClick={() => setPicked(null)} disabled={busy !== null}>
              취소
            </Button>
            <Button onClick={() => void doImport()} loading={busy === 'import'} disabled={blocked}>
              가져오기
            </Button>
          </>
        }
      >
        {plan ? <ImportPreview plan={plan} /> : null}
      </Dialog>
    </Card>
  );
}

function countText(l: { added: number; merged: number; existing: number }): string {
  const parts = [`새로 ${l.added}개`];
  if (l.merged > 0) parts.push(`합침 ${l.merged}개`);
  if (l.existing > 0) parts.push(`이미 있음 ${l.existing}개`);
  return parts.join(' · ');
}

/** 미리보기 본문: 표마다 개수 · 금액, 지출 통장별, 돌려받을 돈, 합칠 것, 알림 */
export function ImportPreview({ plan }: { plan: ImportPlan }) {
  return (
    <div className="stack" data-testid="import-preview">
      {plan.errors.length > 0 ? (
        <Banner tone="danger" title="고쳐야 가져올 수 있어요">
          <ul className="st-import-list">
            {plan.errors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Banner>
      ) : plan.total === 0 ? (
        <Banner tone="info" title="이미 모두 가져온 파일이에요">더할 것이 없어요.</Banner>
      ) : null}

      <table className="st-import-table">
        <caption className="sr-only">표마다 더할 개수와 금액</caption>
        <thead>
          <tr>
            <th scope="col">항목</th>
            <th scope="col">개수</th>
            <th scope="col">금액</th>
          </tr>
        </thead>
        <tbody>
          {plan.summary.map((l) => (
            <tr key={l.key}>
              <th scope="row">{l.label}</th>
              <td>{countText(l)}</td>
              <td>
                {l.amount !== null && l.added > 0 ? (
                  <>
                    <span className="st-import-unit">{l.amountLabel}</span> <Money amount={l.amount} />
                  </>
                ) : (
                  '–'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {plan.expensesByAccount.length > 0 ? (
        <section>
          <h3 className="st-group-title">지출이 나간 통장</h3>
          <ul className="st-import-list">
            {plan.expensesByAccount.map((a) => (
              <li key={a.name}>
                {a.name} {a.count}건 · {formatWon(a.amount)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {plan.claims.pending.length > 0 || plan.claims.settledCount > 0 ? (
        <section>
          <h3 className="st-group-title">청구</h3>
          <ul className="st-import-list">
            {plan.claims.pending.length > 0 ? (
              <li>
                돌려받을 돈 {formatWon(plan.claims.pendingTotal)} (
                {plan.claims.pending.map((p) => `${p.payer} ${formatWon(p.amount)}`).join(' · ')})
                {plan.claims.nextDue ? ` · 정산일 ${formatDateKo(plan.claims.nextDue, false)}` : ''}
              </li>
            ) : null}
            {plan.claims.reservoirLoanPending.length > 0 ? (
              <li>
                그중 저수지에서 빌려 줄 돈 (이벤트 지출){' '}
                {plan.claims.reservoirLoanPending.map((p) => `${p.payer} ${p.count}건 ${formatWon(p.amount)}`).join(' · ')}
                {' '}· 지급하면 저수지에 갚을 돈이 돼요
              </li>
            ) : null}
            {plan.claims.reservoirPending.length > 0 ? (
              <li>
                그중 저수지에 쓸 돈{' '}
                {plan.claims.reservoirPending.map((p) => `${p.payer} ${p.count}건 ${formatWon(p.amount)}`).join(' · ')}
              </li>
            ) : null}
            {plan.claims.reservoirLoanSettled.count > 0 ? (
              <li>
                저수지에서 돌려준 이벤트 지출 {plan.claims.reservoirLoanSettled.count}건 ·{' '}
                {formatWon(plan.claims.reservoirLoanSettled.amount)} · 가져온 뒤 정산 카드에서 저수지에 갚을 돈으로 바꿀 수 있어요
              </li>
            ) : null}
            {plan.claims.settledCount > 0 ? (
              <li>
                돌려준 청구 {plan.claims.settledCount}건 · {formatWon(plan.claims.settledAmount)}
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {plan.merges.length > 0 ? (
        <section>
          <h3 className="st-group-title">이름이 같아 합쳐요</h3>
          <ul className="st-import-list">
            {plan.merges.map((m) => (
              <li key={`${m.table}:${m.name}`}>
                {m.table === 'accounts' ? '통장' : '카테고리'} {m.name}: {m.note}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {plan.warnings.length > 0 ? (
        <Banner tone="warning" title="알아 두세요">
          <ul className="st-import-list">
            {plan.warnings.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Banner>
      ) : null}

      {plan.notes.length > 0 ? (
        <section>
          <h3 className="st-group-title">카테고리 설명 (저장하지 않아요)</h3>
          <ul className="st-import-list">
            {plan.notes.map((n) => (
              <li key={n.name}>
                {n.name}: {n.note}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
