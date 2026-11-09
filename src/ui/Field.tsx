'use client';

import {
  createContext, useContext, useId, useLayoutEffect, useRef, useState, type AriaAttributes,
  type ChangeEvent, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { cx } from './cx';
import { formatAmount, parseDigits } from './format';
import { Icon } from './Icon';

/* ───────── Field: 라벨 · 도움말 · 오류를 입력과 연결해요 ───────── */

interface FieldCtx {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}
const FieldContext = createContext<FieldCtx | null>(null);

export interface FieldProps {
  label: ReactNode;
  /** 입력 아래 보조 설명 */
  hint?: ReactNode;
  /** 오류 문구. 있으면 aria-invalid 와 함께 보여요 */
  error?: ReactNode;
  required?: boolean;
  /** 라벨 옆 '(선택)' 표시 */
  optional?: boolean;
  /** 입력 id 를 직접 정할 때 */
  id?: string;
  /** 라벨을 눈에는 숨기고 화면 읽기에만 */
  hideLabel?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, required = false, optional, id, hideLabel, className, children }: FieldProps) {
  const auto = useId();
  const inputId = id ?? `f${auto.replace(/:/g, '')}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errId = error ? `${inputId}-err` : undefined;
  const describedBy = [errId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <FieldContext.Provider value={{ id: inputId, describedBy, invalid: Boolean(error), required }}>
      <div className={cx('field', className)}>
        <label htmlFor={inputId} className={cx('label', hideLabel && 'sr-only')}>
          {label}
          {required ? (
            <span className="req" aria-hidden>
              *
            </span>
          ) : null}
          {optional ? <span className="opt-text">(선택)</span> : null}
        </label>
        {children}
        {error ? (
          <span id={errId} className="hint err">
            <Icon name="alert-circle" size={16} />
            {error}
          </span>
        ) : null}
        {hint ? (
          <span id={hintId} className="hint">
            {hint}
          </span>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

function useFieldProps(props: { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: AriaAttributes['aria-invalid']; required?: boolean }) {
  const ctx = useContext(FieldContext);
  return {
    id: props.id ?? ctx?.id,
    'aria-describedby': props['aria-describedby'] ?? ctx?.describedBy,
    'aria-invalid': props['aria-invalid'] ?? (ctx?.invalid ? true : undefined),
    required: props.required ?? (ctx?.required || undefined),
  };
}

/* ───────── TextInput ───────── */

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export function TextInput({ className, type = 'text', ...rest }: TextInputProps) {
  const f = useFieldProps(rest);
  return <input type={type} className={cx('input', className)} {...rest} {...f} />;
}

/* ───────── DateInput (YYYY-MM-DD) ───────── */

export interface DateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
}

export function DateInput({ value, onChange, className, ...rest }: DateInputProps) {
  const f = useFieldProps(rest);
  return (
    <input
      type="date"
      className={cx('input', className)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
      {...f}
    />
  );
}

/* ───────── Textarea ───────── */

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, ...rest }: TextareaProps) {
  const f = useFieldProps(rest);
  return <textarea className={cx('input', className)} {...rest} {...f} />;
}

/* ───────── Select ───────── */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  value: string;
  onChange: (value: string) => void;
  options?: SelectOption[];
  /** 고르지 않은 상태 문구 (value 가 '' 일 때) */
  placeholder?: string;
}

export function Select({ value, onChange, options, placeholder, className, children, ...rest }: SelectProps) {
  const f = useFieldProps(rest);
  return (
    <span className={cx('select', className)}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} {...rest} {...f}>
        {placeholder !== undefined ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <Icon name="chevron-down" size={20} />
    </span>
  );
}

/* ───────── MoneyInput: 숫자 키패드 · 쉼표 자동 · value 는 원(정수) 또는 null ───────── */

export interface MoneyInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode' | 'size'> {
  value: number | null;
  onChange: (value: number | null) => void;
  /** 오른쪽 단위 글자 (기본 '원'). 빈 문자열이면 숨겨요 */
  unit?: string;
  /** lg: 64px 높이 큰 숫자 (사도 돼? 금액 등) */
  size?: 'md' | 'lg';
  /** 상한 (기본 999조) */
  max?: number;
  /**
   * 마이너스 금액도 받아요 (마이너스통장 잔액 등). 앞에 '-'를 치거나 옆 '마이너스' 버튼으로 부호를 바꿔요.
   * 휴대폰 숫자 키패드에는 '-'가 없어서 버튼을 함께 보여 줘요
   */
  allowNegative?: boolean;
}

/** 부호까지 읽어요 ('-300,000' → -300000). 숫자가 없으면 null */
function parseSigned(text: string, allowNegative: boolean): number | null {
  const n = parseDigits(text);
  if (n === null) return null;
  return allowNegative && /^\s*-/.test(text) ? -n : n;
}

function digitsBefore(text: string, caret: number): number {
  let n = 0;
  for (let i = 0; i < caret && i < text.length; i++) if (/\d/.test(text[i]!)) n++;
  return n;
}
function caretForDigits(text: string, digits: number): number {
  if (digits <= 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (/\d/.test(text[i]!)) n++;
    if (n === digits) return i + 1;
  }
  return text.length;
}

export function MoneyInput({
  value, onChange, unit = '원', size = 'md', max = 999_999_999_999_999, className, placeholder = '0', onBlur, allowNegative = false,
  ...rest
}: MoneyInputProps) {
  const f = useFieldProps(rest);
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => (value === null ? '' : formatAmount(allowNegative ? value : Math.abs(value))));
  const pendingCaret = useRef<number | null>(null);

  // 바깥에서 value 가 바뀌면 글자를 맞춰요 (입력 중 같은 값이면 그대로). 렌더 중 이전 값과 비교하는 방식
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    if (parseSigned(text, allowNegative) !== value) setText(value === null ? '' : formatAmount(value));
  }

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pendingCaret.current !== null && document.activeElement === el) {
      let pos = caretForDigits(text, pendingCaret.current);
      if (pos === 0 && text.startsWith('-')) pos = 1;
      el.setSelectionRange(pos, pos);
    }
    pendingCaret.current = null;
  }, [text]);

  const negative = allowNegative && text.trim().startsWith('-');

  function commit(digits: number | null, neg: boolean) {
    let next = digits;
    if (next !== null && next > max) next = max;
    const signed = next === null ? null : neg && next !== 0 ? -next : next;
    setText(next === null ? (neg ? '-' : '') : neg && next !== 0 ? formatAmount(-next) : formatAmount(next));
    if (signed !== value) onChange(signed);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const caret = e.target.selectionStart ?? raw.length;
    // 맨 앞 0 이 지워져도 커서가 어긋나지 않게 숫자 개수로 위치를 계산해요
    const lead = /^0+(?=\d)/.exec(raw.replace(/\D/g, ''))?.[0].length ?? 0;
    const before = Math.max(0, digitsBefore(raw, caret) - lead);
    pendingCaret.current = before;
    commit(parseDigits(raw), allowNegative && /^\s*-/.test(raw));
  }

  function toggleSign() {
    commit(parseDigits(text), !negative);
    ref.current?.focus();
  }

  const field = (
    <span className={cx('money-input', size === 'lg' && 'lg', !allowNegative && className)}>
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        enterKeyHint="done"
        className="input"
        value={text}
        placeholder={placeholder}
        onChange={handleChange}
        onBlur={onBlur}
        {...rest}
        {...f}
      />
      {unit ? (
        <span className="unit" aria-hidden>
          {unit}
        </span>
      ) : null}
    </span>
  );
  if (!allowNegative) return field;
  return (
    <span className={cx('money-signed', className)}>
      <button type="button" className="money-sign" aria-pressed={negative} onClick={toggleSign}>
        마이너스
      </button>
      {field}
    </span>
  );
}

/**
 * 검사에 걸린 첫 칸(aria-invalid)으로 포커스를 옮겨요. 오류 문구가 그려진 뒤에 찾도록 다음 틱에 실행해요.
 * 열린 창이 있으면 그 안에서 먼저 찾아요
 */
export function focusFirstInvalid(): void {
  if (typeof window === 'undefined') return;
  setTimeout(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const el =
      dialog?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? document.querySelector<HTMLElement>('[aria-invalid="true"]');
    el?.focus();
  }, 0);
}
