/**
 * 지출을 실제로 쓴 사람 — PLAN 6 (내역).
 * 기록한 사람(author)과 돈을 쓴 사람이 다를 수 있어요. 아래 순서로 처음 맞는 것을 써요.
 * 1) 청구의 낸 사람 (paidBy, 개인 돈으로 낸 사람)
 * 2) 지출이 나간 통장의 주인 (사람별 생활비 · 용돈 · 수입통장)
 *    '누가 썼나요?'에서 고른 사람은 따로 칸이 없고 그 사람의 생활비 통장으로 기록되므로 여기에서 찾아져요
 * 3) 기록한 사람
 * 사람을 가르는 키: 가계부의 사람이면 그 멤버 이메일(소문자), 아니면 주인 이메일(소문자) → 'name:<이름>'
 */
import { accountBelongsTo } from './household';
import { isClaimExpense } from './balances';
import { ledgerPeople, memberName, personByName, type LedgerPerson } from './people';
import type { Expense, LedgerData } from './types';

export type SpenderSource = 'payer' | 'account' | 'recorder';

export interface ExpenseSpender {
  /** 사람을 가르는 키 (필터에 써요) */
  key: string;
  /** 실제로 쓴 사람 이름 */
  name: string;
  /** 어디에서 찾았는지 */
  source: SpenderSource;
  /** 기록한 사람 키 · 이름 */
  recorderKey: string;
  recorderName: string;
  /** 쓴 사람과 기록한 사람이 다른지 ('○○가 기록'을 보일지) */
  recordedByOther: boolean;
}

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

function personKey(p: LedgerPerson): string {
  return lower(p.email);
}

/** 기록한 사람 키: 멤버 이메일(소문자) */
export function recorderKey(expense: Pick<Expense, 'author'>): string {
  return lower(expense.author);
}

export function expenseSpender(
  data: LedgerData,
  expense: Pick<Expense, 'author' | 'accountId' | 'paidBy'>,
  people: LedgerPerson[] = ledgerPeople(data),
): ExpenseSpender {
  const rKey = recorderKey(expense);
  const rName = memberName(data, expense.author);
  const done = (key: string, name: string, source: SpenderSource): ExpenseSpender => ({
    key,
    name,
    source,
    recorderKey: rKey,
    recorderName: rName,
    recordedByOther: key !== rKey,
  });

  // 1) 청구의 낸 사람
  if (isClaimExpense(expense)) {
    const payer = (expense.paidBy ?? '').trim();
    const person =
      people.find((p) => p.name === payer) ?? people.find((p) => p.displayName === payer) ?? personByName(data, payer);
    return person ? done(personKey(person), person.name, 'payer') : done(`name:${payer}`, payer, 'payer');
  }

  // 2) 개인 통장의 주인
  const account = data.accounts.find((a) => a.id === expense.accountId);
  const ownerName = (account?.ownerName ?? '').trim();
  const ownerEmail = lower(account?.ownerEmail);
  if (account && (ownerName || ownerEmail)) {
    const person = people.find((p) => accountBelongsTo(account, p));
    if (person) return done(personKey(person), person.name, 'account');
    const name = ownerName || ownerEmail.split('@')[0] || ownerEmail;
    return done(ownerEmail || `name:${ownerName}`, name, 'account');
  }

  // 3) 기록한 사람
  return done(rKey, rName, 'recorder');
}
