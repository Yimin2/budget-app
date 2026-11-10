import { describe, expect, it } from 'vitest';
import {
  TABLE_NAMES, TAB_NAMES, ALL_TABS, canonicalHeaders, decodeSettings, decodeTable, encodeRow,
  encodeRowForHeaders, encodeSettings, encodeTable, toISODate, toYearMonth, type RawCell,
} from '../schema';
import { sampleLedger } from './fixture';

describe('schema', () => {
  it('탭 이름은 PLAN 5장과 같다', () => {
    expect(ALL_TABS).toEqual(['설정', '통장', '월배분', '이체', '고정지출', '일정', '지출', '월말', '카테고리', '즐겨찾기', '멤버', '여행']);
    expect(canonicalHeaders('transfers')).toEqual([
      'id', '날짜', '종류', '출금통장', '입금통장', '금액', '상태', '월배분id', '메모', '작성자', '생성일시', '수정일시', '삭제됨',
    ]);
    expect(canonicalHeaders('monthEnds')).toEqual(['월', '남은생활비', '처리', '처리자', '처리일시', '항목별']);
    expect(canonicalHeaders('accounts')).toEqual(['id', '이름', '역할', '시작잔액', '시작일', '순서', '주인', '주인이메일', '삭제됨']);
    expect(canonicalHeaders('fixedExpenses')).toContain('나눠쓰기');
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
    expect(encodeRow('monthEnds', d.monthEnds[1]!)).toEqual(['2026-09', 0, '미정', '', '', '']);
    expect(encodeRow('monthEnds', d.monthEnds[0]!)[5]).toBe('{"c1":55000,"":-3000}');
    expect(encodeRow('fixedExpenses', d.fixedExpenses[1]!)).toContain('한달');
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

  it('새 열(주인 · 나눠쓰기 · 항목별)이 없거나 비어도 안전하게 읽는다', () => {
    // 예전 시트: 새 열 머리글이 아예 없음
    const accounts = decodeTable('accounts', [['id', '이름', '역할'], ['a', '수입통장', '수입']]);
    expect(accounts[0]).toMatchObject({ ownerName: null, ownerEmail: null });
    const fixed = decodeTable('fixedExpenses', [['id', '이름', '금액', '종류'], ['f', '생활비', 600000, '생활비']]);
    expect(fixed[0]).toMatchObject({ kind: 'living', categoryId: null, spread: 'daily' });
    const ends = decodeTable('monthEnds', [['월', '남은생활비', '처리'], ['2026-10', 1000, '이월']]);
    expect(ends[0]).toMatchObject({ choice: 'carryover', items: null });
    // 머리글은 있지만 칸이 비었거나 엉뚱한 값
    const blank = decodeTable('monthEnds', [
      ['월', '남은생활비', '처리', '항목별'],
      ['2026-10', 1000, '이월', ''],
      ['2026-09', 1000, '이월', '아무 글자'],
      ['2026-08', 1000, '이월', '{"food":"1,000원","x":"?"}'],
    ]);
    expect(blank.map((r) => r.items)).toEqual([null, null, [{ categoryId: 'food', leftover: 1000 }]]);
    const spread = decodeTable('fixedExpenses', [
      ['id', '종류', '나눠쓰기', '주인'],
      ['a', '생활비', '', ''],
      ['b', '생활비', '한 달', ''],
      ['c', '생활비', 'monthly', ''],
    ]);
    expect(spread.map((r) => r.spread)).toEqual(['daily', 'monthly', 'monthly']);
    const owner = decodeTable('accounts', [['id', '주인', '주인이메일'], ['a', ' 민지 ', ''], ['b', '', 'x@y.z']]);
    expect(owner.map((r) => [r.ownerName, r.ownerEmail])).toEqual([['민지', null], [null, 'x@y.z']]);
  });

  it('고정지출 메모 열이 없거나 비면 메모 없음으로 읽고, 있으면 그대로 읽고 쓴다', () => {
    const old = decodeTable('fixedExpenses', [['id', '이름'], ['f1', '월세']]);
    expect(old[0]!.memo).toBeUndefined();
    const rows = decodeTable('fixedExpenses', [['id', '메모'], ['f1', ''], ['f2', ' 관리비 포함 ']]);
    expect(rows.map((r) => r.memo)).toEqual([undefined, '관리비 포함']);
    const headers = canonicalHeaders('fixedExpenses');
    expect(headers[headers.length - 1]).toBe('메모');
    const enc = encodeRow('fixedExpenses', { ...rows[1]!, name: 'x' });
    expect(enc[enc.length - 1]).toBe('관리비 포함');
    expect(encodeRow('fixedExpenses', rows[0]!).at(-1)).toBe('');
  });

  it('할부 열(할부회차 · 할부개월)이 없거나 비면 null 로 읽고, 종류 할부를 읽는다', () => {
    const old = decodeTable('fixedExpenses', [['id', '이름', '종류'], ['a', '월세', '일반']]);
    expect(old[0]).toMatchObject({ kind: 'bill', installmentNo: null, installmentCount: null });
    const rows = decodeTable('fixedExpenses', [
      ['id', '종류', '할부회차', '할부개월'],
      ['t', '할부', '', ''],
      ['t@2027-01', 'installment', 17, '24'],
    ]);
    expect(rows.map((r) => [r.kind, r.installmentNo, r.installmentCount])).toEqual([
      ['installment', null, null],
      ['installment', 17, 24],
    ]);
  });

  it('예전 앱이 종류를 일반으로 덮어쓴 할부 행(할부개월이 남음)은 할부로 읽는다', () => {
    const rows = decodeTable('fixedExpenses', [
      ['id', '종류', '할부회차', '할부개월'],
      ['tv', '일반', 1, 24],
      ['rent', '일반', '', ''],
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['installment', 'bill']);
  });

  it('청구 열(낸사람 · 돌려받을통장 · 정산일)이 없거나 비면 보통 지출로 읽는다', () => {
    const old = decodeTable('expenses', [['id', '날짜', '금액', '통장'], ['x', '2026-11-01', 1000, 'a']]);
    expect(old[0]).toMatchObject({ paidBy: null, claimAccountId: null, claimDue: null });
    const rows = decodeTable('expenses', [
      ['id', '금액', '낸사람', '돌려받을통장', '정산일'],
      ['a', 1000, '', '', ''],
      ['b', 1000, ' 가람 ', 'inc-g', '2026. 11. 21.'],
      ['c', 1000, '나래', '', '아무 글자'],
    ]);
    expect(rows.map((r) => [r.paidBy, r.claimAccountId, r.claimDue])).toEqual([
      [null, null, null],
      ['가람', 'inc-g', '2026-11-21'],
      ['나래', null, null],
    ]);
  });

  it('설정 정산일: 빈 값은 자동(null), 1~31 만', () => {
    const read = (v: RawCell) => decodeSettings([['키', '값'], ['종류', '공용'], ['정산일', v]]).settings.settleDay;
    expect(read('')).toBeNull();
    expect(read(25)).toBe(25);
    expect(read('21일')).toBeNull();
    expect(read(40)).toBeNull();
    expect(encodeSettings({ ...sampleLedger().settings, settleDay: 25 })).toContainEqual(['정산일', 25]);
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

  it('여행 열(여행id · 여행항목)이 없거나 비면 여행 아님으로 읽고, 여행 탭 항목예산은 한글 JSON', () => {
    const old = decodeTable('expenses', [['id', '날짜', '금액', '통장'], ['x', '2026-11-01', 1000, 'a']]);
    expect(old[0]!.tripId).toBeNull();
    expect(old[0]!.tripItem).toBeNull();
    const rows = decodeTable('expenses', [
      ['id', '날짜', '금액', '통장', '여행id', '여행항목'],
      ['x', '2026-11-01', 1000, 'a', 'tr1', '숙박'],
      ['y', '2026-11-01', 1000, 'a', 'tr1', 'flight'],
      ['z', '2026-11-01', 1000, 'a', '', '모름'],
    ]);
    expect(rows.map((r) => [r.tripId, r.tripItem])).toEqual([['tr1', 'stay'], ['tr1', 'flight'], [null, null]]);
    const trip = sampleLedger().trips[0]!;
    const encoded = encodeRow('trips', trip);
    expect(encoded[canonicalHeaders('trips').indexOf('항목예산')]).toBe('{"항공":300000,"숙박":250000}');
    expect(decodeTable('trips', encodeTable('trips', [trip]))[0]).toEqual(trip);
    const loose = decodeTable('trips', [
      ['id', '이름', '시작일', '종료일', '예산', '항목예산'],
      ['t', '부산', '2026-05-01', '2026-05-02', '', '{"food": 5, "모름": 3, "투어": "1,000"}'],
      ['u', '강릉', '2026-05-01', '', 100, '깨진 값'],
    ]);
    expect(loose[0]).toMatchObject({ budget: 0, items: { food: 5, tour: 1000 }, deleted: false });
    expect(loose[1]).toMatchObject({ endDate: '', items: {} });
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
