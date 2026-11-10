import { describe, expect, it } from 'vitest';
import { account, emptyLedger, event, rule } from './_fixtures';
import { projectEventAccount } from './events';
import type { LedgerData, Trip } from './types';
import { applyWhatIf, effectiveChanges, projectWhatIf, whatIfDiff } from './whatif';

const TODAY = '2026-11-10';
const income = account('income', { order: 0, openingDate: '2026-11-01' });
const eventAcc = account('event', { order: 1, openingBalance: 200_000, openingDate: '2026-11-01' });
const trip = (p: Partial<Trip> = {}): Trip => ({
  id: 'trip-1', name: '봄 여행', startDate: '2027-04-10', endDate: '2027-04-13', budget: 600_000, items: {}, memo: '',
  author: 'a@x', createdAt: '', updatedAt: '', deleted: false, ...p,
});

/** 잔액 20만 + 매달 10만 적립, 2027-05 결혼식 100만 → 5월(6개월 적립 뒤 80만)에 20만 부족 */
function ledger(p: Partial<LedgerData> = {}): LedgerData {
  return emptyLedger({
    accounts: [income, eventAcc],
    rules: [rule({ fromAccountId: income.id, toAccountId: eventAcc.id, amount: 100_000, dayOfMonth: 25, startMonth: '2026-11' })],
    events: [
      event({ id: 'wed', date: '2027-05-16', amount: 1_000_000, accountId: eventAcc.id, name: '하늘 결혼식' }),
      event({ id: 'bd', date: '2027-02-03', amount: 50_000, accountId: eventAcc.id, name: '바다 생일', repeat: 'yearly' }),
    ],
    ...p,
  });
}

describe('해 보기 (덮어씌운 예측)', () => {
  it('원본은 그대로 두고, 바꾼 것이 없으면 같은 데이터', () => {
    const data = ledger();
    expect(applyWhatIf(data, [])).toBe(data);
    expect(applyWhatIf(data, [{ kind: 'event', id: 'wed', amount: 1_000_000 }])).toBe(data); // 같은 값
    const out = applyWhatIf(data, [{ kind: 'event', id: 'wed', exclude: true }]);
    expect(out.events.find((e) => e.id === 'wed')!.deleted).toBe(true);
    expect(data.events.find((e) => e.id === 'wed')!.deleted).toBe(false);
  });

  it('빼기: 부족이 없어지고 마지막 달 잔액이 그만큼 늘어요', () => {
    const data = ledger();
    const before = projectEventAccount(data, TODAY);
    expect(before.shortages.map((s) => s.month)).toContain('2027-05');
    const changes = [{ kind: 'event' as const, id: 'wed', exclude: true }];
    const after = projectWhatIf(data, TODAY, changes);
    expect(after.shortages).toEqual([]);
    const diff = whatIfDiff(data, TODAY, changes, before, after);
    expect(diff.resolved[0]).toBe('2027-05');
    expect(diff.lastDelta).toBe(1_000_000);
    expect(diff.message).toMatch(/^이 일정을 빼면 2027년 5월 .*부족이 없어져요 · 2027년 10월 예상 잔액 \+100만원$/);
  });

  it('금액 바꾸기: 그 차이만큼 예측이 바뀌어요', () => {
    const data = ledger();
    const before = projectEventAccount(data, TODAY);
    const changes = [{ kind: 'event' as const, id: 'wed', amount: 700_000 }];
    const after = projectWhatIf(data, TODAY, changes);
    expect(after.months.find((m) => m.month === '2027-05')!.planned).toBe(700_000);
    const diff = whatIfDiff(data, TODAY, changes, before, after);
    expect(diff.lastDelta).toBe(300_000);
    expect(diff.message.startsWith('금액을 바꾸면 ')).toBe(true);
  });

  it('날짜 옮기기: 적립이 더 쌓인 뒤로 미루면 부족이 없어져요 (반복 일정은 시리즈 전체)', () => {
    const data = ledger();
    const before = projectEventAccount(data, TODAY);
    const changes = [{ kind: 'event' as const, id: 'wed', date: '2027-09-05' }];
    const after = projectWhatIf(data, TODAY, changes);
    expect(after.months.find((m) => m.month === '2027-05')!.planned).toBe(0);
    expect(after.months.find((m) => m.month === '2027-09')!.planned).toBe(1_000_000);
    expect(after.shortages).toEqual([]);
    const diff = whatIfDiff(data, TODAY, changes, before, after);
    expect(diff.message).toBe('날짜를 옮기면 2027년 5월 · 2027년 6월 부족이 없어져요');

    const moved = projectWhatIf(data, TODAY, [{ kind: 'event', id: 'bd', date: '2027-03-03' }]);
    expect(moved.months.find((m) => m.month === '2027-03')!.planned).toBe(50_000);
    expect(moved.months.find((m) => m.month === '2027-02')!.planned).toBe(0);
  });

  it('여행: 빼기 · 예산 · 날짜(돌아오는 날도 함께), 예산 0 은 빼기와 같아요', () => {
    const data = ledger({ events: [], trips: [trip()] });
    const april = (p: ReturnType<typeof projectEventAccount>) => p.months.find((m) => m.month === '2027-04')!.trips ?? 0;
    expect(april(projectEventAccount(data, TODAY))).toBe(600_000);
    expect(april(projectWhatIf(data, TODAY, [{ kind: 'trip', id: 'trip-1', exclude: true }]))).toBe(0);
    expect(april(projectWhatIf(data, TODAY, [{ kind: 'trip', id: 'trip-1', amount: 400_000 }]))).toBe(400_000);
    const moved = applyWhatIf(data, [{ kind: 'trip', id: 'trip-1', date: '2027-06-01' }]).trips[0]!;
    expect([moved.startDate, moved.endDate]).toEqual(['2027-06-01', '2027-06-04']);
    expect(effectiveChanges(data, [{ kind: 'trip', id: 'trip-1', amount: 0 }])).toEqual([{ kind: 'trip', id: 'trip-1', exclude: true }]);
  });

  it('새로 생기는 부족도 알려 줘요', () => {
    const data = ledger({ events: [] });
    const changes = [{ kind: 'event' as const, id: 'x', amount: 1 }];
    expect(effectiveChanges(data, changes)).toEqual([]); // 없는 일정
    const withSmall = ledger({ events: [event({ id: 's', date: '2027-01-10', amount: 10_000, accountId: eventAcc.id, name: '선물' })] });
    const before = projectEventAccount(withSmall, TODAY);
    const ch = [{ kind: 'event' as const, id: 's', amount: 900_000 }];
    const after = projectWhatIf(withSmall, TODAY, ch);
    const diff = whatIfDiff(withSmall, TODAY, ch, before, after);
    expect(diff.added[0]!.month).toBe('2027-01');
    expect(diff.message).toContain('2027년 1월에 ');
    expect(diff.message).toContain('모자라게 돼요');
  });
});
