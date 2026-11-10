'use client';

import { useRouter } from 'next/navigation';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { formatWon, hasLivingBudget, livingItemKey } from '@/domain';
import type { Category, Expense, LivingItem } from '@/domain';
import { useLedger } from '@/state';
import {
  Banner, Button, Chip, ChipGroup, Field, Icon, MoneyInput, PageHeader, SegmentedControl, VerdictCard, isIconName, useToast, cx,
} from '@/ui';
import { claimToastSuffix } from '../_components/ClaimFields';
import { CheckSkeleton, useLedgerFallback } from './LedgerGate';
import { ProjectionChart } from './ProjectionChart';
import { RecordSheet } from './RecordSheet';
import {
  MAX_AMOUNT, QUICK_AMOUNTS, STEP_AMOUNTS, errorMessage, sourceForCategory, type Source,
} from './selectors';
import styles from './home.module.css';

export interface CheckViewProps {
  /** ?amount= 로 미리 채울 금액 */
  initialAmount?: number | null;
  /** ?source=event 로 미리 고를 돈 */
  initialSource?: Source;
}

const AMOUNT_INPUT_ID = 'check-amount';

/** '/check' 사도 돼? — 금액 · 어느 돈 · 생활비 항목(또는 이벤트 카테고리) → 신호등 판단 → [샀어요] 기록 */
export function CheckView({ initialAmount = null, initialSource = 'living' }: CheckViewProps) {
  const fallback = useLedgerFallback(<CheckSkeleton />);
  return (
    <div className={styles.check}>
      <PageHeader title="사도 돼?" backHref="/" backLabel="홈으로" />
      {fallback ?? <CheckBody initialAmount={initialAmount} initialSource={initialSource} />}
    </div>
  );
}

/** 주소를 읽는 동안 보여 줄 모양 */
export function CheckLoading() {
  return (
    <div className={styles.check}>
      <PageHeader title="사도 돼?" backHref="/" backLabel="홈으로" />
      <CheckSkeleton />
    </div>
  );
}

