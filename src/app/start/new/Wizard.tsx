'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { monthOf } from '@/domain';
import type { AllocationRule, FixedExpense, LedgerKind } from '@/domain/types';
import { useLedger, useSession } from '@/state';
import type { LedgerRef } from '@/storage/types';
import { Button, LoadingBlock, useToast } from '@/ui';
import { LedgerLoadError } from '@/app/(app)/_components/RequireLedger';
import { Stepper } from '../_components/Stepper';
import { StepAllocation, StepBalances, StepBasics, StepFixed, StepNote } from './Steps';
import {
  ALLOC_TARGETS, DEFAULT_NAMES, allocationSummary, diffByKey, draftKey, validateAllowances, validateBills,
  wantedFixed, wantedRules, type AllocRole, type AllowanceDraft, type BillDraft, type DraftErrors,
} from './wizard';

const STEPS: Record<LedgerKind, string[]> = {
  shared: ['종류·이름', '시작 잔액', '매달 배분', '고정 지출'],
  personal: ['종류·이름', '시작 잔액'],
};

const HEADS: Record<string, { title: string; desc: string }> = {
  '종류·이름': { title: '새 가계부 만들기', desc: '누구와 쓸 가계부인지 고르고 이름을 정해 주세요.' },
  '시작 잔액': {
    title: '통장 시작 잔액',
    desc: '지금 은행 앱에 보이는 잔액을 적어 주세요. 다르면 나중에 통장 화면에서 언제든 맞출 수 있어요.',
  },
  '매달 배분': { title: '매달 배분', desc: '월급이 들어오면 수입통장에서 각 통장으로 보낼 금액이에요.' },
  '고정 지출': { title: '고정 지출과 생활비', desc: '매달 나가는 돈과 한 달 생활비를 정해 주세요.' },
};

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** 새 가계부 만들기: ① 종류·이름 → (만들기) → ② 시작 잔액 → ③ 매달 배분 → ④ 고정 지출 → 홈 */
export function Wizard() {
  const session = useSession();
  const ledger = useLedger();
  const router = useRouter();
  const toast = useToast();
  const user = session.user;

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<LedgerRef | null>(null);

  // ① 종류 · 이름
  const [kind, setKind] = useState<LedgerKind>('shared');
  const [name, setName] = useState<string>(DEFAULT_NAMES.shared);
  const [nameTouched, setNameTouched] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>();
  const [link, setLink] = useState('');

  // ② 시작 잔액
  const [balances, setBalances] = useState<Record<string, number | null>>({});
  const [openingDate, setOpeningDate] = useState('');

  // ③ 매달 배분
  const [salary, setSalary] = useState<number | null>(null);
  const [allocDay, setAllocDay] = useState(1);
  const [alloc, setAlloc] = useState<Record<AllocRole, number | null>>({ fixed: null, event: null, savings: null, reservoir: null });
  const [savedRules, setSavedRules] = useState<Record<string, AllocationRule>>({});

  // ④ 고정 지출
  const [living, setLiving] = useState<number | null>(null);
  const [bills, setBills] = useState<BillDraft[]>([]);
  const [allowances, setAllowances] = useState<AllowanceDraft[]>(() => [
    { key: draftKey('al'), email: user?.email ?? '', name: user?.name ?? '', amount: null, day: 1 },
  ]);
  const [savedFixed, setSavedFixed] = useState<Record<string, FixedExpense>>({});
  const [billErrors, setBillErrors] = useState<DraftErrors>({});
  const [allowanceErrors, setAllowanceErrors] = useState<DraftErrors>({});

  const steps = STEPS[kind];
  const stepName = steps[step] ?? steps[0]!;
  const head = HEADS[stepName]!;
  const isLast = step === steps.length - 1;
  const ledgerReady = created !== null && ledger.ref?.id === created.id && ledger.data !== null;
  const month = monthOf(ledger.today);
  const sharedLedgers = session.recentLedgers.filter((r) => r.kind === 'shared');
  const summary = allocationSummary(
    salary,
    ALLOC_TARGETS.map((t) => alloc[t.role]),
  );

  function chooseKind(k: LedgerKind) {
    setKind(k);
    if (!nameTouched) setName(DEFAULT_NAMES[k]);
  }

  function finish() {
    toast.success('가계부를 만들었어요');
    router.replace('/');
  }

  function goNext() {
    if (isLast) finish();
    else setStep((s) => s + 1);
  }

  /* ---------- 단계별 저장 ---------- */

  /** false 면 이름이 비어 있어 멈춰요 */
  async function createLedger(): Promise<boolean> {
    if (!name.trim()) {
      setNameError('가계부 이름을 입력해 주세요');
      return false;
    }
    setNameError(undefined);
    const ref = await session.createLedger({
      kind,
      name: name.trim(),
      sharedLedgerId: kind === 'personal' && link ? link : null,
    });
    setCreated(ref);
    return true;
  }

  async function saveBalances() {
    const date = openingDate || ledger.today;
    for (const acc of ledger.activeAccounts) {
      const value = acc.id in balances ? (balances[acc.id] ?? 0) : acc.openingBalance;
      if (value !== acc.openingBalance || date !== acc.openingDate) {
        await ledger.saveAccount({ ...acc, openingBalance: value, openingDate: date });
      }
    }
  }

  async function saveRules() {
    const income = ledger.accountByRole('income');
    const wanted = wantedRules(
      { incomeAccountId: income?.id ?? null, month, day: allocDay },
      ALLOC_TARGETS.map((t) => ({ role: t.role, accountId: ledger.accountByRole(t.role)?.id ?? null, amount: alloc[t.role] })),
    );
    const { add, update, remove } = diffByKey(savedRules, wanted);
    const next = { ...savedRules };
    try {
      for (const a of add) next[a.key] = await ledger.addRule(a.input);
      for (const u of update) {
        await ledger.saveRule(u.row);
        next[u.key] = u.row;
      }
      for (const r of remove) {
        await ledger.saveRule(r.row);
        delete next[r.key];
      }
    } finally {
      setSavedRules(next);
    }
  }

  /** false 면 입력 오류가 있어 멈춰요 */
  async function saveFixed(): Promise<boolean> {
    const bErr = validateBills(bills);
    const aErr = kind === 'shared' ? validateAllowances(allowances) : {};
    setBillErrors(bErr);
    setAllowanceErrors(aErr);
    if (Object.keys(bErr).length > 0 || Object.keys(aErr).length > 0) {
      toast.error('입력한 내용을 확인해 주세요');
      return false;
    }
    const account = ledger.accountByRole('fixed') ?? ledger.activeAccounts[0];
    if (!account) throw new Error('고정 지출을 기록할 통장이 없어요');
    const wanted = wantedFixed({ accountId: account.id, month }, living, bills, kind === 'shared' ? allowances : []);
    const { add, update, remove } = diffByKey(savedFixed, wanted);
    const next = { ...savedFixed };
    try {
      for (const a of add) next[a.key] = await ledger.addFixed(a.input);
      for (const u of update) {
        await ledger.saveFixed(u.row);
        next[u.key] = u.row;
      }
      for (const r of remove) {
        await ledger.saveFixed(r.row);
        delete next[r.key];
      }
    } finally {
      setSavedFixed(next);
    }
    return true;
  }

  async function submit() {
    setBusy(true);
    try {
      if (step === 0) {
        if (await createLedger()) setStep(1);
        return;
      }
      if (stepName === '시작 잔액') await saveBalances();
      else if (stepName === '매달 배분') await saveRules();
      else if (stepName === '고정 지출') {
        const ok = await saveFixed();
        if (!ok) return;
      }
      goNext();
    } catch (e) {
      toast.error(errorText(e, '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요'));
    } finally {
      setBusy(false);
    }
  }

  /* ---------- 그리기 ---------- */

  let body: ReactNode;
  if (step === 0) {
    body = (
      <StepBasics
        kind={kind}
        onKind={chooseKind}
        name={name}
        onName={(v) => {
          setName(v);
          setNameTouched(true);
          if (nameError && v.trim()) setNameError(undefined);
        }}
        nameError={nameError}
        link={link}
        onLink={setLink}
        sharedLedgers={sharedLedgers}
        disabled={busy}
      />
    );
  } else if (!ledgerReady) {
    body =
      created && ledger.ref?.id === created.id && ledger.status === 'error' ? (
        <LedgerLoadError message={ledger.error} onRetry={ledger.reload} />
      ) : (
        <LoadingBlock label="가계부를 준비하고 있어요" />
      );
  } else if (stepName === '시작 잔액') {
    body = (
      <StepBalances
        accounts={ledger.activeAccounts}
        values={balances}
        onValue={(id, v) => setBalances((m) => ({ ...m, [id]: v }))}
        date={openingDate || ledger.today}
        onDate={setOpeningDate}
      />
    );
  } else if (stepName === '매달 배분') {
    body = (
      <StepAllocation
        salary={salary}
        onSalary={setSalary}
        day={allocDay}
        onDay={setAllocDay}
        values={alloc}
        onValue={(role, v) => setAlloc((m) => ({ ...m, [role]: v }))}
        accountName={(role) => ledger.accountByRole(role)?.name ?? null}
        hasIncome={ledger.accountByRole('income') !== null}
        summary={summary}
      />
    );
  } else {
    body = (
      <StepFixed
        isShared={kind === 'shared'}
        living={living}
        onLiving={setLiving}
        bills={bills}
        setBills={setBills}
        allowances={allowances}
        setAllowances={setAllowances}
        billErrors={billErrors}
        allowanceErrors={allowanceErrors}
      />
    );
  }

  const canGoBack = step >= 2;
  const stepText = `${steps.length}단계 중 ${step + 1}단계, ${head.title}`;
  const canSkip = step >= 1 && ledgerReady;
  const primaryLabel = step === 0 ? '가계부 만들기' : isLast ? '완료' : '다음';

  return (
    <form
      className="stack gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && (step === 0 || ledgerReady)) void submit();
      }}
      noValidate
    >
      <Stepper steps={steps} current={step} />
      <div className="wz-head">
        <StepHeading step={step} title={head.title} announce={stepText} />
        <p>{head.desc}</p>
      </div>

      {body}

      {step === 1 ? <StepNote>건너뛰면 잔액 0원으로 시작해요. 설정에서 언제든 바꿀 수 있어요.</StepNote> : null}
      {step >= 2 ? <StepNote>지금 정하지 않아도 돼요. 설정에서 언제든 추가하고 고칠 수 있어요.</StepNote> : null}

      <div className="wz-actions">
        {canGoBack ? (
          <Button variant="outline" icon="arrow-left" onClick={() => setStep((s) => s - 1)} disabled={busy}>
            이전
          </Button>
        ) : step === 0 ? (
          <Button variant="ghost" href={session.activeLedger ? '/' : '/start'}>
            취소
          </Button>
        ) : null}
        <span className="grow" />
        {canSkip ? (
          <Button variant="ghost" onClick={goNext} disabled={busy}>
            {isLast ? '나중에 할게요' : '건너뛰기'}
          </Button>
        ) : null}
        <Button type="submit" loading={busy} disabled={step > 0 && !ledgerReady} iconRight={isLast ? undefined : 'arrow-right'}>
          {primaryLabel}
        </Button>
      </div>
    </form>
  );
}

/** 단계가 바뀌면 새 제목으로 포커스를 옮기고 몇 단계인지 알려요 (키보드·화면 읽기 사용자가 바뀐 걸 알 수 있게) */
function StepHeading({ step, title, announce }: { step: number; title: string; announce: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    ref.current?.focus();
    setMessage(announce);
    // 단계가 바뀔 때만 (같은 단계에서 제목 글자가 바뀌어도 다시 알리지 않음)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  return (
    <>
      <h1 ref={ref} tabIndex={-1}>
        {title}
      </h1>
      <p className="sr-only" aria-live="polite">
        {message}
      </p>
    </>
  );
}
