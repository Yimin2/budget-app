'use client';

import { Fragment, useId, useMemo, useState } from 'react';
import {
  formatDateKo,
  formatManShort,
  formatMonthKo,
  formatWon,
  ledgerPeople,
  savingsBar,
  usualBreakdown,
  usualDonutSlices,
  usualSpenderOptions,
} from '@/domain';
import type { DonutSlice, Id, LedgerData, Shortage, UsualBreakdownRow, UsualTrend, Won } from '@/domain';
import { Icon, SegmentedControl, cx } from '@/ui';
import styles from './usualViz.module.css';

/** 도넛 색: 디자인 토큰의 차트 색 (라이트 · 다크 모두 정해져 있음). '기타'는 회색(--chart-6) */
const SLICE_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
const OTHER_COLOR = 'var(--chart-6)';

export function sliceColor(s: Pick<DonutSlice, 'colorIndex'>): string {
  return s.colorIndex === null ? OTHER_COLOR : (SLICE_COLORS[s.colorIndex] ?? OTHER_COLOR);
}

/** '154.5만' (0이면 '0원') */
const man = (n: Won) => formatManShort(n);
const pct = (share: number) => `${Math.round(share * 100)}%`;

function donutLabel(slices: DonutSlice[], total: Won): string {
  if (slices.length === 0) return '평소 쓰는 돈 기록이 없어요';
  return `평소 쓰는 돈 월 ${man(total)}: ${slices.map((s) => `${s.name} ${man(s.amount)} (${pct(s.share)})`).join(', ')}`;
}

/* ───────── 도넛 (인라인 SVG, 라이브러리 없음) ───────── */

export function UsualDonut({ slices, total, size = 'lg' }: { slices: DonutSlice[]; total: Won; size?: 'sm' | 'lg' }) {
  const r = 40;
  const gap = slices.length > 1 ? 0.6 : 0; // 조각 사이 틈 (pathLength 100 기준)
  // 조각마다 시작 위치 (앞 조각 몫의 누적)
  const starts = slices.map((_, i) => slices.slice(0, i).reduce((t, x) => t + x.share * 100, 0));
  return (
    <div
      className={cx(styles.donut, size === 'sm' ? styles.donutSm : styles.donutLg)}
      role="img"
      aria-label={donutLabel(slices, total)}
      data-testid={size === 'sm' ? 'usual-donut-small' : 'usual-donut'}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <circle cx="50" cy="50" r={r} fill="none" className={styles.donutTrack} strokeWidth={size === 'sm' ? 16 : 12} />
        {slices.map((s, i) => {
          const dash = Math.max(0, s.share * 100 - gap);
          return (
            <circle
              key={s.key}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              pathLength={100}
              strokeWidth={size === 'sm' ? 16 : 12}
              strokeDasharray={`${dash} ${100 - dash}`}
              strokeDashoffset={-(starts[i] ?? 0)}
              transform="rotate(-90 50 50)"
              style={{ stroke: sliceColor(s) }}
            />
          );
        })}
      </svg>
      {size === 'lg' ? (
        <span className={styles.donutCenter} aria-hidden="true">
          <span className={styles.donutCenterLabel}>월</span>
          <span className={styles.donutCenterValue}>{man(total)}</span>
        </span>
      ) : null}
    </div>
  );
}

/* ───────── 적립 대비 막대 ───────── */

export function SavingsBarView({
  contribution,
  usual,
  planned,
  shortages,
  year,
}: {
  contribution: Won;
  usual: Won;
  planned: Won;
  shortages: Shortage[];
  year: number;
}) {
  const bar = savingsBar(contribution, usual + planned, shortages);
  const short = bar.kind === 'short';
  const scale = Math.max(bar.contribution, bar.spending, 1);
  const base = Math.min(bar.contribution, bar.spending) / scale;
  const rest = (short ? bar.over : bar.left) / scale;
  const status = short
    ? `${man(bar.over)} 넘어요${bar.runOut ? ` · 이대로면 ${formatMonthKo(bar.runOut, year)}에 바닥나요` : ''}`
    : bar.left >= 1000
      ? `${man(bar.left)} 남아요`
      : '적립과 평소 지출이 거의 같아요';
  return (
    <div className={styles.bar} data-testid="savings-bar">
      <div className={styles.barLegend}>
        <span>
          적립 <strong>{man(bar.contribution)}</strong>
        </span>
        <span>
          평소 지출 <strong>{man(bar.spending)}</strong>
        </span>
      </div>
      <div className={styles.barTrack} aria-hidden="true">
        <span className={styles.barBase} style={{ width: `${base * 100}%` }} />
        {rest > 0 ? (
          <span className={cx(styles.barRest, short ? styles.barOver : styles.barLeft)} style={{ width: `${rest * 100}%` }} />
        ) : null}
      </div>
      <p className={cx(styles.barStatus, short ? styles.bad : styles.good)} data-testid="savings-status">
        <Icon name={short ? 'alert-triangle' : 'check-circle'} size={18} />
        <span>{status}</span>
      </p>
      {planned > 0 ? (
        <p className={styles.note}>
          평소 지출 = 평소 쓰는 돈 {man(usual)} + 등록한 일정 · 여행 {man(planned)} (한 달 평균)
        </p>
      ) : null}
    </div>
  );
}

/* ───────── 항목별 평균 표 ───────── */

const TREND_TEXT: Record<UsualTrend, { glyph: string; sr: string; cls: string | undefined }> = {
  up: { glyph: '▲', sr: '평균보다 많아요', cls: styles.up },
  down: { glyph: '▼', sr: '평균보다 적어요', cls: styles.down },
  same: { glyph: '–', sr: '평균과 비슷해요', cls: undefined },
};

