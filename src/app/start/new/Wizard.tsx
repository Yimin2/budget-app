'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { monthOf, newId } from '@/domain';
import type { Account, AllocationRule, FixedExpense, IncomePlan, LedgerKind } from '@/domain/types';
import { useLedger, useSession } from '@/state';
import type { LedgerRef } from '@/storage/types';
import { Button, LoadingBlock, cx, useToast } from '@/ui';
import { LedgerLoadError } from '@/app/(app)/_components/RequireLedger';
import { peopleOptions } from '@/app/(app)/_components/PersonPicker';
import { Stepper } from '../_components/Stepper';
import { StepAllocation, StepBalances, StepBasics, StepFixed, StepLiving, StepNote } from './Steps';
import {
  DEFAULT_NAMES, SALARY_ACCOUNT_NAME, activeEarners, allowanceAccountName, allowanceRuleIdForWizard, defaultLivingDrafts, diffByKey,
  fixedTargets, newEarner, validateBills, validateEarners, wantedAllowanceRules, wantedFixed, wantedIncomePlans, wantedLiving,
  wantedRestRules, wantedRules,
  type BillDraft, type DraftErrors, type EarnerDraft, type LivingDraft,
} from './wizard';

const STEPS: Record<LedgerKind, string[]> = {
  shared: ['종류·이름', '시작 잔액', '매달 배분', '고정 지출', '생활비'],
  personal: ['종류·이름', '시작 잔액'],
};

