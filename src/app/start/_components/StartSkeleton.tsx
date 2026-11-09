import { Skeleton } from '@/ui';

/** 시작 화면 뼈대 (세션을 읽는 동안) */
export function StartSkeleton() {
  return (
    <div className="stack gap-6" role="status" aria-live="polite">
      <span className="sr-only">불러오는 중이에요</span>
      <div className="stack gap-3">
        <Skeleton width="70%" height={32} />
        <Skeleton width="90%" height={18} />
      </div>
      <Skeleton height={160} radius="lg" />
      <div className="stack gap-3">
        <Skeleton height={52} radius="md" />
        <Skeleton height={52} radius="md" />
      </div>
    </div>
  );
}
