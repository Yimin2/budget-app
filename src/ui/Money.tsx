import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import { formatAmount } from './format';
import { useAnimatedNumber } from './motion';

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
  /**
   * 값이 바뀌면 이전 값에서 세어 가요 (320ms). 화면 읽기에는 최종 값만 읽혀요.
   * 움직임 줄이기 설정이면 바로 바뀌어요
   */
  animate?: boolean;
}

/** 금액 표시. 자릿수 맞춤(tabular-nums) */
export function Money({ amount, animate, ...props }: MoneyProps) {
  const r = Math.round(Number.isFinite(amount) ? amount : 0);
  if (animate) return <AnimatedMoney amount={r} {...props} />;
  return <StaticMoney amount={r} {...props} />;
}

function textOf(r: number, signed: boolean | undefined, unit: string) {
  return `${signed && r > 0 ? '+' : ''}${formatAmount(r)}${unit}`;
}

function StaticMoney({ amount: r, signed, colored, unit = '원', hero, as: Tag = 'span', className, ...rest }: Omit<MoneyProps, 'animate'>) {
  return (
    <Tag className={cx('money', colored && r > 0 && 'pos', colored && r < 0 && 'neg', hero && 'hero', className)} {...rest}>
      {textOf(r, signed, unit)}
    </Tag>
  );
}

function AnimatedMoney({ amount: r, signed, colored, unit = '원', hero, as: Tag = 'span', className, ...rest }: Omit<MoneyProps, 'animate'>) {
  const shown = useAnimatedNumber(r);
  const cls = cx('money', colored && r > 0 && 'pos', colored && r < 0 && 'neg', hero && 'hero', className);
  if (shown === r) {
    return (
      <Tag className={cls} {...rest}>
        {textOf(r, signed, unit)}
      </Tag>
    );
  }
  // 세는 동안: 보이는 숫자는 화면 읽기에서 숨기고 최종 값만 읽혀요
  return (
    <Tag className={cls} {...rest}>
      <span aria-hidden>{textOf(shown, signed, unit)}</span>
      <span className="sr-only">{textOf(r, signed, unit)}</span>
    </Tag>
  );
}
