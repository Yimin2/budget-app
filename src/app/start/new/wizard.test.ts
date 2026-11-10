import { describe, expect, it } from 'vitest';
import type { Category, FixedExpense } from '@/domain/types';
import {
  activeEarners, allocationSummary, allowanceAccountName, allowanceRuleIdForWizard, defaultLivingDrafts, diffByKey, earnerAccountFields,
  earnerAmounts, incomeAccountName, livingTotal, newEarner, validateBills, validateEarners, wantedAllowanceRules, wantedFixed,
  wantedLiving, wantedRules,
  type BillDraft,
} from './wizard';
import { isAllowanceRuleId } from '@/domain';

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
});

describe('저장할 행', () => {
  it('고정비만 고정 지출 행으로 (용돈 행은 만들지 않아요)', () => {
    const rows = wantedFixed({ accountId: 'acc-fixed', month: '2026-11' }, [
      { key: 'b1', name: ' 월세 ', amount: 800_000, day: 10 },
      { key: 'b2', name: '', amount: null, day: 1 },
    ]);
    expect(rows.map((r) => r.key)).toEqual(['b1']);
    expect(rows[0]!.input).toMatchObject({ kind: 'bill', name: '월세', dayOfMonth: 10, accountId: 'acc-fixed', startMonth: '2026-11', endMonth: null });
    expect(rows.every((r) => r.input.kind !== 'allowance')).toBe(true);
  });

  it('용돈은 그 사람 용돈 통장으로 가는 매달 같은 금액 배분 (월급날)', () => {
    const minji = { ...newEarner('민지', 'minji@x.com'), allowance: 300_000, day: 25 };
    const junho = { ...newEarner('준호'), allowance: null };
    const nobody = { ...newEarner('기쁜'), allowance: 100_000 };
    const wallets: Record<string, string> = { [minji.key]: 'w-minji' };
    const rules = wantedAllowanceRules({ incomeAccountId: 'inc', month: '2026-11' }, [minji, junho, nobody], (e) => wallets[e.key] ?? null);
    expect(rules).toEqual([
      {
        key: `${minji.key}:allowance`,
        input: { fromAccountId: 'inc', toAccountId: 'w-minji', amount: 300_000, kind: 'fixed', dayOfMonth: 25, startMonth: '2026-11', endMonth: null },
      },
    ]);
    expect(wantedAllowanceRules({ incomeAccountId: null, month: '2026-11' }, [minji], () => 'w')).toEqual([]);
    expect(allowanceAccountName(' 민지 ')).toBe('민지 용돈');
    expect(allowanceAccountName('')).toBe('용돈');
    expect(isAllowanceRuleId(allowanceRuleIdForWizard('abc'))).toBe(true);
    // 합계에 용돈도 들어가요
    expect(allocationSummary(500_000, earnerAmounts({ ...minji, alloc: { ...minji.alloc, event: 100_000 } })).total).toBe(400_000);
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
      'living:food': {
        id: 'x1', name: '식비', amount: 500_000, accountId: 'f', categoryId: 'food', dayOfMonth: null, kind: 'living',
        targetEmail: null, spread: 'daily', startMonth: '2026-11', endMonth: null, deleted: false,
      },
      b1: {
        id: 'x2', name: '월세', amount: 800_000, accountId: 'f', categoryId: null, dayOfMonth: 10, kind: 'bill',
        targetEmail: null, spread: 'daily', startMonth: '2026-11', endMonth: null, deleted: false,
      },
    };
    const wanted = [
      ...wantedLiving({ accountId: 'f', month: '2026-11' }, [
        { key: 'l1', categoryId: 'food', name: '식비', icon: 'utensils', amount: 600_000, spread: 'daily' },
      ]),
      ...wantedFixed({ accountId: 'f', month: '2026-11' }, [{ key: 'b9', name: '통신비', amount: 1, day: 1 }]),
    ];
    const d = diffByKey(saved, wanted);
    expect(d.add.map((a) => a.key)).toEqual(['b9']);
    expect(d.update).toEqual([{ key: 'living:food', row: { ...saved['living:food'], amount: 600_000 } }]);
    expect(d.remove).toEqual([{ key: 'b1', row: { ...saved.b1, deleted: true } }]);

    const same = diffByKey({ 'living:food': { ...saved['living:food']!, amount: 600_000 } }, wanted.slice(0, 1));
    expect(same).toEqual({ add: [], update: [], remove: [] });
  });
});

