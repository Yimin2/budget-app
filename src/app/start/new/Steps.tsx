'use client';

import type { Dispatch, SetStateAction } from 'react';
import { formatWon } from '@/domain';
import type { Account, LedgerKind } from '@/domain/types';
import type { LedgerRef } from '@/storage/types';
import { Banner, Button, Chip, ChipGroup, DateInput, Field, Icon, MoneyInput, Select, TextInput } from '@/ui';
import {
  ALLOC_TARGETS, BILL_SUGGESTIONS, DAY_OPTIONS, draftKey,
  type AllocRole, type AllocationSummary, type AllowanceDraft, type BillDraft, type DraftErrors,
} from './wizard';

/* ───────── ① 종류 · 이름 ───────── */

export function StepBasics(props: {
  kind: LedgerKind;
  onKind: (k: LedgerKind) => void;
  name: string;
  onName: (v: string) => void;
  nameError?: string;
  link: string;
  onLink: (v: string) => void;
  sharedLedgers: LedgerRef[];
  disabled?: boolean;
}) {
  const { kind, onKind, name, onName, nameError, link, onLink, sharedLedgers, disabled } = props;
  return (
    <>
      <fieldset className="wz-options" disabled={disabled}>
        <legend>누구와 쓸까요?</legend>
        <label className="wz-opt">
          <input type="radio" name="wz-kind" value="shared" checked={kind === 'shared'} onChange={() => onKind('shared')} />
          <span className="txt">
            <strong>공용 가계부</strong>
            <span className="s">가족·연인과 함께 써요. 수입·고정지출·이벤트·저수지·저축투자 통장 5개로 시작해요.</span>
          </span>
        </label>
        <label className="wz-opt">
          <input type="radio" name="wz-kind" value="personal" checked={kind === 'personal'} onChange={() => onKind('personal')} />
          <span className="txt">
            <strong>개인 가계부</strong>
            <span className="s">혼자 쓰는 용돈 가계부예요. 공용 가계부에서 받은 용돈이 수입으로 들어와요.</span>
          </span>
        </label>
      </fieldset>

      <Field label="가계부 이름" error={nameError} required>
        <TextInput
          value={name}
          onChange={(e) => onName(e.target.value)}
          maxLength={40}
          autoComplete="off"
          disabled={disabled}
        />
      </Field>

      {kind === 'personal' ? (
        <Field
          label="공용 가계부 연결"
          optional
          hint={
            sharedLedgers.length > 0
              ? '연결하면 공용 가계부에서 나에게 배분한 용돈이 매달 수입으로 들어와요.'
              : '최근에 연 공용 가계부가 없어요. 공용 가계부를 먼저 한 번 열어 두면 여기에서 고를 수 있어요.'
          }
        >
          <Select
            value={link}
            onChange={onLink}
            disabled={disabled || sharedLedgers.length === 0}
            options={[
              { value: '', label: '연결하지 않기' },
              ...sharedLedgers.map((r) => ({ value: r.id, label: r.name || '이름 없는 공용 가계부' })),
            ]}
          />
        </Field>
      ) : null}
    </>
  );
}

/* ───────── ② 통장 시작 잔액 ───────── */

const ROLE_HINT: Partial<Record<Account['role'], string>> = {
  income: '월급이 처음 들어오는 통장',
  fixed: '월세·통신비 같은 고정비와 생활비가 나가는 통장',
  event: '경조사·여행·명절·큰 구매에 쓰는 통장',
  reservoir: '목돈·비상금',
  savings: '적금·투자',
  allowance: '용돈을 받고 쓰는 통장',
};

export function StepBalances(props: {
  accounts: Account[];
  values: Record<string, number | null>;
  onValue: (id: string, v: number | null) => void;
  date: string;
  onDate: (v: string) => void;
}) {
  const { accounts, values, onValue, date, onDate } = props;
  return (
    <div className="wz-rows">
      {accounts.map((acc) => (
        <Field key={acc.id} label={acc.name} hint={ROLE_HINT[acc.role]}>
          <MoneyInput
            value={acc.id in values ? (values[acc.id] ?? null) : acc.openingBalance || null}
            onChange={(v) => onValue(acc.id, v)}
          />
        </Field>
      ))}
      <Field label="잔액 기준일" hint="이 날짜의 잔액이에요. 이날부터의 기록이 잔액에 더해져요.">
        <DateInput value={date} onChange={onDate} required />
      </Field>
    </div>
  );
}

