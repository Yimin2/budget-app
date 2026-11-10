import { describe, expect, it, vi } from 'vitest';
import { ALL_TABS, canonicalHeaders, type RawCell } from '../schema';
import { MESSAGES, SheetsBackend, StorageError } from '../sheets';
import type { LedgerRef } from '../types';
import { sampleLedger } from './fixture';

interface Call { method: string; url: URL; body: any; auth: string }

/** 아주 작은 가짜 Sheets/Drive 서버 */
function fakeGoogle(initial?: Record<string, RawCell[][]>) {
  const tabs = new Map<string, RawCell[][]>(Object.entries(initial ?? {}));
  const calls: Call[] = [];
  const failures: number[] = []; // 다음 응답들을 이 상태 코드로
  /** 처리는 하고 응답을 잃어버릴 요청 (append 등) — 남은 횟수 */
  const lostResponses = { append: 0 };
  let title = '';

  const colIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const parseRange = (r: string) => {
    const m = /^'((?:[^']|'')+)'(?:!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?)?$/.exec(r);
    if (!m) throw new Error(`bad range ${r}`);
    return { tab: m[1]!.replace(/''/g, "'"), row: m[3] ? Number(m[3]) : 1, col: m[2] ? colIndex(m[2]) : 0, cell: !!m[2] };
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body, auth: String((init?.headers as Record<string, string>)?.Authorization) });
    const fail = failures.shift();
    if (fail) return json(fail, { error: { code: fail } });
    const path = decodeURIComponent(url.pathname);

    if (url.host === 'www.googleapis.com') return json(200, { id: 'perm1' });
    if (method === 'POST' && path === '/v4/spreadsheets') {
      title = body.properties.title;
      for (const s of body.sheets) tabs.set(s.properties.title, []);
      return json(200, { spreadsheetId: 'sheet-1' });
    }
    let m: RegExpExecArray | null;
    if ((m = /^\/v4\/spreadsheets\/([^/]+)\/values:batchGet$/.exec(path))) {
      const ranges = url.searchParams.getAll('ranges');
      const out = [];
      for (const r of ranges) {
        const { tab } = parseRange(r);
        if (!tabs.has(tab)) return json(400, { error: { message: 'Unable to parse range' } });
        out.push({ range: r, values: tabs.get(tab) });
      }
      return json(200, { valueRanges: out });
    }
    if ((m = /^\/v4\/spreadsheets\/([^/]+)\/values:batchUpdate$/.exec(path))) {
      for (const d of body.data) {
        const { tab, row, col, cell } = parseRange(d.range);
        if (!cell || (row === 1 && col === 0 && !tabs.get(tab)?.length)) {
          tabs.set(tab, d.values);
          continue;
        }
        const rows = tabs.get(tab)!;
        d.values.forEach((v: RawCell[], i: number) => {
          const target = (rows[row - 1 + i] ??= []);
          v.forEach((c, j) => (target[col + j] = c));
        });
      }
      return json(200, {});
    }
    if ((m = /^\/v4\/spreadsheets\/([^/]+)\/values\/(.+):append$/.exec(path))) {
      const { tab } = parseRange(m[2]!);
      tabs.get(tab)!.push(...body.values);
      if (lostResponses.append > 0) {
        lostResponses.append--;
        throw new TypeError('Failed to fetch');
      }
      return json(200, {});
    }
    if ((m = /^\/v4\/spreadsheets\/([^/]+)\/values\/(.+):clear$/.exec(path))) {
      tabs.set(parseRange(m[2]!).tab, []);
      return json(200, {});
    }
    if ((m = /^\/v4\/spreadsheets\/([^/]+)\/values\/(.+)$/.exec(path))) {
      const { tab, row } = parseRange(m[2]!);
      if (method === 'GET') {
        if (!tabs.has(tab)) return json(400, {});
        return json(200, { values: tabs.get(tab) });
      }
      const rows = tabs.get(tab)!;
      body.values.forEach((v: RawCell[], i: number) => (rows[row - 1 + i] = v));
      return json(200, {});
    }
    if ((m = /^\/v4\/spreadsheets\/([^/]+):batchUpdate$/.exec(path))) {
      for (const r of body.requests) {
        if (r.addSheet && tabs.has(r.addSheet.properties.title)) return json(400, { error: { message: 'already exists' } });
        if (r.addSheet) tabs.set(r.addSheet.properties.title, []);
        if (r.updateSpreadsheetProperties) title = r.updateSpreadsheetProperties.properties.title;
      }
      return json(200, {});
    }
    if ((m = /^\/v4\/spreadsheets\/([^/]+)$/.exec(path))) {
      return json(200, { properties: { title }, sheets: [...tabs.keys()].map((t) => ({ properties: { title: t } })) });
    }
    return json(500, {});
  });
  return { tabs, calls, failures, lostResponses, fetchMock, get title() { return title; } };
}

