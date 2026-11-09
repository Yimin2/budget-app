import type { ReactNode } from 'react';
import type { Signal, Verdict } from '@/domain/types';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

export const SIGNAL_LABEL: Record<Signal, string> = { ok: '괜찮아요', warn: '가능하지만', bad: '비추천' };

const SIGNAL_ICON: Record<Exclude<Signal, 'warn'>, IconName> = { ok: 'check', bad: 'x' };

export interface SignalIconProps {
  signal: Signal;
  /** md 44px(기본) · sm 24px */
  size?: 'md' | 'sm';
  /** 글자 없이 아이콘만 쓸 때 화면 읽기용 이름 (기본: 장식) */
  label?: string;
  className?: string;
}

/** 신호등 동그라미 (괜찮아요 체크 · 가능하지만 느낌표 · 비추천 X). 색만으로 전하지 않도록 모양이 달라요 */
export function SignalIcon({ signal, size = 'md', label, className }: SignalIconProps) {
  const px = size === 'sm' ? 16 : 24;
  return (
    <span
      className={cx('signal-icon', signal, size === 'sm' && 'sm', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {signal === 'warn' ? (
        <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
          <path d="M12 7v6M12 17h.01" />
        </svg>
      ) : (
        <Icon name={SIGNAL_ICON[signal as Exclude<Signal, 'warn'>]} size={px} strokeWidth={2.4} />
      )}
    </span>
  );
}

export interface VerdictCardProps {
  verdict: Pick<Verdict, 'signal' | 'title' | 'message' | 'details' | 'when'>;
  /** 상세 줄과 '언제' 줄 사이에 넣을 것 (예: 이벤트통장 예측 막대) */
  children?: ReactNode;
  /** 결과가 바뀔 때 화면 읽기 프로그램에 알려요 (기본 true) */
  live?: boolean;
  /** 제목 태그 (기본 h2) */
  headingLevel?: 2 | 3;
  className?: string;
}

/** "사도 돼?" 결과 판. 상태색 연한 바탕 + 아이콘 + 제목 + 문구 + 상세 + 언제 줄 */
export function VerdictCard({ verdict, children, live = true, headingLevel = 2, className }: VerdictCardProps) {
  const H = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <section
      className={cx('verdict', verdict.signal, className)}
      aria-live={live ? 'polite' : undefined}
      aria-atomic={live ? true : undefined}
      data-signal={verdict.signal}
    >
      <div className="head">
        <SignalIcon signal={verdict.signal} />
        <div className="txt">
          <H className="title">{verdict.title || SIGNAL_LABEL[verdict.signal]}</H>
          <p className="msg">{verdict.message}</p>
        </div>
      </div>
      {verdict.details.length > 0 ? (
        <dl className="rows">
          {verdict.details.map((d, i) => (
            <div key={`${d.label}-${i}`}>
              <dt>{d.label}</dt>
              <dd>{d.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children}
      {verdict.when ? (
        <p className="when" style={{ margin: 0 }}>
          <Icon name="clock" size={16} />
          <span>{verdict.when}</span>
        </p>
      ) : null}
    </section>
  );
}
