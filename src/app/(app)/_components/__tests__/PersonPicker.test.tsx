// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { LedgerData } from '@/domain/types';
import { PersonPicker, peopleOptions, type PersonChoice, type PersonOption } from '../PersonPicker';

afterEach(cleanup);

const PEOPLE: PersonOption[] = [
  { name: '하늘', email: 'sky@example.com' },
  { name: '바다', email: 'sea@example.com' },
];

function Harness({ initial = { name: '', email: '' }, noneLabel, emailOnly }: { initial?: PersonChoice; noneLabel?: string; emailOnly?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <PersonPicker label="주인" people={PEOPLE} value={value} onChange={setValue} noneLabel={noneLabel} emailOnly={emailOnly} />
      <output data-testid="value">{`${value.name}|${value.email}`}</output>
    </>
  );
}

const shown = () => screen.getByTestId('value').textContent;

describe('PersonPicker', () => {
  it('함께 쓰는 사람을 고르면 이름과 이메일을 함께 채워요', () => {
    render(<Harness noneLabel="주인 없음" />);
    const select = screen.getByRole('combobox', { name: '주인' }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(['주인 없음', '하늘 · sky@example.com', '바다 · sea@example.com', '직접 입력']);
    fireEvent.change(select, { target: { value: 'sea@example.com' } });
    expect(shown()).toBe('바다|sea@example.com');
    expect(screen.queryByRole('group', { name: '주인 직접 입력' })).toBeNull();
    fireEvent.change(select, { target: { value: '' } });
    expect(shown()).toBe('|');
  });

  it("'직접 입력'이면 예전처럼 이름과 이메일 칸에 적어요", () => {
    render(<Harness />);
    const select = screen.getByRole('combobox', { name: '주인' }) as HTMLSelectElement;
    // 고르지 않았으면 안내 문구
    expect(select.value).toBe('');
    fireEvent.change(select, { target: { value: 'sky@example.com' } });
    expect(shown()).toBe('하늘|sky@example.com');
    // 고른 사람이 있다가 직접 입력으로 바꾸면 비우고 적게 해요
    fireEvent.change(select, { target: { value: '__manual__' } });
    expect(shown()).toBe('|');
    const manual = screen.getByRole('group', { name: '주인 직접 입력' });
    fireEvent.change(within(manual).getByLabelText('이름'), { target: { value: '구름' } });
    fireEvent.change(within(manual).getByLabelText(/이메일/), { target: { value: 'cloud@example.com' } });
    expect(shown()).toBe('구름|cloud@example.com');
    expect(select.value).toBe('__manual__');
  });

  it('저장된 값이 멤버가 아니면 직접 입력으로 열고, 멤버면 그 사람을 골라 둬요', () => {
    render(<Harness initial={{ name: '별', email: 'star@example.com' }} />);
    expect((screen.getByRole('combobox', { name: '주인' }) as HTMLSelectElement).value).toBe('__manual__');
    expect((within(screen.getByRole('group', { name: '주인 직접 입력' })).getByLabelText('이름') as HTMLInputElement).value).toBe('별');
    cleanup();
    render(<Harness initial={{ name: '', email: 'SKY@example.com' }} />);
    expect((screen.getByRole('combobox', { name: '주인' }) as HTMLSelectElement).value).toBe('sky@example.com');
  });

  it('이메일만 받으면 직접 입력에 이메일 칸만 있어요', () => {
    render(<Harness emailOnly />);
    fireEvent.change(screen.getByRole('combobox', { name: '주인' }), { target: { value: '__manual__' } });
    const manual = screen.getByRole('group', { name: '주인 직접 입력' });
    expect(within(manual).queryByLabelText('이름')).toBeNull();
    fireEvent.change(within(manual).getByLabelText(/이메일/), { target: { value: 'rain@example.com' } });
    expect(shown()).toBe('|rain@example.com');
  });

  it('peopleOptions: 멤버(이어진 통장 주인 이름 먼저) + 따로 준 사람, 같은 이메일은 한 번', () => {
    const data = {
      accounts: [
        { id: 'a', name: '생활비', role: 'fixed', openingBalance: 0, openingDate: '2026-11-01', order: 0, ownerName: '하늘', ownerEmail: 'sky@example.com', deleted: false },
      ],
      members: [
        { email: 'sky@example.com', displayName: '김하늘' },
        { email: 'sea@example.com', displayName: '바다' },
      ],
    } as unknown as LedgerData;
    expect(peopleOptions(data, [{ name: '나', email: 'SEA@example.com' }, { name: '새 사람', email: 'new@example.com' }])).toEqual([
      { name: '하늘', email: 'sky@example.com' },
      { name: '바다', email: 'sea@example.com' },
      { name: '새 사람', email: 'new@example.com' },
    ]);
    expect(peopleOptions(null, [{ name: '', email: 'me@example.com' }])).toEqual([{ name: 'me', email: 'me@example.com' }]);
  });
});
