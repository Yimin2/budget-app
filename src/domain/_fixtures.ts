/** 테스트 전용 데이터 빌더 (index 에서 내보내지 않음) */
import type {
  Account, AccountRole, AllocationRule, Expense, FixedExpense, LedgerData, PlannedEvent, Transfer,
} from './types';

const NOW = '2026-11-01T00:00:00.000Z';
let seq = 0;
const nid = (p: string) => `${p}-${++seq}`;

export function emptyLedger(overrides: Partial<LedgerData> = {}): LedgerData {
  return {
    settings: { name: '테스트', kind: 'shared', sharedLedgerId: null, schemaVersion: 1, createdAt: '2026-01-01T00:00:00.000Z' },
    accounts: [],
    rules: [],
    transfers: [],
    fixedExpenses: [],
    events: [],
    expenses: [],
    monthEnds: [],
    categories: [],
    favorites: [],
    members: [],
    trips: [],
    ...overrides,
  };
}

export function account(role: AccountRole, p: Partial<Account> = {}): Account {
  return { id: `acc-${role}`, name: role, role, openingBalance: 0, openingDate: '2026-01-01', order: 0, ownerName: null, ownerEmail: null, deleted: false, ...p };
}

export function rule(p: Partial<AllocationRule> & Pick<AllocationRule, 'fromAccountId' | 'toAccountId' | 'amount'>): AllocationRule {
  return { id: nid('rule'), dayOfMonth: 1, startMonth: '2026-01', endMonth: null, deleted: false, ...p };
}

export function transfer(p: Partial<Transfer> & Pick<Transfer, 'date' | 'amount'>): Transfer {
  return {
    id: nid('tr'), kind: 'transfer', fromAccountId: null, toAccountId: null, status: 'done', ruleId: null, memo: '',
    author: 'a@x', createdAt: NOW, updatedAt: NOW, deleted: false, ...p,
  };
}

export function expense(p: Partial<Expense> & Pick<Expense, 'date' | 'amount' | 'accountId'>): Expense {
  return {
    id: nid('ex'), categoryId: null, memo: '', eventId: null, fixedExpenseId: null, author: 'a@x',
    createdAt: NOW, updatedAt: NOW, deleted: false, ...p,
  };
}

export function fixed(p: Partial<FixedExpense> & Pick<FixedExpense, 'amount' | 'accountId' | 'kind'>): FixedExpense {
  return {
    id: nid('fx'), name: '고정', categoryId: null, dayOfMonth: p.kind === 'living' ? null : 1, targetEmail: null, spread: 'daily',
    startMonth: '2026-01', endMonth: null, deleted: false, ...p,
  };
}

export function event(p: Partial<PlannedEvent> & Pick<PlannedEvent, 'date' | 'amount' | 'accountId'>): PlannedEvent {
  return {
    id: nid('ev'), name: '일정', categoryId: null, status: 'planned', repeat: 'none', memo: '', author: 'a@x',
    createdAt: NOW, updatedAt: NOW, deleted: false, ...p,
  };
}