/* ───────── ③ 매달 배분 ───────── */

export function StepAllocation(props: {
  salary: number | null;
  onSalary: (v: number | null) => void;
  day: number;
  onDay: (d: number) => void;
  values: Record<AllocRole, number | null>;
  onValue: (role: AllocRole, v: number | null) => void;
  accountName: (role: AllocRole) => string | null;
  hasIncome: boolean;
  summary: AllocationSummary;
}) {
  const { salary, onSalary, day, onDay, values, onValue, accountName, hasIncome, summary } = props;
  return (
    <>
      {!hasIncome ? (
        <Banner tone="warning" title="수입통장이 없어요">
          매달 배분은 수입통장에서 보내요. 설정에서 수입 역할의 통장을 만든 뒤 정해 주세요.
        </Banner>
      ) : null}
      <div className="wz-rows">
        <Field label="한 달 월급" hint="합계를 확인하는 데만 써요. 월급이 들어오면 통장 화면에서 수입으로 기록해 주세요.">
          <MoneyInput value={salary} onChange={onSalary} />
        </Field>
        <Field label="배분하는 날" hint="월급날로 정하면 그날 각 통장으로 보낸 기록이 자동으로 생겨요.">
          <Select value={String(day)} onChange={(v) => onDay(Number(v))} options={DAY_OPTIONS} />
        </Field>
      </div>

      <section className="wz-section" aria-labelledby="wz-alloc-title">
        <h2 id="wz-alloc-title">수입통장에서 보낼 금액</h2>
        <div className="wz-rows">
          {ALLOC_TARGETS.map((t) => {
            const name = accountName(t.role);
            return (
              <Field key={t.role} label={name ?? t.label} hint={name ? t.hint : `${t.label}이 없어서 건너뛰어요`}>
                <MoneyInput value={values[t.role]} onChange={(v) => onValue(t.role, v)} disabled={!name || !hasIncome} />
              </Field>
            );
          })}
        </div>
      </section>

      <div className="wz-total" aria-live="polite">
        <div className="line">
          <span>배분 합계</span>
          <strong>{formatWon(summary.total)}</strong>
        </div>
        {summary.salary !== null ? (
          <div className="line">
            <span>월급</span>
            <strong>{formatWon(summary.salary)}</strong>
          </div>
        ) : null}
        {summary.state === 'under' && summary.left !== null ? (
          <div className="line">
            <span>수입통장에 남는 돈</span>
            <strong>{formatWon(summary.left)}</strong>
          </div>
        ) : null}
      </div>
      {summary.state === 'over' && summary.left !== null ? (
        <Banner tone="warning" title={`배분 합계가 월급보다 ${formatWon(-summary.left)} 많아요`}>
          이대로면 수입통장 잔액이 모자라요. 금액을 줄이거나 월급을 다시 확인해 주세요.
        </Banner>
      ) : null}
      {summary.state === 'even' ? (
        <Banner tone="success" title="월급을 남김없이 나눴어요" />
      ) : null}
    </>
  );
}

/* ───────── ④ 고정 지출 · 생활비 · 용돈 ───────── */

