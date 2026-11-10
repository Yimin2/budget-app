/* 여행 화면에서 쓰는 순수 함수. 화면과 떼어 테스트해요. */
import { formatMan, formatMonthKo, formatWon, TRIP_ITEMS, tripSpendState } from '@/domain';
import type { Expense, ISODate, TripItem, TripItemLine, TripLeftoverPool, TripSpendState, TripStatus, Won } from '@/domain';

/** '/plan/trips?id=…' 여행 하나 주소 */
export function tripHref(id: string): string {
  return `/plan/trips?id=${encodeURIComponent(id)}`;
}

/** "45일 뒤 떠나요" · "내일 떠나요" · "여행 중이에요" · "다녀왔어요" */
export function tripPhaseText(s: Pick<TripStatus, 'phase' | 'daysUntil'>): string {
  if (s.phase === 'ongoing') return '여행 중이에요';
  if (s.phase === 'past') return '다녀왔어요';
  return s.daysUntil === 1 ? '내일 떠나요' : `${s.daysUntil ?? 0}일 뒤 떠나요`;
}

/** 쓴 정도 → 색 이름: 넘으면 danger, 90% 이상 쓰면 warning */
export function stateTone(state: TripSpendState): 'primary' | 'warning' | 'danger' {
  return state === 'over' ? 'danger' : state === 'near' ? 'warning' : 'primary';
}

/** 막대 색: 넘으면 danger, 90% 이상 쓰면 warning */
export function spendTone(spent: Won, budget: Won | null): 'primary' | 'warning' | 'danger' {
  return stateTone(tripSpendState(spent, budget));
}

/**
 * 항목 한 줄 문구
 * - status: 오른쪽 위 상태 ("3만 남음" · "다 썼어요" · "3만 넘었어요" · "나머지 18만 남음" · "예산 밖 4만 씀")
 * - detail: 막대 아래 숫자 ("28만 / 30만" · "나머지 예산 30만 중 12만 씀")
 */
export function itemLineText(line: TripItemLine, pool: TripLeftoverPool | null): { status: string; detail: string } {
  if (line.basis === 'own' && line.budget !== null) {
    const left = line.budget - line.spent;
    return {
      status: left < 0 ? `${formatMan(-left)} 넘었어요` : left === 0 ? '다 썼어요' : `${formatMan(left)} 남음`,
      detail: `${formatMan(line.spent)} / ${formatMan(line.budget)}`,
    };
  }
  if (line.basis === 'pool' && pool) {
    const shared = pool.spent !== line.spent ? ` · 함께 ${formatMan(pool.spent)}` : '';
    return {
      status:
        pool.remaining < 0
          ? `나머지 ${formatMan(-pool.remaining)} 넘었어요`
          : pool.remaining === 0
            ? '나머지 다 썼어요'
            : `나머지 ${formatMan(pool.remaining)} 남음`,
      detail: `나머지 예산 ${formatMan(pool.budget)} 중 ${formatMan(line.spent)} 씀${shared}`,
    };
  }
  return line.spent > 0
    ? { status: `예산 밖 ${formatMan(line.spent)} 씀`, detail: `${formatMan(line.spent)} 씀` }
    : { status: '', detail: '' };
}

/** 낸 돈 목록: 최근 날짜 먼저, 같은 날이면 나중에 기록한 것 먼저 */
export function newestFirst<T extends Pick<Expense, 'date' | 'createdAt'>>(expenses: readonly T[]): T[] {
  return [...expenses].sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1,
  );
}

/** "남은 예산 450,000원" · "120,000원 넘었어요" */
export function remainingText(remaining: Won): string {
  return remaining >= 0 ? `남은 예산 ${formatWon(remaining)}` : `${formatWon(-remaining)} 넘었어요`;
}

/** 남은 예산이 이벤트통장 예측에 어떻게 들어갔는지 한 줄 (넣을 것이 없으면 null) */
export function projectionNote(s: TripStatus, today: ISODate): string | null {
  const baseYear = Number(today.slice(0, 4));
  if (s.projected.length > 0) {
    const months = s.projected.map((p) => formatMonthKo(p.month, baseYear)).join(' · ');
    const total = s.projected.reduce((sum, p) => sum + p.amount, 0);
    return `아직 안 쓴 ${formatWon(total)}은 ${months} 이벤트통장 예측에 넣었어요`;
  }
  if (s.phase === 'past' && s.remaining > 0) return '다녀온 여행이라 남은 예산은 예측에 넣지 않아요';
  return null;
}

/** 여행 고치기 창의 항목 예산 칸 값 (없으면 null) */
export function itemFormValues(items: Partial<Record<TripItem, Won>>): Record<TripItem, Won | null> {
  const out = {} as Record<TripItem, Won | null>;
  for (const k of TRIP_ITEMS) out[k] = items[k] && items[k]! > 0 ? items[k]! : null;
  return out;
}

/** 항목 예산 합과 총예산 비교 안내 (없으면 null) */
export function itemBudgetHint(budget: Won | null, items: Record<TripItem, Won | null>): string | null {
  const sum = TRIP_ITEMS.reduce((s, k) => s + (items[k] ?? 0), 0);
  if (sum === 0) return null;
  if (!budget) return `총예산을 비우면 항목 합 ${formatWon(sum)}을 예산으로 잡아요`;
  if (sum > budget) return `항목 합 ${formatWon(sum)}이 총예산보다 ${formatWon(sum - budget)} 많아요`;
  return `항목 합 ${formatWon(sum)} · 나머지 ${formatWon(budget - sum)}은 항목 없이 써요`;
}
