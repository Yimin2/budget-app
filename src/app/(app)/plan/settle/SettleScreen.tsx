'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  checkSettlementSelection,
  defaultSettlementSelection,
  filterSettleList,
  formatMan,
  formatMonthKo,
  formatShortDate,
  formatWon,
  groupByPerson,
  hasBatchim,
  isCarriedOverClaim,
  ledgerPeople,
  loanPayoff,
  loanRecords,
  monthOf,
  pendingOnly,
  planSettlement,
  selectionLimitText,
  settleExplanation,
  settleList,
  settlePeopleDue,
  settleRoster,
  shortfallText,
} from '@/domain';
import type { Expense, Id, LedgerData, Settlement, SettleMonth, SettleRow } from '@/domain';
import { useLedger } from '@/state';
import { Badge, Banner, Button, Card, Chip, ChipGroup, EmptyState, ProgressBar, cx, type Tone } from '@/ui';
import { PageSkeleton, RequireLedger, type ReadyLedger } from '../../_components';
import { peopleManText, useSettleActions } from '../../_components/SettlementCard';
import { ExpenseDialog } from '../../history/_expenses/ExpenseDialog';
import { HashTarget } from '../../_components/HashTarget';
import { ExpandButton } from '../../_components/ExpandButton';
import { readRepayMonths } from '../CompromisePanel';
import { LoanAmountForm, LoanRecords, loanRecordName, loanSummaryText, useLoanActions } from '../LoanCard';
import styles from './settle.module.css';

/**
 * '/plan/settle' 정산 (PLAN 4-9). 이벤트 화면 한 줄 요약의 [정산하기]로 열어요. 머리: [‹ 이벤트] · '정산 · 11/21'(정산일).
 * - 왼쪽: 이벤트통장 기록 · 줄 돈 · 지급한 청구를 달마다 한 목록으로 (최근 달 먼저). [줄 돈만 · 전체 기록] · [전체 · 사람] 필터.
 *   달 머리 '10월 · 합계 128만 · 줄 돈 55만' + 모두 고르기(일부 = 중간 상태), 줄 돈이 없는 달은 '다 정리됨'(전체 기록에서 접힌 채).
 *   줄마다 날짜 · 이름 · 누가 냈는지 · 상태(줄 돈 / 지급함 / 저수지에서 빌려 줌 / 그냥 지출) · 금액. 이름을 누르면 지출 창.
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

function expenseTitle(data: LedgerData, e: Expense): string {
  const memo = e.memo.trim();
  if (memo) return memo;
  const cat = e.categoryId ? data.categories.find((x) => x.id === e.categoryId)?.name : undefined;
  return cat ?? '지출';
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
            <ul className={styles.months} aria-label="달별 기록">
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
                  >
                    저수지에서 빌려 지급
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

/** 체크박스 (indeterminate 지원) */
function TriCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" className={className} checked={checked} onChange={onChange} aria-label={label} />;
}

