import { Card, Skeleton } from '@/ui';
import grid from './EventsBody.module.css';
import styles from './EventsSkeleton.module.css';

/* ───────── 불러오는 중: 카드 넷과 같은 배치 ───────── */

const SKEL_BARS = [72, 64, 48, 88, 40, 20, 56, 80, 96, 104, 112, 120];

export function EventsSkeleton() {
  return (
    <div className={grid.grid} role="status">
      <span className="sr-only">일정을 불러오는 중이에요</span>
      <Card className={`${styles.skelCard} ${grid.half}`}>
        <Skeleton width={120} height={26} />
        <div className={styles.skelTiles}>
          <Skeleton height={88} radius="md" />
          <Skeleton height={88} radius="md" />
          <Skeleton height={88} radius="md" />
        </div>
        <Skeleton height={26} />
      </Card>
      <Card className={`${styles.skelCard} ${grid.half}`}>
        <Skeleton width={120} height={26} />
        <div className={styles.skelDonut}>
          <Skeleton width={96} height={96} radius="full" />
          <Skeleton height={96} radius="md" />
        </div>
        <Skeleton height={12} radius="full" />
      </Card>
      <Card className={styles.skelCard}>
        <Skeleton width={180} height={26} />
        <div className={styles.skelBars}>
          {SKEL_BARS.map((h, i) => (
            <Skeleton key={i} height={h} radius="sm" />
          ))}
        </div>
      </Card>
      <Card className={styles.skelCard}>
        <Skeleton width={160} height={26} />
        <Skeleton height={56} />
        <Skeleton height={56} />
        <Skeleton height={56} />
      </Card>
    </div>
  );
}
