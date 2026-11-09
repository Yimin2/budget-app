import { afterEach, describe, expect, it, vi } from 'vitest';
import { appIdFromClientId, getGoogleConfig, isGoogleConfigured } from '../config';

afterEach(() => vi.unstubAllEnvs());

describe('google config', () => {
  it('클라이언트 ID 가 없으면 설정 안 됨', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', '');
    expect(isGoogleConfigured()).toBe(false);
  });

  it('공백만 있으면 설정 안 됨', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', '   ');
    expect(isGoogleConfigured()).toBe(false);
  });

  it('값을 읽고 앱 ID 가 없으면 클라이언트 ID 의 프로젝트 번호를 쓴다', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', '123456789-abc.apps.googleusercontent.com');
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_API_KEY', 'key');
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_APP_ID', '');
    expect(isGoogleConfigured()).toBe(true);
    expect(getGoogleConfig()).toEqual({
      clientId: '123456789-abc.apps.googleusercontent.com',
      apiKey: 'key',
      appId: '123456789',
    });
  });

  it('앱 ID 를 주면 그 값을 쓴다', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', '1-x.apps.googleusercontent.com');
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_APP_ID', '999');
    expect(getGoogleConfig().appId).toBe('999');
  });

  it('appIdFromClientId', () => {
    expect(appIdFromClientId('42-abc')).toBe('42');
    expect(appIdFromClientId('abc')).toBe('');
  });
});
