/** 가계부 보관(캐시): 계정 · 가계부 · 버전 열쇠, 버전이 다르면 버림, 계정이 바뀌면 지움, 저장소가 실패하면 메모리 */
import { describe, expect, it } from 'vitest';
import { createMemoryCacheStore, LedgerCache, withMemoryFallback, type CacheStore } from '../cache';
import { sampleLedger } from './fixture';

describe('LedgerCache', () => {
  it('쓰고 읽어요 (이메일은 대소문자를 가리지 않아요)', async () => {
    const cache = new LedgerCache(createMemoryCacheStore(), 3);
    const data = sampleLedger();
    await cache.write('Me@Example.com', 'sheet-1', data, '2026-11-20T01:00:00.000Z');
    const hit = await cache.read('me@example.com', 'sheet-1');
    expect(hit?.data.settings.name).toBe('우리집 가계부');
    expect(hit?.savedAt).toBe('2026-11-20T01:00:00.000Z');
    expect(hit?.version).toBe(3);
    expect(await cache.read('me@example.com', 'sheet-2')).toBeNull();
    expect(await cache.read('other@example.com', 'sheet-1')).toBeNull();
  });

  it('버전이 다른 내용은 읽지 않고 지워요', async () => {
    const store = createMemoryCacheStore();
    const cache = new LedgerCache(store, 2);
    // 같은 열쇠에 예전 모양(버전 1)이 남아 있어요
    await store.set(cache.key('me@example.com', 's'), { version: 1, email: 'me@example.com', ledgerId: 's', savedAt: 'x', data: sampleLedger() });
    expect(await cache.read('me@example.com', 's')).toBeNull();
    expect(await store.keys()).toEqual([]);
    // 이전 버전 열쇠로 쓴 내용은 새 버전에서 보이지 않아요
    await new LedgerCache(store, 1).write('me@example.com', 's', sampleLedger(), 'x');
    expect(await cache.read('me@example.com', 's')).toBeNull();
    await cache.retainOnly('me@example.com');
    expect(await store.keys()).toEqual([]);
  });

  it('retainOnly: 다른 계정의 내용을 지워요 · clear: 모두 지워요', async () => {
    const store = createMemoryCacheStore();
    const cache = new LedgerCache(store);
    await cache.write('a@x.com', '1', sampleLedger(), 't');
    await cache.write('a@x.com', '2', sampleLedger(), 't');
    await cache.write('b@x.com', '1', sampleLedger(), 't');
    await cache.retainOnly('A@x.com');
    expect((await store.keys()).length).toBe(2);
    expect(await cache.read('b@x.com', '1')).toBeNull();
    await cache.clear();
    expect(await store.keys()).toEqual([]);
  });

  it('저장소가 실패하면 메모리로 바꿔 계속 써요 · 실패해도 던지지 않아요', async () => {
    const broken: CacheStore = {
      get: () => Promise.reject(new Error('x')),
      set: () => Promise.reject(new Error('x')),
      delete: () => Promise.reject(new Error('x')),
      keys: () => Promise.reject(new Error('x')),
      clear: () => Promise.reject(new Error('x')),
    };
    const cache = new LedgerCache(withMemoryFallback(broken));
    await cache.write('a@x.com', '1', sampleLedger(), 't');
    expect((await cache.read('a@x.com', '1'))?.savedAt).toBe('t');

    const rawBroken = new LedgerCache(broken);
    await expect(rawBroken.write('a@x.com', '1', sampleLedger(), 't')).resolves.toBeUndefined();
    await expect(rawBroken.read('a@x.com', '1')).resolves.toBeNull();
    await expect(rawBroken.clear()).resolves.toBeUndefined();
  });

  it('IndexedDB 가 없으면 메모리 저장소', async () => {
    const cache = new LedgerCache(withMemoryFallback(null));
    await cache.write('a@x.com', '1', sampleLedger(), 't');
    expect(await cache.read('a@x.com', '1')).not.toBeNull();
  });
});
