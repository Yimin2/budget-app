import { allowanceIncomeId, autoFixedExpenseId, autoTransferId, monthEndTransferId, newId } from './ids';

describe('ids', () => {
  it('newId is uuid v4 and unique', () => {
    const a = newId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newId()).not.toBe(a);
  });
  it('deterministic auto ids', () => {
    expect(autoTransferId('r1', '2026-11')).toBe(autoTransferId('r1', '2026-11'));
    expect(autoTransferId('r1', '2026-11')).not.toBe(autoTransferId('r1', '2026-12'));
    expect(autoFixedExpenseId('r1', '2026-11')).not.toBe(autoTransferId('r1', '2026-11'));
    expect(allowanceIncomeId('s', 'f', '2026-11')).toBe('allowance:s:f:2026-11');
    expect(monthEndTransferId('2026-10')).toBe('monthend:2026-10');
  });
});
