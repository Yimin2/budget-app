/* 여행 화면에서 쓰는 순수 함수. 화면과 떼어 테스트해요. */
import { formatMonthKo, formatWon, TRIP_ITEMS } from '@/domain';
import type { ISODate, TripItem, TripStatus, Won } from '@/domain';

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

/** 막대 색: 넘으면 danger, 90% 이상 쓰면 warning */
export function spendTone(spent: Won, budget: Won | null): 'primary' | 'warning' | 'danger' {
  if (budget === null || budget <= 0) return spent > 0 ? 'warning' : 'primary';
  if (spent > budget) return 'danger';
  return spent >= budget * 0.9 ? 'warning' : 'primary';
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
