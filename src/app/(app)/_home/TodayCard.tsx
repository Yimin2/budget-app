'use client';

import { useId, useState } from 'react';
import { formatNumber, formatWon, withSubject } from '@/domain';
import type { LivingStatus, LivingView } from '@/domain';
import { useLedger } from '@/state';
import { Card, Chip, ChipGroup, Icon, Money, ProgressBar, SegmentedControl, useToast, cx } from '@/ui';
import { errorMessage } from './selectors';
import styles from './home.module.css';

/**
 * 로그인한 계정이 어느 생활비 통장과도 이어지지 않았을 때: 통장 주인 이름 칩으로 나를 골라요.
 * 고르면 그 이름의 통장(주인 이메일이 빈 것)을 모두 내 이메일과 이어 시트에 써 둬요 (다음부터 묻지 않아요)
 */
export function MeChooser({ names }: { names: string[] }) {
  const ledger = useLedger();
  const toast = useToast();
  const titleId = useId();
  const [busy, setBusy] = useState<string | null>(null);

  async function choose(name: string) {
    if (busy) return;
    setBusy(name);
    try {
      await ledger.claimOwner(name);
      toast.success(`${name} 님으로 이었어요`);
    } catch (e) {
      toast.error(errorMessage(e, '나를 정하지 못했어요'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={cx(styles.section, styles.meChooser)} aria-labelledby={titleId}>
      <h2 id={titleId} className="section-title">
        누가 나인지 골라 주세요
      </h2>
      <p className={styles.meHint}>고른 사람의 통장이 이 계정과 이어져요. 그전까지는 모두 합친 생활비를 보여 줘요</p>
      <ChipGroup label="나는 누구인가요">
        {names.map((n) => (
          <Chip key={n} disabled={busy !== null} aria-busy={busy === n || undefined} onClick={() => void choose(n)}>
            {n}
          </Chip>
        ))}
      </ChipGroup>
    </section>
  );
}

/** 한 사람(생활비 통장)의 큰 숫자: 하루 항목이 있으면 오늘 써도 되는 돈, 없으면 이번 달 남은 생활비 */
function headline(living: LivingStatus): number {
  return living.items.some((i) => i.spread === 'daily') ? living.todayAvailable : living.remaining;
}

/** 하루에 나눠 쓰는 항목에 오늘 쓴 돈 합 (한 달 한도 항목은 빼요) */
function dailySpentToday(living: LivingStatus): number {
  return living.items.reduce((sum, i) => (i.spread === 'daily' ? sum + i.spentToday : sum), 0);
}

/**
 * 하루 예산 한 줄: 오늘 쓴 돈이 있으면 '오늘 쓴 돈 ○원 · 써도 되는 돈 ○원', 없으면 '오늘 써도 되는 돈 ○원'.
 * 써도 되는 돈을 넘었으면 '오늘 ○원 넘었어요'(경고 색)
 */
export function DailyLine({ spent, available }: { spent: number; available: number }) {
  const over = available < 0;
  const left = over ? (
    <strong className={styles.warn}>오늘 {formatWon(-available)} 넘었어요</strong>
  ) : spent > 0 ? (
    <>
      써도 되는 돈 <strong>{formatWon(available)}</strong>
    </>
  ) : (
    <>
      오늘 써도 되는 돈 <strong>{formatWon(available)}</strong>
    </>
  );
  return (
    <span className={styles.dailyLine}>
      {spent > 0 ? (
        <>
          <span>
            오늘 쓴 돈 <strong>{formatWon(spent)}</strong>
          </span>
          <span aria-hidden="true">·</span>
        </>
      ) : null}
      <span>{left}</span>
    </span>
  );
}

export function TodayCard({
  living,
  person = null,
  views = [],
  myAccountId = null,
  household = null,
  onPick,
}: {
  living: LivingStatus;
  /** 사람별 생활비일 때 지금 보는 사람 */
  person?: { view: LivingView; isMe: boolean } | null;
  views?: LivingView[];
  myAccountId?: string | null;
  /** 사람별 생활비일 때 모두 합친 생활비 */
  household?: LivingStatus | null;
  onPick?: (accountId: string) => void;
}) {
  const titleId = useId();
  const daily = living.items.filter((i) => i.spread === 'daily');
  const hasDaily = daily.length > 0;
  const over = hasDaily && living.todayAvailable < 0;
  const spentToday = dailySpentToday(living);
  const ratio = living.monthBudget > 0 ? living.spent / living.monthBudget : 0;
  const tone = living.remaining < 0 ? 'danger' : ratio >= 0.8 ? 'warning' : 'primary';
  const dailyNames = daily.map((i) => i.name).join(' · ');
  const who = person ? (person.isMe ? '내가' : withSubject(person.view.name)) : null;
  const title = hasDaily
    ? who
      ? `오늘 ${who} 써도 되는 돈`
      : '오늘 써도 되는 돈'
    : person
      ? `${person.isMe ? '내' : `${person.view.name}의`} 이번 달 남은 생활비`
      : '이번 달 남은 생활비';
  const others = person ? views.filter((v) => v.accountId !== person.view.accountId) : [];

  return (
    <Card as="section" variant="brand" className={cx(styles.hero, styles.oHero)} aria-labelledby={titleId}>
      {person && views.length > 1 && onPick ? (
        <SegmentedControl<string>
          ariaLabel="누구 생활비를 볼까요"
          block
          value={person.view.accountId}
          onChange={onPick}
          options={views.map((v) => ({ value: v.accountId, label: v.accountId === myAccountId ? `${v.name} (나)` : v.name }))}
        />
      ) : null}
      <h2 id={titleId} className={styles.heroLabel}>
        {title}
      </h2>
      <Money amount={Math.max(0, hasDaily ? living.todayAvailable : living.remaining)} hero animate as="p" style={{ margin: 0 }} />
      {hasDaily && living.items.length > 1 ? <p className={styles.heroNote}>{dailyNames} 합계</p> : null}
      {hasDaily && spentToday > 0 ? (
        // 큰 숫자가 '오늘 써도 되는 돈'(오늘 쓴 돈을 뺀 값)이라 오늘 쓴 돈만 더해요. 안 썼으면 '0원' 줄은 없어요
        <p className={styles.heroToday}>
          오늘 쓴 돈 <strong>{formatWon(spentToday)}</strong>
        </p>
      ) : null}
      {over ? (
        <p className={styles.over}>
          <Icon name="alert-triangle" size={20} />
          오늘 {formatWon(-living.todayAvailable)} 넘었어요
        </p>
      ) : null}
      <div className={styles.heroBar}>
        <ProgressBar
          value={living.spent}
          max={living.monthBudget}
          label="이번 달 생활비 사용"
          valueText={`${formatWon(living.monthBudget)} 중 ${formatWon(living.spent)} 썼어요`}
          tone={tone}
          track="brand"
        />
        <div className={styles.heroMeta}>
          {living.remaining >= 0 ? (
            <span>
              이번 달 남은 생활비 <strong>{formatWon(living.remaining)}</strong>
            </span>
          ) : (
            <span className={styles.bad}>
              이번 달 생활비를 <strong className={styles.bad}>{formatWon(-living.remaining)}</strong> 넘었어요
            </span>
          )}
          <span>{living.daysLeft}일 남음</span>
        </div>
        <div className={styles.heroMeta}>
          <span>
            {formatNumber(living.spent)} / {formatWon(living.monthBudget)} 썼어요
            {living.carryIn !== 0 ? ` · 지난달 이월 ${formatWon(living.carryIn)} 포함` : ''}
          </span>
        </div>
      </div>
      {person && household ? (
        <ul className={styles.heroOthers} aria-label="다른 사람과 합계">
          {others.map((v) => (
            <li key={v.accountId}>
              <span>{v.name}</span>
              <OtherAmount living={v.status} />
            </li>
          ))}
          <li>
            <span>{views.length === 2 ? '둘이 합쳐' : '모두 합쳐'}</span>
            <OtherAmount living={household} />
          </li>
        </ul>
      ) : null}
    </Card>
  );
}

/** 다른 사람 · 합계 한 줄의 금액: 하루 항목에 오늘 쓴 돈이 있거나 넘었으면 하루 예산 한 줄, 아니면 큰 숫자와 같은 금액 */
function OtherAmount({ living }: { living: LivingStatus }) {
  const daily = living.items.some((i) => i.spread === 'daily');
  const spent = daily ? dailySpentToday(living) : 0;
  if (daily && (spent > 0 || living.todayAvailable < 0)) return <DailyLine spent={spent} available={living.todayAvailable} />;
  return <strong>{formatWon(Math.max(0, headline(living)))}</strong>;
}

/* ───────── 생활비 항목 ───────── */
