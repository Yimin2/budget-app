import { describe, expect, it } from 'vitest';
import type { FixedExpense } from '@/domain/types';
import {
  allocationSummary, diffByKey, validateAllowances, validateBills, wantedFixed, wantedRules,
  type AllowanceDraft, type BillDraft,
} from './wizard';

describe('allocationSummary', () => {
  it('월급이 없으면 합계만', () => {
    expect(allocationSummary(null, [100, null, 50])).toEqual({ total: 150, salary: null, left: null, state: 'none' });
  });
  it('합계가 월급보다 크면 over, 같으면 even, 작으면 under', () => {
    expect(allocationSummary(5_000_000, [2_000_000, 300_000, 1_500_000, 1_200_000]).state).toBe('even');
    const over = allocationSummary(4_000_000, [2_000_000, 300_000, 1_500_000, 1_200_000]);
    expect(over.state).toBe('over');
    expect(over.left).toBe(-1_000_000);
    expect(allocationSummary(6_000_000, [5_000_000]).state).toBe('under');
  });
  it('음수·빈 값은 무시', () => {
    expect(allocationSummary(100, [-50, undefined, 20]).total).toBe(20);
  });
});

describe('입력 확인', () => {
  const bill = (p: Partial<BillDraft>): BillDraft => ({ key: 'b', name: '', amount: null, day: 1, ...p });
  it('이름만 / 금액만 있으면 오류, 둘 다 없으면 통과', () => {
    expect(validateBills([bill({ key: 'a', amount: 1000 })])).toEqual({ a: { name: '이름을 입력해 주세요' } });
    expect(validateBills([bill({ key: 'a', name: '월세' })])).toEqual({ a: { amount: '금액을 입력해 주세요' } });
    expect(validateBills([bill({ key: 'a' })])).toEqual({});
    expect(validateBills([bill({ key: 'a', name: '월세', amount: 800_000 })])).toEqual({});
  });
  it('용돈은 금액이 있으면 이메일이 필요해요', () => {
    const row = (p: Partial<AllowanceDraft>): AllowanceDraft => ({ key: 'r', email: '', name: '', amount: null, day: 1, ...p });
    expect(validateAllowances([row({ amount: 100 })]).r?.email).toBeDefined();
    expect(validateAllowances([row({ amount: 100, email: 'nope' })]).r?.email).toBe('이메일 주소를 확인해 주세요');
    expect(validateAllowances([row({ email: 'a@b.c' })])).toEqual({});
    expect(validateAllowances([row({})])).toEqual({});
    expect(validateAllowances([row({ amount: 100, email: 'a@b.c' })])).toEqual({});
  });
});

describe('저장할 행', () => {
  it('생활비 · 고정비 · 용돈을 고정 지출 행으로', () => {
    const rows = wantedFixed(
      { accountId: 'acc-fixed', month: '2026-11' },
      600_000,
      [
        { key: 'b1', name: ' 월세 ', amount: 800_000, day: 10 },
        { key: 'b2', name: '', amount: null, day: 1 },
      ],
      [
        { key: 'a1', email: 'minji@x.com', name: '', amount: 150_000, day: 1 },
        { key: 'a2', email: 'bad', name: '준호', amount: 150_000, day: 1 },
      ],
    );
    expect(rows.map((r) => r.key)).toEqual(['living', 'b1', 'a1']);
    expect(rows[0]!.input).toMatchObject({ kind: 'living', dayOfMonth: null, amount: 600_000, startMonth: '2026-11', endMonth: null });
    expect(rows[1]!.input).toMatchObject({ kind: 'bill', name: '월세', dayOfMonth: 10, accountId: 'acc-fixed' });
    expect(rows[2]!.input).toMatchObject({ kind: 'allowance', name: '용돈(minji)', targetEmail: 'minji@x.com' });
  });

  it('수입통장이 없으면 배분 규칙을 만들지 않아요', () => {
    expect(wantedRules({ incomeAccountId: null, month: '2026-11', day: 1 }, [{ role: 'event', accountId: 'e', amount: 1 }])).toEqual([]);
    const rules = wantedRules({ incomeAccountId: 'inc', month: '2026-11', day: 25 }, [
      { role: 'fixed', accountId: 'f', amount: 2_000_000 },
      { role: 'event', accountId: 'e', amount: null },
      { role: 'savings', accountId: null, amount: 100 },
    ]);
    expect(rules).toEqual([
      { key: 'fixed', input: { fromAccountId: 'inc', toAccountId: 'f', amount: 2_000_000, dayOfMonth: 25, startMonth: '2026-11', endMonth: null } },
    ]);
  });

  it('diffByKey: 새로 · 바뀜 · 빠짐을 나눠요 (다시 저장해도 중복 없음)', () => {
    const saved: Record<string, FixedExpense> = {
      living: {
        id: 'x1', name: '생활비', amount: 500_000, accountId: 'f', categoryId: null, dayOfMonth: null, kind: 'living',
        targetEmail: null, startMonth: '2026-11', endMonth: null, deleted: false,
      },
      b1: {
        id: 'x2', name: '월세', amount: 800_000, accountId: 'f', categoryId: null, dayOfMonth: 10, kind: 'bill',
        targetEmail: null, startMonth: '2026-11', endMonth: null, deleted: false,
      },
    };
    const wanted = wantedFixed({ accountId: 'f', month: '2026-11' }, 600_000, [{ key: 'b9', name: '통신비', amount: 1, day: 1 }], []);
    const d = diffByKey(saved, wanted);
    expect(d.add.map((a) => a.key)).toEqual(['b9']);
    expect(d.update).toEqual([{ key: 'living', row: { ...saved.living, amount: 600_000 } }]);
    expect(d.remove).toEqual([{ key: 'b1', row: { ...saved.b1, deleted: true } }]);

    const same = diffByKey({ living: { ...saved.living!, amount: 600_000 } }, wanted.slice(0, 1));
    expect(same).toEqual({ add: [], update: [], remove: [] });
  });
});
