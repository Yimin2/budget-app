/* 테스트 도우미: 통장 고르기(AccountPicker)에서 통장 하나를 골라요 */
import { fireEvent } from '@testing-library/react';

/** 단추(라벨로 찾은 것)를 눌러 펼치고 그 통장 줄을 눌러요 */
export function pickAccount(trigger: HTMLElement, accountId: string): void {
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
  const listId = trigger.getAttribute('aria-controls');
  const list = listId ? document.getElementById(listId) : null;
  if (!list) throw new Error('통장 목록이 열리지 않았어요');
  const option = list.querySelector<HTMLElement>(`[role="option"][data-value="${accountId}"]`);
  if (!option) throw new Error(`목록에 ${accountId} 통장이 없어요`);
  fireEvent.click(option);
}

/** 펼친 목록의 통장 id (보이는 순서) */
export function listedAccounts(trigger: HTMLElement): string[] {
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
  const list = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
  return [...(list?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].map((o) => o.dataset.value ?? '');
}
