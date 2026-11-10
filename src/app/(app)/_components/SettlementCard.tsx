'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import {
  checkSettlementSelection,
  defaultSettlementSelection,
  formatDateKo,
  formatMonthKo,
  formatShortDate,
  formatWon,
  settledReservoirEventClaims,
} from '@/domain';
import type { Expense, Id, LedgerData, PendingClaim, PersonClaims, Settlement } from '@/domain';
import { useLedger } from '@/state';
import { Badge, Button, Card, Icon, cx, isIconName, useMediaQuery, useToast } from '@/ui';
import { ExpenseDialog } from '../history/_expenses/ExpenseDialog';
import styles from './claims.module.css';

function claimTitle(data: LedgerData, c: PendingClaim | Expense): string {
  const e = 'expense' in c ? c.expense : c;
  const memo = e.memo.trim();
  if (memo) return memo;
  const cat = e.categoryId ? data.categories.find((x) => x.id === e.categoryId)?.name : undefined;
  return cat ?? '지출';
}

/** '기쁜 120,000원 · 민구 300,000원' */
export function peopleText(groups: PersonClaims[]): string {
  return groups.map((g) => `${g.name} ${formatWon(g.amount)}`).join(' · ');
}

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const idsOf = (groups: PersonClaims[]) => groups.flatMap((g) => g.claims.map((c) => c.expense.id));
const sum = (list: PendingClaim[]) => list.reduce((s, c) => s + c.amount, 0);
const countOf = (s: Settlement) =>
  [s.pay, s.carry, s.reservoir, s.reservoirLoan, s.upcoming].reduce((n, gs) => n + gs.reduce((m, g) => m + g.claims.length, 0), 0);

/** 지급 · 빌려 지급 · 바꾸기 버튼이 함께 쓰는 동작 (되돌리기 알림 포함) */
function useSettleActions() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<void>, undo: () => Promise<void>, message: string) {
    if (busy) return;
    setBusy(key);
    try {
      await action();
      toast.success(message, {
        action: {
          label: '되돌리기',
          onClick: () => {
            undo().then(
              () => toast.show('지급한 기록을 되돌렸어요'),
              (e: unknown) => toast.error(errorText(e, '되돌리지 못했어요')),
            );
          },
        },
      });
    } catch (e) {
      toast.error(errorText(e, '지급한 기록을 저장하지 못했어요'));
    } finally {
      setBusy(null);
    }
  }
  return { busy, run };
}

/**
 * 이번 달 정산 (PLAN 4-9). 이벤트 화면에 늘, 홈에는 지금 돌려줄 돈이 있을 때 compact 로 보여요.
 * 지급할 수 있는 돈 안에서 오래된 청구부터 사람별로 나누고(처음 골라 둔 것), 안 들어간 돈은 다음 달로 넘겨요.
 * 사람마다 청구를 하나씩 펼쳐 보고 골라 지급할 수 있어요. 누르면 지출 창이 열려요.
 * 저수지통장의 이벤트 청구는 '저수지에서 빌려 줄 돈'(지급하면 저수지에 갚을 돈), 그 밖의 저수지통장 청구는 '저수지에 쓸 돈'이에요
 */
export function SettlementCard({ compact = false, className }: { compact?: boolean; className?: string }) {
  const ledger = useLedger();
  const s = ledger.settlement;
  const data = ledger.data;
  if (!s || !data) return null;
  if (compact) return <CompactSettlement s={s} className={className} />;
  return <FullSettlement s={s} data={data} className={className} />;
}

