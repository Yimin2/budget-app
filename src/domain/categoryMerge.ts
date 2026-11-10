/**
 * 카테고리 합치기 (설정 → 카테고리 → 다른 카테고리로 합치기).
 * 합칠 카테고리(source)를 쓰는 지출 · 생활비 예산 행 · 고정비 · 자주 쓰는 지출 · 일정을 target 으로 옮기고 source 를 지운 것으로 표시한다.
 * - 생활비 예산: 같은 통장에 target 예산이 같은 달에 있으면 금액을 target 행에 더하고(달 경계가 다르면 그 달부터 나눈 행),
 *   없는 달은 source 행을 target 으로 돌린다. '이 달만 다른 금액' 행은 그달 두 항목의 실제 금액 합으로 맞춘다
 * - 다시 해도 같다: 한 번 합친 뒤에는 source 를 쓰는 행이 없어 바꿀 게 없다
 * - 되돌리기용 행(undo)도 함께 돌려준다: 바꾼 행은 원래 값, 새로 만든 행은 지운 것으로
 */
import { addMonths } from './dates';
import { isLivingOverride, livingSegmentId, livingSeriesId } from './living';
import type { Category, Expense, Favorite, FixedExpense, Id, LedgerData, PlannedEvent, YearMonth } from './types';

export interface CategoryMergeCounts {
  expenses: number;
  /** 생활비 예산 항목 (통장마다 하나) */
  budgets: number;
  /** 고정비 · 할부 (생활비 아닌 고정 지출) */
  fixed: number;
  favorites: number;
  events: number;
}

export interface CategoryMergeRows {
  expenses: Expense[];
  events: PlannedEvent[];
  favorites: Favorite[];
  fixedExpenses: FixedExpense[];
  categories: Category[];
}

export interface CategoryMergePlan extends CategoryMergeRows {
  source: Category;
  target: Category;
  counts: CategoryMergeCounts;
  /** 되돌리기: 이 행들을 그대로 쓰면 합치기 전으로 돌아간다 */
  undo: CategoryMergeRows;
}

const isActiveIn = (f: Pick<FixedExpense, 'startMonth' | 'endMonth'>, m: YearMonth) => f.startMonth <= m && (!f.endMonth || f.endMonth >= m);

/**
 * 미리 보기 문구의 앞부분: '지출 3건 · 예산 1개' (0 인 것은 빼고, 지출 · 예산은 늘).
 * 예전에 등록한 자주 쓰는 지출(즐겨찾기)은 화면에 없어서 문구에 넣지 않아요 (행은 그대로 옮겨요)
 */
export function mergeCountsText(c: CategoryMergeCounts): string {
  const parts = [`지출 ${c.expenses}건`, `예산 ${c.budgets}개`];
  if (c.fixed > 0) parts.push(`고정비 ${c.fixed}개`);
  if (c.events > 0) parts.push(`일정 ${c.events}개`);
  return parts.join(' · ');
}

