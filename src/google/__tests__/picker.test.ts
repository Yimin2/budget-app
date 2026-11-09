// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickSpreadsheetWith, resetPickerCache, SPREADSHEET_MIME } from '../picker';
import type { PickerResponse } from '../types';

let cb: ((d: PickerResponse) => void) | null = null;
const calls: Record<string, unknown[]> = {};

function chain(name: string) {
  return function (this: unknown, ...args: unknown[]) {
    calls[name] = args;
    return this;
  };
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', '77-x.apps.googleusercontent.com');
  vi.stubEnv('NEXT_PUBLIC_GOOGLE_API_KEY', 'KEY');
  vi.stubEnv('NEXT_PUBLIC_GOOGLE_APP_ID', '');
  for (const k of Object.keys(calls)) delete calls[k];
  class DocsView {
    constructor(id: string) { calls.view = [id]; }
    setMimeTypes = chain('mime');
    setIncludeFolders = chain('folders');
  }
  class PickerBuilder {
    addView = chain('addView');
    setOAuthToken = chain('token');
    setDeveloperKey = chain('key');
    setAppId = chain('appId');
    setLocale = chain('locale');
    setTitle = chain('title');
    setOrigin = chain('origin');
    setCallback(f: (d: PickerResponse) => void) { cb = f; return this; }
    build() { return { setVisible: () => ({}) }; }
  }
  const g = globalThis as Record<string, unknown>;
  g.google = { picker: { DocsView, PickerBuilder, ViewId: { SPREADSHEETS: 'spreadsheets' }, Action: { PICKED: 'picked', CANCEL: 'cancel' } } };
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetPickerCache();
  delete (globalThis as Record<string, unknown>).google;
});

describe('pickSpreadsheetWith', () => {
  it('고른 시트를 돌려준다', async () => {
    const p = pickSpreadsheetWith(async () => 'TOK');
    await vi.waitFor(() => expect(cb).not.toBeNull());
    expect(calls.view).toEqual(['spreadsheets']);
    expect(calls.mime).toEqual([SPREADSHEET_MIME]);
    expect(calls.token).toEqual(['TOK']);
    expect(calls.key).toEqual(['KEY']);
    expect(calls.appId).toEqual(['77']);
    expect(calls.locale).toEqual(['ko']);
    cb!({ action: 'loaded' });
    cb!({ action: 'picked', docs: [{ id: 'S1', name: '우리집 가계부' }] });
    await expect(p).resolves.toEqual({ id: 'S1', name: '우리집 가계부' });
  });

  it('취소하면 null', async () => {
    cb = null;
    const p = pickSpreadsheetWith(async () => 'TOK');
    await vi.waitFor(() => expect(cb).not.toBeNull());
    cb!({ action: 'cancel' });
    await expect(p).resolves.toBeNull();
  });

  it('API 키가 없으면 not_configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_API_KEY', '');
    await expect(pickSpreadsheetWith(async () => 'TOK')).rejects.toMatchObject({ code: 'not_configured' });
  });
});