function setup(initial?: Record<string, RawCell[][]>) {
  const g = fakeGoogle(initial);
  const getToken = vi.fn(async (force?: boolean) => (force ? 'fresh-token' : 'token'));
  const sleep = vi.fn(async () => {});
  const backend = new SheetsBackend(getToken, { fetch: g.fetchMock as unknown as typeof fetch, sleep });
  return { g, getToken, sleep, backend };
}

const ref: LedgerRef = { id: 'sheet-1', name: '우리집 가계부', kind: 'shared', source: 'sheets' };

describe('SheetsBackend.create', () => {
  it('spreadsheets.create + values.batchUpdate 두 번에 끝낸다', async () => {
    const { g, backend } = setup();
    const out = await backend.create(sampleLedger());
    expect(out).toEqual(ref);
    expect(g.calls).toHaveLength(2);
    const [create, values] = g.calls;
    expect(create!.method).toBe('POST');
    expect(create!.url.href).toBe('https://sheets.googleapis.com/v4/spreadsheets');
    expect(create!.body.properties.title).toBe('우리집 가계부');
    expect(create!.body.sheets.map((s: any) => s.properties.title)).toEqual(ALL_TABS);
    expect(create!.body.sheets.every((s: any) => s.properties.gridProperties.frozenRowCount === 1)).toBe(true);
    expect(create!.auth).toBe('Bearer token');
    expect(values!.url.pathname).toBe('/v4/spreadsheets/sheet-1/values:batchUpdate');
    expect(values!.body.valueInputOption).toBe('RAW');
    expect(values!.body.data).toHaveLength(13);
    expect(g.tabs.get('통장')![0]).toEqual(canonicalHeaders('accounts'));
    expect(g.tabs.get('설정')![0]).toEqual(['키', '값']);
  });
});

