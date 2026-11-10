import { describe, expect, it, vi } from 'vitest';
import type { LedgerRef } from '@/storage/types';
import {
  INVITE_MESSAGES, buildInviteLink, normalizeSpreadsheetId, openInvitedLedger, parseInviteSearch, shouldPromptShared,
} from './invite';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
const REF: LedgerRef = { id: ID, name: '민지·준호 가계부', kind: 'shared', source: 'sheets' };

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

describe('초대 링크 만들기 · 읽기', () => {
  it('링크는 /start?open=<id>', () => {
    expect(buildInviteLink('https://budget.example', ID)).toBe(`https://budget.example/start?open=${ID}`);
    expect(buildInviteLink('https://budget.example/', ID)).toBe(`https://budget.example/start?open=${ID}`);
  });

  it('?open= 에서 id 를 꺼내요 (다른 값과 섞여도 · 시트 주소를 그대로 넣어도)', () => {
    expect(parseInviteSearch(`?open=${ID}`)).toBe(ID);
    expect(parseInviteSearch(`utm=x&open=${ID}`)).toBe(ID);
    expect(parseInviteSearch(`?open=${encodeURIComponent(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`)}`)).toBe(ID);
    expect(parseInviteSearch(`?open=%20${ID}%20`)).toBe(ID);
  });

  it('없거나 이상한 값이면 null', () => {
    expect(parseInviteSearch('')).toBeNull();
    expect(parseInviteSearch(null)).toBeNull();
    expect(parseInviteSearch('?other=1')).toBeNull();
    expect(parseInviteSearch('?open=')).toBeNull();
    expect(parseInviteSearch('?open=short')).toBeNull();
    expect(parseInviteSearch('?open=<script>alert(1)</script>aaaaaaaaaaaaaaaa')).toBeNull();
    expect(parseInviteSearch(`?open=${'a'.repeat(200)}`)).toBeNull();
    expect(normalizeSpreadsheetId('https://example.com/not-a-sheet')).toBeNull();
  });
});

describe('첫 로그인 안내 조건', () => {
  it('구글 로그인 + 최근 가계부 없음일 때만', () => {
    expect(shouldPromptShared({ status: 'signedIn', mode: 'google', recentLedgers: [] })).toBe(true);
    expect(shouldPromptShared({ status: 'signedIn', mode: 'google', recentLedgers: [REF] })).toBe(false);
    expect(shouldPromptShared({ status: 'signedIn', mode: 'demo', recentLedgers: [] })).toBe(false);
    expect(shouldPromptShared({ status: 'signedOut', mode: null, recentLedgers: [] })).toBe(false);
    expect(shouldPromptShared({ status: 'loading', mode: 'google', recentLedgers: [] })).toBe(false);
  });
});

describe('초대 링크로 열기', () => {
  it('이미 읽을 수 있으면 (내 파일) 선택 창 없이 바로 열어요', async () => {
    const pick = vi.fn();
    const describeFn = vi.fn(async () => REF);
    await expect(openInvitedLedger({ describe: describeFn, pick }, ID)).resolves.toEqual({ kind: 'opened', ref: REF, picked: false });
    expect(pick).not.toHaveBeenCalled();
  });

  it.each([403, 404])('권한이 없으면(%i) 그 파일로 선택 창 → 고르면 다시 읽어 열어요', async (status) => {
    let allowed = false;
    const describeFn = vi.fn(async (id: string) => {
      if (!allowed) throw new HttpError('권한이 없어요', status);
      return { ...REF, id };
    });
    const pick = vi.fn(async (fileId: string) => {
      allowed = true;
      return { id: fileId, name: '민지·준호 가계부' };
    });
    const r = await openInvitedLedger({ describe: describeFn, pick }, ID);
    expect(pick).toHaveBeenCalledWith(ID);
    expect(describeFn).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ kind: 'opened', ref: REF, picked: true });
  });

  it('선택 창을 닫으면 cancelled', async () => {
    const describeFn = vi.fn(async () => {
      throw new HttpError('x', 404);
    });
    await expect(openInvitedLedger({ describe: describeFn, pick: async () => null }, ID)).resolves.toEqual({ kind: 'cancelled' });
    expect(describeFn).toHaveBeenCalledTimes(1);
  });

  it('골랐는데도 못 읽으면 공유를 부탁하라고 알려요', async () => {
    const describeFn = vi.fn(async () => {
      throw new HttpError('forbidden', 403);
    });
    await expect(openInvitedLedger({ describe: describeFn, pick: async (id) => ({ id, name: '' }) }, ID)).rejects.toThrow(
      INVITE_MESSAGES.noAccess,
    );
  });

  it('가계부가 아닌 파일 · 연결 오류는 선택 창 없이 그 문구를 그대로', async () => {
    const pick = vi.fn();
    await expect(
      openInvitedLedger({ describe: async () => Promise.reject(new HttpError('이 파일은 가계부로 열 수 없어요', 400)), pick }, ID),
    ).rejects.toThrow('이 파일은 가계부로 열 수 없어요');
    await expect(
      openInvitedLedger({ describe: async () => Promise.reject(new HttpError('Failed to fetch', 0)), pick }, ID),
    ).rejects.toThrow(INVITE_MESSAGES.failed);
    expect(pick).not.toHaveBeenCalled();
  });

  it('고른 뒤 가계부가 아니면 그 문구', async () => {
    let n = 0;
    const describeFn = async () => {
      n++;
      throw n === 1 ? new HttpError('x', 404) : new HttpError('이 파일은 가계부로 열 수 없어요', 400);
    };
    await expect(openInvitedLedger({ describe: describeFn, pick: async (id) => ({ id, name: '' }) }, ID)).rejects.toThrow(
      '이 파일은 가계부로 열 수 없어요',
    );
  });
});
