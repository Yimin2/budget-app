// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { account, emptyLedger, expense } from '@/domain/_fixtures';
import type { Category, Expense, LedgerData } from '@/domain';
import { SavingsBarView, UsualDetails } from './UsualSpendingViz';

afterEach(cleanup);

const TODAY = '2026-11-10';
const eventAcc = account('event', { order: 2, openingDate: '2026-05-01' });
const cat = (id: string, name: string): Category => ({ id, name, icon: 'gift', defaultAccountRole: 'event', order: 0, deleted: false });
const spend = (date: string, amount: number, p: Partial<Expense> = {}) => expense({ date, amount, accountId: eventAcc.id, ...p });

function ledger(): LedgerData {
  return emptyLedger({
    accounts: [
      account('income', { id: 'acc-a', order: 0, ownerName: '가람', ownerEmail: 'garam@x' }),
      account('income', { id: 'acc-b', order: 1, ownerName: '나래', ownerEmail: 'narae@x' }),
      eventAcc,
    ],
    categories: [cat('c-fam', '경조사'), cat('c-gift', '선물')],
    members: [
      { email: 'garam@x', displayName: '가람' },
      { email: 'narae@x', displayName: '나래' },
    ],
    expenses: [
      ...['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m) =>
        spend(`${m}-03`, 120_000, { categoryId: 'c-fam', author: 'garam@x', memo: `${m} 축의금` }),
      ),
      spend('2026-06-10', 30_000, { categoryId: 'c-gift', author: 'narae@x', memo: '꽃' }),
      spend('2026-10-20', 90_000, { categoryId: 'c-gift', author: 'narae@x', memo: '생일 선물' }),
    ],
  });
}

function renderDetails() {
  render(
    <UsualDetails
      data={ledger()}
      accountId={eventAcc.id}
      today={TODAY}
      contribution={700_000}
      usual={1_000_000}
      planned={545_000}
      shortages={[{ month: '2027-02', amount: 10_000 }]}
    />,
  );
}

describe('평소 쓰는 돈 그림 — 펼친 내용', () => {
  it('막대: 적립을 넘는 몫과 바닥나는 달, 평소 지출 = 평소 쓰는 돈 + 일정', () => {
    renderDetails();
    expect(screen.getByTestId('savings-status').textContent).toBe('84.5만 넘어요 · 이대로면 2027년 2월에 바닥나요');
    expect(screen.getByTestId('savings-bar').textContent).toContain('적립 70만');
    expect(screen.getByTestId('savings-bar').textContent).toContain('평소 지출 154.5만');
    expect(screen.getByTestId('savings-bar').textContent).toContain('평소 쓰는 돈 100만 + 등록한 일정 · 여행 54.5만');
  });

  it('적립으로 충분하면 남는 몫', () => {
    render(<SavingsBarView contribution={800_000} usual={500_000} planned={0} shortages={[]} year={2026} />);
    expect(screen.getByTestId('savings-status').textContent).toBe('30만 남아요');
  });

  it('도넛: 가운데 월 합계, 조각마다 글로 (aria-label · 범례)', () => {
    renderDetails();
    const donut = screen.getByRole('img', { name: /^평소 쓰는 돈 월 14만: 경조사 12만 \(86%\), 선물 2만 \(14%\)$/ });
    expect(donut.textContent).toContain('14만');
    expect(within(screen.getByRole('list', { name: '도넛 조각' })).getAllByRole('listitem')).toHaveLength(2);
  });

  it('표: 월 평균 · 건수 · 건당 · 지난달 화살표(글로도), 줄을 누르면 그 항목 지출이 최근 것 먼저 펼쳐져요', () => {
    renderDetails();
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows[1]!.textContent).toContain('경조사');
    expect(rows[1]!.textContent).toContain('12만');
    expect(rows[1]!.textContent).toContain('6건');
    expect(rows[1]!.textContent).toContain('평균과 비슷해요');
    const gift = within(table).getByRole('button', { name: '선물 지출' });
    expect(gift.closest('tr')!.textContent).toMatch(/2만2건6만▲ 9만, 평균보다 많아요/);
    expect(screen.queryByRole('list', { name: /선물 지출/ })).toBeNull();
    fireEvent.click(gift);
    expect(gift.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('dialog')).toBeNull();
    const items = within(screen.getByRole('list', { name: '선물 지출 (최근 것 먼저)' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['10월 20일생일 선물나래90,000원', '6월 10일꽃나래30,000원']);
    fireEvent.click(gift);
    expect(gift.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list', { name: /선물 지출/ })).toBeNull();
  });

  it('[전체 · 사람] 전환: 가계부의 사람 이름으로, 표와 도넛을 그 사람 것만', () => {
    renderDetails();
    const group = screen.getByRole('radiogroup', { name: '누가 쓴 돈을 볼까요' });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['전체', '가람', '나래']);
    expect(within(group).getByRole('radio', { name: '전체' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(group).getByRole('radio', { name: '나래' }));
    expect(within(group).getByRole('radio', { name: '나래' }).getAttribute('aria-checked')).toBe('true');
    const table = screen.getByRole('table');
    expect(within(table).queryByText('경조사')).toBeNull();
    expect(within(table).getByText('선물')).toBeTruthy();
    expect(screen.getByRole('img', { name: /^평소 쓰는 돈 월 2만: 선물 2만 \(100%\)$/ })).toBeTruthy();
    fireEvent.click(within(group).getByRole('radio', { name: '전체' }));
    expect(within(screen.getByRole('table')).getByText('경조사')).toBeTruthy();
  });
});