describe('SheetsRepository', () => {
  it('load 는 batchGet 한 번으로 전체를 읽고 생성 데이터와 같다', async () => {
    const { g, backend } = setup();
    await backend.create(sampleLedger());
    g.calls.length = 0;
    const data = await backend.open(ref).load();
    expect(data).toEqual(sampleLedger());
    expect(g.calls).toHaveLength(1);
    const call = g.calls[0]!;
    expect(call.url.pathname).toBe('/v4/spreadsheets/sheet-1/values:batchGet');
    expect(call.url.searchParams.getAll('ranges')).toEqual(ALL_TABS.map((t) => `'${t}'`));
    expect(call.url.searchParams.get('valueRenderOption')).toBe('UNFORMATTED_VALUE');
  });

  it('없는 탭이 있어도 읽고, 그 탭에 쓰면 탭을 만든다', async () => {
    const { g, backend } = setup();
    await backend.create(sampleLedger());
    g.tabs.delete('즐겨찾기');
    const repo = backend.open(ref);
    const data = await repo.load();
    expect(data.favorites).toEqual([]);
    expect(data.accounts).toHaveLength(7);
    await repo.insert('favorites', [sampleLedger().favorites[0]!]);
    expect(g.tabs.get('즐겨찾기')).toEqual([canonicalHeaders('favorites'), ['v1', '커피', 4500, 'c1', 'a-fix', 0, false]]);
  });

  it('insert 는 마지막 스냅샷에 있는 키를 건너뛰고 INSERT_ROWS 로 append', async () => {
    const { g, backend } = setup();
    await backend.create(sampleLedger());
    const repo = backend.open(ref);
    await repo.load();
    g.calls.length = 0;
    const base = sampleLedger();
    await repo.insert('expenses', [base.expenses[0]!, { ...base.expenses[0]!, id: 'x9' }, { ...base.expenses[0]!, id: 'x9' }]);
    await repo.insert('monthEnds', [base.monthEnds[0]!]); // 이미 있음 → 요청 없음
    await repo.insert('members', [{ email: 'junho@example.com', displayName: 'x' }]);
    await repo.insert('expenses', [{ ...base.expenses[0]!, id: 'x9' }]); // 방금 넣은 키
    // 새 키가 있을 때만: 쓰기 직전에 탭을 새로 읽고(GET) append
    expect(g.calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    const call = g.calls[1]!;
    expect(call.method).toBe('POST');
    // 탭 전체 범위 → 빈 행이 끼어 있어도 표 끝에 붙는다
    expect(decodeURIComponent(call.url.pathname)).toBe("/v4/spreadsheets/sheet-1/values/'지출':append");
    expect(call.url.searchParams.get('valueInputOption')).toBe('RAW');
    expect(call.url.searchParams.get('insertDataOption')).toBe('INSERT_ROWS');
    expect(call.body.values).toHaveLength(1);
    expect(call.body.values[0][0]).toBe('x9');
  });

  it('upsert 는 새로 읽은 행 위치를 고친다 (사이에 다른 사람이 행을 추가해도)', async () => {
    const { g, backend } = setup();
    await backend.create(sampleLedger());
    const repo = backend.open(ref);
    await repo.load();
    // 다른 사람이 위쪽에 행을 끼워 넣음
    const rows = g.tabs.get('지출')!;
    rows.splice(1, 0, ['y0', '2026-11-01', 1, 'a-fix', '', '', '', '', 'junho', '', '', false]);
    g.calls.length = 0;
    await repo.upsert('expenses', { ...sampleLedger().expenses[0]!, amount: 99 });
    const write = g.calls.find((c) => c.method === 'POST')!;
    expect(decodeURIComponent(write.url.pathname)).toBe('/v4/spreadsheets/sheet-1/values:batchUpdate');
    expect(write.body.valueInputOption).toBe('RAW');
    expect(write.body.data.map((d: any) => d.range)).toEqual(["'지출'!A3:Q3"]);
    expect(g.tabs.get('지출')![2]![2]).toBe(99);
    expect(g.tabs.get('지출')![1]![0]).toBe('y0');
  });

  it('upsert: 손으로 바꾼 열 순서·추가 열을 지키고, 없으면 append', async () => {
    const { g, backend } = setup({
      월말: [
        ['처리', '사용자메모', '월', '남은생활비'],
        ['미정', '손으로 쓴 메모', 46296, 1000], // 2026-10 (시리얼)
      ],
    });
    const repo = backend.open(ref);
    await repo.upsert('monthEnds', {
      month: '2026-10', leftover: 2000, choice: 'reservoir', decidedBy: 'a@b.c', decidedAt: 'now',
      items: [{ categoryId: 'c-food', leftover: 2500 }, { categoryId: null, leftover: -500 }],
    });
    // 빠진 앱 열(처리자·처리일시·항목별)은 머리글 끝에 다시 붙이고, 손으로 쓴 메모 칸은 건드리지 않는다
    expect(g.tabs.get('월말')![0]).toEqual(['처리', '사용자메모', '월', '남은생활비', '처리자', '처리일시', '항목별']);
    expect(g.tabs.get('월말')![1]).toEqual([
      '저수지', '손으로 쓴 메모', '2026-10', 2000, 'a@b.c', 'now', '{"c-food":2500,"":-500}',
    ]);
    await repo.upsert('monthEnds', { month: '2026-11', leftover: 5, choice: 'pending', decidedBy: null, decidedAt: null, items: null });
    expect(g.tabs.get('월말')![2]).toEqual(['미정', '', '2026-11', 5, '', '', '']);
  });

  it('updateSettings 는 설정 탭을 다시 쓰고 이름이면 제목도 바꾼다', async () => {
    const { g, backend } = setup();
    await backend.create(sampleLedger());
    g.tabs.get('설정')!.push(['생활비통장ID', 'a-fix']);
    const repo = backend.open(ref);
    await repo.load();
    await repo.updateSettings({ name: '새 가계부' });
    expect(g.tabs.get('설정')).toContainEqual(['이름', '새 가계부']);
    expect(g.tabs.get('설정')).toContainEqual(['생활비통장ID', 'a-fix']);
    expect(g.title).toBe('새 가계부');
    expect((await repo.load()).settings.name).toBe('새 가계부');
  });
});

describe('SheetsBackend 기타', () => {
  it('share 는 Drive permissions.create writer + 알림 메일', async () => {
    const { g, backend } = setup();
    await backend.share(ref, 'guest@example.com');
    const call = g.calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url.origin + call.url.pathname).toBe('https://www.googleapis.com/drive/v3/files/sheet-1/permissions');
    expect(call.url.searchParams.get('sendNotificationEmail')).toBe('true');
    expect(call.body).toEqual({ role: 'writer', type: 'user', emailAddress: 'guest@example.com' });
  });

  it('describe 는 제목과 종류', async () => {
    const { backend } = setup();
    await backend.create({ ...sampleLedger(), settings: { ...sampleLedger().settings, kind: 'personal', name: '내 용돈' } });
    expect(await backend.describe('sheet-1')).toEqual({ id: 'sheet-1', name: '내 용돈', kind: 'personal', source: 'sheets' });
  });
});

