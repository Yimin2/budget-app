/**
 * 쿠키 암호화 (AES-256-GCM, Web Crypto). 서버 전용.
 *
 * 형식: `v1.<iv base64url>.<암호문+태그 base64url>`
 * - 키: AUTH_COOKIE_SECRET(32바이트 이상) 에서 HKDF-SHA256 으로 쿠키 용도마다 따로 만든다
 * - 용도 문자열을 AAD 로도 넣어, 한 쿠키 값을 다른 쿠키 자리에 옮겨 쓰지 못하게 한다
 * - 태그가 맞지 않으면(값을 고쳤거나 키가 다르면) null
 */

const VERSION = 'v1';
const IV_BYTES = 12;
const MIN_SECRET_BYTES = 32;

export type CookiePurpose = 'session' | 'oauth';

const enc = new TextEncoder();
const dec = new TextDecoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** AUTH_COOKIE_SECRET (표준 또는 URL 용 base64) → 바이트. 32바이트보다 짧거나 base64 가 아니면 null */
export function decodeSecret(secret: string | undefined): Uint8Array | null {
  const s = (secret ?? '').trim();
  if (!s || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return null;
  const bytes = base64UrlDecode(s.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'));
  if (!bytes || bytes.length < MIN_SECRET_BYTES) return null;
  return bytes;
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function deriveKey(secret: Uint8Array, purpose: CookiePurpose): Promise<CryptoKey> {
  const id = `${purpose}:${base64UrlEncode(secret)}`;
  let p = keyCache.get(id);
  if (!p) {
    p = crypto.subtle
      .importKey('raw', toBuffer(secret), 'HKDF', false, ['deriveKey'])
      .then((base) =>
        crypto.subtle.deriveKey(
          { name: 'HKDF', hash: 'SHA-256', salt: toBuffer(enc.encode('budget-app.cookie')), info: toBuffer(enc.encode(`budget.${purpose}.v1`)) },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt'],
        ),
      );
    keyCache.set(id, p);
  }
  return p;
}

function aad(purpose: CookiePurpose): ArrayBuffer {
  return toBuffer(enc.encode(`budget.${purpose}.v1`));
}

/** 값을 JSON 으로 바꿔 암호화한다 */
export async function seal(value: unknown, secret: Uint8Array, purpose: CookiePurpose): Promise<string> {
  const key = await deriveKey(secret, purpose);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBuffer(iv), additionalData: aad(purpose) },
    key,
    toBuffer(enc.encode(JSON.stringify(value))),
  );
  return `${VERSION}.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ct))}`;
}

/** 복호화. 형식이 틀리거나 위조 · 다른 키 · 다른 용도면 null */
export async function unseal<T = unknown>(token: string | null | undefined, secret: Uint8Array, purpose: CookiePurpose): Promise<T | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const iv = base64UrlDecode(parts[1] ?? '');
  const ct = base64UrlDecode(parts[2] ?? '');
  if (!iv || iv.length !== IV_BYTES || !ct || ct.length < 17) return null;
  try {
    const key = await deriveKey(secret, purpose);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toBuffer(iv), additionalData: aad(purpose) }, key, toBuffer(ct));
    return JSON.parse(dec.decode(plain)) as T;
  } catch {
    return null;
  }
}

/** 길이가 같을 때 걸리는 시간이 내용과 무관한 비교 */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function randomToken(bytes = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** PKCE S256: base64url(SHA-256(verifier)) */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toBuffer(enc.encode(verifier)));
  return base64UrlEncode(new Uint8Array(digest));
}
