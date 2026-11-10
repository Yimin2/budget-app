import { Icon, cx } from '@/ui';

export interface StepperProps {
  steps: string[];
  /** 지금 단계 (0부터) */
  current: number;
  className?: string;
}

/** 단계 표시: 끝낸 단계는 체크, 지금 단계는 굵게. 좁은 화면에서는 지금 단계 이름만 보여요 */
export function Stepper({ steps, current, className }: StepperProps) {
  return (
    <ol className={cx('wz-steps', className)} aria-label={`${steps.length}단계 중 ${current + 1}단계`}>
      {steps.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'now' : 'todo';
        return (
          <li key={label} className={cx('wz-step', state)} aria-current={state === 'now' ? 'step' : undefined}>
            <span className="c" aria-hidden>
              {state === 'done' ? <Icon name="check" size={16} strokeWidth={2.4} className="mo-check" /> : i + 1}
            </span>
            <span className="l">
              {label}
              {state === 'done' ? <span className="sr-only"> (끝남)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
