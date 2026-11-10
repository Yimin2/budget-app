/** 파일에서 가져오기 — 읽기 · 확인 · 미리보기 계획 (가짜 데이터만 씀) */
import { accountBalance } from './balances';
import { pendingClaims, summarizeClaims } from './claims';
import { createDefaultLedger } from './defaults';
import { applyImportPlan, importRowId, parseImportFile, planImport, type ImportFile } from './importFile';
import { installmentPlans } from './installments';
import { tripStatus } from './trips';
import type { LedgerData } from './types';

const TODAY = '2026-11-10';
const NOW = '2026-11-10T01:00:00.000Z';
const CTX = { today: TODAY, author: 'tester@example.test', now: NOW };

function base(): LedgerData {
  return createDefaultLedger('shared', '테스트 가계부', '2026-11-01', NOW, 'tester@example.test', '테스트');
}

/** 가짜 가져오기 파일 (사람 이름 · 항목 · 금액 모두 만든 값) */
function sample(): Record<string, unknown> {
  return {
    format: 'budget-import',
    version: 1,
    source: 'sample-1',
    name: '예시 파일',
    accounts: [
      { key: 'inc-a', name: '가람 수입통장', role: 'income', openingDate: '2026-11-09', ownerName: '가람', salary: 3_000_000, salaryDay: 25 },
      { key: 'inc-b', name: '나래 수입통장', role: 'income', openingDate: '2026-11-09', ownerName: '나래' },
      { key: 'fixed', name: '고정지출 통장', role: 'fixed', openingDate: '2026-11-09' },
      { key: 'event', name: '이벤트통장', role: 'event', openingDate: '2026-11-09' },
      { key: 'res', name: '비상금통장', role: 'reservoir', openingDate: '2026-11-09' },
    ],
    categories: [
      { key: 'occ', name: '경조사', icon: 'envelope', note: '한 달 예산 10만' },
      { key: 'hobby', name: '취미', icon: 'sparkles', defaultAccountRole: 'event' },
    ],
    rules: [
      { key: 'a-event', from: 'inc-a', to: 'event', amount: 200_000, dayOfMonth: 25, startMonth: '2026-11' },
      { key: 'b-fixed', from: 'inc-b', to: 'fixed', amount: 450_000, dayOfMonth: 21, startMonth: '2026-11' },
    ],
    fixedExpenses: [
      { key: 'rent', name: '월세', amount: 300_000, account: 'fixed', kind: 'bill', dayOfMonth: 21, startMonth: '2026-11', memo: '관리비 포함' },
      { key: 'food', name: '식비', amount: 150_000, account: 'fixed', kind: 'living', spread: 'daily', startMonth: '2026-11' },
      { key: 'pocket', name: '용돈(가람)', amount: 30_000, account: 'fixed', kind: 'allowance', dayOfMonth: 25, startMonth: '2026-11' },
    ],
    installments: [
      { key: 'tv', name: '모니터 할부', amount: 20_000, amountKind: 'monthly', months: 6, firstMonth: '2026-11', dayOfMonth: 23, account: 'fixed' },
      { key: 'old', name: '끝난 할부', amount: 10_000, amountKind: 'monthly', months: 2, firstMonth: '2026-01', dayOfMonth: 5, account: 'fixed' },
    ],
    trips: [{ key: 'trip', name: '바다 여행', startDate: '2026-10-20', endDate: '2026-10-25', budget: 500_000 }],
    expenses: [
      { key: 'e1', date: '2026-10-01', amount: 40_000, account: 'event', category: 'occ', memo: '선물' },
      { key: 'e2', date: '2026-10-05', amount: 70_000, account: 'event', category: 'hobby', memo: '보드게임', claim: { payer: '나래', status: 'pending' } },
      { key: 'e3', date: '2026-10-06', amount: 15_000, account: 'event', memo: '케이크', claim: { payer: '가람', status: 'settled' } },
      { key: 'e4', date: '2026-10-08', amount: 120_000, account: 'res', memo: '숙소', trip: 'trip', tripItem: 'stay' },
      { key: 'e5', date: '2026-11-09', amount: 9_000, account: 'event', memo: '꽃', claim: { payer: '가람', status: 'pending', due: '2026-12-21' } },
    ],
  };
}

