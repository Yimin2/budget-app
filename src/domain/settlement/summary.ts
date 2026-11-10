/**
 * 정산 화면 (/plan/settle) · 이벤트 화면 · 홈의 사람별 목록 · 요약 · 안내 문구
 */
import { formatShortDate, monthOf } from '../dates';
import { formatMan, formatWon } from '../money';
import { oldestFirst, sumOf } from './internal';
import type { PersonClaims, SelectionCheck, Settlement } from './claimsAllocation';
import type { EventMonthUsage } from './usage';
import type { Id, ISODate, PendingClaim, Won, YearMonth } from '../types';

/** 정산 화면 막대의 안내: 이벤트통장에서 줄 수 있는 돈과 저수지에서 빌려 줄 나머지 (넘는 것이 없으면 null) */
export function selectionLimitText(s: Settlement, check: Pick<SelectionCheck, 'excess' | 'fits'>, canBorrow: boolean): string | null {
  if (check.fits) return null;
  const head = s.payable > 0 ? `이벤트통장에서 줄 수 있는 돈은 ${formatMan(s.payable)}이에요` : '이벤트통장에서 줄 수 있는 돈이 없어요';
  return canBorrow ? `${head} · 나머지 ${formatMan(check.excess)}은 저수지에서 빌려 줄 수 있어요` : head;
}

/** 이벤트통장이 모자랄 때 한 줄: '이벤트통장이 12,000원 모자라요' (모자라지 않으면 null) */
export function shortfallText(s: Pick<Settlement, 'shortfall'>): string | null {
  return s.shortfall > 0 ? `이벤트통장이 ${formatWon(s.shortfall)} 모자라요` : null;
}

/**
 * 정산 화면의 쉬운 설명:
 * '지갑(이벤트통장)에 10만 있고, 21일에 50만 들어와요. 지난달에 못 준 돈 55만을 먼저 돌려줘요.
 *  이 돈을 먼저 돌려주면 11월 일정에 5만이 모자라요.' / '… 이번 달 일정 10만을 빼면 줄 수 있는 돈은 50만이에요.'
 */
export function settleExplanation(s: Settlement): string {
  const parts: string[] = [];
  const short = s.recorded < 0;
  const amount0 = formatMan(Math.abs(s.recorded));
  if (s.incoming !== 0) {
    const when = s.incomingOn ? `${Number(s.incomingOn.slice(8))}일에` : `${Number(s.asOf.slice(8))}일까지`;
    const flow = s.incoming > 0 ? `${formatMan(s.incoming)} 들어와요` : `${formatMan(-s.incoming)} 나가요`;
    const wallet = short ? `지갑(이벤트통장)이 ${amount0} 모자라고` : `지갑(이벤트통장)에 ${amount0} 있고`;
    parts.push(`${wallet}, ${when} ${flow}.`);
  } else {
    parts.push(short ? `지갑(이벤트통장)이 ${amount0} 모자라요.` : `지갑(이벤트통장)에 ${amount0} 있어요.`);
  }
  if (s.oldPay > 0) parts.push(`지난달에 못 준 돈 ${formatMan(s.oldPay)}을 먼저 돌려줘요.`);
  const month = Number(monthOf(s.asOf).slice(5));
  if (s.plannedShort) {
    parts.push(`이 돈을 먼저 돌려주면 ${Number(s.plannedShort.month.slice(5))}월 일정에 ${formatMan(s.plannedShort.amount)}이 모자라요.`);
  } else {
    const what = s.oldPay > 0 ? '더 줄 수 있는 돈은' : '줄 수 있는 돈은';
    const amount = s.oldPay > 0 ? s.freshLimit : s.payable;
    parts.push(
      s.reserved > 0
        ? `이번 달 일정 ${formatMan(s.reserved)}을 빼면 ${what} ${formatMan(amount)}이에요.`
        : `${month}월에 남은 일정이 없어 ${what} ${formatMan(amount)}이에요.`,
    );
  }
  return parts.join(' ');
}

/* ───────── 정산 화면 (/plan/settle) · 이벤트 화면 한 줄 요약 ───────── */

/**
 * 정산 화면의 항목 종류
 * - pay: 이번 달 지급 (이벤트통장 · 고정지출통장)
 * - carry: 지급할 수 있는 돈에 안 들어가 다음 달로 넘어가는 이벤트통장 청구
 * - borrow: 저수지통장 이벤트 청구 = 저수지에서 빌려 지급 (지급하면 저수지에 갚을 돈)
 * - reservoir: 저수지통장의 이벤트 아닌 청구 = 저수지에서 지급 (빌린 돈이 아니다)
 * - upcoming: 아직 정산일 전
 */
