import { describe, expect, it } from 'vitest';
import { createDemoLedger } from './defaults';
import { incomeAccountsToMerge } from './internal';
import type { LedgerData } from './types';

/** 월급통장은 하나만 (2026-11): 수입통장이 여럿이면 하나로 모으고 나머지는 각자 통장으로 */
describe('incomeAccountsToMerge', () => {
  const demo = (): LedgerData => createDemoLedger('2026-11-20', '2026-11-20T09:00:00.000Z');

  it('수입통장이 둘이면 배분이 나가는 통장 하나만 남기고, 배분 · 월급 · 배분 이체를 그 통장으로 옮겨요', () => {
    const data = demo();
    const m = incomeAccountsToMerge(data);
    expect(m.hubId).toBe('demo-acc-income');
    // 남긴 월급통장은 주인을 비워 '함께'로, 준호 통장은 각자 월급 받는 통장으로
    expect(m.accounts.map((a) => [a.id, a.payee ?? false, a.ownerName])).toEqual([
      ['demo-acc-income', false, null],
      ['demo-acc-income-junho', true, '준호'],
    ]);
    expect(m.rules.length).toBeGreaterThan(0);
    expect(m.rules.every((r) => r.fromAccountId === 'demo-acc-income')).toBe(true);
    const salary = m.transfers.find((t) => t.id === 'demo-salary-junho');
    expect(salary?.toAccountId).toBe('demo-acc-income');
    // 옮긴 뒤에는 준호 통장으로 받은 월급 · 거기서 나간 배분 이체가 남지 않아요
    const moved = new Map(m.transfers.map((t) => [t.id, t]));
    const after = data.transfers.map((t) => moved.get(t.id) ?? t).filter((t) => !t.deleted);
    expect(after.some((t) => t.kind === 'income' && t.toAccountId === 'demo-acc-income-junho')).toBe(false);
    expect(after.some((t) => t.ruleId !== null && t.fromAccountId === 'demo-acc-income-junho')).toBe(false);
  });

  it("이름에 '월급'이 있는 통장을 먼저 남기고, 다시 해도 같아요", () => {
    const data = demo();
    data.accounts = data.accounts.map((a) => (a.id === 'demo-acc-income-junho' ? { ...a, name: '월급통장' } : a));
    const m = incomeAccountsToMerge(data);
    expect(m.hubId).toBe('demo-acc-income-junho');
    const byId = new Map(m.accounts.map((a) => [a.id, a]));
    const after: LedgerData = { ...data, accounts: data.accounts.map((a) => byId.get(a.id) ?? a) };
    const again = incomeAccountsToMerge(after);
    expect(again.accounts).toEqual([]);
    expect(again.hubId).toBe('demo-acc-income-junho');
  });

  it('수입통장이 하나면 주인만 비우고(함께), 그 밖에는 안 바꿔요', () => {
    const data = demo();
    data.accounts = data.accounts.filter((a) => a.id !== 'demo-acc-income-junho');
    const m = incomeAccountsToMerge(data);
    expect(m.accounts.map((a) => [a.id, a.ownerName, a.ownerEmail])).toEqual([['demo-acc-income', null, null]]);
    const after: LedgerData = { ...data, accounts: data.accounts.map((a) => m.accounts.find((x) => x.id === a.id) ?? a) };
    expect(incomeAccountsToMerge(after).accounts).toEqual([]);
    expect(m.rules).toEqual([]);
    expect(m.transfers).toEqual([]);
  });
});
