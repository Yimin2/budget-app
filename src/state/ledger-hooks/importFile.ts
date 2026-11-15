import { useCallback } from 'react';
import {
  planImport, applyImportPlan, IMPORT_TABLES,
} from '@/domain';
import type { ImportFile } from '@/domain/importFile';
import type { LedgerApi } from '../types';
import type { MemberActionsCtx } from './members';

/** 파일에서 가져오기 · 다시 읽기 */
export function useImportActions(ctx: MemberActionsCtx) {
  const {
    deps, author, today, todayRef, authorRef, data, nowIso, loadAll, requireData, mutate, syncAutoNow,
  } = ctx;
  /* ---------- 파일에서 가져오기 ---------- */

  const previewImport = useCallback<LedgerApi['previewImport']>(
    (file: ImportFile) => (data ? planImport(data, file, { today, author, now: deps.now().toISOString() }) : null),
    [data, today, author, deps],
  );

  const importFile = useCallback<LedgerApi['importFile']>(
    async (file: ImportFile) => {
      const { data: d } = requireData();
      // 미리보기 뒤에 바뀐 데이터가 있을 수 있어 지금 데이터로 다시 만든다 (이미 가져온 행은 건너뛴다)
      const plan = planImport(d, file, { today: todayRef.current, author: authorRef.current, now: nowIso() });
      if (plan.errors.length > 0) throw new Error(plan.errors[0]);
      if (plan.total === 0) return plan;
      await mutate(
        (x) => applyImportPlan(x, plan),
        async (repo) => {
          // 통장 · 카테고리 · 여행 · 일정 · 규칙 · 고정 지출 → 지출 → 이체 순서. 같은 키는 건너뛰어 끊긴 뒤 다시 해도 안전하다.
          // 돌려준 청구의 이체(claim:<지출id>)는 지출 뒤에 써서, 끊겨도 지출 없는 이체가 잔액을 옮기지 않게 한다
          for (const t of IMPORT_TABLES) {
            const rows = plan.rows[t];
            if (rows.length > 0) await repo.insert(t, rows as never);
          }
          for (const a of plan.accountUpdates) await repo.upsert('accounts', a);
        },
        '가져오지 못했어요. 다시 가져오면 빠진 것만 더해요',
        { multiStep: true },
      );
      await syncAutoNow();
      return plan;
    },
    [requireData, todayRef, authorRef, nowIso, mutate, syncAutoNow],
  );

  const reload = useCallback(() => loadAll(), [loadAll]);

  return {
    previewImport, importFile, reload,
  };
}

export type ImportActionsCtx = MemberActionsCtx & ReturnType<typeof useImportActions>;
