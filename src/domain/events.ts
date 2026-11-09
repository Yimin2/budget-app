import { accountBalance, isCountedTransfer } from './balances';
import { addMonths, compareMonth, dateInMonth, isMonthActive, isValidMonth, monthOf, monthRange } from './dates';
import { autoTransferId } from './ids';
import { firstAccountByRole } from './internal';
import { ceilTo1000 } from './money';
import { ruleOccurrenceDate } from './recurring';
import type {
  EventProjection, Id, ISODate, LedgerData, PlannedEvent, ProjectionMonth, Repeat, ShortageFix, YearMonth, Won,
} from './types';

const DEFAULT_HORIZON = 12;

/** 반복 일정 행 id 의 시리즈 기준 id. 다음 회차 행은 '<기준id>@<날짜>' 로 만든다 ('abc@2027-03-31' → 'abc') */
export function seriesBaseId(id: string): string {
  const i = id.indexOf('@');
  return i < 0 ? id : id.slice(0, i);
}

/**
 * 반복 일정의 기준 일(日). 시리즈 첫 행의 날짜 일을 쓴다 (31일 → 2월 28일 → 3월 31일, 짧은 달을 지나도 앞당겨지지 않게).
 * 이 행이 기준일을 그달 말일로 줄인 날짜가 아니면 사용자가 날짜를 바꾼 것으로 보고 이 행의 일을 쓴다.
 */
export function seriesAnchorDay(events: PlannedEvent[], event: PlannedEvent): number {
  const day = Number(event.date.slice(8, 10));
  const base = seriesBaseId(event.id);
  if (base === event.id) return day;
  const first = events.find((e) => e.id === base);
  if (!first) return day;
  const anchor = Number(first.date.slice(8, 10));
  if (!Number.isFinite(anchor) || anchor < 1) return day;
  return dateInMonth(monthOf(event.date), anchor) === event.date ? anchor : day;
}

/** 반복 일정의 다음 회차 날짜 (반복 없음이면 null). anchorDay 를 주면 그 일을 기준으로 말일 처리 */
export function nextOccurrenceDate(date: ISODate, repeat: Repeat, anchorDay?: number): ISODate | null {
  if (repeat === 'none') return null;
  const day = anchorDay ?? Number(date.slice(8, 10));
  return dateInMonth(addMonths(monthOf(date), repeat === 'monthly' ? 1 : 12), day);
}

/** 다음 회차 행의 결정적 id — 다시 눌러도(재시도) 같은 행이라 중복되지 않는다 */
export function nextOccurrenceId(event: PlannedEvent, nextDate: ISODate): string {
  return `${seriesBaseId(event.id)}@${nextDate}`;
}

/** planned 일정의 반복을 [fromMonth, toMonth] 안에서 펼친 회차들 (원래 행 포함, 같은 id 에 회차 날짜). anchorDay: 반복 기준 일 */
export function expandOccurrences(
  event: PlannedEvent,
  fromMonth: YearMonth,
  toMonth: YearMonth,
  anchorDay?: number,
): { id: string; name: string; date: ISODate; amount: Won }[] {
  const eventMonth = monthOf(event.date);
  const day = anchorDay ?? Number(event.date.slice(8, 10));
  const occ = (date: ISODate) => ({ id: event.id, name: event.name, date, amount: event.amount });
  if (!isValidMonth(eventMonth) || !isValidMonth(fromMonth) || !isValidMonth(toMonth)) return [];
  if (compareMonth(toMonth, fromMonth) < 0) return [];
  if (event.repeat === 'monthly') {
    const start = compareMonth(eventMonth, fromMonth) > 0 ? eventMonth : fromMonth;
    if (compareMonth(start, toMonth) > 0) return [];
    return monthRange(start, toMonth).map((m) => occ(m === eventMonth ? event.date : dateInMonth(m, day)));
  }
  if (event.repeat === 'yearly') {
    const mm = event.date.slice(5, 7);
    const startYear = Math.max(Number(eventMonth.slice(0, 4)), Number(fromMonth.slice(0, 4)));
    const endYear = Number(toMonth.slice(0, 4));
    const out: ReturnType<typeof occ>[] = [];
    for (let y = startYear; y <= endYear; y++) {
      const m = `${String(y).padStart(4, '0')}-${mm}`;
      if (compareMonth(m, eventMonth) < 0) continue;
      if (compareMonth(m, fromMonth) < 0 || compareMonth(m, toMonth) > 0) continue;
      out.push(occ(m === eventMonth ? event.date : dateInMonth(m, day)));
    }
    return out;
  }
  if (compareMonth(eventMonth, fromMonth) >= 0 && compareMonth(eventMonth, toMonth) <= 0) return [occ(event.date)];
  return [];
}

