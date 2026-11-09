import { Skeleton } from '@/ui';
import './screens.css';

export interface PageSkeletonProps {
  /** 큰 카드 아래 작은 카드 개수 (기본 2) */
  cards?: number;
  /** 화면 읽기용 문구 */
  label?: string;
  /** 머리(제목 자리) 뼈대도 그릴지 (기본 true). 화면이 제목을 먼저 그리면 false */
  withHeader?: boolean;
}

/** 화면 뼈대: 머리 + 큰 카드 + 작은 카드 그리드. 데이터를 기다리는 동안 보여요 */
export function PageSkeleton({ cards = 2, label = '불러오는 중이에요', withHeader = true }: PageSkeletonProps) {
  return (
    <div className="sx-skel" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {withHeader ? (
        <div className="head">
          <Skeleton width={120} height={14} />
          <Skeleton width={200} height={28} />
        </div>
      ) : null}
      <Skeleton height={168} radius="lg" />
      {cards > 0 ? (
        <div className="grid-2">
          {Array.from({ length: cards }, (_, i) => (
            <Skeleton key={i} height={128} radius="lg" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 사이드바 가계부 전환 자리 뼈대 */
export function SwitcherSkeleton() {
  return (
    <div className="sx-side-skel" aria-hidden>
      <Skeleton width={48} height={12} />
      <Skeleton width={140} height={18} />
    </div>
  );
}