function CompactSettlement({ s, className }: { s: Settlement; className?: string }) {
  const ledger = useLedger();
  const titleId = useId();
  const { busy, run } = useSettleActions();
  if (!s.dueNow) return null;
  const empty = s.pay.length === 0 && s.carry.length === 0 && s.reservoir.length === 0 && s.reservoirLoan.length === 0;
  if (empty) return null;
  const payIds = idsOf(s.pay);
  const payAll = () =>
    run('all', () => ledger.settleClaims(payIds), () => ledger.unsettleClaims(payIds), `${peopleText(s.pay)} 지급했다고 기록했어요`);
  const count = countOf(s);
  return (
    <Card
      as="section"
      aria-labelledby={titleId}
      title={<span id={titleId}>이번 달 정산</span>}
      aside={<span className={styles.asideDate}>{formatDateKo(s.date, false)}</span>}
      className={className}
    >
      <dl className={styles.compactList}>
        {s.pay.length > 0 ? (
          <div>
            <dt>이번 달 지급</dt>
            <dd>{peopleText(s.pay)}</dd>
          </div>
        ) : null}
        {s.carry.length > 0 ? (
          <div>
            <dt>다음 달로 넘어가요</dt>
            <dd>{peopleText(s.carry)}</dd>
          </div>
        ) : null}
        {s.reservoirLoan.length > 0 ? (
          <div>
            <dt>저수지에서 빌려 줄 돈</dt>
            <dd>{peopleText(s.reservoirLoan)}</dd>
          </div>
        ) : null}
        {s.reservoir.length > 0 ? (
          <div>
            <dt>저수지에 쓸 돈</dt>
            <dd>{peopleText(s.reservoir)}</dd>
          </div>
        ) : null}
      </dl>
      <p className={styles.note}>항목 {count}건을 하나씩 보고 골라 지급할 수 있어요</p>
      <div className={styles.actions}>
        {s.pay.length > 0 ? (
          <Button icon="check" loading={busy === 'all'} disabled={busy !== null && busy !== 'all'} onClick={() => void payAll()}>
            모두 지급했어요
          </Button>
        ) : null}
        <Button href="/plan#settlement" variant="outline">
          정산 자세히 보기
        </Button>
      </div>
    </Card>
  );
}

type GroupKey = 'pay' | 'carry' | 'reservoirLoan' | 'reservoir' | 'upcoming';

