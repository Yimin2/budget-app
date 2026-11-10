import { Card, Skeleton } from '@/ui';
import shared from './events.module.css';
import styles from './EventsSkeleton.module.css';

/* ───────── 불러오는 중 ───────── */

const SKEL_BARS = [72, 64, 48, 88, 40, 20, 56, 80, 96, 104, 112, 120];

export function EventsSkeleton() {
  return (
    <div className={shared.page} role="status">
      <span className="sr-only">일정을 불러오는 중이에요</span>
      <Card variant="brand" className={styles.skelCard}>
        <Skeleton width={120} height={22} />
        <Skeleton width={200} height={44} radius="md" />
        <div className="grid-2">
          <Skeleton height={72} radius="md" />
          <Skeleton height={72} radius="md" />
        </div>
      </Card>
      <Card className={styles.skelCard}>
        <Skeleton width={180} height={22} />
        <div className={styles.skelBars}>
          {SKEL_BARS.map((h, i) => (
            <Skeleton key={i} height={h} radius="sm" />
          ))}
        </div>
      </Card>
      <Card className={styles.skelCard}>
        <Skeleton width={120} height={22} />
        <Skeleton height={56} />
        <Skeleton height={56} />
        <Skeleton height={56} />
      </Card>
    </div>
  );
}
