import { describe, expect, it } from 'vitest';
import { account, emptyLedger } from './_fixtures';
import { claimAccountFor, claimPayers } from './claims';
import { DEMO_MEMBERS, createDemoLedger } from './defaults';
import { ledgerPeople, linkAccountsToEmail, personByEmail } from './people';
import type { LedgerData } from './types';

const incSora = account('income', { id: 'inc-s', name: '소라 수입통장', ownerName: '소라', order: 0 });
const incHana = account('income', { id: 'inc-h', name: '하나 수입통장', ownerName: '하나', order: 1 });
const fixed = account('fixed', { id: 'fixed', order: 2 });

function ledger(p: Partial<LedgerData>): LedgerData {
  return emptyLedger({ accounts: [incSora, incHana, fixed], ...p });
}

describe('이 가계부의 사람들 (ledgerPeople)', () => {
  it('주인 이메일이 같으면 이어져 통장 주인 이름으로 불러요 (대소문자 무시)', () => {
    const d = ledger({
      accounts: [{ ...incSora, ownerEmail: 'Sora@Example.com' }, incHana, fixed],
      members: [{ email: 'sora@example.com', displayName: '최소라 (Google)' }],
    });
    expect(ledgerPeople(d)).toEqual([
      { email: 'sora@example.com', name: '소라', displayName: '최소라 (Google)', accountId: 'inc-s' },
    ]);
    expect(claimPayers(d)).toEqual(['소라']);
    expect(claimAccountFor(d, '소라')).toBe('inc-s');
    // 예전에 표시 이름으로 적힌 청구도 같은 통장으로 돌려받아요
    expect(claimAccountFor(d, '최소라 (Google)')).toBe('inc-s');
  });

  it('이메일이 없으면 표시 이름이 주인 이름으로 끝날 때 이어요 (성 + 이름)', () => {
    const d = ledger({ members: [{ email: 's@x', displayName: '최소라' }] });
    expect(personByEmail(d, 'S@X')).toEqual({ email: 's@x', name: '소라', displayName: '최소라', accountId: 'inc-s' });
    expect(claimPayers(d)).toEqual(['소라']);
  });

  it('이름으로 맞는 멤버가 여럿이면 잇지 않아요', () => {
    const d = ledger({
      members: [
        { email: 'a@x', displayName: '최소라' },
        { email: 'b@x', displayName: '박소라' },
      ],
    });
    expect(ledgerPeople(d).map((p) => [p.name, p.accountId])).toEqual([
      ['최소라', null],
      ['박소라', null],
    ]);
    expect(claimAccountFor(d, '최소라')).toBeNull();
  });

  it('어느 멤버와도 이어지지 않은 통장 주인은 낸 사람으로 고를 수 없어요', () => {
    const d = ledger({ members: [{ email: 's@x', displayName: '최소라' }, { email: 'j@x', displayName: '도윤' }] });
    expect(claimPayers(d)).toEqual(['소라', '도윤']);
    expect(claimPayers(d)).not.toContain('하나');
    // 예전 청구에 적힌 이름은 통장 주인으로 그대로 찾아요
    expect(claimAccountFor(d, '하나')).toBe('inc-h');
  });

  it('이메일로 이어진 멤버는 이름으로 다시 잇지 않고, 같은 사람 · 같은 이름은 한 번만', () => {
    const d = ledger({
      accounts: [incSora, { ...incHana, ownerEmail: 's@x' }, fixed],
      members: [
        { email: 's@x', displayName: '소라' },
        { email: 'S@X', displayName: '소라' },
        { email: 'k@x', displayName: '하나' },
      ],
    });
    const people = ledgerPeople(d);
    expect(people.map((p) => [p.email, p.name, p.accountId])).toEqual([
      ['s@x', '하나', 'inc-h'],
      ['k@x', '하나', null],
    ]);
    expect(claimPayers(d)).toEqual(['하나']);
  });

  it('체험 가계부: 민지 · 준호가 각자 수입통장과 이어져요', () => {
    const d = createDemoLedger('2026-11-09', '2026-11-09T00:00:00.000Z');
    expect(claimPayers(d)).toEqual(['민지', '준호']);
    expect(claimAccountFor(d, '준호')).toBe(personByEmail(d, DEMO_MEMBERS[1].email)?.accountId);
  });
});

describe('멤버와 통장 잇기 (linkAccountsToEmail)', () => {
  it('고른 통장에 이메일을 넣고 같은 이메일인 다른 통장은 비워요', () => {
    const accounts = [{ ...incSora, ownerEmail: 'D@x' }, incHana, fixed];
    const changed = linkAccountsToEmail(accounts, 'd@x', 'inc-h', '도윤');
    expect(changed).toEqual([
      { ...incSora, ownerEmail: null },
      { ...incHana, ownerEmail: 'd@x' },
    ]);
  });

  it('주인 이름이 빈 통장은 멤버 이름으로 채우고, 없음이면 비우기만 해요', () => {
    const blank = account('income', { id: 'inc-x', name: '수입통장', ownerName: null });
    expect(linkAccountsToEmail([blank], 'd@x', 'inc-x', '도윤')).toEqual([{ ...blank, ownerName: '도윤', ownerEmail: 'd@x' }]);
    expect(linkAccountsToEmail([{ ...blank, ownerEmail: 'd@x' }], 'd@x', null)).toEqual([{ ...blank, ownerEmail: null }]);
    expect(linkAccountsToEmail([{ ...incSora, ownerEmail: 'd@x' }], 'd@x', 'inc-s')).toEqual([]);
  });
});
