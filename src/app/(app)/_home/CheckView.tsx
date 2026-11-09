'use client';

import { useRouter } from 'next/navigation';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { formatWon, hasLivingBudget, livingItemKey } from '@/domain';
import type { Category, Expense, LivingItem } from '@/domain';
import { useLedger } from '@/state';
import {
  Banner, Button, Chip, ChipGroup, Field, Icon, MoneyInput, PageHeader, SegmentedControl, VerdictCard, isIconName, useToast, cx,
} from '@/ui';
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

  const hasEventAccount = ledger.accountByRole('event') !== null;
  const source: Source = pickedSource === 'event' && !hasEventAccount ? 'living' : pickedSource;
  const living = ledger.living;
  const livingMissing = source === 'living' && living !== null && !hasLivingBudget(living);
  // 고를 수 있는 생활비 항목 (예산 없는 '기타' 묶음은 빼요). 하나뿐이면 저절로 골라요
  const livingItems: LivingItem[] = useMemo(() => living?.items.filter((i) => !i.unbudgeted) ?? [], [living]);
  const selectedItem: LivingItem | undefined =
    itemKey !== null
      ? livingItems.find((i) => livingItemKey(i.categoryId) === itemKey)
      : livingItems.length === 1
        ? livingItems[0]
        : undefined;
  const needItem = source === 'living' && !livingMissing && !selectedItem;
  const eventCategories = hasEventAccount ? ledger.activeCategories.filter((c) => sourceForCategory(c) === 'event') : [];

  // 입력하는 동안은 이전 결과를 잠깐 보여 주고, 계산은 뒤에서 따라와요
  const deferredAmount = useDeferredValue(amount);
  const { judge } = ledger;
  const itemCategory = selectedItem ? selectedItem.categoryId : undefined;
  // 생활비를 정하지 않았거나 항목을 고르지 않았으면 생활비 기준 판단을 하지 않아요 (모든 금액이 '비추천'으로 보이지 않게)
  const verdict = useMemo(() => {
    if (deferredAmount === null || deferredAmount <= 0) return null;
    if (source === 'event') return judge(deferredAmount, 'event');
    if (livingMissing || itemCategory === undefined) return null;
    return judge(deferredAmount, 'living', itemCategory);
  }, [deferredAmount, source, judge, livingMissing, itemCategory]);
  const ready = amount !== null && amount > 0 && verdict !== null;

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

  function pickEventCategory(cat: Category) {
    if (source === 'event' && categoryId === cat.id) {
      setCategoryId(null);
      return;
    }
    setCategoryId(cat.id);
    setSource('event');
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
    toast.success(`${label} ${formatWon(expense.amount)} 기록했어요`, {
      action: { label: '되돌리기', onClick: () => void undo(expense.id) },
    });
    router.push('/');
  }

  const picker =
    livingItems.length > 0 || eventCategories.length > 0 ? (
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

        {livingMissing ? (
          <Banner tone="info" title="생활비를 아직 정하지 않았어요" action={{ label: '정하기', href: '/settings#st-living' }} className={styles.cNotice}>
            항목마다 생활비 예산을 정하면 오늘 써도 되는 돈 기준으로 알려 드려요.
          </Banner>
        ) : null}

        {picker}
      </div>

      <div className={cx(styles.checkCol, styles.checkSticky)}>
        {/* 처음부터 있는 알림 영역 안에서 결과를 바꿔요 → 첫 결과도 화면 읽기 프로그램이 읽어요 */}
        <div className={styles.cVerdict} aria-live="polite" aria-atomic="true">
          {verdict ? (
            <VerdictCard verdict={verdict} live={false}>
              {source === 'event' && verdict.projectionAfter && verdict.projectionAfter.months.length > 0 ? (
                <ProjectionChart months={verdict.projectionAfter.months} title="사면 이벤트통장 예상 잔액" today={ledger.today} onTint />
              ) : null}
            </VerdictCard>
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
          categoryId={source === 'living' ? (selectedItem?.categoryId ?? null) : categoryId}
          onClose={() => setSheetOpen(false)}
          onRecorded={onRecorded}
        />
      ) : null}
    </div>
  );
}