function FullSettlement({ s, data, className }: { s: Settlement; data: LedgerData; className?: string }) {
  const ledger = useLedger();
  const titleId = useId();
  const { busy, run } = useSettleActions();
  const wide = useMediaQuery('(min-width: 768px)');
  const defaults = useMemo(() => defaultSettlementSelection(s), [s]);
  const [picked, setPicked] = useState<Map<Id, boolean>>(() => new Map());
  const [open, setOpen] = useState<Map<string, boolean>>(() => new Map());
  const [editing, setEditing] = useState<Expense | null>(null);
  const settled = useMemo(() => settledReservoirEventClaims(data), [data]);

  const isOn = (id: Id) => picked.get(id) ?? defaults.has(id);
  const toggle = (id: Id) => setPicked((m) => new Map(m).set(id, !isOn(id)));
  const ticked = (g: PersonClaims) => g.claims.filter((c) => isOn(c.expense.id));
  const tickedIds = (groups: PersonClaims[]) => groups.flatMap((g) => ticked(g).map((c) => c.expense.id));
  const resetPicked = () => setPicked(new Map());

  const empty =
    s.pay.length === 0 && s.carry.length === 0 && s.reservoir.length === 0 && s.reservoirLoan.length === 0 && settled.length === 0;

  // 이벤트통장 · 고정지출통장 몫(이번 달 지급 · 넘어가요 · 정산일 전)에서 고른 것
  const roundIds = tickedIds([...s.pay, ...s.carry, ...s.upcoming]);
  const roundCheck = checkSettlementSelection(data, s, roundIds);

  const settle = (key: string, ids: Id[], message: string) =>
    run(key, async () => {
      await ledger.settleClaims(ids);
      resetPicked();
    }, () => ledger.unsettleClaims(ids), message);

  const payOverWithLoan = () => {
    const within = roundCheck.within;
    const over = roundCheck.over;
    return run(
      'round-borrow',
      async () => {
        if (within.length > 0) await ledger.settleClaims(within);
        await ledger.borrowAndSettleClaims(over);
        resetPicked();
      },
      () => ledger.unsettleClaims([...within, ...over]),
      `고른 ${roundCheck.claims.length}건을 지급하고 넘는 ${formatWon(roundCheck.excess)}은 저수지에서 빌렸다고 기록했어요`,
    );
  };

  const borrowLoan = (key: string, ids: Id[], message: string) =>
    run(key, async () => {
      await ledger.borrowReservoirClaims(ids);
      resetPicked();
    }, () => ledger.undoReservoirClaims(ids, 'borrowed'), message);

  /** 사람 한 명 블록 */
  const person = (group: GroupKey, g: PersonClaims, opts: { meta?: string; action?: 'settle' | 'reservoir' | 'loan' }) => {
    const key = `${group}:${g.name}`;
    const expanded = open.get(key) ?? !(!wide && g.claims.length > 3);
    const on = ticked(g);
    const onIds = on.map((c) => c.expense.id);
    const onSum = sum(on);
    const listId = `${titleId}-${group}-${g.name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    let button: ReactNode = null;
    if (opts.action) {
      const check = opts.action === 'settle' ? checkSettlementSelection(data, s, onIds) : null;
      const blocked = check !== null && !check.fits;
      const label =
        opts.action === 'loan'
          ? `저수지에서 빌려 ${g.name}에게 ${formatWon(onSum)} 지급했어요`
          : opts.action === 'reservoir'
            ? `저수지에서 ${g.name}에게 ${formatWon(onSum)} 지급했어요`
            : `${g.name}에게 ${formatWon(onSum)} 지급했어요`;
      const k = `p:${key}`;
      button = (
        <Button
          variant="outline"
          icon="check"
          loading={busy === k}
          disabled={onIds.length === 0 || blocked || (busy !== null && busy !== k)}
          aria-label={label}
          onClick={() =>
            void (opts.action === 'loan'
              ? borrowLoan(k, onIds, `저수지에서 빌려 ${g.name}에게 ${formatWon(onSum)} 지급했다고 기록했어요`)
              : settle(
                  k,
                  onIds,
                  opts.action === 'reservoir'
                    ? `저수지에서 ${g.name}에게 ${formatWon(onSum)} 지급했다고 기록했어요`
                    : `${g.name}에게 ${formatWon(onSum)} 지급했다고 기록했어요`,
                ))
          }
        >
          지급했어요
        </Button>
      );
    }
    return (
      <li key={key} className={styles.personBlock}>
        <div className={styles.dueRow}>
          <span className={styles.dueText}>
            <strong>
              {g.name} {formatWon(opts.action ? onSum : g.amount)}
              {opts.action && onSum !== g.amount ? <span className={styles.ofTotal}> / {formatWon(g.amount)}</span> : null}
            </strong>
            {opts.meta ? <span>{opts.meta}</span> : null}
          </span>
          <Button
            variant="ghost"
            plain
            iconRight="chevron-down"
            className={cx(styles.countBtn, expanded && styles.countOpen)}
            aria-expanded={expanded}
            aria-controls={listId}
            aria-label={`${g.name} 항목 ${g.claims.length}건 ${expanded ? '접기' : '펼치기'}`}
            onClick={() => setOpen((m) => new Map(m).set(key, !expanded))}
          >
            {g.claims.length}건
          </Button>
          {button}
        </div>
        {expanded ? (
          <ul id={listId} className={styles.itemList} aria-label={`${g.name} 항목`}>
            {g.claims.map((c) => {
              const cat = c.expense.categoryId ? data.categories.find((x) => x.id === c.expense.categoryId) : undefined;
              const title = claimTitle(data, c);
              const reservoir = data.accounts.some((a) => a.id === c.accountId && a.role === 'reservoir');
              const guessed = !c.expense.claimDue;
              const cbId = `${listId}-${c.expense.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');
              return (
                <li key={c.expense.id} className={cx(styles.item, opts.action && isOn(c.expense.id) && styles.itemOn)}>
                  {opts.action ? (
                    <input
                      id={cbId}
                      type="checkbox"
                      className={styles.itemCheck}
                      checked={isOn(c.expense.id)}
                      onChange={() => toggle(c.expense.id)}
                      aria-label={`${title} ${formatWon(c.amount)} 고르기`}
                    />
                  ) : null}
                  <span className={styles.itemIcon} aria-hidden>
                    <Icon name={cat && isIconName(cat.icon) ? cat.icon : 'receipt'} size={16} />
                  </span>
                  <button type="button" className={styles.itemMain} onClick={() => setEditing(c.expense)} aria-label={`${title} 자세히 보기`}>
                    <span className={styles.itemTitle}>{title}</span>
                    <span className={styles.itemMeta}>
                      {formatShortDate(c.expense.date)}
                      {reservoir ? (
                        <Badge tone="info" size="sm">
                          저수지
                        </Badge>
                      ) : null}
                      {guessed ? (
                        <Badge tone="neutral" size="sm">
                          날짜 추정
                        </Badge>
                      ) : null}
                    </span>
                  </button>
                  <span className={styles.itemAmount}>{formatWon(c.amount)}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </li>
    );
  };

  const carryIds = tickedIds(s.carry);
  const carryTargets = carryIds.length > 0 ? carryIds : idsOf(s.carry);
  const carryTargetSum = s.carry.flatMap((g) => g.claims).filter((c) => carryTargets.includes(c.expense.id)).reduce((t, c) => t + c.amount, 0);
  const loanIds = idsOf(s.reservoirLoan);
  const settledIds = settled.map((e) => e.id);
  const settledTotal = settled.reduce((t, e) => t + e.amount, 0);

  return (
    <Card
      as="section"
      id="settlement"
      aria-labelledby={titleId}
      title={<span id={titleId}>이번 달 정산</span>}
      aside={<span className={styles.asideDate}>{formatDateKo(s.date, false)}</span>}
      className={cx(className)}
    >
      <PayableLine s={s} />

      {empty ? <p className={styles.summaryLine}>이번 달 돌려줄 돈이 없어요</p> : null}

      {s.pay.length > 0 ? (
        <>
          <h3 className={styles.dueTitle}>이번 달 지급 · {formatWon(s.payTotal)}</h3>
          <ul className={styles.dueList}>{s.pay.map((g) => person('pay', g, { action: 'settle' }))}</ul>
        </>
      ) : null}

      {s.carry.length > 0 ? (
        <>
          <h3 className={styles.dueTitle}>다음 달로 넘어가요 · {formatWon(s.carryTotal)}</h3>
          <ul className={styles.dueList}>
            {s.carry.map((g) =>
              person('carry', g, {
                action: 'settle',
                meta: g.estimate
                  ? `${formatMonthKo(g.estimate, Number(ledger.today.slice(0, 4)))}쯤 지급할 수 있어요`
                  : '12개월 안에는 어려워요',
              }),
            )}
          </ul>
          {s.reservoirAccountId ? (
            <div className={styles.borrow}>
              <p>
                지금 주려면 저수지에서 빌려요. 빌린 돈은 <strong>저수지에 갚을 돈</strong>으로 남고, 남는 달에 갚아요
              </p>
              <Button
                variant="outline"
                icon="arrow-right"
                loading={busy === 'borrow'}
                disabled={busy !== null && busy !== 'borrow'}
                onClick={() =>
                  void run(
                    'borrow',
                    async () => {
                      await ledger.borrowAndSettleClaims(carryTargets);
                      resetPicked();
                    },
                    () => ledger.unsettleClaims(carryTargets),
                    `저수지에서 ${formatWon(carryTargetSum)} 빌려 지급했다고 기록했어요`,
                  )
                }
              >
                저수지에서 빌려 지급
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {roundIds.length > 0 && (s.pay.length > 1 || s.carry.length > 0 || !roundCheck.fits) ? (
        <div className={cx(styles.selectionBar, !roundCheck.fits && styles.selectionOver)} aria-live="polite">
          <p>
            고른 {roundCheck.claims.length}건 · <strong>{formatWon(roundCheck.total)}</strong>
            {!roundCheck.fits ? (
              <span className={styles.overText}>
                지급할 수 있는 돈보다 {formatWon(roundCheck.excess)} 많아요
              </span>
            ) : null}
          </p>
          <div className={styles.actions}>
            {roundCheck.fits ? (
              <Button
                icon="check"
                loading={busy === 'round'}
                disabled={busy !== null && busy !== 'round'}
                onClick={() => void settle('round', roundIds, `고른 ${roundIds.length}건 ${formatWon(roundCheck.total)}을 지급했다고 기록했어요`)}
              >
                모두 지급했어요
              </Button>
            ) : s.reservoirAccountId ? (
              <Button
                icon="arrow-right"
                loading={busy === 'round-borrow'}
                disabled={busy !== null && busy !== 'round-borrow'}
                onClick={() => void payOverWithLoan()}
              >
                저수지에서 빌려 지급
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {s.reservoirLoan.length > 0 ? (
        <>
          <h3 className={styles.dueTitle}>
            저수지에서 빌려 줄 돈 · {formatWon(s.reservoirLoanTotal)}{' '}
            <Badge tone="warning" size="sm">
              빌린 돈
            </Badge>
          </h3>
          <ul className={styles.dueList}>
            {s.reservoirLoan.map((g) => person('reservoirLoan', g, { action: 'loan', meta: '이벤트 지출을 저수지 돈으로 내요' }))}
          </ul>
          <div className={styles.borrow}>
            <p>
              이벤트통장에 돈이 없어 저수지 돈으로 낸 이벤트 지출이에요. 지급하면 이벤트통장 지출이 되고{' '}
              <strong>저수지에 갚을 돈</strong>으로 남아요
            </p>
            {s.reservoirLoan.length > 1 || s.reservoirLoan[0]!.claims.length > 1 ? (
              <Button
                variant="outline"
                icon="arrow-right"
                loading={busy === 'loan-all'}
                disabled={busy !== null && busy !== 'loan-all'}
                onClick={() =>
                  void borrowLoan('loan-all', loanIds, `저수지에서 빌려 ${loanIds.length}건 ${formatWon(s.reservoirLoanTotal)}을 지급했다고 기록했어요`)
                }
              >
                {loanIds.length}건 모두 이벤트 지출로 바꿔 지급 (저수지에서 빌림)
              </Button>
            ) : null}
          </div>
        </>
      ) : null}

      {settled.length > 0 ? (
        <div className={cx(styles.borrow, styles.convertBox)}>
          <p>
            저수지에서 이미 돌려준 이벤트 지출이 <strong>{settled.length}건</strong> 있어요 (
            {[...new Set(settled.map((e) => e.paidBy ?? ''))].filter(Boolean).join(' · ')}). 이벤트통장이 저수지에서 빌린 돈이에요
          </p>
          <Button
            icon="arrow-right"
            loading={busy === 'convert'}
            disabled={busy !== null && busy !== 'convert'}
            onClick={() =>
              void run(
                'convert',
                () => ledger.convertSettledReservoirClaims(settledIds),
                () => ledger.undoReservoirClaims(settledIds, 'converted'),
                `${settledIds.length}건 ${formatWon(settledTotal)}을 저수지에 갚을 돈으로 바꿨어요`,
              )
            }
          >
            {settled.length}건 {formatWon(settledTotal)}을 저수지에 갚을 돈으로 바꿔요
          </Button>
        </div>
      ) : null}

      {s.reservoir.length > 0 ? (
        <>
          <h3 className={styles.dueTitle}>
            저수지에 쓸 돈 · {formatWon(s.reservoirTotal)}{' '}
            <Badge tone="info" size="sm">
              저수지
            </Badge>
          </h3>
          <ul className={styles.dueList}>
            {s.reservoir.map((g) => person('reservoir', g, { action: 'reservoir', meta: '저수지에서 지급' }))}
          </ul>
          <p className={styles.note}>이벤트가 아닌, 저수지에 쓸 돈이라 저수지에서 줘요</p>
        </>
      ) : null}

      {s.upcoming.length > 0 ? (
        <>
          <p className={styles.note}>
            정산일이 아직 안 된 돈:{' '}
            {s.upcoming.map((g) => `${g.name} ${formatWon(g.amount)} (${formatDateKo(g.due, false)})`).join(' · ')}
          </p>
          <ul className={styles.dueList}>{s.upcoming.map((g) => person('upcoming', g, { action: 'settle' }))}</ul>
        </>
      ) : null}

      {editing ? <ExpenseDialog expense={editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

/** 지급할 수 있는 돈 한 줄 + 어떻게 셌는지 */
function PayableLine({ s }: { s: Settlement }) {
  const when = s.asOf === s.date ? `${formatDateKo(s.date, false)} 이벤트통장` : '오늘 이벤트통장';
  return (
    <p className={styles.summaryLine}>
      지급할 수 있는 돈 <strong>{formatWon(s.payable)}</strong>
      <span className={styles.subLine}>
        {when} {formatWon(s.balance)}
        {s.asOf === s.date ? '(적립 포함)' : ''}
        {s.reserved > 0 ? ` − 이번 달 남은 일정 ${formatWon(s.reserved)}` : ''}
      </span>
    </p>
  );
}
