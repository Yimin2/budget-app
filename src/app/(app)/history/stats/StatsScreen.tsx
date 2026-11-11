'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  addMonths,
  budgetVsActual,
  categoryDonutSlices,
  clampStatsMonth,
  compareMonth,
  eventYearReview,
  formatDateKo,
  formatManShort,
  formatMonthKo,
  monthCategorySpend,
  monthOf,
  spendingTrend,
  statsMonthRange,
  trendAverage,
  usualSpenderOptions,
  withSubject,
  type BudgetActual,
  type BudgetActualRow,
  type BudgetState,
  type CategorySpend,
  type DonutSlice,
  type EventYearReview,
  type LedgerData,
  type TrendMonth,
  type Won,
  type YearMonth,
} from '@/domain';
import { Badge, Button, Card, Donut, Icon, PageHeader, ProgressBar, SegmentedControl, cx, donutColor } from '@/ui';
import { ExpandButton } from '../../_components/ExpandButton';
import { PageSkeleton } from '../../_components/PageSkeleton';
import { RequireLedger, type ReadyLedger } from '../../_components/RequireLedger';
import styles from './stats.module.css';

const man = (n: Won) => formatManShort(n);
const pct = (share: number) => `${Math.round(share * 100)}%`;
const monthKo = (m: YearMonth) => formatMonthKo(m, 0);

/** '/history/stats' 통계: 맨 위 ◀ 달 ▶ + 네 묶음 (처음부터 펼쳐 둠 (사용자 결정), [접기]로 요약만 — 창 없음) */
export function StatsScreen() {
  const params = useSearchParams();
  const initial = params?.get('month') ?? null;
  return (
    <>
      <PageHeader title="통계" subtitle="달마다 예산과 쓴 돈, 어디에 썼는지, 1년 흐름을 봐요" />
      <RequireLedger skeleton={<PageSkeleton withHeader={false} cards={4} label="통계를 불러오는 중이에요" />}>
        {(ledger) => <StatsView ledger={ledger} initialMonth={initial} />}
      </RequireLedger>
    </>
  );
}

export function StatsView({ ledger, initialMonth = null }: { ledger: ReadyLedger; initialMonth?: string | null }) {
  const { data, today } = ledger;
  const [picked, setPicked] = useState<string | null>(initialMonth);
  const month = clampStatsMonth(data, today, picked);
  return (
    <div className={styles.page}>
      <StatsMonthSwitcher data={data} today={today} month={month} onChange={setPicked} />
      <BudgetSection data={data} today={today} month={month} />
      <CategorySection data={data} month={month} />
      <TrendSection data={data} month={month} />
      <EventSection data={data} today={today} month={month} />
    </div>
  );
}

/* ───────── 달 고르기 ───────── */

function StatsMonthSwitcher({ data, today, month, onChange }: { data: LedgerData; today: string; month: YearMonth; onChange: (m: YearMonth) => void }) {
  const { min, max } = statsMonthRange(data, today);
  const thisMonth = monthOf(today);
  return (
    <div className={styles.monthBar} role="group" aria-label="통계 달 고르기">
      <Button
        variant="ghost"
        plain
        iconOnly
        icon="chevron-left"
        aria-label="이전 달"
        onClick={() => onChange(addMonths(month, -1))}
        disabled={compareMonth(month, min) <= 0}
      />
      <h2 className={styles.monthTitle} aria-live="polite" data-testid="stats-month">
        {monthKo(month)}
      </h2>
      <Button
        variant="ghost"
        plain
        iconOnly
        icon="chevron-right"
        aria-label="다음 달"
        onClick={() => onChange(addMonths(month, 1))}
        disabled={compareMonth(month, max) >= 0}
      />
      {month !== thisMonth ? (
        <Button variant="ghost" onClick={() => onChange(thisMonth)}>
          이번 달
        </Button>
      ) : null}
    </div>
  );
}

/* ───────── 묶음 틀: 처음부터 펼침 + [접기] ───────── */