function parsed(raw: unknown = sample()): ImportFile {
  const r = parseImportFile(JSON.stringify(raw));
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.file;
}

describe('parseImportFile', () => {
  it('맞는 파일을 읽고 빈 표는 빈 배열로 둬요', () => {
    const f = parsed();
    expect(f.source).toBe('sample-1');
    expect(f.accounts).toHaveLength(5);
    expect(f.events).toEqual([]);
    expect(f.transfers).toEqual([]);
    expect(f.accounts[0]).toMatchObject({ openingBalance: 0, salary: 3_000_000, salaryDay: 25, ownerEmail: null });
  });

  it('JSON 이 아니거나 형식 · 버전이 다르면 알려요', () => {
    expect(parseImportFile('{')).toEqual({ ok: false, errors: [expect.stringContaining('JSON')] });
    expect(parseImportFile(JSON.stringify({ format: 'other' }))).toMatchObject({ ok: false });
    const v9 = parseImportFile(JSON.stringify({ ...sample(), version: 9 }));
    expect(v9.ok).toBe(false);
    if (!v9.ok) expect(v9.errors[0]).toContain('버전 1 · 2');
  });

  it('틀린 칸 · 겹친 key · 없는 통장 · 틀린 날짜를 한꺼번에 알려요', () => {
    const raw = sample();
    raw.source = 'bad source!';
    (raw.accounts as unknown[]).push({ key: 'inc-a', name: '겹침', role: 'income', openingDate: '2026-11-09' });
    (raw.expenses as unknown[]).push(
      { key: 'x1', date: '2026-13-01', amount: 1000, account: 'event' },
      { key: 'x2', date: '2026-11-01', amount: 1000, account: 'nowhere' },
      { key: 'bad key', date: '2026-11-01', amount: 1000, account: 'event' },
      { key: 'x3', date: '2026-11-01', amount: -5, account: 'event', claim: { status: 'pending' } },
    );
    const r = parseImportFile(JSON.stringify(raw));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const text = r.errors.join('\n');
    expect(text).toContain("'source'");
    expect(text).toContain('key 가 앞 항목과 겹쳐요');
    expect(text).toContain("지출 6번째 (x1): 'date' 칸을 확인해 주세요");
    expect(text).toContain("'nowhere' 를 파일에서 찾을 수 없어요");
    expect(text).toContain("'key' 는 영문");
    expect(text).toContain("(x3): 'amount' 칸을 확인해 주세요");
    expect(text).toContain("(x3): 청구 'payer' 칸을 확인해 주세요");
  });

  it('여행 예산이 없으면 앱과 같은 문구로 막아요', () => {
    const raw = sample();
    raw.trips = [{ key: 't', name: '여행', startDate: '2026-12-01', endDate: '2026-12-02', budget: 0 }];
    const r = parseImportFile(JSON.stringify(raw));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('예산을 입력해 주세요');
  });
});

