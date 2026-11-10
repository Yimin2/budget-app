import { describe, expect, it } from 'vitest';
import { createDemoLedger } from './defaults';
import { expenseSpender } from './spender';
import type { Expense, LedgerData } from './types';

const TODAY = '2026-11-20';
const NOW = '2026-11-20T01:00:00.000Z';

function couple(): LedgerData {
  return createDemoLedger(TODAY, NOW, { couple: true });
}

function expense(over: Partial<Expense>): Expense {
  return {
    id: 'x',
    date: TODAY,
    amount: 1000,
    accountId: 'demo-acc-event',
    categoryId: null,
    memo: '',
    eventId: null,
    fixedExpenseId: null,
    author: 'minji@demo',
    createdAt: NOW,
    updatedAt: NOW,
    deleted: false,
    ...over,
  };
}

const who = (data: LedgerData, e: Expense) => {
  const s = expenseSpender(data, e);
  return { key: s.key, name: s.name, source: s.source, other: s.recordedByOther, recorder: s.recorderName };
};

describe('실제로 쓴 사람', () => {
  it('1) 청구의 낸 사람이 가장 먼저 (통장 주인 · 기록한 사람보다)', () => {
    const data = couple();
    expect(who(data, expense({ accountId: 'demo-acc-living-minji', paidBy: '준호' }))).toEqual({
      key: 'junho@demo', name: '준호', source: 'payer', other: true, recorder: '민지',
    });
  });

  it('청구에 적힌 이름이 가계부의 사람이 아니면 그 이름 그대로', () => {
    const data = couple();
    expect(who(data, expense({ paidBy: ' 가온 ' }))).toMatchObject({ key: 'name:가온', name: '가온', source: 'payer', other: true });
  });

  it('2) 개인 통장에서 나갔으면 그 통장 주인 (누가 썼나요에서 고른 사람의 생활비 통장 포함)', () => {
    const data = couple();
    expect(who(data, expense({ accountId: 'demo-acc-living-junho' }))).toEqual({
      key: 'junho@demo', name: '준호', source: 'account', other: true, recorder: '민지',
    });
    expect(who(data, expense({ accountId: 'demo-acc-allowance-minji' }))).toMatchObject({ key: 'minji@demo', other: false });
  });

  it('주인이 멤버와 이어지지 않은 통장이면 주인 이름', () => {
    const data = couple();
    data.accounts.push({ ...data.accounts[0]!, id: 'acc-mom', name: '엄마 통장', ownerName: '엄마', ownerEmail: null });
    expect(who(data, expense({ accountId: 'acc-mom' }))).toMatchObject({ key: 'name:엄마', name: '엄마', source: 'account', other: true });
  });

  it('3) 함께 쓰는 통장(주인 없음)이면 기록한 사람, 대소문자는 가리지 않아요', () => {
    const data = couple();
    expect(who(data, expense({ accountId: 'demo-acc-event', author: 'JUNHO@demo' }))).toEqual({
      key: 'junho@demo', name: '준호', source: 'recorder', other: false, recorder: '준호',
    });
  });
});
