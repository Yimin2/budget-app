// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { loadScript, resetScriptCache } from '../script';

afterEach(() => {
  resetScriptCache();
  document.head.innerHTML = '';
});

describe('loadScript', () => {
  it('같은 src 는 태그 하나, 같은 Promise', async () => {
    const a = loadScript('https://example.com/a.js');
    const b = loadScript('https://example.com/a.js');
    expect(a).toBe(b);
    const tags = document.head.querySelectorAll('script');
    expect(tags).toHaveLength(1);
    tags[0]!.dispatchEvent(new Event('load'));
    await expect(a).resolves.toBeUndefined();
  });

  it('실패하면 지우고 다시 시도할 수 있다', async () => {
    const a = loadScript('https://example.com/b.js');
    document.head.querySelector('script')!.dispatchEvent(new Event('error'));
    await expect(a).rejects.toMatchObject({ code: 'script_failed' });
    expect(document.head.querySelectorAll('script')).toHaveLength(0);
    const b = loadScript('https://example.com/b.js');
    expect(b).not.toBe(a);
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
  });

  it('이미 준비됐으면 태그를 만들지 않는다', async () => {
    await loadScript('https://example.com/c.js', () => true);
    expect(document.head.querySelectorAll('script')).toHaveLength(0);
  });
});