function MonthBlock({
  m,
  data,
  s,
  baseYear,
  open,
  onToggle,
  isOn,
  setMany,
  onOpen,
}: {
  m: SettleMonth;
  data: LedgerData;
  s: Settlement;
  baseYear: number;
  open: boolean;
  onToggle: () => void;
  isOn: (id: Id) => boolean;
  setMany: (ids: Id[], on: boolean) => void;
  onOpen: (e: Expense) => void;
}) {
  const label = formatMonthKo(m.month, baseYear);
  const listId = useId();
  const pendingIds = m.rows.filter((r) => r.item).map((r) => r.expense.id);
  const on = pendingIds.filter(isOn).length;
  const all = pendingIds.length > 0 && on === pendingIds.length;
  return (
    <li className={styles.month}>
      <div className={styles.monthHead}>
        <h3 className={styles.monthTitle}>
          {label}
          <span className={styles.monthSum}>
            {' '}
            · 합계 {formatMan(m.total)} · {m.pendingCount > 0 ? `줄 돈 ${formatMan(m.pendingTotal)}` : '다 정리됨'}
          </span>
        </h3>
        {pendingIds.length > 0 ? (
          <label className={styles.monthAll}>
            모두 고르기
            <TriCheckbox
              className={styles.check}
              checked={all}
              indeterminate={on > 0 && !all}
              onChange={() => setMany(pendingIds, !all)}
              label={`${label} 모두 고르기`}
            />
          </label>
        ) : (
          <ExpandButton open={open} onToggle={onToggle} controls={listId} openLabel="펼치기" closeLabel="접기" label={label} />
        )}
      </div>
      {open ? (
        <ul id={listId} className={styles.rows} aria-label={`${label} 기록`}>
          {m.rows.map((r) => (
            <Row
              key={r.expense.id}
              r={r}
              data={data}
              s={s}
              baseYear={baseYear}
              on={isOn(r.expense.id)}
              onToggle={() => setMany([r.expense.id], !isOn(r.expense.id))}
              onOpen={() => onOpen(r.expense)}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

const STATUS_BADGE: Record<SettleRow['status'], { text: string; tone: Tone }> = {
  claimPending: { text: '줄 돈', tone: 'warning' },
  claimPaid: { text: '지급함', tone: 'success' },
  borrowed: { text: '저수지에서 빌려 줌', tone: 'info' },
  plain: { text: '그냥 지출', tone: 'neutral' },
};

const paidByText = (name: string) => `${name}${hasBatchim(name) ? '이' : '가'} 냄`;

function Row({
  r,
  data,
  s,
  baseYear,
  on,
  onToggle,
  onOpen,
}: {
  r: SettleRow;
  data: LedgerData;
  s: Settlement;
  baseYear: number;
  on: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const ledger = useLedger();
  const { act, lock } = useLoanActions();
  const [editingLoan, setEditingLoan] = useState(false);
  const e = r.expense;
  const title = expenseTitle(data, e);
  const badge = STATUS_BADGE[r.status];
  const payer = (e.paidBy ?? '').trim();
  const pending = r.item !== null;

  const meta: string[] = [];
  const notes: { text: string; warn?: boolean }[] = [];
  if (pending) {
    const item = r.item!;
    if (payer) meta.push(paidByText(payer));
    if ((item.kind === 'pay' || item.kind === 'carry') && isCarriedOverClaim(s, item.claim)) notes.push({ text: '지난달부터', warn: true });
    if (item.kind === 'borrow') notes.push({ text: '저수지에서 빌려 지급' });
    if (item.kind === 'reservoir') notes.push({ text: '저수지에서 지급' });
    if (item.kind === 'carry') {
      const est = s.carry.find((g) => g.name === item.claim.payer)?.estimate ?? null;
      notes.push({ text: est ? `다음 달로 넘어가요 · ${formatMonthKo(est, baseYear)}쯤` : '다음 달로 넘어가요' });
    }
    if (item.kind === 'upcoming') notes.push({ text: `정산일 ${formatShortDate(item.claim.due)}` });
    if (!e.claimDue) notes.push({ text: '날짜 추정' });
  } else if (r.paid) {
    meta.push(r.paid.payer || payer, `${formatShortDate(r.paid.date)} 지급`);
  } else if (r.loan) {
    meta.push(`${formatShortDate(r.loan.transfer.date)} 빌림`);
  } else {
    meta.push(e.accountId === s.eventAccountId ? '이벤트통장' : (data.accounts.find((a) => a.id === e.accountId)?.name ?? ''));
  }
  const metaText = meta.filter(Boolean).join(' · ');
  const loanName = r.loan ? loanRecordName(data, { kind: r.loan.kind, transfer: r.loan.transfer, expenseId: r.loan.expenseId }) : '';

  return (
    <li className={cx(styles.row, !pending && styles.rowMuted)}>
      {pending ? (
        <input type="checkbox" className={styles.check} checked={on} onChange={onToggle} aria-label={`${title} ${formatWon(r.amount)} 고르기`} />
      ) : (
        <span className={cx(styles.dot, styles[`dot_${r.status}`])} aria-hidden />
      )}
      <span className={styles.date}>{formatShortDate(e.date)}</span>
      <div className={styles.main}>
        <button type="button" className={styles.titleBtn} onClick={onOpen} aria-label={`${title} 자세히 보기`}>
          {title}
        </button>
        <span className={styles.meta}>
          <span className={styles.metaDate}>{formatShortDate(e.date)} · </span>
          {metaText}
          {notes.map((n) => (
            <span key={n.text} className={cx(n.warn && styles.warnNote)}>
              {' · '}
              {n.text}
            </span>
          ))}
        </span>
      </div>
      <span className={styles.badge}>
        <Badge tone={badge.tone} variant="soft" size="sm" dot={false}>
          {badge.text}
        </Badge>
      </span>
      <span className={cx(styles.amount, pending && styles.amountStrong)}>{formatMan(r.amount)}</span>
      {!pending && (r.paid || r.loan) ? (
        <div className={styles.actions}>
          {editingLoan && r.loan ? (
            <LoanAmountForm name={loanName} transferId={r.loan.transfer.id} amount={r.loan.transfer.amount} onDone={() => setEditingLoan(false)} />
          ) : (
            <>
              {r.paid ? (
                <Button
                  variant="ghost"
                  className={styles.actionBtn}
                  {...lock(`unpay:${e.id}`)}
                  onClick={() =>
                    void act(`unpay:${e.id}`, () => ledger.undoClaimPayments([e.id]), `${r.paid!.payer}에게 ${formatWon(r.paid!.amount)} 지급한 기록을 취소했어요`)
                  }
                  aria-label={`${r.paid.payer} ${title} ${formatWon(r.paid.amount)} 지급 취소`}
                >
                  지급 취소
                </Button>
              ) : null}
              {r.loan ? (
                <Button variant="ghost" className={styles.actionBtn} onClick={() => setEditingLoan(true)} aria-label={`${loanName} 빌린 금액 고치기`}>
                  금액 고치기
                </Button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

/* ───────── 오른쪽: 줄 수 있는 돈 · 사람별 · 저수지 ───────── */

interface Picked {
  count: number;
  total: number;
  /** 고른 이벤트통장 청구 중 줄 수 있는 돈 안에 드는 합 */
  eventWithin: number;
  eventTotal: number;
  excess: number;
  fits: boolean;
}

function SideColumn({
  s,
  baseYear,
  today,
  picked,
  open,
  onOpen,
  loanOpen,
  onLoanOpen,
}: {
  s: Settlement;
  baseYear: number;
  today: string;
  picked: Picked;
  open: boolean;
  onOpen: (open: boolean) => void;
  loanOpen: boolean;
  onLoanOpen: (open: boolean) => void;
}) {
  const bodyId = useId();
  return (
    <aside className={cx(styles.side, open && styles.sideOpen)} aria-label="정산 요약">
      <button type="button" className={styles.sideToggle} aria-expanded={open} aria-controls={bodyId} onClick={() => onOpen(!open)}>
        <span>
          줄 수 있는 돈 <strong>{formatMan(s.payable)}</strong> · 고른 <strong>{formatMan(picked.total)}</strong>
        </span>
        <span className={styles.sideToggleHint}>{open ? '접기' : '자세히'}</span>
      </button>
      <div id={bodyId} className={styles.sideBody}>
        <PayableCard s={s} baseYear={baseYear} picked={picked} />
        <PeopleCard s={s} baseYear={baseYear} />
        <LoanSideCard s={s} baseYear={baseYear} today={today} open={loanOpen} onOpen={onLoanOpen} />
      </div>
    </aside>
  );
}

function PayableCard({ s, baseYear, picked }: { s: Settlement; baseYear: number; picked: Picked }) {
  const titleId = useId();
  const when = s.asOf === s.date ? `이벤트통장 · ${formatShortDate(s.date)} 적립 포함` : '이벤트통장 · 오늘 잔액 기준';
  const left = Math.max(0, s.payable - picked.eventWithin);
  return (
    <Card as="section" aria-labelledby={titleId} padding="sm" className={styles.sideCard}>
      <h2 id={titleId} className={styles.sideTitle}>
        줄 수 있는 돈 <span className={styles.sideHint}>({when})</span>
      </h2>
      <p className={styles.big}>{formatMan(s.payable)}</p>
      <ProgressBar
        value={Math.min(picked.eventTotal, Math.max(s.payable, 1))}
        max={Math.max(s.payable, picked.eventTotal, 1)}
        tone={picked.fits ? 'primary' : 'danger'}
        track="subtle"
        label="고른 돈 / 줄 수 있는 돈"
        valueText={`${formatWon(s.payable)} 중 ${formatWon(picked.eventTotal)}`}
      />
      <dl className={styles.stats}>
        <div>
          <dt>고른 것 {picked.count}건</dt>
          <dd>{formatMan(picked.total)}</dd>
        </div>
        {picked.fits ? (
          <div>
            <dt>남는 돈</dt>
            <dd className={styles.good}>{formatMan(left)}</dd>
          </div>
        ) : (
          <div>
            <dt>넘는 돈</dt>
            <dd className={styles.bad}>{formatMan(picked.excess)}</dd>
          </div>
        )}
        {s.oldPay > 0 ? (
          <div className={styles.mutedStat}>
            <dt>지난달에 못 준 돈 (먼저)</dt>
            <dd>{formatMan(s.oldPay)}</dd>
          </div>
        ) : null}
        <div className={styles.mutedStat}>
          <dt>이번 달 일정 몫 (빼 둠)</dt>
          <dd>{formatMan(s.reserved)}</dd>
        </div>
      </dl>
      <p className={styles.explain} data-testid="settle-explain">
        {settleExplanation(s)}
      </p>
      {s.plannedShort ? (
        <p className={styles.shortNote} role="status">
          이 돈을 먼저 돌려주면 {formatMonthKo(s.plannedShort.month, baseYear)} 일정에 {formatWon(s.plannedShort.amount)}이 모자라요
        </p>
      ) : null}
      {s.carry.length > 0 ? (
        <div className={styles.carry}>
          <strong>다음 달로 넘어가요 · {formatMan(s.carryTotal)}</strong>
          <ul>
            {s.carry.map((g) => (
              <li key={g.name}>
                {g.name} {formatMan(g.amount)} · {g.estimate ? `${formatMonthKo(g.estimate, baseYear)}쯤` : '12개월 안에는 어려워요'}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function PeopleCard({ s, baseYear }: { s: Settlement; baseYear: number }) {
  const titleId = useId();
  const people = settlePeopleDue(s);
  if (people.length === 0) return null;
  return (
    <Card as="section" aria-labelledby={titleId} padding="sm" className={styles.sideCard}>
      <div className={styles.sideHead}>
        <h2 id={titleId} className={styles.sideTitle}>
          사람별
        </h2>
        <span className={styles.sideHint}>줄 돈</span>
      </div>
      <ul className={styles.peopleList} aria-label="사람별 줄 돈">
        {people.map((p) => (
          <li key={p.name}>
            <span>{p.name}</span>
            <span className={styles.num}>
              {formatMan(p.amount)}
              {p.overdue > 0 && p.overdueMonth ? (
                <span className={styles.sideHint}>
                  {' '}
                  (못 준 돈{p.overdue < p.amount ? ` ${formatMan(p.overdue)}` : ''} · {formatMonthKo(p.overdueMonth, baseYear)})
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function LoanSideCard({
  s,
  baseYear,
  today,
  open,
  onOpen,
}: {
  s: Settlement;
  baseYear: number;
  today: string;
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  const ledger = useLedger();
  const { act, lock } = useLoanActions();
  const titleId = useId();
  const bodyId = useId();
  const [months] = useState(readRepayMonths);
  if (!s.reservoirAccountId) return null;
  const { loan } = s;
  const candidates = ledger.loanCandidates;
  const records = loanRecords(loan);
  if (records.length === 0 && candidates.length === 0 && loan.balance <= 0) return null;
  const payoff = loanPayoff(loan.balance, months, monthOf(today));
  return (
    <Card as="section" id="loan" aria-labelledby={titleId} padding="sm" className={styles.sideCard}>
      <div className={styles.sideHead}>
        <h2 id={titleId} className={styles.sideTitle}>
          저수지 갚을 돈
        </h2>
        <strong className={styles.num}>{formatMan(loan.balance)}</strong>
      </div>
      {payoff ? (
        <p className={styles.sideNote} data-testid="loan-payoff">
          매달 {formatMan(payoff.monthly)}씩 · {formatMonthKo(payoff.endMonth, baseYear)}에 끝 · 빌린 건 목록에서 &lsquo;저수지에서 빌려 줌&rsquo;으로 보여요
        </p>
      ) : null}
      <p className={styles.sideNote} data-testid="loan-section-summary">
        {loanSummaryText(loan)}
        {candidates.length > 0 ? ` · 바꿀 수 있는 지출 ${candidates.length}건` : ''}
      </p>
      {loan.repaidThisMonth ? (
        <div className={styles.lineRow}>
          <p>이번 달 {formatMan(loan.repaidThisMonth.amount)} 갚았어요</p>
          <Button
            variant="ghost"
            {...lock('undoRepay')}
            onClick={() => void act('undoRepay', () => ledger.undoRepayLoan(), '갚은 기록을 되돌렸어요')}
            aria-label={`이번 달 ${formatWon(loan.repaidThisMonth.amount)} 갚은 기록 되돌리기`}
          >
            되돌리기
          </Button>
        </div>
      ) : null}
      {s.repay ? (
        <div className={styles.lineRow}>
          <p>이번 달 {formatMan(s.repay.amount)} 갚기</p>
          <Button
            icon="check"
            {...lock('repay')}
            onClick={() =>
              void act('repay', () => ledger.repayLoan(s.repay!.amount), `저수지에 ${formatWon(s.repay!.amount)} 갚았다고 기록했어요`, () =>
                ledger.undoRepayLoan(),
              )
            }
            aria-label={`저수지에 ${formatWon(s.repay.amount)} 갚았어요`}
          >
            갚았어요
          </Button>
        </div>
      ) : null}
      {records.length > 0 || candidates.length > 0 ? (
        <>
          <ExpandButton open={open} onToggle={() => onOpen(!open)} controls={bodyId} openLabel="갚은 기록 · 금액 고치기" closeLabel="접기" label="저수지 기록" />
          {open ? (
            <div id={bodyId} className={styles.loanBody}>
              <LoanRecords />
            </div>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
