import { ceilTo1000, floorTo100, formatNumber, formatWon, parseWon } from './money';

describe('money', () => {
  it('formats won', () => {
    expect(formatWon(21400)).toBe('21,400원');
    expect(formatWon(-21400)).toBe('-21,400원');
    expect(formatWon(0)).toBe('0원');
    expect(formatWon(1234567)).toBe('1,234,567원');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(NaN)).toBe('0');
  });
  it('parses won input', () => {
    expect(parseWon('21,400원')).toBe(21400);
    expect(parseWon('21400')).toBe(21400);
    expect(parseWon(' 2만 ')).toBe(20000);
    expect(parseWon('2만5천')).toBe(25000);
    expect(parseWon('2만 5000원')).toBe(25000);
    expect(parseWon('1.5만')).toBe(15000);
    expect(parseWon('5천')).toBe(5000);
    expect(parseWon('1억 2000만')).toBe(120_000_000);
    expect(parseWon('')).toBeNull();
    expect(parseWon('원')).toBeNull();
    expect(parseWon('abc')).toBeNull();
    expect(parseWon('-500')).toBeNull();
  });
  it('rounds', () => {
    expect(floorTo100(21428.57)).toBe(21400);
    expect(floorTo100(99)).toBe(0);
    expect(Object.is(floorTo100(50), 0)).toBe(true);
    expect(ceilTo1000(50000)).toBe(50000);
    expect(ceilTo1000(50001)).toBe(51000);
    expect(ceilTo1000(Infinity)).toBe(0);
  });
});
