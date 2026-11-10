import type { ReactNode } from 'react';
import styles from './budget.module.css';

/**
 * 보기만 하는 칸 (작업정리 13: 지난 달 · 준비하지 않은 다음 달 · 다음 달 할부). 안의 단추 · 입력 칸은 모두 꺼지고,
 * 추가 · 고치기 단추는 숨겨요. 목록 줄은 그대로 읽혀요
 */
export function ReadOnly({ on, note, children }: { on: boolean; note?: string; children: ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <fieldset disabled className={styles.readOnly} data-testid="read-only">
      {note ? <p className={styles.readOnlyNote}>{note}</p> : null}
      {children}
    </fieldset>
  );
}
