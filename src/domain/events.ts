import { accountBalance, expenseBalanceAccountId, isCountedTransfer } from './balances';
import { pendingClaims } from './claims';
import { addMonths, compareMonth, dateInMonth, formatMonthKo, isMonthActive, isValidMonth, monthOf, monthRange } from './dates';
import { autoTransferId } from './ids';
import { projectionMonthOf, unrecordedInstallmentPayments } from './installments';
import { firstAccountByRole } from './internal';
import { ceilTo1000 } from './money';
import { lunarToSolar, parseLunarMonthDay } from './holidays';
import { tripOutflows } from './trips';
import { ruleOccurrenceDate } from './recurring';
import { manWon, usualForMonth, usualHistory, usualSpread } from './usual';
import { activeIncomePlans, incomePlanOccurrenceDate, incomeRecordId, isComputedRule, projectRemainders, ruleAmountFor } from './income';
import type {
  EventProjection, Id, ISODate, LedgerData, PlannedEvent, ProjectionMonth, ProjectionRange, Repeat, Shortage, ShortageFix, YearMonth, Won,
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

/** 음력 반복 일정인지 (매년 + 음력 월-일이 바른 값) */
export function lunarRepeatOf(event: Pick<PlannedEvent, 'repeat' | 'lunar'>): { month: number; day: number } | null {
  return event.repeat === 'yearly' ? parseLunarMonthDay(event.lunar) : null;
}

const dayGap = (a: ISODate, b: ISODate) =>
  Math.abs(
    Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10))) -
      Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10))),
  );

/** 이 양력 날짜가 어느 음력 해의 회차인지: 그 음력 월-일의 양력 날짜가 가장 가까운 해 (모르면 null) */
function lunarYearOf(date: ISODate, md: { month: number; day: number }): number | null {
  const y = Number(date.slice(0, 4));
  let best: { year: number; gap: number } | null = null;
  for (const year of [y - 1, y, y + 1]) {
    const d = lunarToSolar(year, md.month, md.day);
    if (!d) continue;
    const gap = dayGap(d, date);
    if (!best || gap < best.gap) best = { year, gap };
  }
  return best?.year ?? null;
}

/**
 * 반복 일정의 다음 회차 날짜 (반복 없음이면 null). anchorDay 를 주면 그 일을 기준으로 말일 처리.
 * lunar('MM-DD')를 주면 매년 반복을 음력으로: 다음 음력 해의 그 월-일을 양력으로 (음력 표 밖이면 양력 1년 뒤)
 */
export function nextOccurrenceDate(date: ISODate, repeat: Repeat, anchorDay?: number, lunar?: string | null): ISODate | null {
  if (repeat === 'none') return null;
  const md = lunarRepeatOf({ repeat, lunar: lunar ?? undefined });
  if (md) {
    const year = lunarYearOf(date, md);
    const next = year === null ? null : lunarToSolar(year + 1, md.month, md.day);
    if (next && next > date) return next;
  }
  const day = anchorDay ?? Number(date.slice(8, 10));
  return dateInMonth(addMonths(monthOf(date), repeat === 'monthly' ? 1 : 12), day);
}