describe('planImport', () => {
  it('표마다 개수 · 금액을 세고, 이름이 같은 통장 · 카테고리는 합쳐요', () => {
    const data = base();
    const plan = planImport(data, parsed(), CTX);
    expect(plan.errors).toEqual([]);
    const line = (k: string) => plan.summary.find((l) => l.key === k)!;
    // 고정지출 통장(띄어쓰기 달라도) · 이벤트통장은 합치고, 수입 2 · 비상금은 새로
    expect(line('accounts')).toMatchObject({ added: 3, merged: 2, existing: 0, amount: 0 });
    expect(line('categories')).toMatchObject({ added: 1, merged: 1 });
    expect(plan.merges.map((m) => m.name)).toEqual(['고정지출통장', '이벤트통장', '경조사']);
    expect(line('rules')).toMatchObject({ added: 2, amount: 650_000 });
    expect(line('bills')).toMatchObject({ added: 2, amount: 330_000 });
    expect(line('living')).toMatchObject({ added: 1, amount: 150_000 });
    expect(line('installments')).toMatchObject({ added: 1, amount: 20_000 });
    expect(line('trips')).toMatchObject({ added: 1, amount: 500_000 });
    expect(line('expenses')).toMatchObject({ added: 5, amount: 254_000 });
    // 돌려준 청구 이체 1 + 월급 1
    expect(line('transfers')).toMatchObject({ added: 2, amount: 3_015_000 });
    expect(plan.expensesByAccount).toEqual([
      { name: '이벤트통장', count: 4, amount: 134_000 },
      { name: '비상금통장', count: 1, amount: 120_000 },
    ]);
    expect(plan.notes).toEqual([{ name: '경조사', note: '한 달 예산 10만' }]);
    expect(plan.warnings).toEqual(
      expect.arrayContaining([
        "할부 '끝난 할부' 는 이미 다 낸 할부라 건너뛰어요",
        '통장 시작일 전 지출 4건은 기록으로만 남고 잔액에는 들어가지 않아요',
      ]),
    );
  });

  it('행 id 는 source 와 key 로 정해지고, 합친 통장 · 카테고리는 있던 id 를 써요', () => {
    const data = base();
    const plan = planImport(data, parsed(), CTX);
    const event = data.accounts.find((a) => a.role === 'event')!;
    const occ = data.categories.find((c) => c.name === '경조사')!;
    const e1 = plan.rows.expenses.find((e) => e.id === importRowId('sample-1', 'exp', 'e1'))!;
    expect(e1).toMatchObject({ accountId: event.id, categoryId: occ.id, memo: '선물', author: CTX.author, deleted: false });
    expect(plan.rows.accounts.map((a) => a.id)).toEqual([
      'imp:sample-1:acc:inc-a', 'imp:sample-1:acc:inc-b', 'imp:sample-1:acc:res',
    ]);
    expect(plan.rows.fixedExpenses.find((f) => f.name === '월세')).toMatchObject({ memo: '관리비 포함', id: 'imp:sample-1:fx:rent' });
  });

  it('청구: 아직 안 돌려준 것은 앱 규칙으로 정산일 · 돌려받을 통장을 정하고, 돌려준 것은 이체 claim:<지출id> 도 만들어요', () => {
    const plan = planImport(base(), parsed(), CTX);
    const e2 = plan.rows.expenses.find((e) => e.id.endsWith(':e2'))!;
    // 이벤트통장 잔액 0 → 다음 월급날. 정산일 = 수입 → 이벤트 배분 이체일(25일)
    expect(e2).toMatchObject({ paidBy: '나래', claimAccountId: 'imp:sample-1:acc:inc-b', claimDue: '2026-11-25' });
    const e5 = plan.rows.expenses.find((e) => e.id.endsWith(':e5'))!;
    expect(e5.claimDue).toBe('2026-12-21');
    const e3 = plan.rows.expenses.find((e) => e.id.endsWith(':e3'))!;
    const settle = plan.rows.transfers.find((t) => t.id === `claim:${e3.id}`)!;
    expect(settle).toMatchObject({ date: '2026-10-06', fromAccountId: e3.accountId, toAccountId: 'imp:sample-1:acc:inc-a', amount: 15_000 });
    expect(plan.claims).toEqual({
      pending: [{ payer: '나래', count: 1, amount: 70_000 }, { payer: '가람', count: 1, amount: 9_000 }],
      pendingTotal: 79_000,
      reservoirPending: [],
      reservoirLoanPending: [],
      reservoirLoanSettled: { count: 0, amount: 0 },
      nextDue: '2026-11-25',
      settledCount: 1,
      settledAmount: 15_000,
    });
  });

  it('저수지통장의 이벤트 카테고리 청구는 저수지에서 빌려 줄 돈 · 갚을 돈으로 바꿀 수 있는 돌려준 청구로 따로 세요', () => {
    const raw = sample();
    (raw.expenses as unknown[]).push(
      { key: 'r1', date: '2026-09-02', amount: 300_000, account: 'res', category: 'hobby', memo: '동호회 회비', claim: { payer: '가람', status: 'pending' } },
      { key: 'r2', date: '2026-09-03', amount: 50_000, account: 'res', memo: '비상 수리', claim: { payer: '가람', status: 'pending' } },
      { key: 'r3', date: '2026-08-02', amount: 200_000, account: 'res', category: 'hobby', memo: '캠핑 장비', claim: { payer: '나래', status: 'settled', settledDate: '2026-08-25' } },
    );
    const plan = planImport(base(), parsed(raw), CTX);
    expect(plan.claims.reservoirLoanPending).toEqual([{ payer: '가람', count: 1, amount: 300_000 }]);
    expect(plan.claims.reservoirPending).toEqual([{ payer: '가람', count: 1, amount: 50_000 }]);
    expect(plan.claims.reservoirLoanSettled).toEqual({ count: 1, amount: 200_000 });
  });

  it('월급은 시작일 뒤 첫 월급날에 수입 한 건으로 들어가요', () => {
    const plan = planImport(base(), parsed(), CTX);
    expect(plan.rows.transfers.find((t) => t.kind === 'income')).toMatchObject({
      id: 'imp:sample-1:tr:salary.inc-a.2026-11', date: '2026-11-25', toAccountId: 'imp:sample-1:acc:inc-a', amount: 3_000_000, memo: '월급',
    });
  });

  it('더한 데이터는 앱 계산이 그대로 읽어요: 청구 요약 · 할부 · 여행 · 잔액', () => {
    const data = base();
    const plan = planImport(data, parsed(), CTX);
    const next = applyImportPlan(data, plan);
    const s = summarizeClaims(next, TODAY);
    expect(s.total).toBe(79_000);
    expect(s.byPayer).toEqual([{ name: '나래', amount: 70_000 }, { name: '가람', amount: 9_000 }]);
    expect(pendingClaims(next, TODAY).every((c) => !c.dueNow)).toBe(true);
    const tv = installmentPlans(next, TODAY).find((p) => p.name === '모니터 할부')!;
    expect(tv).toMatchObject({ count: 6, paidCount: 0, remainingAmount: 120_000, firstMonth: '2026-11', endMonth: '2027-04' });
    const trip = tripStatus(next, next.trips[0]!, TODAY);
    expect(trip).toMatchObject({ spent: 120_000, spentElsewhere: 120_000, remaining: 380_000 });
    // 시작일 전 지출은 잔액에 들어가지 않아요. 11/9 청구는 낸 사람 통장에서만 빠져요
    const event = data.accounts.find((a) => a.role === 'event')!;
    expect(accountBalance(next, event.id, TODAY)).toBe(0);
    expect(accountBalance(next, 'imp:sample-1:acc:inc-a', TODAY)).toBe(-9_000);
    // 합친 통장은 시작 잔액 · 시작일을 바꾸지 않아요
    expect(next.accounts.find((a) => a.id === event.id)).toEqual(event);
  });

  it('같은 파일을 다시 가져오면 더할 것이 없어요 (모두 이미 있음)', () => {
    const data = base();
    const once = applyImportPlan(data, planImport(data, parsed(), CTX));
    const again = planImport(once, parsed(), { ...CTX, today: '2026-12-15', now: '2026-12-15T00:00:00.000Z' });
    expect(again.total).toBe(0);
    expect(again.errors).toEqual([]);
    const line = (k: string) => again.summary.find((l) => l.key === k);
    expect(line('accounts')).toMatchObject({ added: 0, existing: 3, merged: 2 });
    expect(line('expenses')).toMatchObject({ added: 0, existing: 5 });
    expect(line('installments')).toMatchObject({ added: 0, existing: 1 });
    expect(line('transfers')).toMatchObject({ added: 0, existing: 1 });
    expect(applyImportPlan(once, again)).toEqual(once);
  });

  it('합친 통장의 빈 주인 칸만 채워요', () => {
    const data = base();
    const raw = sample();
    raw.accounts = [{ key: 'inc', name: '수입통장', role: 'income', openingDate: '2026-11-09', ownerName: '가람', ownerEmail: 'garam@example.test' }];
    raw.rules = [];
    raw.fixedExpenses = [];
    raw.installments = [];
    raw.expenses = [];
    raw.trips = [];
    raw.categories = [];
    const plan = planImport(data, parsed(raw), CTX);
    expect(plan.rows.accounts).toEqual([]);
    expect(plan.accountUpdates).toHaveLength(1);
    expect(plan.accountUpdates[0]).toMatchObject({ name: '수입통장', ownerName: '가람', ownerEmail: 'garam@example.test', openingDate: '2026-11-01' });
    expect(plan.total).toBe(1);
  });

  it('청구를 저축투자 같은 통장에 적으면 가져오지 않게 막아요', () => {
    const raw = sample();
    raw.accounts = [...(raw.accounts as object[]), { key: 'sav', name: '저축통장', role: 'savings', openingDate: '2026-11-09' }];
    raw.expenses = [{ key: 'bad', date: '2026-11-01', amount: 5000, account: 'sav', memo: '잘못', claim: { payer: '가람', status: 'pending' } }];
    const plan = planImport(base(), parsed(raw), CTX);
    expect(plan.errors).toEqual(["지출 '잘못' 는 청구인데 이벤트통장 · 고정지출통장 · 저수지통장이 아니에요"]);
  });

  it('일정과 여행에 함께 묶인 지출은 여행에만 묶어요', () => {
    const raw = sample();
    raw.events = [{ key: 'ev', date: '2026-10-20', name: '바다 여행 일정', amount: 100_000 }];
    raw.expenses = [{ key: 'both', date: '2026-10-21', amount: 5000, account: 'event', event: 'ev', trip: 'trip' }];
    const data = base();
    const plan = planImport(data, parsed(raw), CTX);
    expect(plan.rows.expenses[0]).toMatchObject({ eventId: null, tripId: 'imp:sample-1:trip:trip', tripItem: null });
    expect(plan.warnings).toContain('일정과 여행에 함께 묶인 지출 1건은 여행에만 묶어요');
    // 통장을 안 적은 일정은 이벤트통장으로
    expect(plan.rows.events[0]!.accountId).toBe(data.accounts.find((a) => a.role === 'event')!.id);
  });
});

