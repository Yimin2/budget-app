// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Money } from '../Money';
import { VerdictCard } from '../Verdict';

afterEach(cleanup);

describe('VerdictCard', () => {
  it('신호를 색만이 아니라 제목 글자와 문구로 보여 줘요', () => {
    render(
      <VerdictCard
        verdict={{
          signal: 'warn',
          title: '가능하지만',
          message: '사면 남은 날 하루 생활비가 18,500원이 돼요',
          details: [
            { label: '오늘 써도 되는 돈', value: '21,400원' },
            { label: '산 뒤 하루 생활비', value: '18,500원' },
          ],
          when: '하루 15,000원씩만 쓰면 9일 뒤에 살 수 있어요',
        }}
      />,
    );
    expect(screen.getByRole('heading', { name: '가능하지만' })).toBeTruthy();
    expect(screen.getByText('사면 남은 날 하루 생활비가 18,500원이 돼요')).toBeTruthy();
    expect(screen.getByText('오늘 써도 되는 돈').nextElementSibling?.textContent).toBe('21,400원');
    expect(screen.getByText(/9일 뒤에 살 수 있어요/)).toBeTruthy();
    const section = screen.getByRole('heading').closest('section')!;
    expect(section.className).toContain('warn');
    expect(section.getAttribute('aria-live')).toBe('polite');
  });

  it('제목이 비면 신호 이름을 써요', () => {
    render(<VerdictCard verdict={{ signal: 'bad', title: '', message: '이번 달 생활비를 50,000원 넘어요', details: [], when: null }} />);
    expect(screen.getByRole('heading', { name: '비추천' })).toBeTruthy();
    expect(screen.queryByRole('term')).toBeNull();
  });
});

describe('Money', () => {
  it('원 단위 쉼표와 부호', () => {
    const { container } = render(
      <>
        <Money amount={21400} />
        <Money amount={-5000} colored />
        <Money amount={3000} signed colored />
      </>,
    );
    const spans = container.querySelectorAll('.money');
    expect(spans[0]!.textContent).toBe('21,400원');
    expect(spans[1]!.textContent).toBe('-5,000원');
    expect(spans[1]!.className).toContain('neg');
    expect(spans[2]!.textContent).toBe('+3,000원');
  });
});