function TrendCell({ row }: { row: UsualBreakdownRow }) {
  const t = TREND_TEXT[row.trend];
  return (
    <span className={cx(styles.trend, t.cls)}>
      <span aria-hidden="true">{t.glyph} </span>
      {man(row.lastMonth)}
      <span className="sr-only">, {t.sr}</span>
    </span>
  );
}

function rowKey(r: UsualBreakdownRow): string {
  return r.categoryId ?? '_none';
}

export function UsualTable({ rows, months, showSpender }: { rows: UsualBreakdownRow[]; months: number; showSpender: boolean }) {
  const baseId = useId();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (rows.length === 0) {
    return <p className={styles.note}>이 사람이 쓴 평소 지출 기록이 없어요</p>;
  }
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className="sr-only">항목별 평균 (최근 {months}개월). 항목을 누르면 그 항목 지출이 펼쳐져요</caption>
        <thead>
          <tr>
            <th scope="col">항목</th>
            <th scope="col">월 평균</th>
            <th scope="col">건수</th>
            <th scope="col">건당</th>
            <th scope="col">지난달</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const key = rowKey(r);
            const isOpen = open[key] === true;
            const listId = `${baseId}-${key}`;
            return (
              <Fragment key={key}>
                <tr className={cx(isOpen && styles.rowOpen)}>
                  <th scope="row">
                    <button
                      type="button"
                      className={styles.rowBtn}
                      aria-expanded={isOpen}
                      aria-controls={listId}
                      aria-label={`${r.name} 지출`}
                      onClick={() => setOpen((o) => ({ ...o, [key]: !isOpen }))}
                    >
                      <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} />
                      <span>{r.name}</span>
                    </button>
                  </th>
                  <td>{man(r.monthly)}</td>
                  <td>{r.count}건</td>
                  <td>{man(r.perItem)}</td>
                  <td>
                    <TrendCell row={r} />
                  </td>
                </tr>
                <tr id={listId} hidden={!isOpen} className={styles.itemsRow}>
                  <td colSpan={5}>
                    {isOpen ? (
                      <ul className={styles.items} aria-label={`${r.name} 지출 (최근 것 먼저)`}>
                        {r.items.map((i) => (
                          <li key={i.id}>
                            <span className={styles.itemMain}>
                              <span className={styles.itemDate}>{formatDateKo(i.date, false)}</span>
                              <span className={styles.itemMemo}>{i.memo.trim() || '메모 없음'}</span>
                              {showSpender ? <span className={styles.itemWho}>{i.spenderName}</span> : null}
                            </span>
                            <span className={styles.itemAmt}>{formatWon(i.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ───────── 카드 안 그림 묶음 ───────── */

const ALL = '_all';

/**
 * 평소 쓰는 돈과 적립 카드의 그림: 접힌 상태에서는 작은 도넛만(UsualDonut sm, 부모가 놓음),
 * 펼치면 막대 · [전체 · 사람] · 도넛 + 표 (넓은 화면에서는 나란히)
 */
export function useUsualBreakdown(data: LedgerData, accountId: Id, today: string, spenderKey: string | null) {
  return useMemo(() => {
    const b = usualBreakdown(data, accountId, today, spenderKey);
    return { breakdown: b, slices: usualDonutSlices(b.rows) };
  }, [data, accountId, today, spenderKey]);
}

export function UsualDetails({
  data,
  accountId,
  today,
  contribution,
  usual,
  planned,
  shortages,
}: {
  data: LedgerData;
  accountId: Id;
  today: string;
  contribution: Won;
  usual: Won;
  planned: Won;
  shortages: Shortage[];
}) {
  const options = useMemo(() => usualSpenderOptions(data, ledgerPeople(data)), [data]);
  const [who, setWho] = useState<string>(ALL);
  const spenderKey = who === ALL || !options.some((o) => o.key === who) ? null : who;
  const { breakdown, slices } = useUsualBreakdown(data, accountId, today, spenderKey);
  const year = Number(today.slice(0, 4));
  return (
    <div className={styles.details}>
      <SavingsBarView contribution={contribution} usual={usual} planned={planned} shortages={shortages} year={year} />
      {options.length >= 2 ? (
        <SegmentedControl
          ariaLabel="누가 쓴 돈을 볼까요"
          value={spenderKey ?? ALL}
          onChange={setWho}
          options={[{ value: ALL, label: '전체' }, ...options.map((o) => ({ value: o.key, label: o.name }))]}
          className={styles.who}
        />
      ) : null}
      <div className={styles.split}>
        <div className={styles.donutCol}>
          <UsualDonut slices={slices} total={breakdown.monthlyTotal} />
          {slices.length > 0 ? (
            <ul className={styles.legend} aria-label="도넛 조각">
              {slices.map((s) => (
                <li key={s.key}>
                  <span className={styles.swatch} style={{ background: sliceColor(s) }} aria-hidden="true" />
                  <span className={styles.legendName}>{s.name}</span>
                  <span className={styles.legendAmt}>
                    {man(s.amount)} · {pct(s.share)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className={styles.tableCol}>
          <UsualTable rows={breakdown.rows} months={breakdown.months.length} showSpender={spenderKey === null} />
        </div>
      </div>
      <p className={styles.note}>
        최근 {breakdown.months.length}개월 기록으로 셌어요 (예외로 표시한 지출은 빼요). 건당 = 그 기간 합 ÷ 건수, 지난달 화살표는 월 평균과 견줘요
      </p>
    </div>
  );
}