export function planCategoryMerge(data: LedgerData, sourceId: Id, targetId: Id): CategoryMergePlan {
  if (sourceId === targetId) throw new Error('같은 카테고리로는 합칠 수 없어요');
  const source = data.categories.find((c) => c.id === sourceId && !c.deleted);
  const target = data.categories.find((c) => c.id === targetId && !c.deleted);
  if (!source) throw new Error('합칠 카테고리를 찾을 수 없어요');
  if (!target) throw new Error('합칠 대상 카테고리를 찾을 수 없어요');

  const expenses = data.expenses.filter((e) => !e.deleted && e.categoryId === sourceId).map((e) => ({ ...e, categoryId: targetId }));
  const events = data.events.filter((e) => !e.deleted && e.categoryId === sourceId).map((e) => ({ ...e, categoryId: targetId }));
  const favorites = data.favorites.filter((f) => !f.deleted && f.categoryId === sourceId).map((f) => ({ ...f, categoryId: targetId }));

  const otherFixed = data.fixedExpenses
    .filter((f) => !f.deleted && f.kind !== 'living' && f.categoryId === sourceId)
    .map((f) => ({ ...f, categoryId: targetId }));

  const living = mergeLivingRows(data.fixedExpenses, sourceId, targetId, target.name);
  const fixedExpenses = [...otherFixed, ...living.rows];
  const categories: Category[] = [{ ...source, deleted: true }];

  const byId = <T extends { id: Id }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
  const exAll = byId(data.expenses);
  const evAll = byId(data.events);
  const favAll = byId(data.favorites);
  const fxAll = byId(data.fixedExpenses);
  const undo: CategoryMergeRows = {
    expenses: expenses.map((e) => exAll.get(e.id)!),
    events: events.map((e) => evAll.get(e.id)!),
    favorites: favorites.map((f) => favAll.get(f.id)!),
    fixedExpenses: fixedExpenses.map((f) => fxAll.get(f.id) ?? { ...f, deleted: true }),
    categories: [source],
  };

  return {
    source,
    target,
    expenses,
    events,
    favorites,
    fixedExpenses,
    categories,
    counts: {
      expenses: expenses.length,
      budgets: living.budgets,
      fixed: otherFixed.length,
      favorites: favorites.length,
      events: events.length,
    },
    undo,
  };
}

/** 생활비 예산 행 합치기. 바뀐 행 · 새 행과 source 예산이 있던 통장 수 */
function mergeLivingRows(all: FixedExpense[], sourceId: Id, targetId: Id, targetName: string): { rows: FixedExpense[]; budgets: number } {
  const livingRows = all.filter((f) => !f.deleted && f.kind === 'living');
  const sourceRows = livingRows.filter((f) => f.categoryId === sourceId);
  const accounts = [...new Set(sourceRows.map((f) => f.accountId))];
  const usedIds = new Set(all.map((f) => f.id));
  const out = new Map<Id, FixedExpense>();
  const put = (f: FixedExpense) => out.set(f.id, f);
  const freshId = (row: FixedExpense, month: YearMonth): Id => {
    const base = livingSegmentId(livingSeriesId(row.id), month);
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
    usedIds.add(id);
    return id;
  };

  for (const acc of accounts) {
    const S = sourceRows.filter((f) => f.accountId === acc && !isLivingOverride(f));
    const T = livingRows.filter((f) => f.accountId === acc && f.categoryId === targetId && !isLivingOverride(f));
    const sumAt = (rows: FixedExpense[], m: YearMonth) => rows.filter((r) => isActiveIn(r, m)).reduce((n, r) => n + r.amount, 0);

    // 달 경계: 행이 시작하는 달과 끝난 다음 달
    const bounds = [...new Set([...S, ...T].flatMap((r) => [r.startMonth, ...(r.endMonth ? [addMonths(r.endMonth, 1)] : [])]))].sort();
    /** row 기간을 경계로 나눈 조각 [시작, 끝(null = 끝없음)] */
    const piecesOf = (row: FixedExpense): [YearMonth, YearMonth | null][] => {
      const cuts = bounds.filter((b) => b > row.startMonth && (!row.endMonth || b <= row.endMonth));
      const starts = [row.startMonth, ...cuts];
      return starts.map((s, i) => [s, i + 1 < starts.length ? addMonths(starts[i + 1]!, -1) : row.endMonth]);
    };

    // 1) target 행: source 가 같은 달에 있으면 금액을 더한다 (금액이 같은 이웃 조각은 한 행으로)
    for (const t of T) {
      if (!S.some((s) => overlaps(s, t))) continue;
      const pieces = mergeEqual(piecesOf(t).map(([ps, pe]) => ({ ps, pe, amount: t.amount + sumAt(S, ps) })));
      pieces.forEach((p, i) => {
        if (i === 0) {
          if (p.amount !== t.amount || p.pe !== t.endMonth) put({ ...t, amount: p.amount, endMonth: p.pe });
        } else put({ ...t, id: freshId(t, p.ps), amount: p.amount, startMonth: p.ps, endMonth: p.pe, deleted: false });
      });
    }

    // 2) source 행: target 이 없는 달은 target 으로 돌리고, 있는 달은 위에서 더했으니 뺀다
    for (const s of S) {
      const free = mergeEqual(
        piecesOf(s)
          .filter(([ps]) => !T.some((t) => isActiveIn(t, ps)))
          .map(([ps, pe]) => ({ ps, pe, amount: s.amount })),
      );
      if (free.length === 0) {
        put({ ...s, deleted: true });
        continue;
      }
      free.forEach((p, i) => {
        const moved = { ...s, categoryId: targetId, name: targetName, startMonth: p.ps, endMonth: p.pe };
        put(i === 0 ? moved : { ...moved, id: freshId(s, p.ps), deleted: false });
      });
    }

    // 3) 이 달만 다른 금액: 그달 두 항목의 실제 금액 합으로
    const SO = sourceRows.filter((f) => f.accountId === acc && isLivingOverride(f));
    const TO = livingRows.filter((f) => f.accountId === acc && f.categoryId === targetId && isLivingOverride(f));
    const months = [...new Set([...SO, ...TO].map((o) => o.startMonth))].sort();
    for (const m of months) {
      const so = SO.filter((o) => o.startMonth === m);
      const to = TO.filter((o) => o.startMonth === m);
      const srcAmt = so.length > 0 ? so.reduce((n, o) => n + o.amount, 0) : sumAt(S, m);
      const tgtAmt = to.length > 0 ? to.reduce((n, o) => n + o.amount, 0) : sumAt(T, m);
      if (to.length > 0) {
        if (srcAmt !== 0) put({ ...to[0]!, amount: to[0]!.amount + srcAmt });
        for (const o of so) put({ ...o, deleted: true });
      } else {
        so.forEach((o, i) => put({ ...o, categoryId: targetId, name: targetName, amount: i === 0 ? o.amount + tgtAmt : o.amount }));
      }
    }
  }
  return { rows: [...out.values()], budgets: accounts.length };
}

