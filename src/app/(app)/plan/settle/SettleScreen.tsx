'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  checkSettlementSelection, defaultSettlementSelection, filterSettleList, formatMan, formatShortDate, formatWon, groupByPerson,
  ledgerPeople, pendingOnly, planSettlement, selectionLimitText, settleList, settleRoster, shortfallText,
} from '@/domain';
import type { Expense, Id, Settlement } from '@/domain';
import { useLedger } from '@/state';
import { Banner, Button, Card, Chip, ChipGroup, EmptyState, cx } from '@/ui';
import { PageSkeleton, RequireLedger, type ReadyLedger } from '../../_components';
import { peopleManText, useSettleActions } from '../../_components/SettlementCard';
import { ExpenseDialog } from '../../history/_expenses/ExpenseDialog';
import { HashTarget } from '../../_components/HashTarget';
import styles from './settle.module.css';
import { MonthBlock } from './SettleRows';
import { SideColumn } from './SettleSide';

/**
 * '/plan/settle' 정산 (PLAN 4-9). 이벤트 화면 한 줄 요약의 [정산하기]로 열어요. 머리: [‹ 이벤트] · '정산 · 11/21'(정산일).
 * - 왼쪽: 이벤트통장 기록 · 줄 돈 · 지급한 청구를 달마다 한 목록으로 (오래된 달 · 오래된 것 먼저: 먼저 줘야 할 돈이 위에). [줄 돈만 · 전체 기록] · [전체 · 사람] 필터.
 *   달 머리 '10월 · 합계 128만 · 줄 돈 55만' + 모두 고르기(일부 = 중간 상태), 줄 돈이 없는 달은 '다 정리됨'(전체 기록에서 접힌 채).
 *   전체 기록을 열면 위에 접힌 달이 있을 때 줄 돈이 있는 가장 오래된 달로 스크롤해요.
 *   줄마다 날짜 · 이름(여행에 묶였으면 보라 '✈ 여행 이름' → 여행 화면) · 누가 냈는지 · 상태(줄 돈 / 지급함 / 저수지에서 빌려 줌 / 그냥 지출) · 금액. 이름을 누르면 지출 창.
 *   지급한 줄은 [지급 취소], 빌린 줄은 [금액 고치기]를 그 자리에서
 * - 오른쪽(데스크톱은 따라오는 열, 폰은 맨 위 한 줄로 접힘): 줄 수 있는 돈 · 사람별 · 저수지 갚을 돈(#loan, 갚은 기록 · 금액 고치기)
 * - 아래 고정 막대: '2건 · 15만 · 기쁜 15만' [저수지에서 빌려 지급] [15만 지급]. [○ 지급]은 줄 수 있는 돈 안에 드는 것만,
 *   넘는 이벤트통장 청구는 [저수지에서 빌려 지급]으로만. 줄 수 있는 돈이 0 이면 [○ 지급]은 이유와 함께 막아요
 * - #paid 로 들어오면 전체 기록, #loan 이면 저수지 기록을 펼친 채로
 */
export function SettleScreen() {
  return (
    <div className={styles.page}>
      <SettleHeader />
      <RequireLedger skeleton={<PageSkeleton withHeader={false} label="정산을 불러오는 중이에요" />}>
        {(l) => <SettleBody ledger={l} />}
      </RequireLedger>
    </div>
  );
}

function SettleHeader() {
  const s = useLedger().settlement;
  return (
    <header className={styles.header}>
      <Button href="/plan" variant="ghost" icon="chevron-left" className={styles.back}>
        이벤트
      </Button>
      <h1 className={styles.title}>{s ? `정산 · ${formatShortDate(s.date)}` : '정산'}</h1>
    </header>
  );
}

const currentHash = () => (typeof window === 'undefined' ? '' : window.location.hash);

function SettleBody({ ledger }: { ledger: ReadyLedger }) {
  const s = ledger.settlement;
  if (!s) {
    return (
      <Card as="section" aria-label="정산">
        <EmptyState icon="receipt" title="정산할 수 없어요" description="이벤트통장이 있어야 정산할 수 있어요." />
      </Card>
    );
  }
  return (
    <>
      <SettleContent ledger={ledger} s={s} />
      <HashTarget />
    </>
  );
}