const HEADS: Record<string, { title: string; desc: string }> = {
  '종류·이름': { title: '새 가계부 만들기', desc: '누구와 쓸 가계부인지 고르고 이름을 정해 주세요.' },
  '시작 잔액': {
    title: '통장 시작 잔액',
    desc: '지금 은행 앱에 보이는 잔액을 적어 주세요. 다르면 나중에 내역의 통장 잔액에서 언제든 맞출 수 있어요.',
  },
  '매달 배분': {
    title: '매달 배분',
    desc: '버는 사람마다 월급과 월급날을 적어 주세요. 월급은 모두 월급통장 하나로 들어와요. 월급날마다 각 통장과 용돈 통장으로 보낼 금액을 정해요.',
  },
  '고정 지출': { title: '고정 지출', desc: '월세·통신비처럼 매달 나가는 돈을 정해 주세요.' },
  '생활비': {
    title: '생활비 예산',
    desc: '항목마다 한 달 예산을 정해 주세요. 매일 쓰는 건 하루에 나눠 쓰고, 가끔 쓰는 건 한 달 한도만 봐요.',
  },
};

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** 새 가계부 만들기: ① 종류·이름 → (만들기) → ② 시작 잔액 → ③ 매달 배분(사람별 수입통장) → ④ 고정 지출 → ⑤ 생활비 → 홈 */
export function Wizard() {
  const session = useSession();
  const ledger = useLedger();
  const router = useRouter();
  const toast = useToast();
  const user = session.user;

  const [step, setStep] = useState(0);
  // 단계 전환 방향: 다음 단계는 오른쪽에서, 이전 단계는 왼쪽에서 들어와요 (처음 그림은 움직이지 않아요)
  const [stepTrack, setStepTrack] = useState<{ step: number; dir: 'next' | 'prev' | null }>({ step: 0, dir: null });
  if (stepTrack.step !== step) setStepTrack({ step, dir: step > stepTrack.step ? 'next' : 'prev' });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<LedgerRef | null>(null);

  // ① 종류 · 이름
  const [kind, setKind] = useState<LedgerKind>('shared');
  const [name, setName] = useState<string>(DEFAULT_NAMES.shared);
  const [nameTouched, setNameTouched] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>();

  // ② 시작 잔액
  const [balances, setBalances] = useState<Record<string, number | null>>({});
  const [openingDate, setOpeningDate] = useState('');

  // ③ 매달 배분 (버는 사람마다 수입 계획, 월급은 모두 월급통장 하나로)
  const [earners, setEarners] = useState<EarnerDraft[]>(() => [newEarner(user?.name ?? '', user?.email ?? '')]);
  const [earnerErrors, setEarnerErrors] = useState<DraftErrors>({});
  /** 사람 키 → 저장한 수입 계획 */
  const [savedPlans, setSavedPlans] = useState<Record<string, IncomePlan>>({});
  const [savedRules, setSavedRules] = useState<Record<string, AllocationRule>>({});
  /** 사람 키 → 마법사가 만든 용돈 통장 */
  const [savedWallets, setSavedWallets] = useState<Record<string, Account>>({});

  // ④ 고정 지출
  const [bills, setBills] = useState<BillDraft[]>([]);
  const [savedFixed, setSavedFixed] = useState<Record<string, FixedExpense>>({});
  const [billErrors, setBillErrors] = useState<DraftErrors>({});

  // ⑤ 생활비 항목 (가계부가 준비되면 기본 카테고리로 채워요)
  const [livingRows, setLivingRows] = useState<LivingDraft[] | null>(null);
  const [savedLiving, setSavedLiving] = useState<Record<string, FixedExpense>>({});

  const steps = STEPS[kind];
  const stepName = steps[step] ?? steps[0]!;
  const head = HEADS[stepName]!;
  const isLast = step === steps.length - 1;
  const ledgerReady = created !== null && ledger.ref?.id === created.id && ledger.data !== null;
  const month = monthOf(ledger.today);
  const livingDrafts = livingRows ?? [];
  // 사람 고르기: 만드는 나 + (이미 있으면) 이 가계부 멤버
  const people = peopleOptions(ledgerReady ? ledger.data : null, user ? [{ name: user.name ?? '', email: user.email }] : []);

  function chooseKind(k: LedgerKind) {
    setKind(k);
    if (!nameTouched) setName(DEFAULT_NAMES[k]);
  }

  function finish() {
    toast.success('가계부를 만들었어요');
    router.replace('/');
  }

  function goNext() {
    if (isLast) {
      finish();
      return;
    }
    // 생활비 단계에 처음 들어갈 때 기본 항목을 채워요 (금액은 비워 둬요)
    if (steps[step + 1] === '생활비' && livingRows === null) setLivingRows(defaultLivingDrafts(ledger.activeCategories));
    setStep((s) => s + 1);
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
      sharedLedgerId: null,
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

  /** 함께 쓰는 월급통장: 처음 만든 수입통장 이름을 '월급통장'으로 (주인 없음) */
  async function saveSalaryAccount() {
    const acc = ledger.accountByRole('income');
    if (!acc) return null;
    if (acc.name !== SALARY_ACCOUNT_NAME || acc.ownerName !== null || acc.ownerEmail !== null) {
      const row = { ...acc, name: SALARY_ACCOUNT_NAME, ownerName: null, ownerEmail: null };
      await ledger.saveAccount(row);
      return row;
    }
    return acc;
  }

  /** 용돈이 있는 사람마다 '<이름> 용돈' 통장 (역할 용돈, 주인 = 그 사람). 이미 만든 통장은 이름 · 주인만 맞춰요 */
  async function saveWallets(list: EarnerDraft[]): Promise<Record<string, Account>> {
    const next = { ...savedWallets };
    try {
      for (const e of list) {
        if (!(e.allowance && e.allowance > 0)) continue;
        const fields = { name: allowanceAccountName(e.name), ownerName: e.name.trim() || null, ownerEmail: e.email.trim() || null };
        const prev = next[e.key];
        if (!prev) {
          next[e.key] = await ledger.addAccount({ ...fields, role: 'allowance', openingBalance: 0 });
        } else if (prev.name !== fields.name || prev.ownerName !== fields.ownerName || prev.ownerEmail !== fields.ownerEmail) {
          const row = { ...prev, ...fields };
          await ledger.saveAccount(row);
          next[e.key] = row;
        }
      }
    } finally {
      setSavedWallets(next);
    }
    return next;
  }

  /** 용돈을 뺀 사람의 (마법사가 만든) 용돈 통장은 지움 표시 */
  async function dropWallets(list: EarnerDraft[], wallets: Record<string, Account>) {
    const next = { ...wallets };
    try {
      for (const [key, acc] of Object.entries(wallets)) {
        const e = list.find((x) => x.key === key);
        if (e && e.allowance && e.allowance > 0) continue;
        await ledger.saveAccount({ ...acc, deleted: true });
        delete next[key];
      }
    } finally {
      setSavedWallets(next);
    }
  }

  /** false 면 입력 오류가 있어 멈춰요 */
  async function saveRules(): Promise<boolean> {
    const errs = validateEarners(earners);
    setEarnerErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error('입력한 내용을 확인해 주세요');
      return false;
    }
    const list = activeEarners(earners);
    const salary = await saveSalaryAccount();
    const incomeAccountId = salary?.id ?? null;
    const wallets = incomeAccountId ? await saveWallets(list) : savedWallets;

    // 수입 계획 (사람마다)
    const plans = diffByKey(savedPlans, wantedIncomePlans({ accountId: incomeAccountId, month }, list));
    const nextPlans = { ...savedPlans };
    try {
      for (const a of plans.add) nextPlans[a.key] = await ledger.addIncomePlan(a.input);
      for (const u of plans.update) {
        await ledger.saveIncomePlan(u.row);
        nextPlans[u.key] = u.row;
      }
      for (const r of plans.remove) {
        await ledger.saveIncomePlan(r.row);
        delete nextPlans[r.key];
      }
    } finally {
      setSavedPlans(nextPlans);
    }

    // 월급날마다 정한 금액 + 남은 돈은 저수지로
    const wanted = [
      ...list.flatMap((e) =>
        wantedRules(
          { incomeAccountId, month, day: e.day, keyPrefix: e.key },
          fixedTargets(e).map((t) => ({ role: t.role, accountId: ledger.accountByRole(t.role)?.id ?? null, amount: e.alloc[t.role] })),
        ),
      ),
      ...wantedAllowanceRules({ incomeAccountId, month }, list, (e) => wallets[e.key]?.id ?? null),
      ...wantedRestRules({ incomeAccountId, reservoirAccountId: ledger.accountByRole('reservoir')?.id ?? null, month }, list),
    ];
    const { add, update, remove } = diffByKey(savedRules, wanted);
    const next = { ...savedRules };
    try {
      // 지우기를 먼저 (같은 날 나머지 규칙을 다른 사람에게 옮길 때 겹치지 않게)
      for (const r of remove) {
        await ledger.saveRule(r.row);
        delete next[r.key];
      }
      for (const a of add) {
        // 용돈 배분은 정한 금액 그대로 두도록 표시한 id 로 (8-2)
        const id = a.key.endsWith(':allowance') ? allowanceRuleIdForWizard(newId()) : undefined;
        next[a.key] = await ledger.addRule(id ? { ...a.input, id } : a.input);
      }
      for (const u of update) {
        await ledger.saveRule(u.row);
        next[u.key] = u.row;
      }
    } finally {
      setSavedRules(next);
    }
    await dropWallets(list, wallets);
    return true;
  }

  /** false 면 입력 오류가 있어 멈춰요 */
  async function saveFixed(): Promise<boolean> {
    const bErr = validateBills(bills);
    setBillErrors(bErr);
    if (Object.keys(bErr).length > 0) {
      toast.error('입력한 내용을 확인해 주세요');
      return false;
    }
    const account = ledger.accountByRole('fixed') ?? ledger.activeAccounts[0];
    if (!account) throw new Error('고정 지출을 기록할 통장이 없어요');
    const wanted = wantedFixed({ accountId: account.id, month }, bills);
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

  async function saveLiving() {
    const account = ledger.accountByRole('fixed') ?? ledger.activeAccounts[0];
    if (!account) throw new Error('생활비를 쓸 통장이 없어요');
    const wanted = wantedLiving({ accountId: account.id, month }, livingDrafts);
    const { add, update, remove } = diffByKey(savedLiving, wanted);
    const next = { ...savedLiving };
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
      setSavedLiving(next);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      if (step === 0) {
        if (await createLedger()) setStep(1);
        return;
      }
      if (stepName === '시작 잔액') await saveBalances();
      else if (stepName === '매달 배분') {
        if (!(await saveRules())) return;
      } else if (stepName === '고정 지출') {
        if (!(await saveFixed())) return;
      } else if (stepName === '생활비') await saveLiving();
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
        earners={earners}
        setEarners={setEarners}
        errors={earnerErrors}
        accountName={(role) => ledger.accountByRole(role)?.name ?? null}
        salaryAccountName={SALARY_ACCOUNT_NAME}
        people={people}
      />
    );
  } else if (stepName === '생활비') {
    body = (
      <StepLiving
        rows={livingDrafts}
        setRows={(update) => setLivingRows((prev) => update(prev ?? []))}
        categories={ledger.activeCategories}
        accountName={(ledger.accountByRole('fixed') ?? ledger.activeAccounts[0])?.name ?? null}
      />
    );
  } else {
    body = (
      <StepFixed bills={bills} setBills={setBills} billErrors={billErrors} />
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
      <div key={step} className={cx('stack gap-6', stepTrack.dir === 'next' && 'mo-step-next', stepTrack.dir === 'prev' && 'mo-step-prev')}>
        <div className="wz-head">
          <StepHeading step={step} title={head.title} announce={stepText} />
          <p>{head.desc}</p>
        </div>

        {body}
      </div>

      {step === 1 ? <StepNote>건너뛰면 잔액 0원으로 시작해요. 설정에서 언제든 바꿀 수 있어요.</StepNote> : null}
      {step >= 2 ? <StepNote>지금 정하지 않아도 돼요. 예산 화면에서 언제든 추가하고 고칠 수 있어요.</StepNote> : null}

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