export type SettleItemKind = 'pay' | 'carry' | 'borrow' | 'reservoir' | 'upcoming';

export interface SettleItem {
  claim: PendingClaim;
  kind: SettleItemKind;
}

export interface SettlePerson {
  name: string;
  /** 그 사람의 모든 항목 합 */
  amount: Won;
  /** 오래된 순 */
  items: SettleItem[];
}

/** 정산 화면: 모든 청구를 사람마다 한 목록으로 (사람 순서 = 이번 달 지급 → 넘어가요 → 저수지 → 정산일 전에 처음 나온 순) */
export function settleRoster(s: Settlement): SettlePerson[] {
  const groups: [SettleItemKind, PersonClaims[]][] = [
    ['pay', s.pay],
    ['carry', s.carry],
    ['borrow', s.reservoirLoan],
    ['reservoir', s.reservoir],
    ['upcoming', s.upcoming],
  ];
  const out: SettlePerson[] = [];
  const seen = new Set<Id>();
  for (const [kind, list] of groups) {
    for (const g of list) {
      for (const claim of g.claims) {
        if (seen.has(claim.expense.id)) continue;
        seen.add(claim.expense.id);
        let p = out.find((x) => x.name === claim.payer);
        if (!p) {
          p = { name: claim.payer, amount: 0, items: [] };
          out.push(p);
        }
        p.amount += claim.amount;
        p.items.push({ claim, kind });
      }
    }
  }
  for (const p of out) p.items.sort((a, b) => oldestFirst(a.claim, b.claim));
  return out;
}

export interface SettlementSummary {
  /**
   * 이번 달 줄 돈 = 정산 기준일까지 돌려줄 날이 된 모든 청구의 합 (지난달부터 못 준 것 · 다음 달로 넘어갈 것 포함,
   * 돌려줄 날이 된 저수지 청구 포함). 이벤트통장에서 지금 줄 수 있는지와 상관없이 이번 달에 줘야 하는 돈
   */
  total: Won;
  /** 사람마다 (많은 순) */
  people: { name: string; amount: Won }[];
  /** 정산일 */
  date: ISODate;
  /** 그중 이벤트통장에서 줄 수 있는 돈 = 처음 골라 둔 이벤트통장 청구 (지난달 청구 먼저 · 오래된 순 first-fit, 쪼개지 않음) */
  fromEvent: Won;
  /** 생활비(고정지출) 통장에서 줄 돈 */
  fromFixed: Won;
  /** 저수지에서 줄 돈 (저수지통장의 이벤트 아닌 청구, 빌린 돈이 아니다) */
  fromReservoir: Won;
  /** 저수지에서 빌려 줄 돈 (저수지 돈으로 낸 이벤트 청구) */
  borrow: Won;
  /** 나머지 = 이벤트통장에서 줄 수 있는 돈에 안 드는 청구 → 저수지에서 빌리거나 다음 달로 */
  rest: Won;
  /** 이벤트통장에서 줄 수 있는 돈 (한도) */
  payable: Won;
  /** 줄 돈이 없을 때 다음에 줄 돈: 가장 이른 정산일과 그날 줄 돈 (없으면 null) */
  next: { date: ISODate; amount: Won } | null;
  /** 넘어가는 돈 합과 가장 늦은 지급 예상 달 (12개월 안에 어려우면 null) */
  carry: { amount: Won; estimate: YearMonth | null } | null;
  /** 아직 안 돌려준 청구가 하나라도 있는지 (정산 화면을 열 만한지) */
  hasClaims: boolean;
}

/**
 * 이벤트 화면 · 홈 · 정산 화면 맨 위의 요약: '이번 달 줄 돈 70만 (민구 55만 · 기쁜 15만) · 11/21'
 * 과 그중 어디서 줄 수 있는지 (splitText)
 */
