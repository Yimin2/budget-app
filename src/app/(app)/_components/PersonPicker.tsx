'use client';

import { useState, type ReactNode } from 'react';
import { ledgerPeople } from '@/domain';
import type { LedgerData } from '@/domain/types';
import { Field, Select, TextInput } from '@/ui';
import './screens.css';

/** 고른 사람: 이름과 이메일을 함께 채워요 */
export interface PersonChoice {
  name: string;
  email: string;
}

/** 고르기 목록의 사람 한 명 */
export interface PersonOption {
  name: string;
  email: string;
}

export interface PersonPickerProps {
  label: string;
  /** 이 가계부를 함께 쓰는 사람들 (peopleOptions(data)) */
  people: PersonOption[];
  value: PersonChoice;
  onChange: (next: PersonChoice) => void;
  /** 아무도 고르지 않는 선택지 (예: '함께 쓰는 통장 (주인 없음)'). 없으면 '사람 고르기' 안내만 */
  noneLabel?: string;
  required?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  /** 사람을 고르지 않았을 때 오류 */
  error?: ReactNode;
  /** 직접 입력: 이름 칸 오류 */
  nameError?: ReactNode;
  /** 직접 입력: 이메일 칸 오류 */
  emailError?: ReactNode;
  /** 직접 입력: 이메일 칸 아래 안내 */
  emailHint?: ReactNode;
  /** 직접 입력에서 이메일이 꼭 있어야 하면 (용돈 받는 사람) */
  emailRequired?: boolean;
  /** 이메일만 받아요 (이름 칸 없음) */
  emailOnly?: boolean;
}

const MANUAL = '__manual__';

function lower(s: string): string {
  return s.trim().toLowerCase();
}

/** '민지 · minji@demo' */
export function personOptionLabel(p: PersonOption): string {
  return p.email ? `${p.name} · ${p.email}` : p.name;
}

/** 이 가계부를 함께 쓰는 사람들 (멤버 + 이어진 통장 주인 이름). extra 는 아직 멤버가 아닌 사람 (예: 새 가계부를 만드는 나) */
export function peopleOptions(data: LedgerData | null, extra: PersonOption[] = []): PersonOption[] {
  const out: PersonOption[] = [];
  const push = (p: PersonOption) => {
    const email = p.email.trim();
    if (!email || out.some((x) => lower(x.email) === lower(email))) return;
    out.push({ name: p.name.trim() || email.split('@')[0] || email, email });
  };
  for (const p of data ? ledgerPeople(data) : []) push(p);
  for (const m of data?.members ?? []) push({ name: m.displayName, email: m.email });
  for (const p of extra) push(p);
  return out;
}

function matchOf(people: PersonOption[], value: PersonChoice): PersonOption | undefined {
  const email = lower(value.email);
  return email ? people.find((p) => lower(p.email) === email) : undefined;
}

/**
 * 사람 고르기: 함께 쓰는 사람을 '이름 · 이메일'로 고르면 이름과 이메일이 함께 채워져요.
 * 아직 초대하지 않은 사람은 '직접 입력'을 골라 이름과 이메일을 적어요. 함께 쓰는 사람이 없으면 바로 입력 칸이에요.
 */
export function PersonPicker({
  label, people, value, onChange, noneLabel, required, optional, hint, error, nameError, emailError, emailHint,
  emailRequired, emailOnly,
}: PersonPickerProps) {
  const match = matchOf(people, value);
  const filled = value.name.trim() !== '' || value.email.trim() !== '';
  // 처음 열 때: 함께 쓰는 사람과 이메일이 같으면 그 사람, 아니고 값이 있으면 직접 입력
  const [manual, setManual] = useState(() => people.length === 0 || (!match && filled));
  const showManual = people.length === 0 || manual || (!match && filled);
  const selectValue = showManual ? MANUAL : (match?.email ?? '');

  const options = [
    ...(noneLabel ? [{ value: '', label: noneLabel }] : []),
    ...people.map((p) => ({ value: p.email, label: personOptionLabel(p) })),
    { value: MANUAL, label: '직접 입력' },
  ];

  function pick(v: string) {
    if (v === MANUAL) {
      setManual(true);
      // 고른 사람이 있었으면 비우고 적게 해요
      if (match) onChange({ name: '', email: '' });
      return;
    }
    setManual(false);
    if (!v) {
      onChange({ name: '', email: '' });
      return;
    }
    const p = people.find((x) => x.email === v);
    if (p) onChange({ name: p.name, email: p.email });
  }

  const nameField = emailOnly ? null : (
    <Field label={people.length === 0 ? label : '이름'} required={required} optional={people.length === 0 ? optional : undefined} error={nameError} hint={people.length === 0 ? hint : undefined}>
      <TextInput value={value.name} maxLength={20} autoComplete="off" onChange={(e) => onChange({ ...value, name: e.target.value })} />
    </Field>
  );
  const emailField = (
    <Field
      label={emailOnly && people.length === 0 ? label : '이메일'}
      required={emailRequired}
      optional={!emailRequired}
      error={emailError}
      hint={emailHint}
    >
      <TextInput
        type="email"
        inputMode="email"
        autoComplete="off"
        value={value.email}
        onChange={(e) => onChange({ ...value, email: e.target.value })}
      />
    </Field>
  );

  if (people.length === 0) {
    return (
      <>
        {nameField}
        {emailField}
      </>
    );
  }

  return (
    <>
      <Field label={label} required={required} optional={optional} error={showManual ? undefined : error} hint={hint}>
        <Select value={selectValue} onChange={pick} options={options} placeholder={noneLabel ? undefined : '사람 고르기'} />
      </Field>
      {showManual ? (
        <div className="pp-manual" role="group" aria-label={`${label} 직접 입력`}>
          {nameField}
          {emailField}
        </div>
      ) : null}
    </>
  );
}
