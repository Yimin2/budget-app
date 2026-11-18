import { Card, Skeleton } from '@/ui';
import grid from './EventsBody.module.css';
import styles from './EventsSkeleton.module.css';

/* ───────── 불러오는 중: 상태 · 정산 · 달 말 잔액 · 달별 일정 · 평소 쓰는 돈과 같은 배치 ───────── */

const SKEL_BARS = [56, 64, 52, 72, 96, 88, 76, 104, 20, 40, 64, 88, 104, 112, 120];

export function EventsSkeleton() {
  return (
    <div className={grid.grid} role="status">
      <span className="sr-only">일정을 불러오는 중이에요</span>
      <div className={grid.top}>
        <Skeleton height={176} radius="lg" />
        <Skeleton height={88} radius="lg" />
      </div>
      <Card className={styles.skelCard}>
        <Skeleton width={120} height={26} />
        <div className={styles.skelBars}>
          {SKEL_BARS.map((h, i) => (
            <Skeleton key={i} height={h} radius="sm" />
          ))}
        </div>
      </Card>
      <div className={grid.lower}>
        <Card className={styles.skelCard}>
          <Skeleton width={160} height={26} />
          <Skeleton height={56} />
          <Skeleton height={56} />
          <Skeleton height={56} />
        </Card>
        <Card className={styles.skelCard}>
          <Skeleton width={120} height={26} />
          <Skeleton height={22} />
          <Skeleton height={120} radius="md" />
        </Card>
      </div>
    </div>
  );
}