/** v2: 월급통장 하나 · 수입 계획 · 나머지 전부 보내기 · 사람별 생활비 · 용돈 통장 (이름은 지어낸 것) */
function sampleV2(): Record<string, unknown> {
  return {
    format: 'budget-import',
    version: 2,
    source: 'couple-1',
    accounts: [
      { key: 'salary', name: '월급 모으는 통장', role: 'income', openingDate: '2026-11-01' },
      { key: 'liv-a', name: '생활비(가람)', role: 'fixed', openingDate: '2026-11-01', ownerName: '가람' },
      { key: 'liv-b', name: '생활비(나래)', role: 'fixed', openingDate: '2026-11-01', ownerName: '나래', ownerEmail: 'narae@example.test' },
      { key: 'pocket-a', name: '용돈(가람)', role: 'allowance', openingDate: '2026-11-01', ownerName: '가람' },
      { key: 'event', name: '이벤트통장', role: 'event', openingDate: '2026-11-01' },
      { key: 'res', name: '저수지통장', role: 'reservoir', openingDate: '2026-11-01' },
    ],
    incomePlans: [
      { key: 'garam', person: '가람', amount: 2_970_000, dayOfMonth: 21, account: 'salary', startMonth: '2026-11' },
      { key: 'narae', person: '나래', email: 'narae@example.test', amount: 3_000_000, dayOfMonth: 25, account: 'salary', startMonth: '2026-11' },
    ],
    rules: [
      { key: 'a', from: 'salary', to: 'liv-a', amount: 828_000, dayOfMonth: 21, startMonth: '2026-11' },
      { key: 'b', from: 'salary', to: 'liv-b', kind: 'fixed', amount: 1_272_600, dayOfMonth: 21, startMonth: '2026-11' },
      { key: 'rest21', from: 'salary', to: 'res', kind: 'remainder', dayOfMonth: 21, startMonth: '2026-11' },
      { key: 'pocket', from: 'salary', to: 'pocket-a', amount: 400_000, dayOfMonth: 25, startMonth: '2026-11' },
      { key: 'rest25', from: 'salary', to: 'res', kind: 'remainder', amount: 0, dayOfMonth: 25, startMonth: '2026-11' },
    ],
    fixedExpenses: [
      { key: 'dues-a', name: '회비', amount: 30_000, account: 'liv-a', kind: 'bill', dayOfMonth: 5, startMonth: '2026-11' },
      { key: 'dues-b', name: '회비', amount: 30_000, account: 'liv-b', kind: 'bill', dayOfMonth: 5, startMonth: '2026-11' },
      { key: 'food-a', name: '식비', amount: 300_000, account: 'liv-a', kind: 'living', spread: 'daily', startMonth: '2026-11' },
      { key: 'food-b', name: '식비', amount: 200_000, account: 'liv-b', kind: 'living', spread: 'daily', startMonth: '2026-11' },
    ],
  };
}

