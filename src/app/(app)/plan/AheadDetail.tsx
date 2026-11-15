'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { forecastCompare, formatManShort, formatShortDate, formatWon, monthOf } from '@/domain';
import type { ForecastSnapshot, ISODate, PastMonth, ProjectionMonth, ProjectionRangeMonth, SpentOnlyMonth, YearMonth } from '@/domain';
import { Button, Icon, cx } from '@/ui';
import {
  aheadInflowText, aheadTotalLines, aheadTotals, isNewSpend, capList, repayByMonth, repayPayersLine, repaySummary, monthLabel,
  monthShortLine, type AheadItem,
} from './selectors';
import { tripHref } from './trips/selectors';
import shared from './events.module.css';
import styles from './AheadCard.module.css';
import { PAST_RECORDS_HREF, SETTLE_SCREEN_HREF, AHEAD_LIST_LIMIT, AHEAD_LIST_KEEP } from './aheadShared';

function ItemRow({ item, today }: { item: AheadItem; today: ISODate }) {
  const claim = item.kind === 'claims';
  return (
    <li className={cx(item.kind === 'usual' && styles.itemMuted)}>
      <span className={styles.d}>{item.date && !claim ? formatShortDate(item.date) : item.kind === 'trip' ? '여행' : ''}</span>
      <span className={styles.n}>
        {item.tripId ? <Link href={tripHref(item.tripId)}>{item.label}</Link> : item.label}
        {item.date && !claim && item.date < today ? <span className="sr-only"> (날짜 지남)</span> : null}
        {item.note ? <span className={styles.note}>{item.kind === 'usual' ? ` (${item.note})` : ` · ${item.note}`}</span> : null}
      </span>
      <span className={styles.a}>
        <Man value={item.amount} />
      </span>
    </li>
  );
}

/** 보이는 금액은 만 단위, 화면 읽기는 정확한 원 단위 */
function Man({ value }: { value: number }) {
  return (
    <>
      <span aria-hidden>{formatManShort(value)}</span>
      <span className="sr-only">{formatWon(value)}</span>
    </>
  );
}

/** 'N건 더' (누르면 나머지를 보여요) */
function MoreButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button type="button" className={styles.moreBtn} onClick={onClick}>
      {count}건 더
      <Icon name="chevron-down" size={16} />
    </button>
  );
}

/**
 * 지난 지출 돌려주기 묶음 (PLAN 4-2): 처음엔 접어서 머리 한 줄 '지난 지출 돌려주기 440만 · 25건 (6~10월에 쓴 것)' +
 * 낸 사람별 합 '민구 420만 · 기쁜 20만' + [펼치기] · 정산 화면 링크. 펼치면 쓴 달별 한 줄 '6월 · 3건 45만'(오래된 달 먼저),
 * 달을 누르면 그달 항목(5줄 + 'N건 더'). 청구 한 건씩 목록이 없으면(합만) 한 줄 그대로
 */
