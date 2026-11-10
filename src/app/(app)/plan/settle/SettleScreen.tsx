'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  defaultSettlementSelection,
  formatDateKo,
  formatMan,
  formatMonthKo,
  formatShortDate,
  formatWon,
  isCarriedOverClaim,
  planSettlement,
  selectionLimitText,
  settleExplanation,
  settleRoster,
  shortfallText,
} from '@/domain';
import type { Expense, Id, LedgerData, PendingClaim, Settlement, SettleItem, SettleItemKind, SettlePerson } from '@/domain';
import { Badge, Banner, Button, Card, EmptyState, Icon, PageHeader, cx, isIconName } from '@/ui';
import { PageSkeleton, RequireLedger, type ReadyLedger } from '../../_components';
import { useSettleActions } from '../../_components/SettlementCard';
import { ExpenseDialog } from '../../history/_expenses/ExpenseDialog';
import { HashTarget } from '../../_components/HashTarget';
import { LoanSection } from '../LoanCard';
import { PaidSection } from './PaidSection';
import claims from '../../_components/claims.module.css';
import styles from './settle.module.css';

/**
 * '/plan/settle' 이번 달 정산 (PLAN 4-9). 이벤트 화면 한 줄 요약의 [정산하기]로 열어요.
 * 지급할 수 있는 돈과 어떻게 셌는지 → 사람마다 항목 목록(전체 선택 · 사람 선택 · 항목 선택) → 고른 합 막대 · [지급했어요].
 * 지난달부터 못 준 청구를 먼저(이번 달 일정보다도 먼저) 지급할 수 있는 돈에 넣어요 ('지난달부터' 표시).
 * [지급했어요]는 이벤트통장 청구 중 지급할 수 있는 돈 안에 드는 것만 지급하고, 넘는 것은 [저수지에서 빌려 지급]으로만 줄 수 있어요.
 * 지급할 수 있는 돈이 0 이면 [지급했어요]는 이유와 함께 막고 [저수지에서 빌려 지급]만 둬요. 이벤트통장이 음수면 맨 위에 모자란 돈을 알려요.
 * 저수지 돈으로 낸 이벤트 청구는 사람 목록 안에 '저수지에서 빌려 지급' 표시로 함께 있어요 (저수지는 받는 사람이 아니에요).
 * 그 아래 '지급한 기록'(#paid, [지급 취소])과 맨 아래 '저수지' 칸(#loan: 빌리고 갚은 기록의 금액 고치기 · 취소, 하나씩 갚을 돈으로 바꾸기)이 있어요
 */
export function SettleScreen() {
  return (
    <div className={styles.page}>
      <PageHeader title="이번 달 정산" subtitle="고른 항목을 지급했다고 기록해요" backHref="/plan" backLabel="이벤트로" />
      <RequireLedger skeleton={<PageSkeleton withHeader={false} label="정산을 불러오는 중이에요" />}>
        {(l) => <SettleBody ledger={l} />}
      </RequireLedger>
    </div>
  );
}

function claimTitle(data: LedgerData, c: PendingClaim): string {
  const memo = c.expense.memo.trim();
  if (memo) return memo;
  const cat = c.expense.categoryId ? data.categories.find((x) => x.id === c.expense.categoryId)?.name : undefined;
  return cat ?? '지출';
}

const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');

function SettleBody({ ledger }: { ledger: ReadyLedger }) {
  const s = ledger.settlement;
  if (!s) {
    return (
      <Card as="section" aria-label="이번 달 정산">
        <EmptyState icon="receipt" title="정산할 수 없어요" description="이벤트통장이 있어야 정산할 수 있어요." />
      </Card>
    );
  }
  return (
    <>
      <HashTarget />
      <SettleContent ledger={ledger} s={s} />
      <PaidSection />
      <LoanSection />
    </>
  );
}

