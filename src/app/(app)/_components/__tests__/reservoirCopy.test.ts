/** 저수지는 받는 사람이 아니에요: 화면 문구에 '저수지에 줄 돈' 같은 말이 남지 않게 (갚을 돈만 있어요) */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = ['src/app', 'src/ui'];
const FORBIDDEN = /저수지에 (?:줄|쓸|줘야 할|돌려줄) 돈|저수지에서 돌려받을|저수지에서 빌려 줄 돈/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : files(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('저수지 문구', () => {
  it('화면 코드에 저수지를 받는 쪽으로 쓰는 문구가 없어요', () => {
    const hits = ROOTS.flatMap(files).flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((line, i) => ({ f, i: i + 1, line }))
        // '저수지에 줘야 할 돈은 없고' 처럼 없다고 말하는 문장은 괜찮아요
        .filter(({ line }) => FORBIDDEN.test(line) && !/줘야 할 돈은 없/.test(line)),
    );
    expect(hits.map(({ f, i, line }) => `${f}:${i} ${line.trim()}`)).toEqual([]);
  });
});