function overlaps(a: Pick<FixedExpense, 'startMonth' | 'endMonth'>, b: Pick<FixedExpense, 'startMonth' | 'endMonth'>): boolean {
  return (!a.endMonth || a.endMonth >= b.startMonth) && (!b.endMonth || b.endMonth >= a.startMonth);
}

/** 이어지고 금액이 같은 조각을 하나로 (끊긴 조각은 따로, 조각은 늘 시작 순) */
function mergeEqual(pieces: { ps: YearMonth; pe: YearMonth | null; amount: number }[]) {
  const out: { ps: YearMonth; pe: YearMonth | null; amount: number }[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    const touching = last && last.pe !== null && addMonths(last.pe, 1) === p.ps;
    if (last && touching && last.amount === p.amount) last.pe = p.pe;
    else out.push({ ...p });
  }
  return out;
}

/** 합치기 결과(또는 되돌리기 행)를 데이터에 적용 (화면에 먼저 반영할 때) */
export function applyMergeRows(data: LedgerData, rows: CategoryMergeRows): LedgerData {
  const upsert = <T extends { id: Id }>(list: T[], changed: T[]): T[] => {
    if (changed.length === 0) return list;
    const map = new Map(changed.map((r) => [r.id, r]));
    const next = list.map((r) => map.get(r.id) ?? r);
    const have = new Set(list.map((r) => r.id));
    for (const r of changed) if (!have.has(r.id)) next.push(r);
    return next;
  };
  return {
    ...data,
    expenses: upsert(data.expenses, rows.expenses),
    events: upsert(data.events, rows.events),
    favorites: upsert(data.favorites, rows.favorites),
    fixedExpenses: upsert(data.fixedExpenses, rows.fixedExpenses),
    categories: upsert(data.categories, rows.categories),
  };
}