function RepayGroup({ month, items, label, today }: { month: ProjectionMonth; items: AheadItem[]; label: string; today: ISODate }) {
  const ids = useId().replace(/:/g, '');
  const [open, setOpen] = useState(false);
  const [openMonths, setOpenMonths] = useState<ReadonlySet<YearMonth>>(new Set());
  const [allMonths, setAllMonths] = useState<ReadonlySet<YearMonth>>(new Set());
  const groups = repayByMonth(items, month);
  const payers = repayPayersLine(month);
  const head = repaySummary(month) ?? '지난 지출 돌려주기';
  const toggleMonth = (m: YearMonth) =>
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  const listId = `${ids}-repay`;
  return (
    <div className={styles.group} data-testid="ahead-repay">
      <h4 className={styles.groupTitle} data-testid="ahead-repay-head">
        {head}
      </h4>
      {payers ? (
        <p className={styles.repayPayers} data-testid="ahead-repay-payers">
          {payers}
        </p>
      ) : null}
      <div className={styles.repayActions}>
        {groups.length > 0 ? (
          <button
            type="button"
            className={styles.toggleBtn}
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? '접기' : '펼치기'}
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
          </button>
        ) : null}
        <Link href={SETTLE_SCREEN_HREF} className={styles.repayLink}>
          정산 화면
          <Icon name="chevron-right" size={16} />
        </Link>
      </div>
      {groups.length === 0 ? (
        <ul className={styles.items} aria-label={`${label} 지난 지출 돌려주기`}>
          {items.map((i) => (
            <ItemRow key={i.key} item={i} today={today} />
          ))}
        </ul>
      ) : open ? (
        <ul id={listId} className={styles.repayMonths} aria-label={`${label} 지난 지출 돌려주기`}>
          {groups.map((g) => {
            const mOpen = openMonths.has(g.month);
            const rows = allMonths.has(g.month) ? { shown: g.items, more: 0 } : capList(g.items, AHEAD_LIST_LIMIT, AHEAD_LIST_KEEP);
            const rowsId = `${ids}-repay-${g.month}`;
            return (
              <li key={g.month} className={styles.repayMonth}>
                <button
                  type="button"
                  className={styles.monthToggle}
                  aria-expanded={mOpen}
                  aria-controls={rowsId}
                  onClick={() => toggleMonth(g.month)}
                >
                  <span className={styles.monthToggleText}>
                    {g.label}에 쓴 것 · {g.count}건
                  </span>
                  <span className={styles.groupAmount}>
                    <Man value={g.amount} />
                  </span>
                  <Icon name={mOpen ? 'chevron-up' : 'chevron-down'} size={16} />
                </button>
                {mOpen ? (
                  <>
                    <ul id={rowsId} className={styles.items} aria-label={`${g.label}에 쓴 것`}>
                      {rows.shown.map((i) => (
                        <li key={i.key}>
                          <span className={styles.d}>{i.date ? formatShortDate(i.date) : ''}</span>
                          <span className={styles.n}>{i.payer ?? i.label}</span>
                          <span className={styles.a}>
                            <Man value={i.amount} />
                          </span>
                        </li>
                      ))}
                    </ul>
                    {rows.more > 0 ? (
                      <MoreButton count={rows.more} onClick={() => setAllMonths((prev) => new Set(prev).add(g.month))} />
                    ) : null}
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {open || groups.length === 0 ? (
        <p className={styles.groupNote}>이미 쓴 돈이라 지출은 그때 달에 세고, 여기선 통장에서 돈이 나가는 날로 잡아요</p>
      ) : null}
    </div>
  );
}

function DetailNav({ onPrev, onNext }: { onPrev?: () => void; onNext?: () => void }) {
  return (
    <div className={shared.nav}>
      <Button variant="ghost" plain iconOnly icon="chevron-left" aria-label="이전 달" onClick={onPrev} disabled={!onPrev} />
      <Button variant="ghost" plain iconOnly icon="chevron-right" aria-label="다음 달" onClick={onNext} disabled={!onNext} />
    </div>
  );
}

export function MonthDetail({
  month,
  items,
  range,
  highCount,
  today,
  spentSoFar,
  prevForecast,
  onPrev,
  onNext,
}: {
  month: ProjectionMonth;
  items: AheadItem[];
  range: ProjectionRangeMonth | null;
  highCount: number;
  today: ISODate;
  spentSoFar: number | null;
  prevForecast: ForecastSnapshot | null;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const isThis = month.month === monthOf(today);
  const short = month.endBalance < 0;
  const label = monthLabel(month.month, today);
  const spend = items.filter(isNewSpend);
  const repay = items.filter((i) => !isNewSpend(i));
  const totals = aheadTotals(month);
  const lines = aheadTotalLines(month, today, spentSoFar);
  const [spendAll, setSpendAll] = useState(false);
  const spendShown = spendAll ? { shown: spend, more: 0 } : capList(spend, AHEAD_LIST_LIMIT, AHEAD_LIST_KEEP);
  return (
    <div className={styles.detail} data-testid="ahead-month">
      <div className={shared.detailHead}>
        <div className={shared.txt}>
          <h3 className={styles.detailTitle}>
            {label}
            {isThis ? ' · 이번 달' : ''}
          </h3>
          <span className={styles.detailSub}>
            <span className={cx(shared.statusLine, short ? shared.bad : shared.ok)} data-testid="ahead-month-status">
              <Icon name={short ? 'alert-triangle' : 'check-circle'} size={16} />
              {monthShortLine(month, today) ?? '모자라지 않아요'}
            </span>
          </span>
        </div>
        <DetailNav onPrev={onPrev} onNext={onNext} />
      </div>
      <div className={styles.totalBox} data-testid="ahead-total">
        <p className={styles.totalTitle}>{lines.title}</p>
        {lines.split ? <p className={styles.totalSub}>= {lines.split}</p> : null}
        {lines.parts ? <p className={styles.totalSub}>{lines.parts}</p> : null}
      </div>
      {spend.length > 0 ? (
        <div className={styles.group}>
          {repay.length > 0 ? (
            <h4 className={styles.groupTitle}>
              새로 나갈 돈 <span className={styles.groupAmount}>{formatManShort(totals.spend)}</span>
            </h4>
          ) : null}
          <ul className={styles.items} aria-label={`${label} 나갈 돈`}>
            {spendShown.shown.map((i) => (
              <ItemRow key={i.key} item={i} today={today} />
            ))}
          </ul>
          {spendShown.more > 0 ? <MoreButton count={spendShown.more} onClick={() => setSpendAll(true)} /> : null}
        </div>
      ) : (
        <p className={styles.detailEmpty}>{repay.length > 0 ? '새로 나갈 돈은 없어요' : '이 달에는 나갈 돈이 없어요'}</p>
      )}
      {repay.length > 0 ? <RepayGroup month={month} items={repay} label={label} today={today} /> : null}
      <dl className={styles.calc}>
        <div className={cx(styles.calcRow, styles.calcMuted)}>
          <dt>들어오는 돈</dt>
          <dd data-testid="ahead-inflow">{aheadInflowText(month, isThis)}</dd>
        </div>
        <div className={cx(styles.calcRow, styles.calcTotal)}>
          <dt>그 달 끝 예상 잔액</dt>
          <dd className={short ? shared.bad : undefined}>
            <Man value={month.endBalance} />
          </dd>
        </div>
        {range ? (
          <div className={cx(styles.calcRow, styles.calcMuted)}>
            <dt>아끼면 · 많이 쓰면</dt>
            <dd>
              {formatManShort(range.endLow)} · <span className={range.endHigh < 0 ? shared.bad : undefined}>{formatManShort(range.endHigh)}</span>
            </dd>
          </div>
        ) : null}
        {prevForecast ? (
          <div className={cx(styles.calcRow, styles.calcMuted)}>
            <dt>지난달 예상</dt>
            <dd data-testid="ahead-prev-forecast">{formatManShort(prevForecast.expected)}</dd>
          </div>
        ) : null}
      </dl>
      {range && range.endHigh < 0 && !short && highCount > 0 ? (
        <p className={styles.detailWarn}>많이 쓰면 이 달에 {formatManShort(-range.endHigh)} 모자라요</p>
      ) : null}
    </div>
  );
}

/** 통장 시작 전 달: '○월 · 통장 기록 전' + 쓴 돈 + 묶은 줄(5줄 + 'N건 더') + 정산 화면 링크. 잔액 · 예측 견주기는 없어요 */
export function SpentDetail({
  s,
  today,
  onPrev,
  onNext,
}: {
  s: SpentOnlyMonth;
  today: ISODate;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const label = monthLabel(s.month, today);
  const [all, setAll] = useState(false);
  const rows = all ? { shown: s.items, more: 0 } : capList(s.items, AHEAD_LIST_LIMIT, AHEAD_LIST_KEEP);
  return (
    <div className={styles.detail} data-testid="ahead-spent-month">
      <div className={shared.detailHead}>
        <div className={shared.txt}>
          <h3 className={styles.detailTitle}>{label} · 통장 기록 전</h3>
          <span className={styles.detailSub}>통장을 시작하기 전이라 잔액 대신 쓴 돈만 보여요</span>
        </div>
        <DetailNav onPrev={onPrev} onNext={onNext} />
      </div>
      <dl className={styles.calc}>
        <div className={cx(styles.calcRow, styles.calcTotal)}>
          <dt>쓴 돈</dt>
          <dd data-testid="ahead-spent-total">
            <Man value={s.spent} />
          </dd>
        </div>
      </dl>
      <ul className={styles.items} aria-label={`${label} 쓴 돈`}>
        {rows.shown.map((i) => (
          <li key={i.key}>
            <span className={styles.n}>
              {i.label}
              {i.expenseIds.length > 1 ? <span className={styles.note}> · {i.expenseIds.length}건</span> : null}
            </span>
            <span className={styles.a}>
              <Man value={i.amount} />
            </span>
          </li>
        ))}
      </ul>
      {rows.more > 0 ? <MoreButton count={rows.more} onClick={() => setAll(true)} /> : null}
      <Link href={PAST_RECORDS_HREF} className={styles.pastLink}>
        그 달 쓴 돈은 정산 화면에서
        <Icon name="chevron-right" size={16} />
      </Link>
    </div>
  );
}

/** 지난 달 요약: 시작 잔액 · 들어온 돈 · 나간 돈 · 끝 잔액 + 그때 예상과 견주기 + 정산 화면 링크 */
export function PastDetail({
  past,
  snapshot,
  today,
  onPrev,
  onNext,
}: {
  past: PastMonth;
  snapshot: ForecastSnapshot | null;
  today: ISODate;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const label = monthLabel(past.month, today);
  const cmp = snapshot ? forecastCompare(snapshot, past) : null;
  return (
    <div className={styles.detail} data-testid="ahead-past-month">
      <div className={shared.detailHead}>
        <div className={shared.txt}>
          <h3 className={styles.detailTitle}>{label} · 지난 달</h3>
          <span className={styles.detailSub}>기록으로 계산한 실제 잔액</span>
        </div>
        <DetailNav onPrev={onPrev} onNext={onNext} />
      </div>
      <dl className={styles.calc}>
        <div className={styles.calcRow}>
          <dt>시작 잔액</dt>
          <dd>
            <Man value={past.startBalance} />
          </dd>
        </div>
        <div className={styles.calcRow}>
          <dt>들어온 돈</dt>
          <dd>
            +<Man value={past.inflow} />
          </dd>
        </div>
        <div className={styles.calcRow}>
          <dt>나간 돈</dt>
          <dd>
            −<Man value={past.outflow} />
          </dd>
        </div>
        <div className={cx(styles.calcRow, styles.calcTotal)}>
          <dt>끝 잔액</dt>
          <dd className={past.endBalance < 0 ? shared.bad : undefined}>
            <Man value={past.endBalance} />
          </dd>
        </div>
      </dl>
      {cmp ? (
        <div className={styles.compare} data-testid="ahead-compare">
          <p className={styles.compareHead}>{cmp.headline}</p>
          {cmp.detail ? <p className={styles.compareSub}>{cmp.detail}</p> : null}
          {cmp.inflowNote ? <p className={styles.compareSub}>{cmp.inflowNote}</p> : null}
        </div>
      ) : (
        <p className={styles.compareSub}>이 달은 그때 남긴 예측 기록이 없어요</p>
      )}
      <Link href={PAST_RECORDS_HREF} className={styles.pastLink}>
        그 달 쓴 돈은 정산 화면에서
        <Icon name="chevron-right" size={16} />
      </Link>
    </div>
  );
}
