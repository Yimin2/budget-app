import { describe, expect, it } from 'vitest';
import { base64UrlDecode, base64UrlEncode, decodeSecret, pkceChallenge, randomToken, safeEqual, seal, unseal } from '../crypto';

const SECRET_B64 = Buffer.alloc(32, 7).toString('base64');
const secret = decodeSecret(SECRET_B64)!;

describe('decodeSecret', () => {
  it('32바이트 이상 base64 만 받는다', () => {
    expect(decodeSecret(SECRET_B64)?.length).toBe(32);
    expect(decodeSecret(Buffer.alloc(48, 1).toString('base64url'))?.length).toBe(48);
    expect(decodeSecret(Buffer.alloc(16, 1).toString('base64'))).toBeNull();
    expect(decodeSecret('not base64 at all!')).toBeNull();
    expect(decodeSecret('')).toBeNull();
    expect(decodeSecret(undefined)).toBeNull();
  });
});

describe('seal / unseal (AES-256-GCM)', () => {
  it('왕복하면 같은 값', async () => {
    const value = { rt: '1//refresh', sub: '123', email: 'a@gmail.com', t: 1 };
    const sealed = await seal(value, secret, 'session');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('refresh');
    expect(await unseal(sealed, secret, 'session')).toEqual(value);
  });

  it('같은 값도 매번 다른 암호문 (IV 무작위)', async () => {
    const a = await seal({ x: 1 }, secret, 'session');
    const b = await seal({ x: 1 }, secret, 'session');
    expect(a).not.toBe(b);
  });

  it('한 글자라도 고치면 거절', async () => {
    const sealed = await seal({ rt: 'abc' }, secret, 'session');
    const parts = sealed.split('.');
    const ct = parts[2]!;
    const flipped = ct.slice(0, 5) + (ct[5] === 'A' ? 'B' : 'A') + ct.slice(6);
    expect(await unseal(`${parts[0]}.${parts[1]}.${flipped}`, secret, 'session')).toBeNull();
    const iv = parts[1]!;
    const ivFlipped = (iv[0] === 'A' ? 'B' : 'A') + iv.slice(1);
    expect(await unseal(`${parts[0]}.${ivFlipped}.${ct}`, secret, 'session')).toBeNull();
  });

  it('다른 키 · 다른 용도 · 잘못된 형식은 거절', async () => {
    const sealed = await seal({ rt: 'abc' }, secret, 'session');
    const other = decodeSecret(Buffer.alloc(32, 9).toString('base64'))!;
    expect(await unseal(sealed, other, 'session')).toBeNull();
    expect(await unseal(sealed, secret, 'oauth')).toBeNull();
    expect(await unseal('v2.' + sealed.slice(3), secret, 'session')).toBeNull();
    expect(await unseal('garbage', secret, 'session')).toBeNull();
    expect(await unseal('v1.!!.??', secret, 'session')).toBeNull();
    expect(await unseal(null, secret, 'session')).toBeNull();
  });
});

describe('PKCE · state 도우미', () => {
  it('RFC 7636 부록 B 예시와 같은 S256 challenge', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('randomToken 은 base64url, 겹치지 않는다', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });

  it('safeEqual', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(false);
  });

  it('base64url 왕복', () => {
    const bytes = new Uint8Array([0, 250, 251, 252, 253, 254, 255]);
    expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
    expect(base64UrlDecode('a+b/')).toBeNull();
  });
});
