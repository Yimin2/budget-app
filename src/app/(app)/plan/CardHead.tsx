import type { ReactNode } from 'react';
import styles from './CardHead.module.css';

/**
 * 이벤트 화면 카드들이 함께 쓰는 제목 줄: 제목(h2) · 옆 작은 표시 · 오른쪽 버튼.
 * 카드 틀은 cardStyles.card (세로로 쌓고 간격 16px). 폰에서도 본문을 CSS 로 숨기지 않아요
 */
export function CardHead({ titleId, title, badge, actions }: { titleId: string; title: ReactNode; badge?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={styles.head}>
      <div className={styles.titleRow}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {badge}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}

export const cardStyles = styles;
