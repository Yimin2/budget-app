'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  defaultSettlementSelection,
  formatDateKo,
  formatMan,
  formatMonthKo,
  formatShortDate,
  formatWon,
  planSettlement,
  settleRoster,
} from '@/domain';
import type { Expense, Id, LedgerData, PendingClaim, Settlement, SettleItem, SettleItemKind, SettlePerson } from '@/domain';
import { Badge, Button, Card, EmptyState, Icon, PageHeader, cx, isIconName } from '@/ui';
import { PageSkeleton, RequireLedger, type ReadyLedger } from '../../_components';
import { useSettleActions } from '../../_components/SettlementCard';
import { ExpenseDialog } from '../../history/_expenses/ExpenseDialog';
import claims from '../../_components/claims.module.css';
import styles from './settle.module.css';

/**
 * '/plan/settle' 이번 달 정산 (PLAN 4-9). 이벤트 화면 한 줄 요약의 [정산하기]로 열어요.
 * 지급할 수 있는 돈과 어떻게 셌는지 → 사람마다 항목 목록(전체 선택 · 사람 선택 · 항목 선택) → 고른 합 막대 · [지급했어요].
 * 고른 이벤트통장 청구가 지급할 수 있는 돈보다 많으면 넘는 금액을 보이고 [저수지에서 빌려 지급].
 * 저수지 돈으로 낸 이벤트 청구는 사람 목록 안에 '저수지에서 빌려 지급' 표시로 함께 있어요 (저수지는 받는 사람이 아니에요)
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
  return <SettleContent ledger={ledger} s={s} />;
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

  const pay = () => {
    const { settle, over, borrow } = plan;
    const n = plan.claims.length;
    const message =
      over.length > 0
        ? `고른 ${n}건을 지급하고 넘는 ${formatWon(plan.excess)}은 저수지에서 빌렸다고 기록했어요`
        : borrow.length > 0
          ? `고른 ${n}건 ${formatWon(plan.total)}을 지급했다고 기록했어요 (저수지에서 빌린 ${borrow.length}건 포함)`
          : `고른 ${n}건 ${formatWon(plan.total)}을 지급했다고 기록했어요`;
    return run(
      over.length > 0 ? 'borrow' : 'pay',
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
      message,
    );
  };

  const borrowTotal = s.reservoirLoan
    .flatMap((g) => g.claims)
    .filter((c) => plan.borrow.includes(c.expense.id))
    .reduce((t, c) => t + c.amount, 0);

  return (
    <>
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
        <p className={claims.note}>처음엔 오래된 것부터 지급할 수 있는 돈 안에서 골라 뒀어요. 항목을 누르면 자세히 볼 수 있어요</p>
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
          {!plan.fits ? (
            <span className={styles.overText}>
              지급할 수 있는 돈보다 {formatWon(plan.excess)} 많아요
              {canBorrow ? ` · 넘는 ${plan.over.length}건은 저수지에서 빌려 지급해요` : ''}
            </span>
          ) : null}
          {plan.borrow.length > 0 ? (
            <span>저수지에서 빌려 지급 {plan.borrow.length}건 {formatWon(borrowTotal)} 포함 · 저수지에 갚을 돈이 돼요</span>
          ) : null}
        </div>
        {plan.fits ? (
          <Button
            icon="check"
            loading={busy === 'pay'}
            disabled={plan.claims.length === 0 || (busy !== null && busy !== 'pay')}
            onClick={() => void pay()}
          >
            지급했어요
          </Button>
        ) : canBorrow ? (
          <Button
            icon="arrow-right"
            loading={busy === 'borrow'}
            disabled={busy !== null && busy !== 'borrow'}
            onClick={() => void pay()}
          >
            저수지에서 빌려 지급
          </Button>
        ) : (
          <Button icon="check" disabled>
            지급했어요
          </Button>
        )}
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
      <dl className={styles.calc}>
        <div>
          <dt>
            {when}
            {s.asOf === s.date ? ' (적립 포함)' : ''}
          </dt>
          <dd>{formatWon(s.balance)}</dd>
        </div>
        {s.reserved > 0 ? (
          <div>
            <dt>이번 달 남은 일정 · 여행 · 할부</dt>
            <dd>−{formatWon(s.reserved)}</dd>
          </div>
        ) : null}
      </dl>
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
  estimate,
  baseYear,
}: {
  item: SettleItem;
  data: LedgerData;
  on: boolean;
  onToggle: () => void;
  onOpen: () => void;
  estimate: string | null;
  baseYear: number;
}) {
  const c = item.claim;
  const cat = c.expense.categoryId ? data.categories.find((x) => x.id === c.expense.categoryId) : undefined;
  const title = claimTitle(data, c);
  const badge = KIND_BADGE[item.kind];
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