function StatSection({ id, title, summary, children }: { id: string; title: string; summary: ReactNode; children: () => ReactNode }) {
  const [open, setOpen] = useState(true);
  const titleId = useId();
  const bodyId = `${id}-body`;
  return (
    <Card as="section" aria-labelledby={titleId} className={styles.section} data-testid={id}>
      <div className={styles.sectionHead}>
        <h2 id={titleId} className={styles.sectionTitle}>
          {title}
        </h2>
        <ExpandButton open={open} onToggle={() => setOpen((o) => !o)} controls={bodyId} openLabel="펼치기" closeLabel="접기" label={title} />
      </div>
      <div className={styles.summary}>{summary}</div>
      <div id={bodyId} hidden={!open} className={styles.body}>
        {open ? children() : null}
      </div>
    </Card>
  );
}

/* ───────── ① 달별 예산 대비 실제 ───────── */

const STATE_TONE: Record<BudgetState, 'primary' | 'warning' | 'danger'> = { ok: 'primary', warning: 'warning', over: 'danger', none: 'primary' };

function stateText(r: Pick<BudgetActualRow, 'state' | 'spent' | 'budget' | 'ratio'>): string {
  if (r.state === 'over') return `${man(r.spent - r.budget)} 넘었어요`;
  if (r.state === 'none') return '예산 없음';
  return `${pct(r.ratio)} 썼어요`;
}

function BudgetRow({ name, budget, spent, state, ratio }: { name: string; budget: Won; spent: Won; state: BudgetState; ratio: number }) {
  const text = stateText({ state, spent, budget, ratio });
  return (
    <li className={styles.budgetRow} data-state={state}>
      <div className={styles.budgetLine}>
        <span className={styles.budgetName}>{name}</span>
        <span className={styles.budgetAmt}>
          {man(spent)}
          {budget > 0 ? <span className={styles.muted}> / {man(budget)}</span> : null}
        </span>
      </div>
      {budget > 0 ? (
        <ProgressBar value={spent} max={budget} tone={STATE_TONE[state]} track="subtle" label={name} decorative />
      ) : null}
      <span className={cx(styles.stateText, state === 'over' && styles.danger, state === 'warning' && styles.warning)}>
        {state === 'over' || state === 'warning' ? <Icon name="alert-triangle" size={16} /> : null}
        {text}
      </span>
    </li>
  );
}

