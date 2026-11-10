/* 여행 화면에서 쓰는 순수 함수. 화면과 떼어 테스트해요. */
import { formatMan, formatMonthKo, formatShortDate, formatWon, TRIP_ITEMS, tripSpendState } from '@/domain';
import type {
  Expense, ISODate, TripDailySpending, TripDayRow, TripItem, TripItemLine, TripLeftoverPool, TripSpendState, TripStatus, Won,
} from '@/domain';

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

/** 날짜별 한 줄 이름: "여행 전 (미리 낸 돈)" · "12/20 (1일차)" · "여행 뒤" */
export function dayRowLabel(row: Pick<TripDayRow, 'kind' | 'date' | 'dayIndex'>): string {
  if (row.kind === 'before') return '여행 전 (미리 낸 돈)';
  if (row.kind === 'after') return '여행 뒤';
  return `${formatShortDate(row.date!)} (${row.dayIndex}일차)`;
}

/**
 * 날짜별 카드를 접었을 때 보이는 한 줄 (정리할 지출이 없으면 null)
 * - "하루 평균 18만 · 가장 많이 쓴 날 12/20 23만" · 하루 여행은 "12/20 하루 8만"
 * - 여행 날에 쓴 돈이 없으면 "여행 전 45만 · 여행 날에 쓴 돈은 아직 없어요"
 */
export function dailySummaryText(d: Pick<TripDailySpending, 'dayCount' | 'daysTotal' | 'average' | 'peak' | 'before' | 'after'>): string | null {
  if (d.daysTotal > 0 && d.peak) {
    if (d.dayCount === 1) return `${formatShortDate(d.peak.date!)} 하루 ${formatMan(d.daysTotal)}`;
    // 평균은 천 원 단위로 반올림해 짧게 (12.6667만 → 12.7만)
    return `하루 평균 ${formatMan(Math.round(d.average / 1000) * 1000)} · 가장 많이 쓴 날 ${formatShortDate(d.peak.date!)} ${formatMan(d.peak.total)}`;
  }
  const parts = [d.before > 0 ? `여행 전 ${formatMan(d.before)}` : '', d.after > 0 ? `여행 뒤 ${formatMan(d.after)}` : ''].filter(Boolean);
  if (parts.length === 0) return null;
  return `${parts.join(' · ')} · 여행 날에 쓴 돈은 아직 없어요`;
}
