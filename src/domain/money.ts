import type { Won } from './types';

function groupDigits(abs: number): string {
  return String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 21400 → '21,400원'. 음수는 '-21,400원' */
export function formatWon(n: Won): string {
  return `${formatNumber(n)}원`;
}

/** 숫자만 — 21400 → '21,400' */
export function formatNumber(n: Won): string {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n);
  if (r === 0) return '0';
  return (r < 0 ? '-' : '') + groupDigits(Math.abs(r));
}

/**
 * 만 원 단위 짧은 금액 — 2970000 → '297만', 828000 → '82.8만', 1272600 → '127.26만', 5000 → '0.5만', 0 → '0원'.
 * 1만 원 아래 · 만 단위로 끝나지 않는 금액도 소수로 (원 단위까지 정확)
 */
export function formatMan(n: Won): string {
  if (!Number.isFinite(n)) return '0원';
  const r = Math.round(n);
  if (r === 0) return '0원';
  const abs = Math.abs(r);
  const whole = Math.floor(abs / 10000);
  const rest = abs % 10000;
  const frac = rest === 0 ? '' : `.${String(rest).padStart(4, '0').replace(/0+$/, '')}`;
  return `${r < 0 ? '-' : ''}${groupDigits(whole)}${frac}만`;
}

const UNIT_RE = /^(?:(\d+(?:\.\d+)?)억)?(?:(\d+(?:\.\d+)?)만)?(?:(\d+(?:\.\d+)?)천)?(\d+)?$/;

/** '21,400원' / '21400' / ' 2만 ' 같은 입력에서 정수 원. 해석 불가면 null. '만' 단위 지원 */
export function parseWon(input: string): Won | null {
  if (typeof input !== 'string') return null;
  const s = input.replace(/[\s,]/g, '').replace(/원$/, '');
  if (s === '') return null;
  const m = UNIT_RE.exec(s);
  if (!m) return null;
  const [, eok, man, cheon, rest] = m;
  if (eok === undefined && man === undefined && cheon === undefined && rest === undefined) return null;
  const value =
    (eok ? Number(eok) * 100_000_000 : 0) +
    (man ? Number(man) * 10_000 : 0) +
    (cheon ? Number(cheon) * 1_000 : 0) +
    (rest ? Number(rest) : 0);
  if (!Number.isFinite(value)) return null;
  return Math.round(value);
}

/** 100원 단위 내림 (하루 생활비 표시용) */
export function floorTo100(n: Won): Won {
  if (!Number.isFinite(n)) return 0;
  return Math.floor(n / 100) * 100 + 0;
}

/** 1000원 단위 올림 (적립액 제안용) */
export function ceilTo1000(n: Won): Won {
  if (!Number.isFinite(n)) return 0;
  return Math.ceil(n / 1000) * 1000 + 0;
}