describe('오류와 재시도', () => {
  it('401 이면 토큰을 새로 받아 한 번 다시 시도', async () => {
    const { g, getToken, backend } = setup();
    g.failures.push(401);
    await backend.share(ref, 'a@b.c');
    expect(g.calls.map((c) => c.auth)).toEqual(['Bearer token', 'Bearer fresh-token']);
    expect(getToken).toHaveBeenLastCalledWith(true);
  });

  it('401 이 두 번이면 로그인 만료 오류', async () => {
    const { g, backend } = setup();
    g.failures.push(401, 401);
    await expect(backend.share(ref, 'a@b.c')).rejects.toThrow(MESSAGES.unauthorized);
    expect(g.calls).toHaveLength(2);
  });

  it('429/5xx 는 기다렸다가 최대 3번 다시 시도', async () => {
    const { g, sleep, backend } = setup();
    g.failures.push(429, 503, 500);
    await backend.share(ref, 'a@b.c');
    expect(g.calls).toHaveLength(4);
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([500, 1000, 2000]);

    g.calls.length = 0;
    g.failures.push(429, 429, 429, 429);
    await expect(backend.share(ref, 'a@b.c')).rejects.toThrow(MESSAGES.busy);
    expect(g.calls).toHaveLength(4);
  });

  it('403/404 는 한글 안내', async () => {
    const { g, backend } = setup();
    g.failures.push(403);
    const err = await backend.open(ref).load().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).message).toBe('이 가계부에 접근할 권한이 없어요. 가계부를 만든 사람에게 공유를 부탁해 주세요');
    expect((err as StorageError).status).toBe(403);
    g.failures.push(404);
    await expect(backend.open(ref).load()).rejects.toThrow(MESSAGES.notFound);
  });

  it('네트워크 오류는 재시도 뒤 연결 안내', async () => {
    const sleep = vi.fn(async () => {});
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const backend = new SheetsBackend(async () => 't', { fetch: fetchMock as unknown as typeof fetch, sleep });
    await expect(backend.share(ref, 'a@b.c')).rejects.toThrow(MESSAGES.network);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('검증된 결함 회귀', () => {
  const auto = () => ({
    ...sampleLedger().transfers[0]!,
    id: 'auto:r1:2026-11', kind: 'transfer' as const, fromAccountId: 'a-inc', toAccountId: 'a-res', amount: 300000, status: 'done' as const,
  });

  it('두 기기가 각자 불러온 뒤 같은 자동 기록을 써도 한 줄만 생긴다', async () => {
    const { g, backend } = setup();
    await backend.create(sampleLedger());
    const a = backend.open(ref);
    const b = backend.open(ref);
    await a.load();
    await b.load();
    await a.insert('transfers', [auto()]);
    await b.insert('transfers', [auto()]);
    expect(g.tabs.get('이체')!.filter((r) => r[0] === 'auto:r1:2026-11')).toHaveLength(1);
  });

  it('이미 중복된 행은 읽을 때 한 번만 세고, 지우면 모든 줄이 지워진다', async () => {
    const { g, backend } = setup();
    await backend.create(sampleLedger());
    const repo = backend.open(ref);
    await repo.load();
    await repo.insert('transfers', [auto()]);
    const tab = g.tabs.get('이체')!;
    tab.push([...tab[tab.length - 1]!]);
    const data = await repo.load();
    expect(data.transfers.filter((t) => t.id === 'auto:r1:2026-11')).toHaveLength(1);
    await repo.upsert('transfers', { ...auto(), deleted: true });
    const rows = g.tabs.get('이체')!.filter((r) => r[0] === 'auto:r1:2026-11');
    expect(rows.map((r) => r[12])).toEqual([true, true]);
  });

  it('append 응답이 끊겨도 같은 행을 두 번 쓰지 않는다', async () => {
    const { g, backend } = setup();
    await backend.create(sampleLedger());
    const repo = backend.open(ref);
    await repo.load();
    g.lostResponses.append = 1;
    const e = { ...sampleLedger().expenses[0]!, id: 'e-dup', amount: 10000 };
    await repo.insert('expenses', [e]);
    expect(g.tabs.get('지출')!.filter((r) => r[0] === 'e-dup')).toHaveLength(1);
    expect(g.calls.filter((c) => c.url.pathname.endsWith(':append'))).toHaveLength(1);
  });

  it('파일 만들기는 5xx 에 자동으로 다시 보내지 않는다', async () => {
    const { g, backend } = setup();
    g.failures.push(503);
    await expect(backend.create(sampleLedger())).rejects.toThrow(MESSAGES.busy);
    expect(g.calls).toHaveLength(1);
  });

  it('설정 쓰기는 한 번의 PUT — 실패해도 설정 탭이 비지 않고, 그사이 추가된 줄도 지킨다', async () => {
    const { g, backend } = setup();
    await backend.create({ ...sampleLedger(), settings: { ...sampleLedger().settings, kind: 'personal', sharedLedgerId: 'shared-xyz' } });
    const repo = backend.open(ref);
    await repo.load();
    const before = JSON.stringify(g.tabs.get('설정'));
    g.failures.push(0, 503, 503, 503, 503); // GET 통과, PUT 네 번 실패
    await expect(repo.updateSettings({ name: '바뀐 이름' })).rejects.toThrow();
    expect(JSON.stringify(g.tabs.get('설정'))).toBe(before);
    expect(g.calls.some((c) => c.url.pathname.endsWith(':clear'))).toBe(false);

    g.tabs.get('설정')!.push(['나중추가', 'v']);
    await repo.updateSettings({ name: '바뀐 이름' });
    expect(g.tabs.get('설정')).toContainEqual(['나중추가', 'v']);
    expect(g.tabs.get('설정')).toContainEqual(['공용가계부ID', 'shared-xyz']);
  });

  it('가계부가 아닌 스프레드시트는 열지 않는다', async () => {
    const { backend } = setup({ 지출: [['날짜', '금액', '내용'], ['2026-11-01', 12000, '점심']] });
    await expect(backend.describe('sheet-1')).rejects.toThrow(MESSAGES.notLedger);
    await expect(backend.open(ref).load()).rejects.toThrow(MESSAGES.notLedger);
  });

  it('삭제됨 열을 지운 탭도 지우기가 저장된다 (열을 다시 붙임)', async () => {
    const { g, backend } = setup();
    await backend.create(sampleLedger());
    const tab = g.tabs.get('지출')!;
    const del = tab[0]!.indexOf('삭제됨');
    for (const row of tab) row.splice(del, 1);
    const repo = backend.open(ref);
    await repo.load();
    await repo.upsert('expenses', { ...sampleLedger().expenses[0]!, deleted: true });
    expect((await repo.load()).expenses.find((e) => e.id === 'x1')?.deleted).toBe(true);
  });

  it('upsert 는 모르는 열(수식 등)을 다시 쓰지 않는다', async () => {
    const { g, backend } = setup();
    await backend.create(sampleLedger());
    const tab = g.tabs.get('지출')!;
    tab[0]!.push('월');
    tab[1]!.push('=LEFT(B2,7)');
    const repo = backend.open(ref);
    await repo.upsert('expenses', { ...sampleLedger().expenses[0]!, date: '2026-12-01' });
    const write = g.calls.at(-1)!;
    expect(write.body.data.map((d: any) => d.range)).toEqual(["'지출'!A2:Q2"]);
    expect(g.tabs.get('지출')![1]![17]).toBe('=LEFT(B2,7)');
  });

  it('불러온 뒤 열 순서가 바뀌어도 insert 는 새 머리글 순서로 쓴다', async () => {
    const { g, backend } = setup();
    await backend.create(sampleLedger());
    const repo = backend.open(ref);
    await repo.load();
    const h = g.tabs.get('지출')![0]!;
    [h[1], h[2]] = [h[2]!, h[1]!]; // 날짜 ↔ 금액
    await repo.insert('expenses', [{ ...sampleLedger().expenses[0]!, id: 'e-new', date: '2026-11-09', amount: 4500 }]);
    const got = (await repo.load()).expenses.find((e) => e.id === 'e-new')!;
    expect(got.date).toBe('2026-11-09');
    expect(got.amount).toBe(4500);
  });

  it('나중에 더한 탭(여행)이 없는 예전 가계부는 불러올 때 한 번 만들어, 다음부터는 batchGet 한 번으로 읽는다', async () => {
    const { g, backend } = setup();
    await backend.create(sampleLedger());
    g.tabs.delete('여행');
    const repo = backend.open(ref);
    await repo.load();
    expect(g.tabs.get('여행')).toEqual([canonicalHeaders('trips')]);
    const before = g.calls.length;
    const data = await repo.load();
    expect(data.trips).toEqual([]);
    expect(g.calls.length - before).toBe(1);
  });

  it('가계부가 아닌 파일에는 탭을 만들지 않는다', async () => {
    const { g, backend } = setup({ Sheet1: [['a', 'b']] });
    await expect(backend.open(ref).load()).rejects.toThrow(MESSAGES.notLedger);
    expect([...g.tabs.keys()]).toEqual(['Sheet1']);
  });

  it('없던 탭을 다른 사람이 먼저 만들었어도 insert 가 된다', async () => {
    const { g, backend } = setup();
    await backend.create(sampleLedger());
    g.tabs.delete('즐겨찾기');
    const a = backend.open(ref);
    const b = backend.open(ref);
    await a.load();
    await b.load();
    await b.insert('favorites', [sampleLedger().favorites[0]!]);
    await a.insert('favorites', [{ ...sampleLedger().favorites[0]!, id: 'v9' }]);
    expect(g.tabs.get('즐겨찾기')!.map((r) => r[0])).toEqual(['id', 'v1', 'v9']);
  });
});
