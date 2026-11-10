import { describe, expect, it, vi } from 'vitest';
import { SheetsBackend, StorageError } from '../sheets';
import type { LedgerRef } from '../types';

const ref: LedgerRef = { id: 'sheet-1', name: '가계부', kind: 'shared', source: 'sheets' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function backendWith(responses: Response[]) {
  const urls: URL[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    urls.push(new URL(String(input)));
    return responses.shift() ?? json(500, {});
  });
  const backend = new SheetsBackend(async () => 'token', { fetch: fetchMock as unknown as typeof fetch, sleep: async () => {} });
  return { backend, urls, fetchMock };
}

describe('SheetsBackend.listSharing — Drive permissions.list', () => {
  it('fields · supportsAllDrives 로 부르고, 사람(type=user)만 권한과 함께 모아요', async () => {
    const { backend, urls } = backendWith([
      json(200, {
        permissions: [
          { id: '1', type: 'user', role: 'owner', emailAddress: 'owner@example.com', displayName: '가나다' },
          { id: '2', type: 'user', role: 'writer', emailAddress: 'editor@example.com', displayName: '라마바' },
          { id: '3', type: 'user', role: 'commenter', emailAddress: 'comment@example.com', displayName: '' },
          { id: '4', type: 'user', role: 'reader', emailAddress: 'viewer@example.com', displayName: '사아자' },
          { id: '5', type: 'user', role: 'writer', emailAddress: 'gone@example.com', displayName: '지운 계정', deleted: true },
          { id: '6', type: 'user', role: 'fileOrganizer', emailAddress: 'org@example.com', displayName: '차카타' },
          { id: '7', type: 'user', role: 'writer', displayName: '이메일 없음' },
        ],
      }),
    ]);
    const list = await backend.listSharing(ref);
    const url = urls[0]!;
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/drive/v3/files/sheet-1/permissions');
    expect(url.searchParams.get('supportsAllDrives')).toBe('true');
    expect(url.searchParams.get('fields')).toBe('nextPageToken,permissions(id,type,role,emailAddress,displayName,deleted)');
    expect(list).toEqual({
      complete: true,
      users: [
        { email: 'owner@example.com', displayName: '가나다', role: 'owner' },
        { email: 'editor@example.com', displayName: '라마바', role: 'writer' },
        { email: 'comment@example.com', displayName: '', role: 'commenter' },
        { email: 'viewer@example.com', displayName: '사아자', role: 'reader' },
        { email: 'org@example.com', displayName: '차카타', role: 'writer' },
      ],
    });
  });

  it('그룹 · 도메인 · 링크 공유가 있으면 complete=false, 다음 쪽(pageToken)도 읽어요', async () => {
    const { backend, urls } = backendWith([
      json(200, {
        nextPageToken: 'p2',
        permissions: [{ id: '1', type: 'user', role: 'owner', emailAddress: 'owner@example.com', displayName: '가나다' }],
      }),
      json(200, { permissions: [{ id: 'anyoneWithLink', type: 'anyone', role: 'reader' }] }),
    ]);
    const list = await backend.listSharing(ref);
    expect(urls).toHaveLength(2);
    expect(urls[1]!.searchParams.get('pageToken')).toBe('p2');
    expect(list.complete).toBe(false);
    expect(list.users.map((u) => u.email)).toEqual(['owner@example.com']);
  });

  it('보기 권한이라 403 이면 그대로 던져요 (부르는 쪽이 건너뛰어요)', async () => {
    const { backend } = backendWith([json(403, { error: { code: 403 } })]);
    await expect(backend.listSharing(ref)).rejects.toBeInstanceOf(StorageError);
  });
});
