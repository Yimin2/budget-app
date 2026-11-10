'use client';

import { useId, useState, type ReactNode } from 'react';
import { Card, cx } from '@/ui';
import { ExpandButton } from '../_components/ExpandButton';
import styles from './FoldCard.module.css';

/**
 * 이벤트 화면 네 카드가 함께 쓰는 틀: 제목(h2) · 오른쪽 버튼 · 늘 보이는 요약 · 본문.
 * 폰(1024px 아래)에서는 본문이 접혀 있다가 [펼치기]로 같은 자리에서 펼쳐요. 넓은 화면은 본문이 늘 보이고 [펼치기]는 숨겨요
 * (CSS 로만 숨겨서 화면 읽기 프로그램도 보이는 것과 같은 것만 읽어요)
 */
export function useMobileFold(label: string) {
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  return {
    open,
    bodyId,
    /** 접히는 본문에 붙여요 */
    bodyClass: open ? undefined : styles.folded,
    toggle: (
      <div className={styles.toggle}>
        <ExpandButton open={open} onToggle={() => setOpen((o) => !o)} controls={bodyId} openLabel="펼치기" label={label} />
      </div>
    ),
  };
}

export interface FoldCardProps {
  /** 제목 (h2). 카드(section)의 이름이 돼요 */
  title: ReactNode;
  /** 폰의 [펼치기] 버튼 이름 앞말 (예: '이번 달' → '이번 달 펼치기') */
  foldLabel: string;
  /** 제목 옆 작은 표시 (예: '미리 보는 중') */
  badge?: ReactNode;
  /** 제목 줄 오른쪽 버튼 */
  actions?: ReactNode;
  /** 늘 보이는 요약 */
  summary?: ReactNode;
  /** 폰에서 접히는 본문 */
  children?: ReactNode;
  id?: string;
  className?: string;
  'data-testid'?: string;
}

export function FoldCard({ title, foldLabel, badge, actions, summary, children, id, className, ...rest }: FoldCardProps) {
  const titleId = useId();
  const fold = useMobileFold(foldLabel);
  return (
    <Card as="section" id={id} className={cx(styles.card, className)} aria-labelledby={titleId} data-testid={rest['data-testid']}>
      <FoldHead titleId={titleId} title={title} badge={badge} actions={actions} />
      {summary}
      {children ? (
        <>
          {fold.toggle}
          <div id={fold.bodyId} className={cx(styles.body, fold.bodyClass)}>
            {children}
          </div>
        </>
      ) : null}
    </Card>
  );
}

export function FoldHead({ titleId, title, badge, actions }: { titleId: string; title: ReactNode; badge?: ReactNode; actions?: ReactNode }) {
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

export const foldStyles = styles;
