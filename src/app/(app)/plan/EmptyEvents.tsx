'use client';

import type { Category } from '@/domain';
import { Button, Card, Chip, ChipGroup, EmptyState, isIconName } from '@/ui';
import type { EventPreset } from './EventDialog';
import styles from './EmptyEvents.module.css';

/* ───────── 빈 상태 ───────── */

const EXAMPLES: { label: string; name: string; category: string; repeat?: EventPreset['repeat'] }[] = [
  { label: '결혼식', name: '결혼식', category: '경조사' },
  { label: '명절', name: '설날', category: '명절', repeat: 'yearly' },
  { label: '여행', name: '여름휴가', category: '여행' },
  { label: '생일 선물', name: '생일 선물', category: '선물', repeat: 'yearly' },
];

export function EmptyEvents({ categories, onAdd }: { categories: Category[]; onAdd: (preset?: EventPreset) => void }) {
  return (
    <Card as="section" aria-label="일정">
      <EmptyState
        icon="calendar"
        title="아직 넣은 일정이 없어요"
        description="결혼식, 명절, 여행처럼 고정비가 아닌 큰 지출을 미리 넣어 두세요. 모자라는 달이 생기면 미리 알려 드려요."
        action={
          <div className={styles.examples}>
            <Button icon="plus" onClick={() => onAdd()}>
              일정 추가
            </Button>
            <span className={styles.examplesLabel}>예시로 시작하기</span>
            <ChipGroup label="예시로 시작하기">
              {EXAMPLES.map((ex) => {
                const cat = categories.find((c) => c.name === ex.category) ?? null;
                return (
                  <Chip
                    key={ex.label}
                    icon={cat && isIconName(cat.icon) ? cat.icon : 'calendar'}
                    onClick={() => onAdd({ name: ex.name, categoryId: cat?.id ?? null, repeat: ex.repeat })}
                  >
                    {ex.label}
                  </Chip>
                );
              })}
            </ChipGroup>
          </div>
        }
      />
    </Card>
  );
}
