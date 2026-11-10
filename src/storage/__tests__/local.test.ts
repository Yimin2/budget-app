// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalBackend, createMemoryStorage, localStorageKey } from '../local';
import { sampleLedger } from './fixture';

describe('LocalBackend (메모리 저장소)', () => {
  let backend: LocalBackend;
  beforeEach(() => {
    backend = new LocalBackend(createMemoryStorage());
  });

  it('create → load 같은 데이터, id 는 local:<uuid>', async () => {
    const ref = await backend.create(sampleLedger());
    expect(ref.id).toMatch(/^local:[0-9a-f-]{36}$/);
    expect(ref).toMatchObject({ name: '우리집 가계부', kind: 'shared', source: 'local' });
    expect(await backend.open(ref).load()).toEqual(sampleLedger());
    expect(await backend.describe(ref.id)).toEqual(ref);
    expect(backend.list()).toEqual([ref]);
  });

  it('load 결과를 고쳐도 저장본은 바뀌지 않는다', async () => {
    const ref = await backend.create(sampleLedger());
    const repo = backend.open(ref);
    const d = await repo.load();
    d.expenses.length = 0;
    expect((await repo.load()).expenses).toHaveLength(2);
  });

  it('insert 는 있는 키를 건너뛴다 (월말=month, 멤버=email)', async () => {
    const ref = await backend.create(sampleLedger());
    const repo = backend.open(ref);
    const base = sampleLedger();
    await repo.insert('expenses', [{ ...base.expenses[0]!, amount: 1 }, { ...base.expenses[0]!, id: 'x9' }, { ...base.expenses[0]!, id: 'x9' }]);
    await repo.insert('monthEnds', [{ ...base.monthEnds[0]!, leftover: 1 }, { ...base.monthEnds[0]!, month: '2026-11' }]);
    await repo.insert('members', [{ email: 'minji@example.com', displayName: '다른 이름' }]);
    const d = await repo.load();
    expect(d.expenses.map((e) => e.id)).toEqual(['x1', 'x2', 'x9']);
    expect(d.expenses[0]!.amount).toBe(12000);
    expect(d.monthEnds.map((m) => m.month)).toEqual(['2026-10', '2026-09', '2026-08', '2026-11']);
    expect(d.members).toHaveLength(2);
  });

  it('upsert 는 교체하거나 추가한다', async () => {
    const ref = await backend.create(sampleLedger());
    const repo = backend.open(ref);
    const base = sampleLedger();
    await repo.upsert('expenses', { ...base.expenses[0]!, amount: 1 });
    await repo.upsert('monthEnds', { ...base.monthEnds[1]!, choice: 'carryover' });
    await repo.upsert('categories', { ...base.categories[0]!, id: 'c9' });
    const d = await repo.load();
    expect(d.expenses[0]!.amount).toBe(1);
    expect(d.expenses).toHaveLength(2);
    expect(d.monthEnds[1]!.choice).toBe('carryover');
    expect(d.categories.map((c) => c.id)).toEqual(['c1', 'c2', 'c9']);
  });

  it('updateSettings 와 share', async () => {
    const ref = await backend.create(sampleLedger());
    const repo = backend.open(ref);
    await repo.updateSettings({ name: '새 이름' });
    await backend.share(ref, ' guest@example.com ');
    const d = await repo.load();
    expect(d.settings.name).toBe('새 이름');
    expect(d.settings.kind).toBe('shared');
    expect(d.members.at(-1)).toEqual({ email: 'guest@example.com', displayName: 'guest' });
    expect((await backend.describe(ref.id)).name).toBe('새 이름');
  });

  it('없는 가계부는 한글 오류', async () => {
    await expect(backend.describe('local:none')).rejects.toThrow('가계부를 찾을 수 없어요');
  });

  it('지정한 id 로 만들기 (체험 모드)', async () => {
    const ref = await backend.create(sampleLedger(), 'local:demo');
    expect(ref.id).toBe('local:demo');
    await expect(backend.create(sampleLedger(), 'abc')).rejects.toThrow();
  });
});

describe('LocalBackend (window.localStorage)', () => {
  it('키 budget:ledger:<id> 에 JSON 으로 저장한다', async () => {
    window.localStorage.clear();
    const backend = new LocalBackend();
    const ref = await backend.create(sampleLedger());
    const raw = window.localStorage.getItem(localStorageKey(ref.id));
    expect(localStorageKey(ref.id)).toBe(`budget:ledger:${ref.id}`);
    expect(JSON.parse(raw!)).toEqual(sampleLedger());
    backend.remove(ref.id);
    expect(backend.has(ref.id)).toBe(false);
  });

  it('옛 저장본(주인 · 나눠쓰기 · 항목별 없음)은 기본값으로 채워 읽는다', async () => {
    window.localStorage.clear();
    const old = sampleLedger() as unknown as Record<string, Record<string, unknown>[]>;
    for (const a of old.accounts!) {
      delete a.ownerName;
      delete a.ownerEmail;
    }
    for (const f of old.fixedExpenses!) delete f.spread;
    for (const m of old.monthEnds!) delete m.items;
    window.localStorage.setItem(localStorageKey('local:old'), JSON.stringify(old));
    const data = await new LocalBackend().open({ id: 'local:old', name: '', kind: 'shared', source: 'local' }).load();
    expect(data.accounts.every((a) => a.ownerName === null && a.ownerEmail === null)).toBe(true);
    expect(data.fixedExpenses.every((f) => f.spread === 'daily')).toBe(true);
    expect(data.monthEnds.every((m) => m.items === null)).toBe(true);
  });
});
