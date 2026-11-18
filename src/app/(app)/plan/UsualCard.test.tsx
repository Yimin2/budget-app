// @vitest-environment jsdom
/** 이벤트 화면 카드 '평소 쓰는 돈': 기록이 없으면 안내 한 줄 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventsView } from './EventsView';
import { makeHarness } from './testHarness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/plan',
}));

afterEach(cleanup);

describe('평소 쓰는 돈 카드', () => {
  it('지난 기록은 있어도 일정 아닌 이벤트 지출이 없으면 표 대신 안내 한 줄', async () => {
    const h = makeHarness({ history: true });
    render(<EventsView />, { wrapper: h.Wrapper });
    const card = await screen.findByRole('region', { name: '평소 쓰는 돈' });
    await waitFor(() => expect(within(card).getByTestId('usual-empty')).toBeTruthy());
    expect(within(card).getByTestId('usual-empty').textContent).toBe('아직 일정 아닌 이벤트 지출 기록이 없어요. 기록이 쌓이면 항목별 평균이 나와요');
    expect(within(card).queryByRole('table')).toBeNull();
  });
});