/** 이 일정 행의 다음 회차 날짜 (기준 일 · 음력 반영). 반복이 아니면 null */
export function nextEventDate(events: PlannedEvent[], event: PlannedEvent): ISODate | null {
  if (event.repeat === 'none') return null;
  return nextOccurrenceDate(event.date, event.repeat, seriesAnchorDay(events, event), event.lunar);
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
  const lunar = lunarRepeatOf(event);
  if (lunar) {
    // 음력: 이 행의 음력 해부터 해마다 그 음력 월-일을 양력으로 (표 밖의 해는 양력 같은 날)
    const baseYear = lunarYearOf(event.date, lunar);
    if (baseYear !== null) {
      const out: ReturnType<typeof occ>[] = [];
      const endYear = Number(toMonth.slice(0, 4));
      for (let y = baseYear; y <= endYear; y++) {
        const shifted = dateInMonth(`${String(Number(eventMonth.slice(0, 4)) + (y - baseYear)).padStart(4, '0')}-${eventMonth.slice(5, 7)}`, day);
        const date = y === baseYear ? event.date : (lunarToSolar(y, lunar.month, lunar.day) ?? shifted);
        const m = monthOf(date);
        if (compareMonth(m, eventMonth) < 0 || compareMonth(m, fromMonth) < 0 || compareMonth(m, toMonth) > 0) continue;
        out.push(occ(date));
      }
      return out;
    }
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
 * - 아직 돌려주지 않은 청구(PLAN 4-9)는 정산일 달에 나갈 돈 (잔액에는 아직 없어서 두 번 빠지지 않는다)
 * - 이 통장에서 나가는 할부(PLAN 4-10) 중 아직 자동 기록되지 않은 회차는 그 달에 나갈 돈 (기록된 회차는 잔액에 이미 있다)
 * - trips: 여행의 남은 예산(PLAN 4-11, 이벤트통장만). 묶은 지출은 이미 위에서 잡혀 남은 예산에서 빠져 있다
 * - 이번 달 월배분: 자동 이체가 이미 기록됐거나, 날짜가 지났는데 통장 시작일 전이라 기록되지 않을 회차는 넣지 않는다
 */
function projectAccount(
  data: LedgerData,
  accountId: Id,
  today: ISODate,
  horizon: number,
  extras: { month: YearMonth; amount: Won }[] = [],
  trips: { month: YearMonth; tripId: Id; name: string; amount: Won }[] = [],
  withUsual = false,
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
  // 나머지 전부 보내기 규칙은 앞으로 남을 돈을 흘려 본 예상 금액으로 (PLAN 4-13)
  const remainders = rules.some(isComputedRule) ? projectRemainders(data, today, horizon) : new Map<string, Won>();
  const ruleNet = (month: YearMonth, isFirst: boolean) =>
    rules.reduce((s, r) => {
      // 시작일 전 회차는 기록되지 않으므로 넣지 않는다. 이번 달은 이미 기록된(잔액에 들어간) 회차도 뺀다
      if (ruleOccurrenceDate(data, r, month) === null) return s;
      if (isFirst && transferIds.has(autoTransferId(r.id, month))) return s;
      return s + sign(r) * ruleAmountFor(r, month, remainders, data);
    }, 0);
  const monthlyRate = (month: YearMonth) =>
    rules.reduce((s, r) => {
      if (!isMonthActive(month, r.startMonth, r.endMonth)) return s;
      // 나머지 규칙은 한 달을 온전히 흘려 본 다음 달 예상으로
      const amount = isComputedRule(r) ? ruleAmountFor(r, addMonths(month, 1), remainders, data) || ruleAmountFor(r, month, remainders, data) : r.amount;
      return s + sign(r) * amount;
    }, 0);
  // 이 통장으로 들어올 수입 계획 중 아직 기록되지 않은 회차
  const incomeIn = (month: YearMonth) =>
    activeIncomePlans(data, month, accountId).reduce((s, p) => {
      if (incomePlanOccurrenceDate(data, p, month) === null || transferIds.has(incomeRecordId(p.id, month))) return s;
      return s + p.amount;
    }, 0);

  const plannedTransfers = data.transfers.filter((t) => !t.deleted && t.status === 'planned');
  // 오늘 뒤 날짜로 이미 기록한(done) 이체·지출
  const laterTransfers = data.transfers.filter(
    (t) => t.date > today && t.date >= opening && isCountedTransfer(data, t) && (t.toAccountId === accountId || t.fromAccountId === accountId),
  );
  // 청구 지출은 낸 사람 통장에서 빠진다 (함께 쓰는 통장은 아래 pending 청구로 정산일에)
  const laterExpenses = data.expenses.filter(
    (e) => !e.deleted && expenseBalanceAccountId(e) === accountId && e.date > today && e.date >= opening,
  );
  // 아직 돌려주지 않은 청구: 돌려주는 통장은 정산일 달에 나가고(지난 정산일은 이번 달), 돌려받을 통장은 그달에 들어온다
  const claims = pendingClaims(data, today).filter((c) => c.accountId === accountId || c.claimAccountId === accountId);
  const claimMonth = (due: ISODate) => (monthOf(due) < thisMonth ? thisMonth : monthOf(due));
  const plannedEvents = data.events.filter((e) => !e.deleted && e.status === 'planned' && e.accountId === accountId);
  const installmentsDue = unrecordedInstallmentPayments(data, accountId);
  // 여행에 묶인 지출은 여행 남은 예산에서만 뺀다 (일정에도 묶여 있어도 일정 남은 금액에서 또 빼면 두 번 빠진다)
  const liveTrips = new Set(data.trips.filter((t) => !t.deleted).map((t) => t.id));
  const spent = new Map<Id, Won>();
  for (const x of data.expenses) {
    if (x.deleted || !x.eventId || (x.tripId && liveTrips.has(x.tripId))) continue;
    spent.set(x.eventId, (spent.get(x.eventId) ?? 0) + x.amount);
  }

  // 평소 쓰는 돈 (PLAN 4-2, 이벤트통장만)
  const history = withUsual ? usualHistory(data, accountId) : null;

  const months: ProjectionMonth[] = [];
  let balance = currentBalance;
  for (const month of monthRange(thisMonth, lastMonth)) {
    const isFirst = month === thisMonth;
    const contributions = ruleNet(month, isFirst);
    const income = incomeIn(month);
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
    let claimsOut = 0;
    for (const c of claims) {
      if (claimMonth(c.due) !== month || c.accountId === c.claimAccountId) continue;
      if (c.accountId === accountId) claimsOut += c.amount;
      if (c.claimAccountId === accountId) transfersIn += c.amount;
    }
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
    const extraAmount = extras.reduce((s, x) => (x.month === month ? s + x.amount : s), 0);
    const installments = installmentsDue.reduce((s, p) => (projectionMonthOf(p, today) === month ? s + p.amount : s), 0);
    const tripList: { id: Id; name: string; amount: Won }[] = [];
    for (const t of trips) {
      if (t.month !== month) continue;
      const same = tripList.find((x) => x.id === t.tripId);
      if (same) same.amount += t.amount;
      else tripList.push({ id: t.tripId, name: t.name, amount: t.amount });
    }
    const tripsOut = tripList.reduce((s, t) => s + t.amount, 0);
    const u = history ? usualForMonth(data, accountId, history, month, thisMonth, events) : { usual: 0, basis: 'none' as const };
    const usual = u.usual;
    const startBalance = balance;
    const endBalance =
      startBalance + income + contributions + transfersIn - transfersOut - planned - usual - scheduledSpending - claimsOut - installments -
      tripsOut - extraAmount;
    months.push({
      month,
      startBalance,
      contributions,
      transfersIn,
      transfersOut,
      planned,
      usual,
      ...(usual > 0 && u.basis !== 'none' ? { usualBasis: u.basis } : {}),
      extra: extraAmount,
      ...(scheduledSpending > 0 ? { scheduledSpending } : {}),
      ...(claimsOut > 0 ? { claims: claimsOut } : {}),
      ...(installments > 0 ? { installments } : {}),
      ...(tripsOut > 0 ? { trips: tripsOut, tripList } : {}),
      ...(income > 0 ? { income } : {}),
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
 * - 여행의 남은 예산(총예산 − 묶은 지출)은 여행 날짜의 달에 나갈 돈 (trips)
 * - 평소 쓰는 돈(usual): 등록하지 않은 채 늘 나가는 돈. 작년 같은 달 기록, 없으면 최근 12개월 평균 (usual.ts). 기록이 없으면 0
 * - extra: 가정 지출 {month, amount} (사도 돼? 판단용, 평소 쓰는 돈과 따로 더한다). extras: 여러 달에 걸친 가정 지출 (할부 안내용)
 * - endBalance < 0 인 달 = shortages
 */
export function projectEventAccount(
  data: LedgerData,
  today: ISODate,
  opts?: { horizonMonths?: number; extra?: { month: YearMonth; amount: Won }; extras?: { month: YearMonth; amount: Won }[] },
): EventProjection {
  const account = firstAccountByRole(data, 'event');
  if (!account) return { accountId: null, currentBalance: 0, monthlyContribution: 0, months: [], shortages: [] };
  const extras = [...(opts?.extra ? [opts.extra] : []), ...(opts?.extras ?? [])];
  // 여행 예산은 늘 이벤트통장에서 나간다 (PLAN 4-11)
  const p = projectAccount(data, account.id, today, opts?.horizonMonths ?? DEFAULT_HORIZON, extras, tripOutflows(data, today), true);
  return {
    accountId: account.id,
    currentBalance: p.currentBalance,
    monthlyContribution: p.monthlyContribution,
    months: p.months,
    shortages: p.months.filter((m) => m.endBalance < 0).map((m) => ({ month: m.month, amount: -m.endBalance })),
    range: projectionRange(data, account.id, today, p.months),
  };
}

/**
 * PLAN 4-2 범위: 평소 쓰는 돈만 아끼면 / 많이 쓰면으로 바꿔 본 달 말 잔액 (나머지는 보통과 같다).
 * 그달 아끼면 = max(0, 평소 쓰는 돈 − 아래 폭), 많이 쓰면 = 평소 쓰는 돈 + 위 폭. 차이는 다음 달로 쌓인다.
 * 기록이 없으면(폭 0) 세 줄이 같다
 */
export function projectionRange(data: LedgerData, eventAccountId: Id, today: ISODate, months: ProjectionMonth[]): ProjectionRange {
  const spread = usualSpread(usualHistory(data, eventAccountId), monthOf(today));
  let lowGain = 0;
  let highLoss = 0;
  const out: ProjectionRange['months'] = months.map((m) => {
    const usualLow = Math.max(0, m.usual - spread.low);
    const usualHigh = m.usual + spread.high;
    lowGain += m.usual - usualLow;
    highLoss += usualHigh - m.usual;
    return { month: m.month, usualLow, usualHigh, endLow: m.endBalance + lowGain, endHigh: m.endBalance - highLoss };
  });
  const highShortages: Shortage[] = out.filter((m) => m.endHigh < 0).map((m) => ({ month: m.month, amount: -m.endHigh }));
  return { method: spread.method, points: spread.points, spreadLow: spread.low, spreadHigh: spread.high, months: out, highShortages };
}

/** 보통이면 모자라지 않는데 많이 쓰면 모자라는 첫 달 (보통에도 부족이 있으면 null) */
export function highOnlyShortage(projection: EventProjection): Shortage | null {
  if (projection.shortages.length > 0) return null;
  return projection.range?.highShortages[0] ?? null;
}

/** '보통이면 괜찮지만, 많이 쓰면 5월에 23만원 모자라요' (해당 없으면 null) */
export function highOnlyShortageMessage(projection: EventProjection, today: ISODate): string | null {
  const s = highOnlyShortage(projection);
  if (!s) return null;
  const label = s.month === monthOf(today) ? '이번 달' : formatMonthKo(s.month, Number(today.slice(0, 4)));
  return `보통이면 괜찮지만, 많이 쓰면 ${label}에 ${manWon(s.amount)} 모자라요`;
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