describe('생활비 항목', () => {
  const cat = (id: string, name: string, role: Category['defaultAccountRole'] = 'fixed'): Category => ({
    id, name, icon: 'dots', defaultAccountRole: role, order: 0, deleted: false,
  });
  const cats = ['식비', '카페', '교통', '생활', '쇼핑', '의료', '문화', '경조사', '기타'].map((n, i) =>
    cat(`c${i}`, n, n === '경조사' ? 'event' : 'fixed'),
  );

  it('기본 항목: 생활비 카테고리 7개, 금액은 비우고 식비·카페·교통만 하루에 나눠 쓰기', () => {
    const rows = defaultLivingDrafts(cats);
    expect(rows.map((r) => r.name)).toEqual(['식비', '카페', '교통', '생활', '쇼핑', '의료', '문화']);
    expect(rows.every((r) => r.amount === null)).toBe(true);
    expect(rows.filter((r) => r.spread === 'daily').map((r) => r.name)).toEqual(['식비', '카페', '교통']);
  });

  it('금액이 있는 항목만 생활비 예산 행으로 (카테고리 · 쓰는 방식 포함), 합계', () => {
    const rows = defaultLivingDrafts(cats).map((r, i) => ({ ...r, amount: i === 0 ? 300_000 : i === 4 ? 50_000 : null }));
    expect(livingTotal(rows)).toBe(350_000);
    const wanted = wantedLiving({ accountId: 'f', month: '2026-11' }, rows);
    expect(wanted.map((w) => [w.key, w.input.name, w.input.amount, w.input.spread, w.input.kind, w.input.categoryId])).toEqual([
      ['living:c0', '식비', 300_000, 'daily', 'living', 'c0'],
      ['living:c4', '쇼핑', 50_000, 'monthly', 'living', 'c4'],
    ]);
  });
});

describe('버는 사람 (사람별 수입통장)', () => {
  it('수입통장 이름 · 주인', () => {
    expect(incomeAccountName(' 민지 ')).toBe('민지 수입통장');
    expect(incomeAccountName('')).toBe('수입통장');
    const e = { ...newEarner('준호', ''), email: '' };
    expect(earnerAccountFields(e)).toEqual({ name: '준호 수입통장', ownerName: '준호', ownerEmail: null });
  });

  it('둘째 사람부터 이름이 필요하고, 비어 있는 사람은 저장하지 않아요', () => {
    const first = newEarner('민지', 'minji@x.com');
    const empty = newEarner();
    const noName = { ...newEarner(), salary: 2_000_000 };
    const badMail = { ...newEarner('준호', 'nope') };
    expect(activeEarners([first, empty, noName]).map((e) => e.key)).toEqual([first.key, noName.key]);
    const errs = validateEarners([first, empty, noName, badMail]);
    expect(Object.keys(errs)).toEqual([noName.key, badMail.key]);
    expect(errs[noName.key]?.name).toBe('이름을 입력해 주세요');
    expect(errs[badMail.key]?.email).toBe('이메일 주소를 확인해 주세요');
  });

  it('사람마다 자기 수입통장에서 나가는 규칙 (키가 겹치지 않아요)', () => {
    const a = wantedRules({ incomeAccountId: 'inc-a', month: '2026-11', day: 25, keyPrefix: 'A' }, [
      { role: 'fixed', accountId: 'f', amount: 1_200_000 },
    ]);
    const b = wantedRules({ incomeAccountId: 'inc-b', month: '2026-11', day: 10, keyPrefix: 'B' }, [
      { role: 'fixed', accountId: 'f', amount: 800_000 },
    ]);
    expect([...a, ...b].map((r) => [r.key, r.input.fromAccountId, r.input.amount, r.input.dayOfMonth])).toEqual([
      ['A:fixed', 'inc-a', 1_200_000, 25],
      ['B:fixed', 'inc-b', 800_000, 10],
    ]);
  });
});