/** 일정에 연결해 이미 쓴 돈 (삭제 안 된 지출 중 eventId 가 같은 것) */
export function spentOnEvent(data: LedgerData, eventId: Id): Won {
  return data.expenses.reduce((s, x) => (!x.deleted && x.eventId === eventId ? s + x.amount : s), 0);
}

/**
 * 통장 하나의 월별 예측 (월배분·예정 이체·그 통장의 예정 일정 반영). 이벤트통장 예측과 저수지 예상 잔액에 함께 쓴다.
 * - 오늘보다 뒤 날짜로 이미 기록한 이체·지출(done)은 오늘 잔액에 없으므로 그 날짜의 달에 넣는다
 * - 예정 일정에 이미 연결해 쓴 지출이 있으면 그 행 회차에서는 남은 금액만 뺀다 (반복으로 펼친 다음 회차는 전액)
 * - 이번 달 월배분: 자동 이체가 이미 기록됐거나, 날짜가 지났는데 통장 시작일 전이라 기록되지 않을 회차는 넣지 않는다
 */
function projectAccount(
  data: LedgerData,
  accountId: Id,
  today: ISODate,
  horizon: number,
  extra?: { month: YearMonth; amount: Won },
): { currentBalance: Won; monthlyContribution: Won; months: ProjectionMonth[] } {
  const thisMonth = monthOf(today);
  const lastMonth = addMonths(thisMonth, Math.max(1, horizon) - 1);
  const currentBalance = accountBalance(data, accountId, today);
  const account = data.accounts.find((a) => a.id === accountId);
  const opening = account?.openingDate ?? '';
  const transferIds = new Set(data.transfers.map((t) => t.id));
  const rules = data.rules.filter(
    (r) => !r.deleted && (r.toAccountId === accountId || r.fromAccountId === accountId),
  );
  const sign = (r: (typeof rules)[number]) =>
    (r.toAccountId === accountId ? 1 : 0) - (r.fromAccountId === accountId ? 1 : 0);
  const ruleNet = (month: YearMonth, isFirst: boolean) =>
    rules.reduce((s, r) => {
      // 시작일 전 회차는 기록되지 않으므로 넣지 않는다. 이번 달은 이미 기록된(잔액에 들어간) 회차도 뺀다
      if (ruleOccurrenceDate(data, r, month) === null) return s;
      if (isFirst && transferIds.has(autoTransferId(r.id, month))) return s;
      return s + sign(r) * r.amount;
    }, 0);
  const monthlyRate = (month: YearMonth) =>
    rules.reduce((s, r) => (isMonthActive(month, r.startMonth, r.endMonth) ? s + sign(r) * r.amount : s), 0);

  const plannedTransfers = data.transfers.filter((t) => !t.deleted && t.status === 'planned');
  // 오늘 뒤 날짜로 이미 기록한(done) 이체·지출
  const laterTransfers = data.transfers.filter(
    (t) => t.date > today && t.date >= opening && isCountedTransfer(data, t) && (t.toAccountId === accountId || t.fromAccountId === accountId),
  );
  const laterExpenses = data.expenses.filter(
    (e) => !e.deleted && e.accountId === accountId && e.date > today && e.date >= opening,
  );
  const plannedEvents = data.events.filter((e) => !e.deleted && e.status === 'planned' && e.accountId === accountId);
  const spent = new Map<Id, Won>();
  for (const x of data.expenses) {
    if (!x.deleted && x.eventId) spent.set(x.eventId, (spent.get(x.eventId) ?? 0) + x.amount);
  }

  const months: ProjectionMonth[] = [];
  let balance = currentBalance;
  for (const month of monthRange(thisMonth, lastMonth)) {
    const isFirst = month === thisMonth;
    const contributions = ruleNet(month, isFirst);
    let transfersIn = 0;
    let transfersOut = 0;
    for (const t of plannedTransfers) {
      if (monthOf(t.date) !== month) continue;
      if (t.toAccountId === accountId) transfersIn += t.amount;
      if (t.fromAccountId === accountId) transfersOut += t.amount;
    }
    for (const t of laterTransfers) {
      if (monthOf(t.date) !== month) continue;
      if (t.toAccountId === accountId) transfersIn += t.amount;
      if (t.fromAccountId === accountId) transfersOut += t.amount;
    }
    const scheduledSpending = laterExpenses.reduce((s, e) => (monthOf(e.date) === month ? s + e.amount : s), 0);
    const events: ProjectionMonth['events'] = [];
    for (const e of plannedEvents) {
      const paid = spent.get(e.id) ?? 0;
      const remaining = Math.max(0, e.amount - paid);
      // 이미 다 쓴 행(연결 지출 ≥ 예상 금액)은 그 회차를 빼고, 반복 회차만 남긴다
      const keepOwn = paid === 0 || remaining > 0;
      const anchor = e.repeat === 'none' ? undefined : seriesAnchorDay(data.events, e);
      // 날짜가 지났는데 아직 예정인 일정은 이번 달에 나갈 돈으로 본다
      if (isFirst && compareMonth(monthOf(e.date), thisMonth) < 0) {
        if (keepOwn) events.push({ id: e.id, name: e.name, date: e.date, amount: remaining });
      }
      for (const o of expandOccurrences(e, month, month, anchor)) {
        if (o.date !== e.date) events.push(o);
        else if (keepOwn) events.push({ ...o, amount: remaining });
      }
    }
    events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const planned = events.reduce((s, e) => s + e.amount, 0);
    const extraAmount = extra && extra.month === month ? extra.amount : 0;
    const startBalance = balance;
    const endBalance =
      startBalance + contributions + transfersIn - transfersOut - planned - scheduledSpending - extraAmount;
    months.push({
      month,
      startBalance,
      contributions,
      transfersIn,
      transfersOut,
      planned,
      extra: extraAmount,
      ...(scheduledSpending > 0 ? { scheduledSpending } : {}),
      endBalance,
      events,
    });
    balance = endBalance;
  }
  return { currentBalance, monthlyContribution: monthlyRate(thisMonth), months };
}

