import { describe, expect, it } from 'vitest';
import {
  TABLE_NAMES, TAB_NAMES, ALL_TABS, canonicalHeaders, decodeSettings, decodeTable, encodeRow,
  encodeRowForHeaders, encodeSettings, encodeTable, toISODate, toYearMonth, type RawCell,
} from '../schema';
import { sampleLedger } from './fixture';

describe('schema', () => {
  it('탭 이름은 PLAN 5장과 같다', () => {
    expect(ALL_TABS).toEqual(['설정', '통장', '월배분', '이체', '고정지출', '일정', '지출', '월말', '카테고리', '즐겨찾기', '멤버']);
    expect(canonicalHeaders('transfers')).toEqual([
      'id', '날짜', '종류', '출금통장', '입금통장', '금액', '상태', '월배분id', '메모', '작성자', '생성일시', '수정일시', '삭제됨',
    ]);
    expect(canonicalHeaders('monthEnds')).toEqual(['월', '남은생활비', '처리', '처리자', '처리일시']);
  });

  it.each(TABLE_NAMES)('%s 행 왕복 변환', (table) => {
    const data = sampleLedger();
    const rows = data[table] as never[];
    const encoded = encodeTable(table, rows);
    expect(encoded[0]).toEqual(canonicalHeaders(table));
    for (const row of encoded) for (const cell of row) expect(['string', 'number', 'boolean']).toContain(typeof cell);
    expect(decodeTable(table, encoded)).toEqual(rows);
  });

  it('한글 표시값·불리언·빈 칸으로 쓴다', () => {
    const d = sampleLedger();
    expect(encodeRow('transfers', d.transfers[0]!)).toEqual([
      't1', '2026-11-25', '수입', '', 'a-inc', 5000000, '완료', '', '월급', 'minji@example.com',
      '2026-11-09T10:00:00.000Z', '2026-11-09T10:00:00.000Z', false,
    ]);
    expect(encodeRow('accounts', d.accounts[3]!)[2]).toBe('저수지');
    expect(encodeRow('monthEnds', d.monthEnds[1]!)).toEqual(['2026-09', 0, '미정', '', '']);
  });

  it('머리글 이름으로 매핑: 순서 바뀜·추가 열·빠진 선택 열', () => {
    const values: RawCell[][] = [
      ['메모 ', '금액', '사용자 열', 'ID', '날짜', '통장', '삭제됨'],
      ['점심', '12,000', '아무거나', 'x1', 46335, 'a-fix', 'TRUE'],
      [],
      ['', '', '', '', '', '', ''],
      ['', 5000, '', '', '2026-11-01', 'a-fix', false], // 키 없음 → 건너뜀
      [null, 3000, null, 'x2', '2026. 11. 3.', 'a-fix'],
    ];
    const rows = decodeTable('expenses', values);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 'x1', memo: '점심', amount: 12000, date: '2026-11-09', accountId: 'a-fix', deleted: true,
      categoryId: null, eventId: null, fixedExpenseId: null, author: '', createdAt: '',
    });
    expect(rows[1]).toMatchObject({ id: 'x2', memo: '', amount: 3000, date: '2026-11-03', deleted: false });
  });

  it('코드값이나 다른 표기로 써도 읽는다', () => {
    const rows = decodeTable('accounts', [
      ['id', '이름', '역할', '시작잔액'],
      ['a', '통장', 'reservoir', '1000원'],
      ['b', '통장', '고정 지출', 0],
      ['c', '통장', '이상한값', 0],
    ]);
    expect(rows.map((r) => r.role)).toEqual(['reservoir', 'fixed', 'other']);
    expect(rows[0]!.openingBalance).toBe(1000);
    expect(rows[0]!.openingDate).toBe('');
  });

  it('카테고리 이모지 머리글은 아이콘으로 읽는다', () => {
    const rows = decodeTable('categories', [['id', '이름', '이모지'], ['c', '식비', 'utensils']]);
    expect(rows[0]!.icon).toBe('utensils');
  });

  it('월 키를 시리얼 숫자·다른 표기에서 정규화', () => {
    expect(toYearMonth(46327)).toBe('2026-11');
    expect(toYearMonth('2026.1')).toBe('2026-01');
    expect(toISODate('2026/1/5')).toBe('2026-01-05');
  });

  it('실제 머리글 순서로 쓰고 모르는 열은 기존 값 유지', () => {
    const d = sampleLedger();
    const headers = ['이메일', '메모장', '표시이름'];
    expect(encodeRowForHeaders('members', d.members[0]!, headers, ['old', '보존', 'old'])).toEqual([
      'minji@example.com', '보존', '민지',
    ]);
  });

  it('설정 키/값 왕복, 모르는 키 보존', () => {
    const d = sampleLedger();
    const enc = encodeSettings({ ...d.settings, kind: 'personal', sharedLedgerId: 'sheet-1' }, [['생활비통장ID', 'a-fix']]);
    expect(enc[0]).toEqual(['키', '값']);
    expect(enc).toContainEqual(['종류', '개인']);
    const dec = decodeSettings(enc);
    expect(dec.settings).toEqual({ ...d.settings, kind: 'personal', sharedLedgerId: 'sheet-1' });
    expect(dec.extras).toEqual([['생활비통장ID', 'a-fix']]);
    expect(decodeSettings(encodeSettings(d.settings)).settings).toEqual(d.settings);
  });

  it('TAB_NAMES 는 TABLE_NAMES 전부를 덮는다', () => {
    expect(TABLE_NAMES.every((t) => TAB_NAMES[t])).toBe(true);
  });
});

describe('시작월 검증', () => {
  it('빈 칸 · 연도만 · 엉뚱한 숫자는 월로 보지 않는다', () => {
    expect(toYearMonth('')).toBeNull();
    expect(toYearMonth('2026')).toBeNull();
    expect(toYearMonth(11)).toBeNull(); // 1900-01
    expect(toYearMonth('2026-13')).toBeNull();
    expect(toYearMonth('2026. 3')).toBe('2026-03');
    const rows = decodeTable('rules', [canonicalHeaders('rules'), ['r', 'a', 'b', 1000, 1, '', '', false]]);
    expect(rows[0]!.startMonth).toBe('');
  });
});