export function settlementSummary(s: Settlement): SettlementSummary {
  const roster = settleRoster(s);
  const isDue = (i: SettleItem) => i.kind !== 'upcoming' && i.claim.due <= s.asOf;
  const people = roster
    .map((p) => ({ name: p.name, amount: p.items.filter(isDue).reduce((t, i) => t + i.claim.amount, 0) }))
    .filter((p) => p.amount > 0)
    .sort((a, b) => b.amount - a.amount || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const dueOf = (list: PersonClaims[]) => sumOf(list.flatMap((g) => g.claims).filter((c) => c.due <= s.asOf));
  const later = roster.flatMap((p) => p.items).filter((i) => !isDue(i));
  let next: SettlementSummary['next'] = null;
  if (later.length > 0) {
    const date = later.reduce((m, i) => (i.claim.due < m ? i.claim.due : m), later[0]!.claim.due);
    next = { date, amount: later.filter((i) => i.claim.due === date).reduce((t, i) => t + i.claim.amount, 0) };
  }
  let carry: SettlementSummary['carry'] = null;
  if (s.carry.length > 0) {
    let estimate: YearMonth | null = s.carry[0]!.estimate;
    for (const g of s.carry) {
      if (g.estimate === null || estimate === null) {
        estimate = null;
        break;
      }
      if (g.estimate > estimate) estimate = g.estimate;
    }
    carry = { amount: s.carryTotal, estimate };
  }
  return {
    total: people.reduce((t, p) => t + p.amount, 0),
    people,
    date: s.date,
    fromEvent: s.eventPayTotal,
    fromFixed: s.payTotal - s.eventPayTotal,
    fromReservoir: dueOf(s.reservoir),
    borrow: dueOf(s.reservoirLoan),
    rest: s.carryTotal,
    payable: s.payable,
    next,
    carry,
    hasClaims: roster.length > 0,
  };
}

/**
 * 줄 돈을 어디서 주는지 한 줄: '이벤트통장에서 2만 · 나머지 68만은 저수지에서 빌리거나 다음 달로'
 * (모두 이벤트통장 몫이고 다 들어가면 '모두 이벤트통장에서 줄 수 있어요'). 줄 돈이 없으면 null
 */
export function settlementSplitText(sum: SettlementSummary): string | null {
  if (sum.total <= 0) return null;
  if (sum.rest === 0 && sum.fromFixed === 0 && sum.fromReservoir === 0 && sum.borrow === 0) return '모두 이벤트통장에서 줄 수 있어요';
  const parts: string[] = [];
  if (sum.fromEvent > 0) parts.push(`이벤트통장에서 ${formatMan(sum.fromEvent)}`);
  if (sum.fromFixed > 0) parts.push(`생활비 통장에서 ${formatMan(sum.fromFixed)}`);
  if (sum.fromReservoir > 0) parts.push(`저수지에서 ${formatMan(sum.fromReservoir)}`);
  if (sum.borrow > 0) parts.push(`저수지에서 빌려 ${formatMan(sum.borrow)}`);
  if (sum.rest > 0) {
    const head =
      parts.length > 0
        ? '나머지 '
        : sum.payable > 0
          ? `이벤트통장에서 줄 수 있는 ${formatMan(sum.payable)}에 안 들어가 `
          : '이벤트통장에서 줄 수 있는 돈이 없어 ';
    parts.push(`${head}${formatMan(sum.rest)}은 저수지에서 빌리거나 다음 달로`);
  }
  return parts.join(' · ');
}

/**
 * 한 줄 카드 머리말 옆(모바일은 둘째 줄)에 붙일 말: '11/21 정산 15만 · 못 준 돈 55만은 다음 달로 (민구)'.
 * 생활비 통장 · 저수지에서 줄 몫이 있으면 함께, 줄 돈이 없으면 '이번 달 정산할 돈은 없어요'. 붙일 말이 없으면 null.
 * 못 준 돈의 사람은 두 명까지만 (금액은 두 명일 때만)
 */
export function eventUsageNoteText(u: EventMonthUsage, sum: SettlementSummary): string | null {
  const parts: string[] = [];
  if (sum.total <= 0) parts.push('이번 달 정산할 돈은 없어요');
  if (u.plannedClaims > 0) parts.push(`${formatShortDate(sum.date)} 정산 ${formatMan(u.plannedClaims)}`);
  if (sum.fromFixed > 0) parts.push(`생활비 통장에서 ${formatMan(sum.fromFixed)}`);
  if (sum.fromReservoir > 0) parts.push(`저수지에서 ${formatMan(sum.fromReservoir)}`);
  if (sum.borrow > 0) parts.push(`저수지에서 빌려 ${formatMan(sum.borrow)}`);
  if (u.unpaid > 0) {
    const who =
      u.unpaidPeople.length === 1
        ? ` (${u.unpaidPeople[0]!.name})`
        : u.unpaidPeople.length === 2
          ? ` (${u.unpaidPeople.map((p) => `${p.name} ${formatMan(p.amount)}`).join(' · ')})`
          : '';
    parts.push(`못 준 돈 ${formatMan(u.unpaid)}은 다음 달로${who}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
