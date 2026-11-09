import type { LedgerData } from '@/domain/types';

const now = '2026-11-09T10:00:00.000Z';
const audit = { author: 'minji@example.com', createdAt: now, updatedAt: now, deleted: false };

/** 모든 표에 null / 비 null 값이 고루 들어간 예시 */
export function sampleLedger(): LedgerData {
  return {
    settings: { name: '우리집 가계부', kind: 'shared', sharedLedgerId: null, schemaVersion: 1, createdAt: now },
    accounts: [
      { id: 'a-inc', name: '수입통장', role: 'income', openingBalance: 1200000, openingDate: '2026-11-01', order: 0, ownerName: '민지', ownerEmail: 'minji@example.com', deleted: false },
      { id: 'a-fix', name: '고정지출통장', role: 'fixed', openingBalance: 0, openingDate: '2026-11-01', order: 1, ownerName: null, ownerEmail: null, deleted: false },
      { id: 'a-evt', name: '이벤트통장', role: 'event', openingBalance: 300000, openingDate: '2026-11-01', order: 2, ownerName: null, ownerEmail: null, deleted: true },
      { id: 'a-res', name: '저수지통장', role: 'reservoir', openingBalance: 5, openingDate: '2026-11-01', order: 3, ownerName: null, ownerEmail: null, deleted: false },
      { id: 'a-sav', name: '저축', role: 'savings', openingBalance: 0, openingDate: '2026-11-01', order: 4, ownerName: null, ownerEmail: null, deleted: false },
      { id: 'a-al', name: '용돈', role: 'allowance', openingBalance: 0, openingDate: '2026-11-01', order: 5, ownerName: null, ownerEmail: null, deleted: false },
      { id: 'a-etc', name: '기타', role: 'other', openingBalance: -1000, openingDate: '2026-11-01', order: 6, ownerName: null, ownerEmail: null, deleted: false },
    ],
    rules: [
      { id: 'r1', fromAccountId: 'a-inc', toAccountId: 'a-fix', amount: 2000000, dayOfMonth: 25, startMonth: '2026-11', endMonth: null, deleted: false },
      { id: 'r2', fromAccountId: 'a-inc', toAccountId: 'a-evt', amount: 300000, dayOfMonth: 31, startMonth: '2026-01', endMonth: '2026-10', deleted: true },
    ],
    transfers: [
      { id: 't1', date: '2026-11-25', kind: 'income', fromAccountId: null, toAccountId: 'a-inc', amount: 5000000, status: 'done', ruleId: null, memo: '월급', ...audit },
      { id: 't2', date: '2026-11-25', kind: 'transfer', fromAccountId: 'a-inc', toAccountId: 'a-fix', amount: 2000000, status: 'planned', ruleId: 'r1', memo: '', ...audit },
      { id: 't3', date: '2026-11-26', kind: 'adjustment', fromAccountId: 'a-fix', toAccountId: null, amount: 1000, status: 'done', ruleId: null, memo: '맞추기', ...audit, deleted: true },
    ],
    fixedExpenses: [
      { id: 'f1', name: '월세', amount: 700000, accountId: 'a-fix', categoryId: 'c1', dayOfMonth: 5, kind: 'bill', targetEmail: null, spread: 'daily', startMonth: '2026-11', endMonth: null, deleted: false },
      { id: 'f2', name: '생활비', amount: 600000, accountId: 'a-fix', categoryId: null, dayOfMonth: null, kind: 'living', targetEmail: null, spread: 'monthly', startMonth: '2026-11', endMonth: '2027-03', deleted: false },
      { id: 'f3', name: '용돈(민지)', amount: 300000, accountId: 'a-fix', categoryId: null, dayOfMonth: 1, kind: 'allowance', targetEmail: 'minji@example.com', spread: 'daily', startMonth: '2026-11', endMonth: null, deleted: true },
    ],
    events: [
      { id: 'e1', date: '2027-02-16', name: '설날', amount: 500000, accountId: 'a-evt', categoryId: 'c2', status: 'planned', repeat: 'yearly', memo: '', ...audit },
      { id: 'e2', date: '2026-12-01', name: '통신', amount: 1, accountId: 'a-evt', categoryId: null, status: 'done', repeat: 'monthly', memo: '메모', ...audit },
      { id: 'e3', date: '2027-05-10', name: '결혼식', amount: 100000, accountId: 'a-evt', categoryId: null, status: 'canceled', repeat: 'none', memo: '', ...audit, deleted: true },
    ],
    expenses: [
      { id: 'x1', date: '2026-11-09', amount: 12000, accountId: 'a-fix', categoryId: 'c1', memo: '점심', eventId: null, fixedExpenseId: null, ...audit },
      { id: 'x2', date: '2026-11-05', amount: 700000, accountId: 'a-fix', categoryId: null, memo: '', eventId: 'e2', fixedExpenseId: 'f1', ...audit, deleted: true },
    ],
    monthEnds: [
      { month: '2026-10', leftover: 52000, choice: 'reservoir', decidedBy: 'minji@example.com', decidedAt: now, items: [{ categoryId: 'c1', leftover: 55000 }, { categoryId: null, leftover: -3000 }] },
      { month: '2026-09', leftover: 0, choice: 'pending', decidedBy: null, decidedAt: null, items: null },
      { month: '2026-08', leftover: -3000, choice: 'carryover', decidedBy: 'junho@example.com', decidedAt: now, items: null },
    ],
    categories: [
      { id: 'c1', name: '식비', icon: 'utensils', defaultAccountRole: 'fixed', order: 0, deleted: false },
      { id: 'c2', name: '명절', icon: 'gift', defaultAccountRole: 'event', order: 1, deleted: true },
    ],
    favorites: [
      { id: 'v1', name: '커피', amount: 4500, categoryId: 'c1', accountId: 'a-fix', order: 0, deleted: false },
      { id: 'v2', name: '택시', amount: 10000, categoryId: null, accountId: null, order: 1, deleted: true },
    ],
    members: [
      { email: 'minji@example.com', displayName: '민지' },
      { email: 'junho@example.com', displayName: '준호' },
    ],
  };
}