function CheckBody({ initialAmount, initialSource }: { initialAmount: number | null; initialSource: Source }) {
  const ledger = useLedger();
  const router = useRouter();
  const toast = useToast();

  const [amount, setAmount] = useState<number | null>(initialAmount);
  const [pickedSource, setSource] = useState<Source>(initialSource);
  /** 이벤트통장으로 살 때 고른 카테고리 */
  const [categoryId, setCategoryId] = useState<string | null>(null);
  /** 생활비로 살 때 고른 항목 (livingItemKey) */
  const [itemKey, setItemKey] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  /** 이벤트통장으로 살 때 고른 여행 (PLAN 4-11: 여행 남은 예산으로 판단) */
  const [tripId, setTripId] = useState<string | null>(null);

  /** 누구 생활비 예산으로 볼지 (사람별 생활비 통장, PLAN 4-14). 기본은 나 */
  const [personId, setPersonId] = useState<string | null>(null);
  const views = ledger.livingViews;
  const multiPerson = views.length > 1;
  const livingAccountId = multiPerson
    ? (views.find((v) => v.accountId === (personId ?? ledger.myLivingAccountId)) ?? views[0]!).accountId
    : null;
  const hasEventAccount = ledger.accountByRole('event') !== null;
  const source: Source = pickedSource === 'event' && !hasEventAccount ? 'living' : pickedSource;
  const living = multiPerson ? ledger.livingFor(livingAccountId) : ledger.living;
  const livingMissing = source === 'living' && living !== null && !hasLivingBudget(living);
  // 고를 수 있는 생활비 항목 (예산 없는 '기타' 묶음은 빼요). 하나뿐이면 저절로 골라요
  const livingItems: LivingItem[] = useMemo(() => living?.items.filter((i) => !i.unbudgeted) ?? [], [living]);
  const selectedItem: LivingItem | undefined =
    itemKey !== null
      ? livingItems.find((i) => livingItemKey(i.categoryId) === itemKey)
      : livingItems.length === 1
        ? livingItems[0]
        : undefined;
  // 예산을 아직 정하지 않은 생활비 카테고리 — 고르면 생활비 전체 기준으로 판단해요
  const { activeCategories } = ledger;
  const unbudgetedCategories: Category[] = useMemo(() => {
    if (!living || !hasLivingBudget(living)) return [];
    const budgeted = new Set(livingItems.map((i) => i.categoryId));
    return activeCategories.filter((c) => sourceForCategory(c) === 'living' && !budgeted.has(c.id));
  }, [living, livingItems, activeCategories]);
  const pickedLooseCatId =
    itemKey !== null && itemKey.startsWith('cat:') && unbudgetedCategories.some((c) => `cat:${c.id}` === itemKey) ? itemKey.slice(4) : null;
  const pickedLooseCat = pickedLooseCatId ? (unbudgetedCategories.find((c) => c.id === pickedLooseCatId) ?? null) : null;
  const needItem = source === 'living' && !livingMissing && !selectedItem && !pickedLooseCat;
  const eventCategories = hasEventAccount ? ledger.activeCategories.filter((c) => sourceForCategory(c) === 'event') : [];
  const activeTrips = hasEventAccount ? ledger.trips.filter((t) => t.phase !== 'past') : [];
  const pickedTrip = source === 'event' ? (activeTrips.find((t) => t.trip.id === tripId) ?? null) : null;
  const pickedTripId = pickedTrip?.trip.id ?? null;

  // 입력하는 동안은 이전 결과를 잠깐 보여 주고, 계산은 뒤에서 따라와요
  const deferredAmount = useDeferredValue(amount);
  const { judge, trips } = ledger;
  const itemCategory = selectedItem ? selectedItem.categoryId : (pickedLooseCatId ?? undefined);
  // 생활비를 정하지 않았거나 항목을 고르지 않았으면 생활비 기준 판단을 하지 않아요 (모든 금액이 '비추천'으로 보이지 않게)
  const judgedTripId = source === 'event' && tripId !== null && trips.some((t) => t.trip.id === tripId && t.phase !== 'past') ? tripId : null;
  const verdict = useMemo(() => {
    if (deferredAmount === null || deferredAmount <= 0) return null;
    if (source === 'event') return judge(deferredAmount, 'event', undefined, { tripId: judgedTripId });
    if (livingMissing || itemCategory === undefined) return null;
    return judge(deferredAmount, 'living', itemCategory, { livingAccountId });
  }, [deferredAmount, source, judge, livingMissing, itemCategory, judgedTripId, livingAccountId]);
  const ready = amount !== null && amount > 0 && verdict !== null;
  // 큰 금액이면 '12개월 할부면 매달 ○원'과 그 금액이 맞는지 (PLAN 4-4 · 4-10)
  const { installmentHint } = ledger;
  const hint = useMemo(() => {
    if (verdict === null || deferredAmount === null) return null;
    // 여행을 골랐으면 판단과 같은 여행으로 (같은 돈을 두 번 세지 않게)
    return source === 'event'
      ? installmentHint(deferredAmount, 'event', undefined, { tripId: judgedTripId })
      : installmentHint(deferredAmount, 'living', itemCategory, { livingAccountId });
  }, [verdict, deferredAmount, source, installmentHint, itemCategory, judgedTripId, livingAccountId]);

  // 데스크톱(마우스)에서는 금액 칸에 바로 커서를 둬요. 휴대폰은 키보드가 결과를 가리지 않게 그대로 둬요
  useEffect(() => {
    if (initialAmount !== null) return;
    if (typeof window === 'undefined' || !window.matchMedia?.('(pointer: fine)').matches) return;
    document.getElementById(AMOUNT_INPUT_ID)?.focus();
  }, [initialAmount]);

  function pickItem(item: LivingItem) {
    setItemKey(livingItemKey(item.categoryId));
    setSource('living');
  }

  function pickLooseCategory(cat: Category) {
    setItemKey(`cat:${cat.id}`);
    setSource('living');
  }

  function pickEventCategory(cat: Category) {
    if (source === 'event' && categoryId === cat.id) {
      setCategoryId(null);
      return;
    }
    setCategoryId(cat.id);
    setSource('event');
  }

  function pickTrip(id: string) {
    if (source === 'event' && tripId === id) {
      setTripId(null);
      return;
    }
    setTripId(id);
    setSource('event');
    if (categoryId === null) {
      const travel = eventCategories.find((c) => c.name === '여행');
      if (travel) setCategoryId(travel.id);
    }
  }

  function addStep(step: number) {
    setAmount((a) => Math.min(MAX_AMOUNT, (a ?? 0) + step));
  }

  async function undo(expenseId: string) {
    try {
      await ledger.deleteExpense(expenseId);
      toast.show('기록을 되돌렸어요');
    } catch (e) {
      toast.error(errorMessage(e, '되돌리지 못했어요'));
    }
  }

  function onRecorded(expense: Expense, label: string) {
    setSheetOpen(false);
    toast.success(`${label} ${formatWon(expense.amount)} 기록했어요${claimToastSuffix(expense, ledger.today)}`, {
      action: { label: '되돌리기', onClick: () => void undo(expense.id) },
    });
    router.push('/');
  }

  const picker =
    livingItems.length > 0 || eventCategories.length > 0 || unbudgetedCategories.length > 0 ? (
      <section className={cx(styles.section, styles.cCategory)} aria-labelledby="check-pick-title">
        <h2 className={styles.groupLabel} id="check-pick-title">
          어디에 쓸까요?
        </h2>
        <p className={styles.hintText}>
          {livingItems.length > 1
            ? '고른 생활비 항목의 예산으로 알려 드려요. 경조사·여행은 이벤트통장 기준으로 바꿔요.'
            : '경조사·여행처럼 이벤트통장에서 나가는 걸 고르면 이벤트통장 기준으로 바꿔요.'}
        </p>
        <ChipGroup label="어디에 쓸까요">
          {livingItems.map((i) => (
            <Chip
              key={`item-${livingItemKey(i.categoryId)}`}
              icon={isIconName(i.icon) ? i.icon : 'dots'}
              selected={source === 'living' && selectedItem === i}
              onClick={() => pickItem(i)}
            >
              {i.name}
            </Chip>
          ))}
          {unbudgetedCategories.map((c) => (
            <Chip
              key={`loose-${c.id}`}
              icon={isIconName(c.icon) ? c.icon : 'dots'}
              selected={source === 'living' && pickedLooseCat?.id === c.id}
              onClick={() => pickLooseCategory(c)}
            >
              {c.name}
            </Chip>
          ))}
          {eventCategories.map((c) => (
            <Chip
              key={`cat-${c.id}`}
              icon={isIconName(c.icon) ? c.icon : 'dots'}
              selected={source === 'event' && categoryId === c.id}
              onClick={() => pickEventCategory(c)}
            >
              {c.name}
            </Chip>
          ))}
        </ChipGroup>
      </section>
    ) : null;

  const placeholderSub =
    source === 'living'
      ? living && hasLivingBudget(living)
        ? selectedItem
          ? selectedItem.todayAvailable !== null
            ? `오늘 ${selectedItem.name}에 써도 되는 돈 ${formatWon(Math.max(0, selectedItem.todayAvailable))}`
            : `이번 달 남은 ${selectedItem.name} ${formatWon(selectedItem.remaining)}`
          : `오늘 써도 되는 돈 ${formatWon(Math.max(0, living.todayAvailable))}`
        : null
      : ledger.eventProjection
        ? `이벤트통장 잔액 ${formatWon(ledger.eventProjection.currentBalance)}`
        : null;

  return (
    <div className={styles.checkGrid}>
      <div className={styles.checkCol}>
        <Field label="사려는 금액" id={AMOUNT_INPUT_ID} className={cx(styles.amountField, styles.cAmount)}>
          <MoneyInput value={amount} onChange={setAmount} size="lg" max={MAX_AMOUNT} />
        </Field>

        <ChipGroup label="금액 빠르게 넣기" className={cx(styles.chipsCenter, styles.cQuick)}>
          {QUICK_AMOUNTS.map((q) => (
            <Chip key={q.value} selected={amount === q.value} onClick={() => setAmount(q.value)}>
              {q.label}
            </Chip>
          ))}
          {STEP_AMOUNTS.map((s) => (
            <Chip key={`step-${s.value}`} icon="plus" onClick={() => addStep(s.value)} aria-label={`${s.label.slice(1)} 더하기`}>
              {s.label.slice(1)}
            </Chip>
          ))}
        </ChipGroup>

        <div className={cx(styles.section, styles.cSource)}>
          <SegmentedControl<Source>
            ariaLabel="어느 돈으로 살까요"
            block
            value={source}
            onChange={setSource}
            options={[
              { value: 'living', label: '생활비로' },
              { value: 'event', label: '이벤트통장으로', disabled: !hasEventAccount },
            ]}
          />
          {!hasEventAccount ? <p className={styles.hintText}>이벤트통장이 없어서 생활비 기준으로만 볼 수 있어요.</p> : null}
        </div>

        {multiPerson && source === 'living' ? (
          <div className={styles.section}>
            <h2 className={styles.groupLabel} id="check-person-title">
              누구 생활비로 볼까요?
            </h2>
            <SegmentedControl<string>
              ariaLabel="누구 생활비로 볼까요"
              block
              value={livingAccountId ?? ''}
              onChange={(id) => {
                setPersonId(id);
                setItemKey(null);
              }}
              options={views.map((v) => ({ value: v.accountId, label: v.accountId === ledger.myLivingAccountId ? `${v.name} (나)` : v.name }))}
            />
          </div>
        ) : null}

        {livingMissing ? (
          <Banner tone="info" title="생활비를 아직 정하지 않았어요" action={{ label: '정하기', href: '/budget#st-living' }} className={styles.cNotice}>
            항목마다 생활비 예산을 정하면 오늘 써도 되는 돈 기준으로 알려 드려요.
          </Banner>
        ) : null}

        {picker}

        {activeTrips.length > 0 ? (
          <section className={styles.section} aria-labelledby="check-trip-title">
            <h2 className={styles.groupLabel} id="check-trip-title">
              여행에 쓸 돈인가요? <span className="opt-text">(선택)</span>
            </h2>
            <p className={styles.hintText}>여행을 고르면 그 여행의 남은 예산으로 알려 드려요.</p>
            <ChipGroup label="여행 고르기">
              {activeTrips.map((t) => (
                <Chip key={t.trip.id} icon="plane" selected={pickedTripId === t.trip.id} onClick={() => pickTrip(t.trip.id)}>
                  {t.trip.name}
                </Chip>
              ))}
            </ChipGroup>
          </section>
        ) : null}
      </div>

      <div className={cx(styles.checkCol, styles.checkSticky)}>
        {/* 처음부터 있는 알림 영역 안에서 결과를 바꿔요 → 첫 결과도 화면 읽기 프로그램이 읽어요 */}
        <div className={styles.cVerdict} aria-live="polite" aria-atomic="true">
          {verdict ? (
            <>
              <VerdictCard verdict={verdict} live={false}>
                {source === 'event' && verdict.projectionAfter && verdict.projectionAfter.months.length > 0 ? (
                  <ProjectionChart months={verdict.projectionAfter.months} title="사면 이벤트통장 예상 잔액" today={ledger.today} onTint />
                ) : null}
              </VerdictCard>
              {hint ? (
                <p className={cx(styles.instHint, hint.fits ? styles.instFits : styles.instOver)}>
                  <Icon name={hint.fits ? 'check-circle' : 'alert-circle'} size={20} className={styles.instIcon} />
                  <span>{hint.message}</span>
                </p>
              ) : null}
            </>
          ) : (
            <div className={styles.placeholder}>
              <Icon name="help-circle" size={48} className={styles.placeholderIcon} />
              <p className={styles.placeholderTitle}>
                {livingMissing
                  ? '생활비를 정하면 바로 알려 드려요'
                  : needItem
                    ? '어디에 쓸지 골라 주세요'
                    : '금액을 넣으면 바로 알려 드려요'}
              </p>
              {placeholderSub ? <p className={styles.placeholderSub}>{placeholderSub}</p> : null}
            </div>
          )}
        </div>

        <div className={cx(styles.actions, styles.cActions)}>
          <Button size="lg" block icon="check" disabled={!ready} onClick={() => setSheetOpen(true)}>
            샀어요 · 기록하기
          </Button>
          <Button href="/" variant="outline" block>
            안 살래요
          </Button>
        </div>
      </div>

      {sheetOpen && amount !== null && amount > 0 ? (
        <RecordSheet
          amount={amount}
          source={source}
          categoryId={source === 'living' ? (selectedItem?.categoryId ?? pickedLooseCat?.id ?? null) : categoryId}
          tripId={pickedTripId}
          spenderKey={livingAccountId ? (ledger.spenders.find((x) => x.livingAccountId === livingAccountId)?.key ?? null) : null}
          onClose={() => setSheetOpen(false)}
          onRecorded={onRecorded}
        />
      ) : null}
    </div>
  );
}