describe('budget-import v2', () => {
  it('수입 계획 · 나머지 배분 · 사람별 통장을 읽어요', () => {
    const f = parsed(sampleV2());
    expect(f.version).toBe(2);
    expect(f.incomePlans.map((p) => [p.key, p.person, p.email, p.amount, p.dayOfMonth])).toEqual([
      ['garam', '가람', null, 2_970_000, 21],
      ['narae', '나래', 'narae@example.test', 3_000_000, 25],
    ]);
    expect(f.rules.map((r) => [r.key, r.kind, r.amount])).toEqual([
      ['a', 'fixed', 828_000],
      ['b', 'fixed', 1_272_600],
      ['rest21', 'remainder', 0],
      ['pocket', 'fixed', 400_000],
      ['rest25', 'remainder', 0],
    ]);
  });

  it('v1 파일은 예전처럼 읽고, v2 칸을 쓰면 버전을 올리라고 알려요', () => {
    const v1 = parsed();
    expect(v1.version).toBe(1);
    expect(v1.incomePlans).toEqual([]);
    expect(v1.rules.every((r) => r.kind === 'fixed')).toBe(true);
    const withPlans = parseImportFile(JSON.stringify({ ...sampleV2(), version: 1 }));
    expect(withPlans.ok).toBe(false);
    if (!withPlans.ok) {
      expect(withPlans.errors.some((e) => e.includes("'incomePlans' 는 버전 2"))).toBe(true);
      expect(withPlans.errors.some((e) => e.includes("'kind' 는 버전 2"))).toBe(true);
    }
  });

  it('정한 금액 배분에 금액이 없으면 막고, 나머지 배분은 금액 없이 돼요', () => {
    const raw = sampleV2();
    (raw.rules as Record<string, unknown>[]).push({ key: 'bad', from: 'salary', to: 'event', dayOfMonth: 21, startMonth: '2026-11' });
    const r = parseImportFile(JSON.stringify(raw));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual([expect.stringContaining("(bad): 'amount' 칸을 확인해 주세요")]);
  });

  it('계획: 수입 계획 행 · 나머지 규칙(금액 0) · 사람별 통장의 고정비와 생활비, 다시 가져와도 늘지 않아요', () => {
    const data = base();
    const plan = planImport(data, parsed(sampleV2()), CTX);
    expect(plan.errors).toEqual([]);
    const accId = (key: string) => importRowId('couple-1', 'acc', key);
    expect(plan.rows.incomePlans.map((p) => [p.id, p.personName, p.personEmail, p.amount, p.dayOfMonth, p.accountId])).toEqual([
      [importRowId('couple-1', 'inc', 'garam'), '가람', null, 2_970_000, 21, accId('salary')],
      [importRowId('couple-1', 'inc', 'narae'), '나래', 'narae@example.test', 3_000_000, 25, accId('salary')],
    ]);
    const res = data.accounts.find((a) => a.role === 'reservoir')!.id;
    expect(plan.rows.rules.filter((r) => r.kind === 'remainder').map((r) => [r.toAccountId, r.amount, r.dayOfMonth])).toEqual([
      [res, 0, 21],
      [res, 0, 25],
    ]);
    // 가계부에 있던 '저수지통장' · '이벤트통장' 은 합치고 그 id 를 써요
    expect(plan.merges.map((m) => m.name)).toEqual(['이벤트통장', '저수지통장']);
    expect(plan.summary.find((l) => l.key === 'incomePlans')).toMatchObject({ added: 2, amount: 5_970_000, amountLabel: '매달' });
    expect(plan.warnings.some((w) => w.includes('나머지 전부 보내기 2개'))).toBe(true);
    expect(plan.rows.fixedExpenses.filter((f) => f.kind === 'bill').map((f) => f.accountId)).toEqual([accId('liv-a'), accId('liv-b')]);

    const after = applyImportPlan(data, plan);
    const again = planImport(after, parsed(sampleV2()), CTX);
    expect(again.total).toBe(0);
    expect(again.summary.find((l) => l.key === 'incomePlans')).toMatchObject({ added: 0, existing: 2 });
  });

  it('생활비 쓰는 날(useDays · skipHolidays · perWeek)은 v2 의 선택 칸이고, 비우면 예전 행과 같아요', () => {
    const raw = sampleV2();
    const fx = raw.fixedExpenses as Record<string, unknown>[];
    fx.push(
      { key: 'lunch', name: '직장식비', amount: 220_000, account: 'liv-a', kind: 'living', spread: 'daily', useDays: 'weekdays', skipHolidays: true, startMonth: '2026-11' },
      { key: 'dine', name: '외식', amount: 160_000, account: 'liv-b', kind: 'living', spread: 'daily', perWeek: 2, startMonth: '2026-11' },
      { key: 'gym', name: '운동', amount: 40_000, account: 'liv-b', kind: 'living', spread: 'daily', useDays: ['MON', 'wed', 'fri'], startMonth: '2026-11' },
    );
    const f = parsed(raw);
    expect(f.fixedExpenses.map((x) => [x.key, x.useDays, x.skipHolidays, x.perWeek])).toEqual([
      ['dues-a', null, false, null],
      ['dues-b', null, false, null],
      ['food-a', null, false, null],
      ['food-b', null, false, null],
      ['lunch', [1, 2, 3, 4, 5], true, null],
      ['dine', null, false, 2],
      ['gym', [1, 3, 5], false, null],
    ]);
    const plan = planImport(base(), f, CTX);
    expect(plan.errors).toEqual([]);
    const row = (key: string) => plan.rows.fixedExpenses.find((x) => x.id === importRowId('couple-1', 'fx', key))!;
    expect(row('food-a')).not.toHaveProperty('useDays');
    expect(row('food-a')).not.toHaveProperty('skipHolidays');
    expect(row('food-a')).not.toHaveProperty('perWeek');
    expect(row('lunch')).toMatchObject({ useDays: [1, 2, 3, 4, 5], skipHolidays: true });
    expect(row('dine')).toMatchObject({ perWeek: 2 });
    expect(row('dine')).not.toHaveProperty('useDays');
  });

  it('쓰는 날 칸: 틀린 값은 막고, v1 에 쓰면 버전을 올리라고 알려요', () => {
    const raw = sampleV2();
    (raw.fixedExpenses as Record<string, unknown>[]).push(
      { key: 'bad1', name: '가', amount: 1_000, account: 'liv-a', kind: 'living', useDays: ['월'], startMonth: '2026-11' },
      { key: 'bad2', name: '나', amount: 1_000, account: 'liv-a', kind: 'living', perWeek: 8, startMonth: '2026-11' },
      { key: 'bad3', name: '다', amount: 1_000, account: 'liv-a', kind: 'living', skipHolidays: 'yes', startMonth: '2026-11' },
    );
    const r = parseImportFile(JSON.stringify(raw));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual([
        expect.stringContaining("(bad1): 'useDays' 칸을 확인해 주세요"),
        expect.stringContaining("(bad2): 'perWeek' 칸을 확인해 주세요"),
        expect.stringContaining("(bad3): 'skipHolidays' 칸을 확인해 주세요"),
      ]);
    }
    const v1 = sample();
    (v1.fixedExpenses as Record<string, unknown>[])[1]!.perWeek = 2;
    const r1 = parseImportFile(JSON.stringify(v1));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.errors).toEqual([expect.stringContaining("'perWeek' 는 버전 2")]);
  });

  it('같은 통장 · 같은 날의 나머지 배분이 둘이면 막아요', () => {
    const raw = sampleV2();
    (raw.rules as Record<string, unknown>[]).push({ key: 'rest21b', from: 'salary', to: 'event', kind: 'remainder', dayOfMonth: 21, startMonth: '2026-11' });
    const plan = planImport(base(), parsed(raw), CTX);
    expect(plan.errors).toEqual([expect.stringContaining("'rest21b'")]);
  });
});
