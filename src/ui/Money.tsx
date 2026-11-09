import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import { formatAmount } from './format';

export interface MoneyProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  amount: number;
  /** 양수 앞에 '+' 를 붙여요 (음수는 항상 '-') */
  signed?: boolean;
  /** 부호에 따라 색 (양수 초록 · 음수 빨강). 색과 함께 부호 글자가 늘 보여요 */
  colored?: boolean;
  /** 단위 (기본 '원'). 빈 문자열이면 숫자만 */
  unit?: string;
  /** 홈 요약처럼 큰 숫자 (36~48px 800) */
  hero?: boolean;
  as?: 'span' | 'strong' | 'p' | 'dd' | 'div';
}

/** 금액 표시. 자릿수 맞춤(tabular-nums) */
export function Money({ amount, signed, colored, unit = '원', hero, as: Tag = 'span', className, ...rest }: MoneyProps) {
  const r = Math.round(Number.isFinite(amount) ? amount : 0);
  const text = `${signed && r > 0 ? '+' : ''}${formatAmount(r)}${unit}`;
  return (
    <Tag className={cx('money', colored && r > 0 && 'pos', colored && r < 0 && 'neg', hero && 'hero', className)} {...rest}>
      {text}
    </Tag>
  );
}
