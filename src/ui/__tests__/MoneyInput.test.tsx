// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Field, MoneyInput } from '../Field';
import { parseDigits } from '../format';

afterEach(cleanup);

function Controlled({ initial = null as number | null, onValue }: { initial?: number | null; onValue?: (v: number | null) => void }) {
  const [v, setV] = useState<number | null>(initial);
  return (
    <Field label="금액" hint="원 단위로 적어요">
      <MoneyInput
        value={v}
        onChange={(n) => {
          setV(n);
          onValue?.(n);
        }}
      />
    </Field>
  );
}

describe('parseDigits', () => {
  it('숫자만 골라 정수로 바꿔요', () => {
    expect(parseDigits('21,400')).toBe(21400);
    expect(parseDigits('0012')).toBe(12);
    expect(parseDigits('abc')).toBeNull();
    expect(parseDigits('')).toBeNull();
    expect(parseDigits('0')).toBe(0);
  });
});

describe('MoneyInput', () => {
  it('숫자 키패드와 라벨 연결', () => {
    render(<Controlled />);
    const input = screen.getByLabelText('금액') as HTMLInputElement;
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('aria-describedby')).toContain('hint');
  });

  it('입력하면 쉼표를 넣고 숫자를 돌려줘요', () => {
    const onValue = vi.fn();
    render(<Controlled onValue={onValue} />);
    const input = screen.getByLabelText('금액') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1234567' } });
    expect(input.value).toBe('1,234,567');
    expect(onValue).toHaveBeenLastCalledWith(1234567);

    fireEvent.change(input, { target: { value: '1,234,5a67원' } });
    expect(input.value).toBe('1,234,567');

    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    expect(onValue).toHaveBeenLastCalledWith(null);
  });

  it('바깥 값이 바뀌면 따라가요', () => {
    const { rerender } = render(<MoneyInput aria-label="금액" value={4500} onChange={() => {}} />);
    const input = screen.getByLabelText('금액') as HTMLInputElement;
    expect(input.value).toBe('4,500');
    rerender(<MoneyInput aria-label="금액" value={null} onChange={() => {}} />);
    expect(input.value).toBe('');
    rerender(<MoneyInput aria-label="금액" value={90000} onChange={() => {}} />);
    expect(input.value).toBe('90,000');
  });
});