/**
 * PLAN 4-2. 이벤트통장 12개월(기본) 예측.
 * - 이벤트통장 = role='event' 첫 통장 (없으면 accountId=null, 빈 예측)
 * - 이번 달 시작값 = 오늘 기준 잔액. 이번 달: 아직 기록 안 된(자동 이체 id 없음) 월배분 적립 + 이번 달 planned 이체 − 오늘 이후(포함)·지난 날짜라도 아직 planned 인 이번 달 일정
 * - 다음 달부터: 전월 말 + 월배분 적립 + planned 이체 − 그달 planned 일정(반복 펼침)
 * - extra: 가정 지출 {month, amount} (사도 돼? 판단용)
 * - endBalance < 0 인 달 = shortages
 */
export function projectEventAccount(
  data: LedgerData,
  today: ISODate,
  opts?: { horizonMonths?: number; extra?: { month: YearMonth; amount: Won } },
): EventProjection {
  const account = firstAccountByRole(data, 'event');
  if (!account) return { accountId: null, currentBalance: 0, monthlyContribution: 0, months: [], shortages: [] };
  const p = projectAccount(data, account.id, today, opts?.horizonMonths ?? DEFAULT_HORIZON, opts?.extra);
  return {
    accountId: account.id,
    currentBalance: p.currentBalance,
    monthlyContribution: p.monthlyContribution,
    months: p.months,
    shortages: p.months.filter((m) => m.endBalance < 0).map((m) => ({ month: m.month, amount: -m.endBalance })),
  };
}

/**
 * PLAN 4-2 부족 대처 제안.
 * ① 늘릴 금액 = 부족한 달마다 (그달까지 누적 부족액 ÷ 다음 달부터 그달까지 적립 횟수) 의 최댓값, 1000원 올림
 *    (이번 달 부족은 적립으로 채울 수 없어 ①에서 빠진다. fromMonth=다음 달, toMonth·times=그 최댓값을 만든 달과 적립 횟수)
 * ② 첫 부족 달에 저수지(role='reservoir')에서 부족액만큼. 저수지 예상 잔액 = 그달 말 저수지 잔액 예측(월배분 포함)
 */
export function suggestShortageFixes(data: LedgerData, today: ISODate, projection: EventProjection): ShortageFix {
  const shortages = projection.shortages;
  if (shortages.length === 0) return { increaseMonthly: null, fromReservoir: null };
  const thisMonth = monthOf(today);
  const fromMonth = addMonths(thisMonth, 1);

  let increaseMonthly: ShortageFix['increaseMonthly'] = null;
  let maxPerMonth = 0;
  let toMonth: YearMonth | null = null;
  let times = 0;
  for (const s of shortages) {
    const n = compareMonth(s.month, thisMonth);
    if (n <= 0) continue;
    const per = s.amount / n;
    // 금액을 정한 달(가장 많이 필요한 달)까지가 나눠 채우는 기간
    if (per > maxPerMonth) {
      maxPerMonth = per;
      toMonth = s.month;
      times = n;
    }
  }
  if (toMonth !== null && maxPerMonth > 0) {
    increaseMonthly = { amount: ceilTo1000(maxPerMonth), fromMonth, toMonth, times };
  }

  let fromReservoir: ShortageFix['fromReservoir'] = null;
  const reservoir = firstAccountByRole(data, 'reservoir');
  const first = shortages[0]!;
  if (reservoir) {
    const horizon = compareMonth(first.month, thisMonth) + 1;
    const rp = projectAccount(data, reservoir.id, today, Math.max(1, horizon));
    const at = rp.months.find((m) => m.month === first.month);
    fromReservoir = {
      month: first.month,
      amount: first.amount,
      reservoirAccountId: reservoir.id,
      reservoirProjected: at ? at.endBalance : rp.currentBalance,
    };
  }
  return { increaseMonthly, fromReservoir };
}