function budgetSummary(b: BudgetActual): ReactNode {
  if (b.rows.length === 0) return <p className={styles.summaryText}>이 달은 생활비 예산과 지출이 없어요</p>;
  return (
    <>
      <p className={styles.summaryText}>
        생활비 예산 <strong>{man(b.budget)}</strong> 중 <strong>{man(b.spent)}</strong> 썼어요
      </p>
      {b.overCount > 0 || b.warningCount > 0 ? (
        <div className={styles.badges}>
          {b.overCount > 0 ? (
            <Badge tone="danger" variant="soft" size="sm">
              넘은 항목 {b.overCount}개
            </Badge>
          ) : null}
          {b.warningCount > 0 ? (
            <Badge tone="warning" variant="soft" size="sm">
              90% 넘게 쓴 항목 {b.warningCount}개
            </Badge>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function BudgetSection({ data, today, month }: { data: LedgerData; today: string; month: YearMonth }) {
  const b = useMemo(() => budgetVsActual(data, month, today), [data, month, today]);
  return (
    <StatSection id="stats-budget" title="달별 예산 대비 실제" summary={budgetSummary(b)}>
      {() => (
        <>
          {b.rows.length > 0 ? (
            <ul className={styles.budgetList} aria-label={`${monthKo(month)} 생활비 항목별 예산과 쓴 돈`}>
              {b.rows.map((r) => (
                <BudgetRow key={r.key} name={r.owner ? `${r.name} (${r.owner})` : r.name} budget={r.budget} spent={r.spent} state={r.state} ratio={r.ratio} />
              ))}
            </ul>
          ) : null}
          {b.fixed || b.allowance ? (
            <ul className={styles.budgetList} aria-label="고정비 · 용돈">
              {b.fixed ? (
                <li className={styles.budgetRow}>
                  <div className={styles.budgetLine}>
                    <span className={styles.budgetName}>고정비</span>
                    <span className={styles.budgetAmt}>
                      {man(b.fixed.paid)}
                      <span className={styles.muted}> / {man(b.fixed.planned)}</span>
                    </span>
                  </div>
                  {b.fixed.planned > 0 ? <ProgressBar value={b.fixed.paid} max={b.fixed.planned} track="subtle" label="고정비" decorative /> : null}
                  <span className={styles.stateText}>자동 기록된 결제 / 그달 결제할 돈</span>
                </li>
              ) : null}
              {b.allowance ? (
                <li className={styles.budgetRow}>
                  <div className={styles.budgetLine}>
                    <span className={styles.budgetName}>용돈</span>
                    <span className={styles.budgetAmt}>
                      {man(b.allowance.spent)}
                      {b.allowance.planned > 0 ? <span className={styles.muted}> / {man(b.allowance.planned)}</span> : null}
                    </span>
                  </div>
                  {b.allowance.planned > 0 ? (
                    <ProgressBar value={b.allowance.spent} max={b.allowance.planned} track="subtle" label="용돈" decorative />
                  ) : null}
                  <span className={styles.stateText}>용돈 통장에서 나간 돈 / 그달 용돈 배분</span>
                </li>
              ) : null}
            </ul>
          ) : null}
          <p className={styles.note}>예산은 그달에 적용된 예산(지난달 이월 포함)이에요. 90% 넘게 쓰면 주의, 넘으면 위험 색이에요.</p>
        </>
      )}
    </StatSection>
  );
}

/* ───────── ② 카테고리별 비율 ───────── */

const ALL = '_all';

function donutText(slices: DonutSlice[], total: Won, who: string): string {
  if (slices.length === 0) return `${who} 쓴 돈이 없어요`;
  return `${who} 쓴 돈 ${man(total)}: ${slices.map((s) => `${s.name} ${man(s.amount)} (${pct(s.share)})`).join(', ')}`;
}

function DonutLegend({ slices, label }: { slices: DonutSlice[]; label: string }) {
  return (
    <ul className={styles.legend} aria-label={label}>
      {slices.map((s) => (
        <li key={s.key}>
          <span className={styles.swatch} style={{ background: donutColor(s) }} aria-hidden="true" />
          <span className={styles.legendName}>{s.name}</span>
          <span className={styles.legendAmt}>
            {man(s.amount)} · {pct(s.share)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CategorySection({ data, month }: { data: LedgerData; month: YearMonth }) {
  const all = useMemo(() => monthCategorySpend(data, month), [data, month]);
  const allSlices = useMemo(() => categoryDonutSlices(all), [all]);
  const total = all.reduce((s, r) => s + r.amount, 0);
  const top = allSlices[0];
  return (
    <StatSection
      id="stats-category"
      title="카테고리별 비율"
      summary={
        <div className={styles.summaryRow}>
          {allSlices.length > 0 ? <Donut parts={allSlices} size="sm" label={donutText(allSlices, total, monthKo(month))} /> : null}
          <p className={styles.summaryText}>
            {total > 0 ? (
              <>
                {monthKo(month)} 쓴 돈 <strong>{man(total)}</strong>
                {top ? (
                  <>
                    {' '}
                    · 가장 많이 {top.name} {pct(top.share)}
                  </>
                ) : null}
              </>
            ) : (
              `${monthKo(month)}에는 쓴 돈이 없어요`
            )}
          </p>
        </div>
      }
    >
      {() => <CategoryDetails data={data} month={month} all={all} />}
    </StatSection>
  );
}

function CategoryDetails({ data, month, all }: { data: LedgerData; month: YearMonth; all: CategorySpend[] }) {
  const options = useMemo(() => usualSpenderOptions(data), [data]);
  const [picked, setPicked] = useState<string>(ALL);
  const key = picked === ALL || !options.some((o) => o.key === picked) ? null : picked;
  const rows = useMemo(() => (key ? monthCategorySpend(data, month, key) : all), [data, month, key, all]);
  const slices = useMemo(() => categoryDonutSlices(rows), [rows]);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const whoName = key ? (options.find((o) => o.key === key)?.name ?? '') : '';
  const who = whoName ? withSubject(whoName) : '';
  return (
    <>
      {options.length >= 2 ? (
        <SegmentedControl
          ariaLabel="누가 쓴 돈을 볼까요"
          value={key ?? ALL}
          onChange={setPicked}
          options={[{ value: ALL, label: '전체' }, ...options.map((o) => ({ value: o.key, label: o.name }))]}
          className={styles.who}
        />
      ) : null}
      {slices.length > 0 ? (
        <div className={styles.split}>
          <Donut
            parts={slices}
            label={donutText(slices, total, `${monthKo(month)}${who ? ` ${who}` : ''}`)}
            data-testid="stats-donut"
            center={
              <>
                <span className="donut-center-label">{whoName || '전체'}</span>
                <span className="donut-center-value">{man(total)}</span>
              </>
            }
          />
          <DonutLegend slices={slices} label="카테고리별 쓴 돈" />
        </div>
      ) : (
        <p className={styles.note}>{who ? `${who} 이 달에 쓴 돈이 없어요` : '이 달에 쓴 돈이 없어요'}</p>
      )}
      <p className={styles.note}>
        생활비 · 고정비 · 용돈 · 이벤트통장까지 그달의 모든 지출이에요. 큰 5개 말고는 기타로 묶어요. 사람은 실제로 쓴 사람(개인 돈으로 낸 사람 · 통장 주인)으로 나눠요.
      </p>
    </>
  );
}

/* ───────── ③ 월별 추이 ───────── */

function TrendSection({ data, month }: { data: LedgerData; month: YearMonth }) {
  const trend = useMemo(() => spendingTrend(data, month), [data, month]);
  const avg = trendAverage(trend);
  const cur = trend.at(-1)!;
  return (
    <StatSection
      id="stats-trend"
      title="월별 추이"
      summary={
        <p className={styles.summaryText}>
          최근 12개월 평균 월 <strong>{man(avg)}</strong> · {monthKo(month)} <strong>{man(cur.total)}</strong>
        </p>
      }
    >
      {() => <TrendDetails data={data} trend={trend} month={month} />}
    </StatSection>
  );
}

function TrendDetails({ data, trend, month }: { data: LedgerData; trend: TrendMonth[]; month: YearMonth }) {
  const [sel, setSel] = useState<YearMonth>(month);
  const selected = trend.find((t) => t.month === sel) ?? trend.at(-1)!;
  const max = Math.max(1, ...trend.map((t) => t.total));
  const rows = useMemo(() => monthCategorySpend(data, selected.month), [data, selected.month]);
  const slices = useMemo(() => categoryDonutSlices(rows), [rows]);
  const tableId = useId();
  return (
    <>
      <div className={styles.chart} role="group" aria-label="달마다 쓴 돈. 달을 누르면 아래에 그달 내역이 나와요" aria-describedby={tableId}>
        {trend.map((t) => {
          const on = t.month === selected.month;
          return (
            <button
              key={t.month}
              type="button"
              className={cx(styles.col, on && styles.colOn)}
              aria-pressed={on}
              aria-label={`${monthKo(t.month)} ${man(t.total)}`}
              onClick={() => setSel(t.month)}
            >
              <span className={styles.colTrack} aria-hidden="true">
                <span className={styles.colBar} style={{ height: `${(Math.max(0, t.total) / max) * 100}%` }} />
              </span>
              <span className={styles.colLabel} aria-hidden="true">
                {Number(t.month.slice(5))}월
              </span>
            </button>
          );
        })}
      </div>
      <table className="sr-only" id={tableId}>
        <caption>최근 12개월 달마다 쓴 돈</caption>
        <thead>
          <tr>
            <th scope="col">달</th>
            <th scope="col">쓴 돈</th>
            <th scope="col">건수</th>
          </tr>
        </thead>
        <tbody>
          {trend.map((t) => (
            <tr key={t.month}>
              <th scope="row">{monthKo(t.month)}</th>
              <td>{man(t.total)}</td>
              <td>{t.count}건</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.breakdown} data-testid="trend-breakdown" aria-live="polite">
        <h3 className={styles.breakdownTitle}>
          {monthKo(selected.month)} · {man(selected.total)} · {selected.count}건
        </h3>
        {slices.length > 0 ? <DonutLegend slices={slices} label={`${monthKo(selected.month)} 카테고리별 쓴 돈`} /> : <p className={styles.note}>이 달에는 쓴 돈이 없어요</p>}
      </div>
    </>
  );
}

/* ───────── ④ 이벤트통장 1년 회고 ───────── */

const signed = (n: Won) => (n > 0 ? `+${man(n)}` : n < 0 ? `−${man(-n)}` : '0원');

function EventSection({ data, today, month }: { data: LedgerData; today: string; month: YearMonth }) {
  const r = useMemo(() => eventYearReview(data, month, today), [data, month, today]);
  if (!r) return null;
  return (
    <StatSection
      id="stats-event"
      title="이벤트통장 1년 회고"
      summary={
        <>
          <p className={styles.summaryText}>
            적립 <strong>{man(r.contributed)}</strong> · 쓴 돈 <strong>{man(r.spent)}</strong> · 잔액 <strong>{signed(r.net)}</strong>
          </p>
          <p className={styles.note}>
            {monthKo(r.from)} ~ {monthKo(r.to)}
          </p>
        </>
      }
    >
      {() => <EventDetails r={r} />}
    </StatSection>
  );
}

function EventDetails({ r }: { r: EventYearReview }) {
  const maxCat = Math.max(1, ...r.byCategory.map((c) => c.amount));
  return (
    <>
      <dl className={styles.facts}>
        <div>
          <dt>들어온 적립</dt>
          <dd>{man(r.contributed)}</dd>
        </div>
        <div>
          <dt>쓴 돈</dt>
          <dd>
            {man(r.spent)} <span className={styles.muted}>· {r.spentCount}건{r.claimSpent > 0 ? ` · 청구 ${man(r.claimSpent)} 포함` : ''}</span>
          </dd>
        </div>
        <div>
          <dt>잔액 변화</dt>
          <dd>
            {signed(r.net)}{' '}
            <span className={styles.muted}>
              ({man(r.startBalance)} → {man(r.endBalance)})
            </span>
          </dd>
        </div>
        <div>
          <dt>저수지에서 빌린 돈</dt>
          <dd>{man(r.borrowed)}</dd>
        </div>
        <div>
          <dt>저수지에 갚은 돈</dt>
          <dd>{man(r.repaid)}</dd>
        </div>
        {r.movedOut > 0 ? (
          <div>
            <dt>다른 통장으로 옮긴 돈</dt>
            <dd>{man(r.movedOut)}</dd>
          </div>
        ) : null}
      </dl>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>가장 큰 일정 · 여행</h3>
        {r.topEvents.length > 0 ? (
          <ol className={styles.rank}>
            {r.topEvents.map((e) => (
              <li key={e.key}>
                <span className={styles.rankMain}>
                  <Badge size="sm" tone={e.kind === 'trip' ? 'info' : 'neutral'}>
                    {e.kind === 'trip' ? '여행' : '일정'}
                  </Badge>
                  <span className={styles.rankName}>{e.name}</span>
                  <span className={styles.muted}>{formatDateKo(e.firstDate, false)}</span>
                </span>
                <span className={styles.rankAmt}>{man(e.amount)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.note}>일정 · 여행에 묶인 지출이 없어요</p>
        )}
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>카테고리별 쓴 돈</h3>
        {r.byCategory.length > 0 ? (
          <ul className={styles.catList} aria-label="이벤트통장 카테고리별 쓴 돈">
            {r.byCategory.map((c) => (
              <li key={c.key}>
                <div className={styles.budgetLine}>
                  <span className={styles.budgetName}>{c.name}</span>
                  <span className={styles.budgetAmt}>
                    {man(c.amount)} <span className={styles.muted}>· {pct(r.spent > 0 ? c.amount / r.spent : 0)}</span>
                  </span>
                </div>
                <span className={styles.catTrack} aria-hidden="true">
                  <span style={{ width: `${(c.amount / maxCat) * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.note}>쓴 돈이 없어요</p>
        )}
      </div>
      <p className={styles.note}>
        청구(개인 돈으로 낸 지출)는 돌려준 날이 아니라 쓴 날짜로 셌어요. 잔액 변화는 실제로 돌려준 날 줄어서 쓴 돈과 다를 수 있어요.
      </p>
    </>
  );
}
