/* 예산 화면 테스트 도우미: 접힌 칸 펼치기 · 들어오는 돈 줄 고치기 (작업정리 8-3) */
import { fireEvent, screen, within } from '@testing-library/react';

/** 제목(h2)으로 카드 찾기 (수입 계획 · 매달 배분 · 생활비 정리) */
export function card(title: string): HTMLElement {
  return screen.getByRole('heading', { level: 2, name: title }).closest('.card') as HTMLElement;
}

/** 통장 카드 사람 탭 고르기 (민지 · 준호 · 함께) */
export function pickOwner(name: string): void {
  fireEvent.click(within(screen.getByRole('radiogroup', { name: '누구 통장' })).getByRole('radio', { name }));
}

/** 통장 카드의 들어오는 돈 줄(매달 배분 · 수입 계획)을 눌러 그 자리 고치기 칸을 열고 그 칸을 돌려줘요 */
export function openIncoming(account: string, row: RegExp, index = 0): HTMLElement {
  const btn = within(accountCard(account)).getAllByRole('button', { name: row })[index]!;
  if (btn.getAttribute('aria-expanded') !== 'true') fireEvent.click(btn);
  return document.getElementById(btn.getAttribute('aria-controls')!)!;
}

/** 통장 카드 (h3 제목 = 통장 이름) */
export function accountCard(name: string): HTMLElement {
  return screen.getByRole('heading', { level: 3, name }).closest('article') as HTMLElement;
}

/** 통장 카드의 나가는 돈 한 줄(고정비 · 할부 · 생활비 예산)을 펼치고 펼친 칸을 돌려줘요 */
export function openOut(account: string, label: '고정비' | '할부' | '생활비 예산'): HTMLElement {
  const btn = within(accountCard(account)).getByRole('button', { name: new RegExp(`^${account.replace(/[()]/g, '\\$&')} ${label} (펼치기|접기)$`) });
  if (btn.getAttribute('aria-expanded') !== 'true') fireEvent.click(btn);
  return document.getElementById(btn.getAttribute('aria-controls')!)!;
}
