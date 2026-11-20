import { account, emptyLedger, rule, transfer } from './_fixtures';
import { autoTransferId } from './ids';
import { hasSendWork, salaryAccounts, sendList } from './sendList';
import type { LedgerData } from './types';

const salary = account('income', { id: 'salary', name: '월급통장', bank: '카카오뱅크', accountNumber: '3333-01' });
const other = account('income', { id: 'inc2', name: '수입통장', order: 5 });
const ev = account('event', { id: 'ev', name: '이벤트통장', order: 2 });
const res = account('reservoir', { id: 'res', name: '저수지', order: 3 });
const rEv = rule({ id: 'r-ev', fromAccountId: salary.id, toAccountId: ev.id, amount: 500_000, dayOfMonth: 21 });
const rRes = rule({ id: 'r-res', fromAccountId: salary.id, toAccountId: res.id, amount: 300_000, dayOfMonth: 21, autoDebit: true });

const income = (date: string, amount: number) => transfer({ id: `in-${date}`, kind: 'income', toAccountId: salary.id, date, amount });
const auto = (r: typeof rEv, month: string, amount: number, p: Partial<Parameters<typeof transfer>[0]> = {}) =>
  transfer({ id: autoTransferId(r.id, month), fromAccountId: r.fromAccountId, toAccountId: r.toAccountId, ruleId: r.id, date: `${month}-21`, amount, ...p });

function ledger(p: Partial<LedgerData> = {}): LedgerData {
  return emptyLedger({ accounts: [salary, other, ev, res], rules: [rEv, rRes], ...p });
}

describe('오늘 보낼 돈', () => {
  it('월급통장은 배분 규칙이 나가는 수입 통장만이에요', () => {
    expect(salaryAccounts(ledger()).map((a) => a.id)).toEqual(['salary']);
  });

  it('배분이 기록되기 전에는 비어 있어요', () => {
    const l = sendList(ledger(), '2026-11-20');
    expect(l.sources).toEqual([]);
    expect(hasSendWork(l)).toBe(false);
  });

  it('이번 달 배분을 받는 통장 순서로 보여 주고, 자동이체는 금액이 같으면 할 일이 아니에요', () => {
    const d = ledger({
      transfers: [income('2026-10-21', 800_000), auto(rEv, '2026-10', 500_000), auto(rRes, '2026-10', 300_000), income('2026-11-21', 800_000), auto(rEv, '2026-11', 500_000), auto(rRes, '2026-11', 300_000)],
    });
    const l = sendList(d, '2026-11-21');
    expect(l.sources).toHaveLength(1);
    const items = l.sources[0]!.items;
    expect(items.map((i) => [i.to?.id, i.pending, i.autoDebit, i.changedFrom])).toEqual([
      ['ev', true, false, null],
      ['res', false, true, null],
    ]);
    expect(l.pendingCount).toBe(1);
    expect(l.sources[0]!.leftover).toBe(0);
  });

  it('자동이체 금액이 지난달과 다르면 바꿔 달라고 하고, 보냈어요 · 바꿨어요를 누르면 끝나요', () => {
    const base = [income('2026-10-21', 800_000), auto(rRes, '2026-10', 300_000), income('2026-11-21', 850_000), auto(rRes, '2026-11', 350_000)];
    const l = sendList(ledger({ transfers: [...base, auto(rEv, '2026-11', 500_000)] }), '2026-11-21');
    const r = l.sources[0]!.items.find((i) => i.rule.id === 'r-res')!;
    expect(r.changedFrom).toBe(300_000);
    expect(r.pending).toBe(true);
    expect(l.pendingCount).toBe(2);

    const done = sendList(
      ledger({ transfers: [...base.slice(0, 3), auto(rRes, '2026-11', 350_000, { sentAt: '2026-11-21T01:00:00.000Z' }), auto(rEv, '2026-11', 500_000, { sentAt: '2026-11-21T01:00:00.000Z' })] }),
      '2026-11-21',
    );
    expect(done.pendingCount).toBe(0);
    expect(done.sources[0]!.items.every((i) => i.sent)).toBe(true);
  });

  it('배분 뒤에도 월급통장에 돈이 남아 있으면 덜 보낸 돈으로 알려요', () => {
    const d = ledger({ transfers: [income('2026-11-21', 900_000), auto(rEv, '2026-11', 500_000, { sentAt: '2026-11-21T01:00:00.000Z' }), auto(rRes, '2026-11', 300_000)] });
    const l = sendList(d, '2026-11-21');
    expect(l.pendingCount).toBe(0);
    expect(l.sources[0]!.leftover).toBe(100_000);
    expect(hasSendWork(l)).toBe(true);
  });

  it('미래 날짜 · 지난달 · 지운 이체는 빼요', () => {
    const d = ledger({ transfers: [auto(rEv, '2026-10', 500_000), auto(rRes, '2026-11', 300_000, { deleted: true }), auto(rEv, '2026-11', 500_000)] });
    expect(sendList(d, '2026-11-20').sources).toEqual([]);
  });
});