export function StepFixed(props: {
  isShared: boolean;
  living: number | null;
  onLiving: (v: number | null) => void;
  bills: BillDraft[];
  setBills: Dispatch<SetStateAction<BillDraft[]>>;
  allowances: AllowanceDraft[];
  setAllowances: Dispatch<SetStateAction<AllowanceDraft[]>>;
  billErrors: DraftErrors;
  allowanceErrors: DraftErrors;
}) {
  const { isShared, living, onLiving, bills, setBills, allowances, setAllowances, billErrors, allowanceErrors } = props;
  const used = new Set(bills.map((b) => b.name.trim()));
  const suggestions = BILL_SUGGESTIONS.filter((s) => !used.has(s));

  const patchBill = (key: string, patch: Partial<BillDraft>) =>
    setBills((list) => list.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  const patchAllowance = (key: string, patch: Partial<AllowanceDraft>) =>
    setAllowances((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <>
      <section className="wz-section" aria-labelledby="wz-living-title">
        <h2 id="wz-living-title">생활비</h2>
        <Field label="한 달 생활비" hint="하루 생활비와 '사도 돼?' 판단의 기준이에요. 고정지출통장에서 써요.">
          <MoneyInput value={living} onChange={onLiving} />
        </Field>
      </section>

      <section className="wz-section" aria-labelledby="wz-bills-title">
        <h2 id="wz-bills-title">고정 지출</h2>
        <p>월세·통신비처럼 매달 나가는 돈이에요. 결제일에 고정지출통장에서 나간 걸로 자동 기록돼요.</p>
        {bills.length > 0 ? (
          <ul className="wz-items">
            {bills.map((b, i) => {
              const err = billErrors[b.key];
              return (
                <li key={b.key}>
                  <div className="wz-item" role="group" aria-label={b.name.trim() || `고정 지출 ${i + 1}`}>
                    <div className="top">
                      <Field label="이름" error={err?.name}>
                        <TextInput value={b.name} onChange={(e) => patchBill(b.key, { name: e.target.value })} maxLength={30} />
                      </Field>
                      <Button
                        variant="ghost"
                        plain
                        iconOnly
                        icon="trash"
                        aria-label={`${b.name || '고정 지출'} 빼기`}
                        onClick={() => setBills((list) => list.filter((x) => x.key !== b.key))}
                      />
                    </div>
                    <div className="pair">
                      <Field label="금액" error={err?.amount}>
                        <MoneyInput value={b.amount} onChange={(v) => patchBill(b.key, { amount: v })} />
                      </Field>
                      <Field label="결제일">
                        <Select value={String(b.day)} onChange={(v) => patchBill(b.key, { day: Number(v) })} options={DAY_OPTIONS} />
                      </Field>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
        <ChipGroup label="고정 지출 추가">
          {suggestions.map((s) => (
            <Chip
              key={s}
              icon="plus"
              onClick={() => setBills((list) => [...list, { key: draftKey('bill'), name: s, amount: null, day: 1 }])}
            >
              {s}
            </Chip>
          ))}
          <Chip icon="plus" onClick={() => setBills((list) => [...list, { key: draftKey('bill'), name: '', amount: null, day: 1 }])}>
            직접 추가
          </Chip>
        </ChipGroup>
      </section>

      {isShared ? (
        <section className="wz-section" aria-labelledby="wz-allowance-title">
          <h2 id="wz-allowance-title">용돈</h2>
          <p>멤버에게 매달 주는 용돈이에요. 받는 사람의 개인 가계부에 수입으로 들어가요.</p>
          {allowances.length > 0 ? (
            <ul className="wz-items">
              {allowances.map((r, i) => {
                const err = allowanceErrors[r.key];
                return (
                  <li key={r.key}>
                    <div className="wz-item" role="group" aria-label={`용돈 ${i + 1}${r.name.trim() ? ` (${r.name.trim()})` : ''}`}>
                      <div className="top">
                        <Field label="받는 사람 이메일" error={err?.email}>
                          <TextInput
                            type="email"
                            inputMode="email"
                            autoComplete="off"
                            value={r.email}
                            onChange={(e) => patchAllowance(r.key, { email: e.target.value })}
                          />
                        </Field>
                        <Button
                          variant="ghost"
                          plain
                          iconOnly
                          icon="trash"
                          aria-label={`${r.name || r.email || '용돈'} 빼기`}
                          onClick={() => setAllowances((list) => list.filter((x) => x.key !== r.key))}
                        />
                      </div>
                      <Field label="이름" optional hint="기록에 '용돈(이름)'으로 보여요">
                        <TextInput value={r.name} onChange={(e) => patchAllowance(r.key, { name: e.target.value })} maxLength={20} />
                      </Field>
                      <div className="pair">
                        <Field label="금액" error={err?.amount}>
                          <MoneyInput value={r.amount} onChange={(v) => patchAllowance(r.key, { amount: v })} />
                        </Field>
                        <Field label="주는 날">
                          <Select value={String(r.day)} onChange={(v) => patchAllowance(r.key, { day: Number(v) })} options={DAY_OPTIONS} />
                        </Field>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <div>
            <Button
              variant="outline"
              icon="plus"
              onClick={() =>
                setAllowances((list) => [...list, { key: draftKey('al'), email: '', name: '', amount: null, day: 1 }])
              }
            >
              용돈 추가
            </Button>
          </div>
        </section>
      ) : null}
    </>
  );
}

/** 단계 아래 안내 한 줄 */
export function StepNote({ children }: { children: string }) {
  return (
    <p className="sp-note">
      <Icon name="info" size={16} />
      <span>{children}</span>
    </p>
  );
}