type View = 'due' | 'all';

function SettleContent({ ledger, s }: { ledger: ReadyLedger; s: Settlement }) {
  const data = ledger.data;
  const baseYear = Number(ledger.today.slice(0, 4));
  const { busy, run } = useSettleActions();
  const roster = useMemo(() => settleRoster(s), [s]);
  const defaults = useMemo(() => defaultSettlementSelection(s), [s]);
  const months = useMemo(() => settleList(data, s), [data, s]);
  const people = useMemo(() => ledgerPeople(data), [data]);
  const [view, setView] = useState<View>(() => (currentHash() === '#paid' ? 'all' : 'due'));
  const [person, setPerson] = useState<string | null>(null);
  const [picked, setPicked] = useState<Map<Id, boolean>>(() => new Map());
  const [editing, setEditing] = useState<Expense | null>(null);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const [summaryOpen, setSummaryOpen] = useState(() => currentHash() === '#loan');
  const [loanOpen, setLoanOpen] = useState(() => currentHash() === '#loan');

  // 같은 화면에서 주소의 # 만 바뀌어도 (#paid → 전체 기록, #loan → 저수지 기록 펼침)
  useEffect(() => {
    const go = () => {
      const h = window.location.hash;
      if (h === '#paid') setView('all');
      if (h === '#loan') {
        setSummaryOpen(true);
        setLoanOpen(true);
      }
    };
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, []);

  const allIds = useMemo(() => roster.flatMap((p) => p.items.map((i) => i.claim.expense.id)), [roster]);
  const isOn = (id: Id) => picked.get(id) ?? defaults.has(id);
  const setMany = (ids: Id[], on: boolean) =>
    setPicked((m) => {
      const next = new Map(m);
      for (const id of ids) next.set(id, on);
      return next;
    });
  const selected = allIds.filter(isOn);
  const plan = planSettlement(data, s, selected);
  const check = checkSettlementSelection(data, s, selected);
  const canBorrow = s.reservoirAccountId !== null;

  const filtered = filterSettleList(data, months, person);
  const shown = view === 'due' ? pendingOnly(filtered) : filtered;
  const visibleIds = shown.flatMap((m) => m.rows.filter((r) => r.item).map((r) => r.expense.id));
  const monthsRef = useRef<HTMLUListElement>(null);
  /** 전체 기록에서 처음 펼쳐진 달 (줄 돈이 있는 가장 오래된 달). 위에 접힌 달이 없으면 null */
  const firstDue = view === 'all' ? shown.findIndex((m) => m.pendingCount > 0) : -1;
  const scrollMonth = firstDue > 0 ? shown[firstDue]!.month : null;
  const scrolled = useRef<string | null>(null);

  // 전체 기록을 열면 (처음 들어올 때 포함) 오래된 다 정리된 달은 접힌 채 두고, 줄 돈이 있는 첫 달로 스크롤해요
  useEffect(() => {
    if (view !== 'all') {
      scrolled.current = null;
      return;
    }
    if (!scrollMonth || scrolled.current !== null) return;
    scrolled.current = scrollMonth;
    const el = monthsRef.current?.querySelector<HTMLElement>(`[data-month="${scrollMonth}"]`);
    el?.scrollIntoView?.({ block: 'start' });
  }, [view, scrollMonth]);

  /** [○ 지급]: 지급할 수 있는 돈 안에 드는 것만 (넘는 이벤트통장 청구는 남겨 둬요) */
  const payWithin = () => {
    const { settle, borrow } = plan;
    const n = settle.length + borrow.length;
    const total = plan.claims.filter((c) => !plan.over.includes(c.expense.id)).reduce((t, c) => t + c.amount, 0);
    const message =
      borrow.length > 0
        ? `고른 ${n}건 ${formatWon(total)}을 지급했다고 기록했어요 (저수지에서 빌린 ${borrow.length}건 포함)`
        : `고른 ${n}건 ${formatWon(total)}을 지급했다고 기록했어요`;
    return run(
      'pay',
      async () => {
        if (settle.length > 0) await ledger.settleClaims(settle);
        if (borrow.length > 0) await ledger.borrowReservoirClaims(borrow);
        const left = new Map<Id, boolean>();
        for (const id of plan.over) left.set(id, true);
        setPicked(left);
      },
      async () => {
        if (borrow.length > 0) await ledger.undoReservoirClaims(borrow, 'borrowed');
        if (settle.length > 0) await ledger.unsettleClaims(settle);
      },
      message,
    );
  };

  /** [저수지에서 빌려 지급]: 안에 드는 것은 그대로 지급하고, 넘는 이벤트통장 청구만 저수지에서 빌려 지급 */
  const payBorrow = () => {
    const { settle, over, borrow } = plan;
    const n = plan.claims.length;
    return run(
      'borrow',
      async () => {
        if (settle.length > 0) await ledger.settleClaims(settle);
        if (over.length > 0) await ledger.borrowAndSettleClaims(over);
        if (borrow.length > 0) await ledger.borrowReservoirClaims(borrow);
        setPicked(new Map());
      },
      async () => {
        if (borrow.length > 0) await ledger.undoReservoirClaims(borrow, 'borrowed');
        const rest = [...settle, ...over];
        if (rest.length > 0) await ledger.unsettleClaims(rest);
      },
      `고른 ${n}건을 지급하고 넘는 ${formatWon(plan.excess)}은 저수지에서 빌렸다고 기록했어요`,
    );
  };

  const borrowTotal = s.reservoirLoan
    .flatMap((g) => g.claims)
    .filter((c) => plan.borrow.includes(c.expense.id))
    .reduce((t, c) => t + c.amount, 0);
  const limitText = selectionLimitText(s, plan, canBorrow);
  const withinCount = plan.settle.length + plan.borrow.length;
  const payAmount = plan.total - plan.excess;
  // 지급할 수 있는 돈이 0 인데 이벤트통장 청구를 골랐으면 [○ 지급]은 막아요 (저수지에서 빌려서만 줄 수 있어요)
  const payBlocked = !plan.fits && s.payable === 0;
  const payReason = payBlocked ? '이벤트통장에서 줄 수 있는 돈이 없어서 지급할 수 없어요' : null;
  const payReasonId = useId();
  const shortText = shortfallText(s);
  const pickedPeople = peopleManText(groupByPerson(plan.claims));

  return (
    <>
      {shortText ? (
        <Banner tone="warning" title={shortText}>
          들어올 돈이 먼저 모자란 돈을 메워요
        </Banner>
      ) : null}

      <div className={styles.layout}>
        <SideColumn
          s={s}
          baseYear={baseYear}
          today={ledger.today}
          picked={{ count: plan.claims.length, total: plan.total, eventWithin: check.withinEventTotal, eventTotal: check.eventTotal, excess: check.excess, fits: check.fits }}
          open={summaryOpen}
          onOpen={setSummaryOpen}
          loanOpen={loanOpen}
          onLoanOpen={setLoanOpen}
        />

        <Card as="section" id="paid" aria-labelledby="settle-list-title" className={styles.listCard}>
          <h2 id="settle-list-title" className={styles.srOnly}>
            정산 목록
          </h2>
          <div className={styles.filters}>
            <ChipGroup label="보기">
              <Chip selected={view === 'due'} onClick={() => setView('due')}>
                줄 돈만
              </Chip>
              <Chip selected={view === 'all'} onClick={() => setView('all')}>
                전체 기록
              </Chip>
            </ChipGroup>
            {people.length > 0 ? (
              <ChipGroup label="사람">
                <Chip selected={person === null} onClick={() => setPerson(null)}>
                  전체
                </Chip>
                {people.map((p) => (
                  <Chip key={p.email} selected={person === p.email.toLowerCase()} onClick={() => setPerson(p.email.toLowerCase())}>
                    {p.name}
                  </Chip>
                ))}
              </ChipGroup>
            ) : null}
          </div>
          {visibleIds.length > 0 ? (
            <div className={styles.bulk}>
              <Button variant="ghost" onClick={() => setMany(visibleIds, true)} disabled={visibleIds.every(isOn)}>
                {person ? '이 사람 모두 고르기' : '전체 선택'}
              </Button>
              <Button variant="ghost" onClick={() => setMany(visibleIds, false)} disabled={!visibleIds.some(isOn)}>
                선택 해제
              </Button>
            </div>
          ) : null}
          <p className={styles.note}>
            처음엔 지난달에 못 준 것부터, 그다음 오래된 것부터 줄 수 있는 돈 안에서 골라 뒀어요. 이름을 누르면 자세히 볼 수 있어요
          </p>

          {shown.length === 0 ? (
            <div className={styles.empty}>
              <p>{view === 'due' ? (allIds.length === 0 ? '지금 줄 돈이 없어요' : '이 사람에게 줄 돈은 없어요') : '기록이 없어요'}</p>
              {view === 'due' ? (
                <Button variant="outline" onClick={() => setView('all')}>
                  전체 기록 보기
                </Button>
              ) : null}
            </div>
          ) : (
            <ul ref={monthsRef} className={styles.months} aria-label="달별 기록">
              {shown.map((m) => (
                <MonthBlock
                  key={m.month}
                  m={m}
                  data={data}
                  s={s}
                  baseYear={baseYear}
                  open={m.pendingCount > 0 || opened.has(m.month)}
                  onToggle={() =>
                    setOpened((o) => {
                      const next = new Set(o);
                      if (next.has(m.month)) next.delete(m.month);
                      else next.add(m.month);
                      return next;
                    })
                  }
                  isOn={isOn}
                  setMany={setMany}
                  onOpen={setEditing}
                />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {allIds.length > 0 ? (
        <>
          <div className={styles.barSpace} aria-hidden />
          <div className={cx(styles.bar, !plan.fits && styles.barOver)} role="region" aria-label="고른 항목">
            <div className={styles.barInner}>
              <div className={styles.barText} aria-live="polite">
                <span>
                  <strong data-testid="settle-picked">
                    {plan.claims.length}건 · {formatMan(plan.total)}
                  </strong>
                  {pickedPeople ? <span className={styles.barPeople}> · {pickedPeople}</span> : null}
                </span>
                {limitText ? <span className={styles.overText}>{limitText}</span> : null}
                {payReason ? (
                  <span id={payReasonId} className={styles.overText}>
                    {payReason}
                  </span>
                ) : null}
                {plan.borrow.length > 0 ? (
                  <span>저수지에서 빌려 지급 {plan.borrow.length}건 {formatWon(borrowTotal)} 포함 · 저수지에 갚을 돈이 돼요</span>
                ) : null}
                {visibleIds.length < selected.length ? <span>필터에 안 보이는 고른 항목도 함께 지급해요</span> : null}
              </div>
              <div className={styles.barActions}>
                {canBorrow ? (
                  <Button
                    variant={plan.fits ? 'outline' : 'primary'}
                    loading={busy === 'borrow'}
                    disabled={plan.fits || (busy !== null && busy !== 'borrow')}
                    onClick={() => void payBorrow()}
                    // 좁은 화면은 '빌려 지급'으로 줄여 보여도 이름은 그대로
                    aria-label="저수지에서 빌려 지급"
                  >
                    <span className={styles.longLabel}>저수지에서 빌려 지급</span>
                    <span className={styles.shortLabel}>빌려 지급</span>
                  </Button>
                ) : null}
                <Button
                  icon="check"
                  variant={plan.fits ? 'primary' : 'outline'}
                  loading={busy === 'pay'}
                  disabled={withinCount === 0 || payBlocked || (busy !== null && busy !== 'pay')}
                  aria-describedby={payReason ? payReasonId : undefined}
                  onClick={() => void payWithin()}
                  data-testid="settle-pay"
                >
                  {`${formatMan(payAmount)} 지급`}
                </Button>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {editing ? <ExpenseDialog expense={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

/* ───────── 왼쪽: 달마다 ───────── */