function SettleContent({ ledger, s }: { ledger: ReadyLedger; s: Settlement }) {
  const data = ledger.data;
  const baseYear = Number(ledger.today.slice(0, 4));
  const listTitleId = useId();
  const { busy, run } = useSettleActions();
  const roster = useMemo(() => settleRoster(s), [s]);
  const defaults = useMemo(() => defaultSettlementSelection(s), [s]);
  const [picked, setPicked] = useState<Map<Id, boolean>>(() => new Map());
  const [editing, setEditing] = useState<Expense | null>(null);

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
  const canBorrow = s.reservoirAccountId !== null;

  if (roster.length === 0) {
    return (
      <Card as="section" aria-label="이번 달 정산">
        <EmptyState
          icon="check"
          title="이번 달 줄 돈이 없어요"
          description="개인 돈으로 낸 청구가 생기면 여기서 골라 지급해요."
          action={
            <Button href="/plan" variant="outline">
              이벤트로 돌아가기
            </Button>
          }
        />
      </Card>
    );
  }

  /** [지급했어요]: 지급할 수 있는 돈 안에 드는 것만 (넘는 이벤트통장 청구는 남겨 둬요) */
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
  // 지급할 수 있는 돈이 0 인데 이벤트통장 청구를 골랐으면 [지급했어요]는 막아요 (저수지에서 빌려서만 줄 수 있어요)
  const payBlocked = !plan.fits && s.payable === 0;
  const payReason = payBlocked ? '이벤트통장에서 줄 수 있는 돈이 없어서 지급할 수 없어요' : null;
  const payReasonId = `${listTitleId}-pay-reason`;
  const shortText = shortfallText(s);

  return (
    <>
      {shortText ? (
        <Banner tone="warning" title={shortText}>
          들어올 돈이 먼저 모자란 돈을 메워요
        </Banner>
      ) : null}
      <PayableCard s={s} baseYear={baseYear} />

      <Card as="section" aria-labelledby={listTitleId} className={styles.listCard}>
        <div className={styles.listHead}>
          <h2 id={listTitleId} className="card-title">
            사람별 항목
          </h2>
          <div className={styles.bulk}>
            <Button variant="ghost" size="md" onClick={() => setMany(allIds, true)} disabled={selected.length === allIds.length}>
              전체 선택
            </Button>
            <Button variant="ghost" size="md" onClick={() => setMany(allIds, false)} disabled={selected.length === 0}>
              선택 해제
            </Button>
          </div>
        </div>
        <p className={claims.note}>
          처음엔 지난달에 못 준 것부터, 그다음 오래된 것부터 지급할 수 있는 돈 안에서 골라 뒀어요. 항목을 누르면 자세히 볼 수 있어요
        </p>
        <ul className={styles.people}>
          {roster.map((p) => (
            <PersonBlock
              key={p.name}
              person={p}
              data={data}
              s={s}
              baseYear={baseYear}
              isOn={isOn}
              onToggle={(id) => setMany([id], !isOn(id))}
              onPerson={(on) => setMany(p.items.map((i) => i.claim.expense.id), on)}
              onOpen={setEditing}
            />
          ))}
        </ul>
      </Card>

      <div className={cx(styles.totalBar, !plan.fits && styles.totalOver)} role="region" aria-label="고른 항목">
        <div className={styles.totalText} aria-live="polite">
          <strong>
            고른 {plan.claims.length}건 · {formatWon(plan.total)}
          </strong>
          {limitText ? <span className={styles.overText}>{limitText}</span> : null}
          {payReason ? (
            <span id={payReasonId} className={styles.overText}>
              {payReason}
            </span>
          ) : null}
          {plan.borrow.length > 0 ? (
            <span>저수지에서 빌려 지급 {plan.borrow.length}건 {formatWon(borrowTotal)} 포함 · 저수지에 갚을 돈이 돼요</span>
          ) : null}
        </div>
        <div className={styles.totalActions}>
          <Button
            icon="check"
            variant={plan.fits ? 'primary' : 'outline'}
            loading={busy === 'pay'}
            disabled={withinCount === 0 || payBlocked || (busy !== null && busy !== 'pay')}
            aria-describedby={payReason ? payReasonId : undefined}
            onClick={() => void payWithin()}
          >
            지급했어요
          </Button>
          {!plan.fits && canBorrow ? (
            <Button
              icon="arrow-right"
              loading={busy === 'borrow'}
              disabled={busy !== null && busy !== 'borrow'}
              onClick={() => void payBorrow()}
            >
              저수지에서 빌려 지급
            </Button>
          ) : null}
        </div>
      </div>

      {editing ? <ExpenseDialog expense={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

/** 지급할 수 있는 돈과 어떻게 셌는지, 다음 달로 넘어가는 돈 */
function PayableCard({ s, baseYear }: { s: Settlement; baseYear: number }) {
  const titleId = useId();
  const when = s.asOf === s.date ? `${formatDateKo(s.date, false)} 이벤트통장 잔액` : '오늘 이벤트통장 잔액';
  return (
    <Card
      as="section"
      aria-labelledby={titleId}
      title={<span id={titleId}>지급할 수 있는 돈</span>}
      aside={<span className={claims.asideDate}>정산일 {formatDateKo(s.date, false)}</span>}
    >
      <p className={claims.summaryLine}>
        지급할 수 있는 돈 <strong>{formatWon(s.payable)}</strong>
      </p>
      <p className={styles.explain} data-testid="settle-explain">
        {settleExplanation(s)}
      </p>
      <dl className={styles.calc}>
        <div>
          <dt>
            {when}
            {s.asOf === s.date ? ' (적립 포함)' : ''}
          </dt>
          <dd>{formatWon(s.balance)}</dd>
        </div>
        {s.oldPay > 0 ? (
          <div>
            <dt>지난달에 못 준 돈 (먼저 돌려줘요)</dt>
            <dd>{formatWon(s.oldPay)}</dd>
          </div>
        ) : null}
        {s.reserved > 0 ? (
          <div>
            <dt>이번 달 남은 일정 · 여행 · 할부</dt>
            <dd>−{formatWon(s.reserved)}</dd>
          </div>
        ) : null}
      </dl>
      {s.plannedShort ? (
        <p className={styles.shortNote} role="status">
          이 돈을 먼저 돌려주면 {formatMonthKo(s.plannedShort.month, baseYear)} 일정에 {formatWon(s.plannedShort.amount)}이 모자라요
        </p>
      ) : null}
      <p className={claims.note}>이벤트통장 청구만 이 돈과 견줘요. 생활비 통장 청구는 그 통장에서, 저수지 돈으로 낸 청구는 저수지에서 줘요</p>
      {s.carry.length > 0 ? (
        <div className={styles.carry}>
          <strong>다음 달로 넘어가요 · {formatWon(s.carryTotal)}</strong>
          <ul>
            {s.carry.map((g) => (
              <li key={g.name}>
                {g.name} {formatMan(g.amount)} ·{' '}
                {g.estimate ? `${formatMonthKo(g.estimate, baseYear)}쯤 지급할 수 있어요` : '12개월 안에는 어려워요'}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

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

const KIND_BADGE: Partial<Record<SettleItemKind, { text: string; tone: 'warning' | 'info' | 'neutral' }>> = {
  borrow: { text: '저수지에서 빌려 지급', tone: 'warning' },
  reservoir: { text: '저수지에서 지급', tone: 'info' },
  carry: { text: '다음 달로 넘어가요', tone: 'neutral' },
};

function PersonBlock({
  person,
  data,
  s,
  baseYear,
  isOn,
  onToggle,
  onPerson,
  onOpen,
}: {
  person: SettlePerson;
  data: LedgerData;
  s: Settlement;
  baseYear: number;
  isOn: (id: Id) => boolean;
  onToggle: (id: Id) => void;
  onPerson: (on: boolean) => void;
  onOpen: (e: Expense) => void;
}) {
  const on = person.items.filter((i) => isOn(i.claim.expense.id));
  const onSum = on.reduce((t, i) => t + i.claim.amount, 0);
  const all = on.length === person.items.length;
  const some = on.length > 0 && !all;
  const listId = safeId(`settle-${person.name}`);
  const estimateOf = (name: string) => s.carry.find((g) => g.name === name)?.estimate ?? null;
  return (
    <li className={styles.person}>
      <div className={styles.personHead}>
        <TriCheckbox
          className={claims.itemCheck}
          checked={all}
          indeterminate={some}
          onChange={() => onPerson(!all)}
          label={`${person.name} 모두 고르기`}
        />
        <span className={styles.personName}>
          <strong>{person.name}</strong>
          <span>
            {formatWon(onSum)}
            {onSum !== person.amount ? ` / ${formatWon(person.amount)}` : ''} · {on.length}/{person.items.length}건
          </span>
        </span>
      </div>
      <ul id={listId} className={claims.itemList} aria-label={`${person.name} 항목`}>
        {person.items.map((item) => (
          <ItemRow
            key={item.claim.expense.id}
            item={item}
            data={data}
            on={isOn(item.claim.expense.id)}
            onToggle={() => onToggle(item.claim.expense.id)}
            onOpen={() => onOpen(item.claim.expense)}
            s={s}
            estimate={item.kind === 'carry' ? estimateOf(person.name) : null}
            baseYear={baseYear}
          />
        ))}
      </ul>
    </li>
  );
}

function ItemRow({
  item,
  data,
  on,
  onToggle,
  onOpen,
  s,
  estimate,
  baseYear,
}: {
  item: SettleItem;
  data: LedgerData;
  on: boolean;
  onToggle: () => void;
  onOpen: () => void;
  s: Settlement;
  estimate: string | null;
  baseYear: number;
}) {
  const c = item.claim;
  const cat = c.expense.categoryId ? data.categories.find((x) => x.id === c.expense.categoryId) : undefined;
  const title = claimTitle(data, c);
  const badge = KIND_BADGE[item.kind];
  const carriedOver = (item.kind === 'pay' || item.kind === 'carry') && isCarriedOverClaim(s, c);
  return (
    <li className={cx(claims.item, on && claims.itemOn)}>
      <input type="checkbox" className={claims.itemCheck} checked={on} onChange={onToggle} aria-label={`${title} ${formatWon(c.amount)} 고르기`} />
      <span className={claims.itemIcon} aria-hidden>
        <Icon name={cat && isIconName(cat.icon) ? cat.icon : 'receipt'} size={16} />
      </span>
      <button type="button" className={claims.itemMain} onClick={onOpen} aria-label={`${title} 자세히 보기`}>
        <span className={claims.itemTitle}>{title}</span>
        <span className={claims.itemMeta}>
          {formatShortDate(c.expense.date)}
          {badge ? (
            <Badge tone={badge.tone} size="sm">
              {item.kind === 'carry' && estimate ? `${badge.text} · ${formatMonthKo(estimate, baseYear)}쯤` : badge.text}
            </Badge>
          ) : null}
          {carriedOver ? (
            <Badge tone="warning" size="sm">
              지난달부터
            </Badge>
          ) : null}
          {item.kind === 'upcoming' ? (
            <Badge tone="neutral" size="sm">
              정산일 {formatShortDate(c.due)}
            </Badge>
          ) : null}
          {!c.expense.claimDue ? (
            <Badge tone="neutral" size="sm">
              날짜 추정
            </Badge>
          ) : null}
        </span>
      </button>
      <span className={claims.itemAmount}>{formatWon(c.amount)}</span>
    </li>
  );
}
