/* UI 표시용 숫자 서식. 도메인 계산과 무관하게 UI 키트만으로 동작하도록 따로 둬요. */

function group(abs: number): string {
  return String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 21400 → '21,400' · -500 → '-500' */
export function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n);
  if (r === 0) return '0';
  return (r < 0 ? '-' : '') + group(Math.abs(r));
}

/** 21400 → '21,400원' */
export function formatMoney(n: number): string {
  return `${formatAmount(n)}원`;
}

/** 숫자 입력 문자열에서 정수 원. 숫자가 없으면 null. 15자리까지만 받아요 */
export function parseDigits(input: string): number | null {
  const digits = input.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 15);
  if (digits === '') return null;
  return Number(digits);
}
